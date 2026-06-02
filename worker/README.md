# India Datacenter Watch — Worker backend

A small Cloudflare Worker that gives the static site a real report backend:
community submissions are stored, photos are uploaded, and **approved** reports
appear on the map as `community_reported` pins and in the Photos gallery.

## Routes

| Method | Path        | Purpose                                                        |
|--------|-------------|----------------------------------------------------------------|
| GET    | `/health`   | Liveness; shows whether KV/R2 are bound                        |
| POST   | `/report`   | Accept a report (multipart form, up to 5 photos)              |
| GET    | `/reports`  | Approved reports **with coordinates** → map pins              |
| GET    | `/photos`   | Approved photo descriptors → gallery                          |
| GET    | `/photo?key=…` | Stream a stored photo (only if its report is approved)    |
| POST   | `/approve`  | Admin: mark a report approved (`Authorization: Bearer <ADMIN_TOKEN>`) |

Submissions land **unapproved**. Nothing is shown publicly until you approve it —
this is the moderation gate.

## Deploy

```bash
cd worker
npm install
npx wrangler login

# 1. Create storage
npx wrangler kv namespace create REPORTS      # paste the id into wrangler.toml
npx wrangler r2 bucket create india-dc-watch-photos

# 2. Set the admin token (used by /approve)
npx wrangler secret put ADMIN_TOKEN

# 3. Ship it
npx wrangler deploy
```

Wrangler prints a URL like `https://india-dc-watch-api.<you>.workers.dev`.
Put that in **`web/config.js`**:

```js
window.DC_WATCH_API = "https://india-dc-watch-api.<you>.workers.dev";
```

The site auto-detects it: the report form starts submitting live (with photo
uploads), the Photos gallery loads approved photos, and approved reports with
coordinates render as community-reported pins.

## Moderating submissions

```bash
# List submissions
npx wrangler kv key list --binding REPORTS

# Read one
npx wrangler kv key get --binding REPORTS "report:<ts>:<id>"

# Approve (makes it public)
curl -X POST https://india-dc-watch-api.<you>.workers.dev/approve \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"id":"<the-report-id>"}'
```

Approved reports that include coordinates appear on the map; their photos appear
in the gallery. Promote verified facilities into `data/datacenters.csv` for the
permanent dataset.

## Local dev

```bash
npx wrangler dev    # serves on http://127.0.0.1:8787
```
Set `window.DC_WATCH_API = "http://127.0.0.1:8787"` in `web/config.js` while testing.
