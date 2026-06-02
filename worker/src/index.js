/**
 * India Datacenter Watch — report ingestion Worker (Cloudflare).
 *
 * Routes:
 *   GET  /health           — liveness
 *   POST /report           — accept a community report (multipart form, up to 5 photos)
 *   GET  /photos           — list APPROVED community photos (for the gallery)
 *   GET  /photo?key=<k>    — stream a stored photo (only if its report is approved)
 *   POST /approve          — admin: mark a report approved (Bearer ADMIN_TOKEN)
 *
 * Bindings (see wrangler.toml):
 *   REPORTS  — KV namespace (report records)
 *   PHOTOS   — R2 bucket (uploaded images)
 *   ADMIN_TOKEN — secret (wrangler secret put ADMIN_TOKEN)
 */

const MAX_PHOTOS = 5;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const OK_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"];

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
  };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors() },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

    try {
      if (url.pathname === "/health") {
        return json({ ok: true, kv: !!env.REPORTS, r2: !!env.PHOTOS });
      }
      if (url.pathname === "/report" && request.method === "POST") return handleReport(request, env);
      if (url.pathname === "/reports" && request.method === "GET") return listReports(env);
      if (url.pathname === "/photos" && request.method === "GET") return listPhotos(env);
      if (url.pathname === "/photo" && request.method === "GET") return streamPhoto(url, env);
      if (url.pathname === "/approve" && request.method === "POST") return approve(request, env);
      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: "server error", detail: String(err && err.message || err) }, 500);
    }
  },
};

async function handleReport(request, env) {
  if (!env.REPORTS) return json({ error: "storage not configured" }, 503);

  const form = await request.formData();
  const f = (k) => (form.get(k) || "").toString().trim();

  const agreed = f("agreed");
  const location = f("location");
  if (agreed !== "true") return json({ error: "agreement required" }, 400);
  if (!location) return json({ error: "facility location is required" }, 400);

  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  const lat = parseFloat(f("latitude"));
  const lng = parseFloat(f("longitude"));
  const hasCoords = isFinite(lat) && isFinite(lng) && lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98;

  // Store photos (if any) in R2.
  const photoKeys = [];
  if (env.PHOTOS) {
    const files = form.getAll("photos").filter((p) => p && typeof p === "object" && "arrayBuffer" in p);
    for (let i = 0; i < files.length && i < MAX_PHOTOS; i++) {
      const file = files[i];
      if (file.size > MAX_BYTES) continue;
      if (file.type && !OK_TYPES.includes(file.type)) continue;
      const safe = (file.name || "photo").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
      const key = `photos/${id}/${i}-${safe}`;
      await env.PHOTOS.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
      photoKeys.push(key);
    }
  }

  const record = {
    id, ts, approved: false,
    name: f("name"), phone: f("phone"), address: f("address"), email: f("email"),
    location, operator: f("operator"), status: f("status") || "community_reported",
    latitude: hasCoords ? lat : null, longitude: hasCoords ? lng : null,
    issue: f("issue"), other: f("other"), photoKeys,
  };
  await env.REPORTS.put(`report:${ts}:${id}`, JSON.stringify(record), {
    metadata: { approved: false, location, photos: photoKeys.length },
  });

  return json({ ok: true, id });
}

async function listReports(env) {
  // Approved community reports that carry coordinates — rendered as map pins.
  if (!env.REPORTS) return json([]);
  const out = [];
  const list = await env.REPORTS.list({ prefix: "report:", limit: 1000 });
  for (const k of list.keys) {
    if (!(k.metadata && k.metadata.approved)) continue;
    const rec = await env.REPORTS.get(k.name, "json");
    if (!rec || !rec.approved || rec.latitude == null || rec.longitude == null) continue;
    out.push({
      id: rec.id, name: rec.location || "Community report", operator: rec.operator || "Community-reported",
      status: "community_reported", latitude: rec.latitude, longitude: rec.longitude,
      notes: rec.issue || "", ts: rec.ts, photos: (rec.photoKeys || []).length,
    });
  }
  return json(out);
}

async function listPhotos(env) {
  if (!env.REPORTS) return json([]);
  const out = [];
  const list = await env.REPORTS.list({ prefix: "report:", limit: 1000 });
  for (const k of list.keys) {
    if (!(k.metadata && k.metadata.approved && k.metadata.photos)) continue;
    const rec = await env.REPORTS.get(k.name, "json");
    if (!rec || !rec.approved) continue;
    (rec.photoKeys || []).forEach((key) => out.push({ url: `/photo?key=${encodeURIComponent(key)}`, location: rec.location, ts: rec.ts }));
  }
  return json(out);
}

async function streamPhoto(url, env) {
  if (!env.PHOTOS || !env.REPORTS) return json({ error: "not configured" }, 503);
  const key = url.searchParams.get("key") || "";
  // Only serve photos whose report is approved.
  const id = (key.split("/")[1]) || "";
  const list = await env.REPORTS.list({ prefix: "report:", limit: 1000 });
  let approved = false;
  for (const k of list.keys) {
    if (k.name.endsWith(id)) { approved = !!(k.metadata && k.metadata.approved); break; }
  }
  if (!approved) return json({ error: "not found" }, 404);
  const obj = await env.PHOTOS.get(key);
  if (!obj) return json({ error: "not found" }, 404);
  return new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "public, max-age=86400", ...cors() },
  });
}

async function approve(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "unauthorized" }, 401);
  const body = await request.json().catch(() => ({}));
  const id = (body.id || "").toString();
  if (!id) return json({ error: "id required" }, 400);

  const list = await env.REPORTS.list({ prefix: "report:", limit: 1000 });
  for (const k of list.keys) {
    if (!k.name.endsWith(id)) continue;
    const rec = await env.REPORTS.get(k.name, "json");
    if (!rec) break;
    rec.approved = true;
    await env.REPORTS.put(k.name, JSON.stringify(rec), { metadata: { approved: true, location: rec.location, photos: (rec.photoKeys || []).length } });
    return json({ ok: true, id });
  }
  return json({ error: "not found" }, 404);
}
