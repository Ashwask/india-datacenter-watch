/* India Datacenter Watch — map + filters + statistics + reporting.
   Data comes from data.js (window.DATACENTERS), generated from data/datacenters.csv. */
(function () {
  "use strict";

  var DATA = (window.DATACENTERS || []).slice();
  var API_BASE = (window.DC_WATCH_API || "").replace(/\/+$/, "");

  var STATUS = {
    operational:        { cls: "operational", label: "Operational" },
    under_construction: { cls: "under",       label: "Under construction" },
    proposed:           { cls: "proposed",    label: "Proposed" },
    community_reported: { cls: "reported",    label: "Community-reported" }
  };
  var COLOR = {
    operational: "#2ea043", under_construction: "#d29922",
    proposed: "#539bf5", community_reported: "#db61a2", decommissioned: "#6b7785"
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ---- map (locked to India) ----
  var INDIA_BOUNDS = L.latLngBounds([6.4, 67.5], [35.8, 97.5]);
  var map = L.map("map", {
    scrollWheelZoom: true, zoomControl: true,
    minZoom: 4, maxZoom: 19,
    maxBounds: INDIA_BOUNDS, maxBoundsViscosity: 1.0
  });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19, subdomains: "abcd",
    bounds: INDIA_BOUNDS, noWrap: true
  }).addTo(map);
  map.fitBounds(INDIA_BOUNDS, { padding: [10, 10] });

  // Cluster overlapping markers (131/191 facilities share a city-centroid coordinate).
  // Falls back to a plain layer group if the plugin didn't load.
  var layer = (typeof L.markerClusterGroup === "function")
    ? L.markerClusterGroup({
        maxClusterRadius: 44,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        spiderfyDistanceMultiplier: 1.7,
        chunkedLoading: true
      })
    : L.layerGroup();
  layer.addTo(map);
  var enabled = { operational: true, under_construction: true, proposed: true, community_reported: true };
  var legendRows = {};

  function syncLegend() {
    Object.keys(legendRows).forEach(function (k) {
      legendRows[k].classList.toggle("off", !enabled[k]);
    });
  }
  function scrollToMap() {
    showTab("map");
    var el = document.getElementById("map-anchor");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- tabs (single-section view) ----
  var TAB_SECTIONS = {
    map: ["map-anchor"],
    directory: ["directory"],
    impact: ["concerns", "statistics", "impact"],
    action: ["response"],
    photos: ["photos"],
    about: ["about", "news", "faq"],
    report: ["report"]
  };
  function showTab(name) {
    if (!TAB_SECTIONS[name]) name = "map";
    Object.keys(TAB_SECTIONS).forEach(function (tab) {
      var shown = (tab === name);
      TAB_SECTIONS[tab].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { el.style.display = shown ? "" : "none"; el.setAttribute("aria-hidden", shown ? "false" : "true"); }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("nav.top a[data-tab]"), function (a) {
      var sel = a.getAttribute("data-tab") === name;
      a.classList.toggle("active", sel);
      a.setAttribute("aria-selected", sel ? "true" : "false");
      a.setAttribute("tabindex", sel ? "0" : "-1");
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (name === "map" && typeof map !== "undefined") {
      // Container just became visible / resized — recompute so tiles fill it.
      requestAnimationFrame(function () { map.invalidateSize(); });
      setTimeout(function () { map.invalidateSize(); }, 120);
      setTimeout(function () { map.invalidateSize(); }, 350);
    }
    if (name === "impact") persistentCharts.forEach(function (c) { try { c.resize(); } catch (e) {} });
  }
  function setupTabs() {
    // Hide the inter-section dividers (tabs separate content now).
    Array.prototype.forEach.call(document.querySelectorAll(".divider"), function (d) {
      var w = d.closest(".content"); if (w) w.style.display = "none";
    });
    // ARIA roles on tabs and panels.
    var tabEls = [];
    Object.keys(TAB_SECTIONS).forEach(function (tab) {
      var a = document.querySelector('nav.top a[data-tab="' + tab + '"]');
      if (a) {
        a.setAttribute("role", "tab"); a.id = "tab-" + tab;
        a.setAttribute("aria-controls", TAB_SECTIONS[tab].join(" "));
        tabEls.push(a);
      }
      TAB_SECTIONS[tab].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { el.setAttribute("role", "tabpanel"); el.setAttribute("tabindex", "0"); el.setAttribute("aria-labelledby", "tab-" + tab); }
      });
    });
    // Keyboard: arrow / home / end move focus between tabs.
    tabEls.forEach(function (a, i) {
      a.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showTab(a.getAttribute("data-tab")); return; }
        var idx = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") idx = (i + 1) % tabEls.length;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") idx = (i - 1 + tabEls.length) % tabEls.length;
        else if (e.key === "Home") idx = 0;
        else if (e.key === "End") idx = tabEls.length - 1;
        if (idx === null) return;
        e.preventDefault();
        var t = tabEls[idx]; showTab(t.getAttribute("data-tab")); t.focus();
      });
    });
    // Reverse map: any in-page #anchor link jumps to the tab containing it.
    var idToTab = {};
    Object.keys(TAB_SECTIONS).forEach(function (tab) {
      TAB_SECTIONS[tab].forEach(function (id) { idToTab[id] = tab; });
    });
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[data-tab], a[href^='#']");
      if (!a) return;
      var tab = a.getAttribute("data-tab") || idToTab[(a.getAttribute("href") || "").slice(1)];
      if (tab) {
        e.preventDefault();
        showTab(tab);
        if (e.detail > 0 && a.blur) a.blur(); // mouse click: don't leave a stuck focus ring
      }
    });
    // Logo → home (the Map tab / landing view).
    var logo = document.getElementById("logo-home");
    if (logo) logo.addEventListener("click", function (e) {
      showTab("map");
      if (e.detail > 0 && logo.blur) logo.blur();
    });
    // After any pointer activation of a button-like control, drop focus so the
    // outline/highlight doesn't linger.
    document.addEventListener("click", function (e) {
      if (e.detail <= 0) return; // keyboard activation keeps focus for a11y
      var b = e.target.closest && e.target.closest('[role="button"]');
      if (b && b.blur) b.blur();
    });
    // Activate any role="button" element with Enter / Space.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("role") === "button") { e.preventDefault(); t.click(); }
    });
    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () { if (typeof map !== "undefined") map.invalidateSize(); }, 150);
    });
    showTab("map");
  }

  function marker(d) {
    var color = COLOR[d.status] || "#6b7785";
    var ring = d.water_stressed ? "box-shadow:0 0 0 3px rgba(63,182,196,.55);" : "";
    var icon = L.divIcon({
      className: "",
      html: '<div style="width:14px;height:14px;border-radius:50%;background:' + color +
            ';border:2px solid #0e1116;' + ring + '"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7]
    });
    var st = STATUS[d.status] || { cls: "decommissioned", label: d.status };
    var rows = "";
    if (d.it_load_mw != null) rows += "<dt>IT load</dt><dd>" + d.it_load_mw + " MW</dd>";
    if (d.commissioned_year != null) rows += "<dt>Since</dt><dd>" + d.commissioned_year + "</dd>";
    rows += "<dt>Location</dt><dd>" + esc(d.city) + ", " + esc(d.state) + "</dd>";

    var html =
      '<div class="pop">' +
        '<h3>' + esc(d.name) + "</h3>" +
        '<div class="op">' + esc(d.operator) + '</div>' +
        '<span class="badge ' + d.status + '">' + esc(st.label) + "</span>" +
        "<dl>" + rows + "</dl>" +
        (d.water_stressed ? '<div class="waterflag">💧 In a water-stressed region</div>' : "") +
        (d.notes ? '<div class="notes">' + esc(d.notes) + "</div>" : "") +
        (d.source ? '<div class="src"><a href="' + esc(d.source) + '" target="_blank" rel="noopener">Source ↗</a></div>'
                  : '<div class="src small">No source on file</div>') +
      "</div>";
    return L.marker([d.latitude, d.longitude], { icon: icon }).bindPopup(html);
  }

  function currentFilter() {
    var state = document.getElementById("f-state").value;
    var op = document.getElementById("f-operator").value.trim().toLowerCase();
    var waterOnly = document.getElementById("f-water").checked;
    return DATA.filter(function (d) {
      if (!enabled[d.status]) return false;
      if (state && d.state !== state) return false;
      if (op && d.operator.toLowerCase().indexOf(op) === -1) return false;
      if (waterOnly && !d.water_stressed) return false;
      return true;
    });
  }

  function render() {
    var rows = currentFilter();
    layer.clearLayers();
    rows.forEach(function (d) { marker(d).addTo(layer); });
    buildTable(rows);
  }

  // ---- directory table with a Source column ----
  function sourceHost(url) {
    try { return url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]; }
    catch (e) { return "source"; }
  }
  function buildTable(rows) {
    var body = document.getElementById("dir-body");
    if (!body) return;
    var sorted = rows.slice().sort(function (a, b) {
      return a.operator.localeCompare(b.operator) || a.name.localeCompare(b.name);
    });
    body.innerHTML = sorted.map(function (d) {
      var st = (STATUS[d.status] || { label: d.status }).label;
      var src = d.source
        ? '<a class="srclink" href="' + esc(d.source) + '" target="_blank" rel="noopener">' + esc(sourceHost(d.source)) + " ↗</a>"
        : '<span class="small">—</span>';
      return "<tr>" +
        '<td class="fac">' + esc(d.name) + "</td>" +
        '<td class="op">' + esc(d.operator) + "</td>" +
        "<td>" + esc(d.city) + "</td>" +
        "<td>" + esc(d.state) + "</td>" +
        '<td><span class="sb ' + d.status + '">' + esc(st) + "</span></td>" +
        "<td>" + (d.it_load_mw != null ? d.it_load_mw + " MW" : "—") + "</td>" +
        '<td class="water">' + (d.water_stressed ? "💧" : "") + "</td>" +
        "<td>" + src + "</td>" +
      "</tr>";
    }).join("");
    var c = document.getElementById("dir-count");
    if (c) c.textContent = sorted.length;
  }

  // ---- header stats ----
  function buildHeaderStats() {
    var byStatus = {}, states = {}, ops = {}, water = 0;
    DATA.forEach(function (d) {
      byStatus[d.status] = (byStatus[d.status] || 0) + 1;
      states[d.state] = true; ops[d.operator] = true;
      if (d.water_stressed) water++;
    });
    document.getElementById("u-count").textContent = DATA.length;
    document.getElementById("u-states").textContent = Object.keys(states).length;
    document.getElementById("u-ops").textContent = Object.keys(ops).length;
    document.getElementById("u-water").textContent = water;

    var cards = [
      { n: DATA.length, l: "Total tracked", cls: "", act: "all" },
      { n: byStatus.operational || 0, l: "Operational", cls: "", act: "operational" },
      { n: byStatus.under_construction || 0, l: "Under construction", cls: "", act: "under_construction" },
      { n: byStatus.proposed || 0, l: "Proposed", cls: "", act: "proposed" },
      { n: Math.round((water / DATA.length) * 100) + "%", l: "Water-stressed", cls: "water", act: "water" }
    ];
    document.getElementById("statstrip").innerHTML = cards.map(function (c) {
      return '<div class="stat ' + c.cls + '" data-act="' + c.act + '" role="button" tabindex="0"' +
        ' aria-label="' + esc(c.l) + ': ' + c.n + ' — filter the map" title="Filter the map">' +
        '<div class="n">' + c.n + '</div><div class="l">' + c.l + "</div></div>";
    }).join("");
    Array.prototype.forEach.call(document.querySelectorAll(".stat[data-act]"), function (el) {
      el.addEventListener("click", function () { statCardAction(el.getAttribute("data-act"), el); });
    });
  }

  // Clicking a header stat card drives the map filters.
  function statCardAction(act, el) {
    var strip = document.getElementById("statstrip");
    Array.prototype.forEach.call(strip.children, function (c) { c.classList.remove("active"); });
    if (act === "all") {
      Object.keys(enabled).forEach(function (k) { enabled[k] = true; });
      document.getElementById("f-water").checked = false;
      syncLegend();
    } else if (act === "water") {
      var box = document.getElementById("f-water");
      box.checked = !box.checked;
      if (box.checked && el) el.classList.add("active");
    } else {
      // isolate this status
      Object.keys(enabled).forEach(function (k) { enabled[k] = (k === act); });
      document.getElementById("f-water").checked = false;
      syncLegend();
      if (el) el.classList.add("active");
    }
    render();
    scrollToMap();
  }

  // ---- statistics section ----
  function buildBigStats() {
    var ops = {}, cities = {}, knownMW = 0, mwCount = 0;
    DATA.forEach(function (d) {
      ops[d.operator] = true; cities[d.city] = true;
      if (d.it_load_mw != null) { knownMW += d.it_load_mw; mwCount++; }
    });
    var cards = [
      { n: DATA.length, l: "Facilities tracked" },
      { n: Object.keys(ops).length, l: "Operators" },
      { n: Object.keys(cities).length, l: "Cities" },
      { n: Math.round(knownMW).toLocaleString() + " MW", l: "Disclosed IT load (" + mwCount + " facilities)" }
    ];
    document.getElementById("bigstats").innerHTML = cards.map(function (c) {
      return '<div class="bigstat"><div class="n">' + c.n + '</div><div class="l">' + c.l + "</div></div>";
    }).join("");
  }

  function filterByState(state) {
    document.getElementById("f-state").value = state;
    Object.keys(enabled).forEach(function (k) { enabled[k] = true; });
    document.getElementById("f-water").checked = false;
    syncLegend(); render(); scrollToMap();
  }

  function buildStateChart() {
    if (!chartsReady()) return;
    var byState = {};
    DATA.forEach(function (d) { byState[d.state] = (byState[d.state] || 0) + 1; });
    var sorted = Object.keys(byState).map(function (k) { return [k, byState[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    mk("ch-statecount", {
      type: "bar",
      data: { labels: sorted.map(function (e) { return e[0]; }),
        datasets: [{ data: sorted.map(function (e) { return e[1]; }),
          backgroundColor: "#f0883e", hoverBackgroundColor: "#ffa657", borderRadius: 4, maxBarThickness: 18 }] },
      options: {
        indexAxis: "y",
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: function (c) { return c.parsed.x + " facilities — click to filter the map"; } } } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(42,50,61,.45)" } },
                  y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11.5 } } } },
        onClick: function (evt, els, chart) { if (els && els.length) filterByState(chart.data.labels[els[0].index]); },
        onHover: function (evt, els) { if (evt.native) evt.native.target.style.cursor = els.length ? "pointer" : "default"; }
      }
    }, persistentCharts);
  }

  // ---- modals (Terms / Privacy) ----
  function wireModals() {
    function close() {
      Array.prototype.forEach.call(document.querySelectorAll(".modal-overlay"), function (m) {
        m.classList.remove("open");
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-modal]"), function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var m = document.getElementById("modal-" + a.getAttribute("data-modal"));
        if (m) m.classList.add("open");
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".modal-overlay"), function (m) {
      m.addEventListener("click", function (e) { if (e.target === m) close(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (b) {
      b.addEventListener("click", close);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  // ---- nav scroll-spy ----
  function wireScrollSpy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('nav.top a[href^="#"]'));
    var targets = links.map(function (a) {
      var id = a.getAttribute("href").slice(1);
      return { a: a, el: document.getElementById(id) };
    }).filter(function (t) { return t.el; });
    function onScroll() {
      var y = window.scrollY + 80, current = null;
      targets.forEach(function (t) { if (t.el.offsetTop <= y) current = t; });
      links.forEach(function (a) { a.classList.remove("active"); });
      if (current) current.a.classList.add("active");
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // ---- legend (toggles) ----
  function buildLegend() {
    var counts = {};
    DATA.forEach(function (d) { counts[d.status] = (counts[d.status] || 0) + 1; });
    var el = document.getElementById("legend");
    el.innerHTML = ""; legendRows = {};
    Object.keys(STATUS).forEach(function (k) {
      var s = STATUS[k];
      var row = document.createElement("div");
      row.className = "legend-row";
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-pressed", enabled[k] ? "true" : "false");
      row.setAttribute("aria-label", "Toggle " + s.label + " facilities on the map");
      row.innerHTML = '<span class="pin ' + s.cls + '" aria-hidden="true"></span><span class="nm">' + s.label +
        '</span><span class="cnt">' + (counts[k] || 0) + "</span>";
      row.addEventListener("click", function () {
        enabled[k] = !enabled[k];
        row.classList.toggle("off", !enabled[k]);
        row.setAttribute("aria-pressed", enabled[k] ? "true" : "false");
        render();
      });
      legendRows[k] = row;
      el.appendChild(row);
    });
  }

  // ---- state dropdown ----
  function buildStateSelect() {
    var sel = document.getElementById("f-state");
    var states = Array.from(new Set(DATA.map(function (d) { return d.state; }))).sort();
    states.forEach(function (s) {
      var o = document.createElement("option"); o.value = s; o.textContent = s; sel.appendChild(o);
    });
  }

  // ---- reporting form ----
  function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; }
  function radio(name) {
    var r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : "";
  }
  function gatherReport() {
    return {
      type: "community_report",
      submitted_via: "india-datacenter-watch",
      name: val("r-contact"), phone: val("r-phone"), address: val("r-address"),
      email: val("r-email-addr"), location: val("r-location"), operator: val("r-operator"),
      status: radio("r-status"), issue: val("r-notes"), other: val("r-other"),
      agreed: document.getElementById("r-agree").checked
    };
  }
  function msg(t, kind) {
    var m = document.getElementById("r-status-msg");
    m.style.display = "block"; m.textContent = t;
    m.className = "full note-box" + (kind === "ok" ? " submit-ok" : kind === "err" ? " submit-err" : "");
  }
  function reportCoords() {
    var parts = (val("r-coords") || "").split(",");
    if (parts.length !== 2) return null;
    var lat = parseFloat(parts[0]), lng = parseFloat(parts[1]);
    return isFinite(lat) && isFinite(lng) ? { lat: lat, lng: lng } : null;
  }

  async function submitToWorker() {
    var r = gatherReport();
    if (!r.agreed) { msg("Please tick the agreement box first.", "err"); return; }
    if (!r.location) { msg("Please enter the data center location you're reporting.", "err"); return; }
    if (!API_BASE) {
      msg('Live submission isn’t enabled on this deployment yet. Use "Email instead" or "Download JSON" below — or set up the Cloudflare Worker (see /worker).', "err");
      return;
    }
    var fd = new FormData();
    Object.keys(r).forEach(function (k) { fd.append(k, r[k]); });
    var c = reportCoords();
    if (c) { fd.append("latitude", c.lat); fd.append("longitude", c.lng); }
    var files = document.getElementById("r-photos").files;
    for (var i = 0; i < Math.min(files.length, 5); i++) fd.append("photos", files[i]);
    msg("Submitting…");
    try {
      var res = await fetch(API_BASE + "/report", { method: "POST", body: fd });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && data.ok) {
        msg("Thank you — your report was submitted (ref " + String(data.id || "").slice(0, 8) +
          "). We review every submission before it appears on the map.", "ok");
        document.getElementById("reportForm").reset();
      } else {
        msg("Submission failed: " + (data.error || ("HTTP " + res.status)) + ". Please use Email or Download instead.", "err");
      }
    } catch (e) {
      msg("Couldn’t reach the server. Please use “Email instead” or “Download JSON”.", "err");
    }
  }

  function wireReport() {
    document.getElementById("r-submit").addEventListener("click", submitToWorker);
    document.getElementById("r-email").addEventListener("click", function () {
      var r = gatherReport();
      if (!r.agreed) { msg("Please tick the agreement box before submitting.", "err"); return; }
      var body = "New community report for India Datacenter Watch%0D%0A%0D%0A" +
        Object.keys(r).map(function (k) { return k + ": " + encodeURIComponent(r[k]); }).join("%0D%0A");
      window.location.href = "mailto:reports@example.org?subject=" +
        encodeURIComponent("[DC Watch] " + (r.location || "report")) + "&body=" + body;
    });
    document.getElementById("r-download").addEventListener("click", function () {
      var r = gatherReport();
      var blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "dc-report-" + (r.location || "facility").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + ".json";
      a.click();
      msg("Report downloaded. Attach it to a GitHub issue, or email it to us — thank you.", "ok");
    });
  }

  // ---- Photos gallery + live community-report pins (from the Worker) ----
  function buildPhotos() {
    var grid = document.getElementById("photo-grid"); if (!grid) return;
    function empty() {
      grid.innerHTML = '<div class="photo-empty">No community photos yet. Be the first — attach photos when you ' +
        '<a href="#report">report a facility</a>.</div>';
    }
    if (!API_BASE) { empty(); return; }
    fetch(API_BASE + "/photos").then(function (r) { return r.json(); }).then(function (list) {
      if (!Array.isArray(list) || !list.length) { empty(); return; }
      grid.innerHTML = list.map(function (p) {
        return '<figure><img loading="lazy" alt="Community-submitted photo" src="' + esc(API_BASE + p.url) + '">' +
          '<figcaption>' + esc(p.location || "Community report") + "</figcaption></figure>";
      }).join("");
    }).catch(empty);
  }

  function loadLiveReports() {
    if (!API_BASE) return;
    fetch(API_BASE + "/reports").then(function (r) { return r.json(); }).then(function (list) {
      if (!Array.isArray(list) || !list.length) return;
      list.forEach(function (r) {
        var lat = parseFloat(r.latitude), lng = parseFloat(r.longitude);
        if (!isFinite(lat) || !isFinite(lng)) return;
        DATA.push({
          id: r.id || ("live-" + lat + "-" + lng), name: r.name || "Community report",
          operator: r.operator || "Community-reported", city: r.name || "", state: "Community report",
          latitude: lat, longitude: lng, status: "community_reported",
          it_load_mw: null, commissioned_year: null, water_stressed: null,
          notes: r.notes || null, source: null
        });
      });
      buildLegend(); render(); // refresh community_reported count + pins
    }).catch(function () {});
  }

  // ========================================================================
  //  ANALYTICS: aggregations, impact calculations, charts, concern modals
  // ========================================================================
  var PAL = ["#539bf5", "#2ea043", "#d29922", "#db61a2", "#3fb6c4", "#f0883e",
             "#a371f7", "#e5534b", "#57ab5a", "#cc6b2c", "#6cb6ff", "#8ddb8c"];
  var STATUS_COLOR = { operational: "#2ea043", under_construction: "#d29922", proposed: "#539bf5", community_reported: "#db61a2" };

  // Impact assumptions (transparent, editable here). Annualised, nameplate-based upper estimate.
  var PUE = 1.6;        // power usage effectiveness (India avg ~1.6–1.8)
  var WUE = 1.8;        // litres of water per kWh (direct + indirect, combined)
  var GRID = 0.71;      // tCO2 per MWh (CEA India grid factor)
  var HH_KWH = 1000;    // approx annual electricity per Indian household (kWh)
  var HRS = 8760;

  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function disclosed() { return DATA.filter(function (d) { return d.it_load_mw != null; }); }
  function totalMW(rows) { return sum(rows.map(function (d) { return d.it_load_mw || 0; })); }
  function nf(n) { return Math.round(n).toLocaleString("en-IN"); }

  function impact(mw) {
    var e = mw * PUE * HRS;                 // MWh / year (facility-level, incl. cooling)
    return {
      mw: mw, gwh: e / 1000,
      waterBn: (e * 1000 * WUE) / 1e9,      // billion litres / year
      co2Mt: (e * GRID) / 1e6,              // million tonnes CO2 / year
      homes: (e * 1000) / HH_KWH            // homes-equivalent
    };
  }

  function countBy(rows, keyFn) {
    var m = {}; rows.forEach(function (d) { var k = keyFn(d); m[k] = (m[k] || 0) + 1; }); return m;
  }
  function topEntries(map, n) {
    return Object.keys(map).map(function (k) { return [k, map[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, n || 99);
  }
  function mwByKey(rows, keyFn) {
    var m = {}; rows.forEach(function (d) { if (d.it_load_mw != null) { var k = keyFn(d); m[k] = (m[k] || 0) + d.it_load_mw; } }); return m;
  }
  function cumulativeByYear(rows, valFn) {
    var byY = {};
    rows.forEach(function (d) { if (d.commissioned_year != null) byY[d.commissioned_year] = (byY[d.commissioned_year] || 0) + valFn(d); });
    var years = Object.keys(byY).map(Number).sort(function (a, b) { return a - b; });
    var cum = 0, labels = [], data = [];
    years.forEach(function (y) { cum += byY[y]; labels.push(String(y)); data.push(Math.round(cum * 100) / 100); });
    return { labels: labels, data: data };
  }

  // ---- chart helpers ----
  function chartsReady() { return typeof Chart !== "undefined"; }
  function initChartDefaults() {
    if (!chartsReady()) return;
    Chart.defaults.color = "#9aa7b4";
    Chart.defaults.borderColor = "rgba(42,50,61,.55)";
    Chart.defaults.font.family = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif';
    Chart.defaults.maintainAspectRatio = false;
  }
  var concernCharts = [];
  var persistentCharts = []; // stats/state charts — resized when their tab opens
  function destroyConcernCharts() { concernCharts.forEach(function (c) { c.destroy(); }); concernCharts = []; }
  function mk(id, cfg, store) {
    if (!chartsReady()) return null;
    var el = document.getElementById(id); if (!el) return null;
    var c = new Chart(el, cfg); if (store) store.push(c); return c;
  }
  function bar(labels, data, opts) {
    opts = opts || {};
    return { type: "bar", data: { labels: labels, datasets: [{ data: data, backgroundColor: opts.colors || opts.color || PAL[0], borderRadius: 4 }] },
      options: { indexAxis: opts.h ? "y" : "x", plugins: { legend: { display: false } },
        scales: { x: { grid: { display: !opts.h } }, y: { grid: { display: !!opts.h ? false : true }, beginAtZero: true } } } };
  }
  function line(labels, data, color) {
    return { type: "line", data: { labels: labels, datasets: [{ data: data, borderColor: color || PAL[0],
      backgroundColor: (color || PAL[0]) + "33", fill: true, tension: .25, pointRadius: 2, borderWidth: 2 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } };
  }
  function doughnut(labels, data, colors) {
    return { type: "doughnut", data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderColor: "#0e1116", borderWidth: 2 }] },
      options: { cutout: "60%", plugins: { legend: { position: "bottom", labels: { boxWidth: 12, padding: 12 } } } } };
  }
  function stacked(labels, ds) {
    return { type: "bar", data: { labels: labels, datasets: ds },
      options: { plugins: { legend: { position: "bottom" } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } } };
  }

  // ---- statistics section charts ----
  function buildStatsCharts() {
    if (!chartsReady()) return;
    var bs = countBy(DATA, function (d) { return d.status; });
    mk("ch-status", doughnut(
      ["Operational", "Under construction", "Proposed"],
      [bs.operational || 0, bs.under_construction || 0, bs.proposed || 0],
      [STATUS_COLOR.operational, STATUS_COLOR.under_construction, STATUS_COLOR.proposed]
    ), persistentCharts);
    var ops = topEntries(countBy(DATA, function (d) { return d.operator; }), 12);
    mk("ch-operators", bar(ops.map(function (e) { return e[0]; }), ops.map(function (e) { return e[1]; }), { h: true, color: PAL[0] }), persistentCharts);
    var withYear = DATA.filter(function (d) { return d.commissioned_year != null; }).length;
    var trend = cumulativeByYear(DATA, function () { return 1; });
    mk("ch-trend", line(trend.labels, trend.data, PAL[5]), persistentCharts);
    var withMW = disclosed().length;
    var smw = topEntries(mwByKey(DATA, function (d) { return d.state; }), 12);
    mk("ch-statemw", bar(smw.map(function (e) { return e[0]; }), smw.map(function (e) { return Math.round(e[1]); }), { h: true, color: PAL[4] }), persistentCharts);
    // Coverage labels — be honest about how much of the dataset each chart reflects.
    setText("note-trend", "Based on " + withYear + " of " + DATA.length + " facilities with a known commissioning year");
    setText("note-statemw", "Based on " + withMW + " of " + DATA.length + " facilities disclosing IT load");
  }
  function setText(id, t) { var el = document.getElementById(id); if (el) el.textContent = t; }

  // ---- live figures on concern cards ----
  function setLiveFigures() {
    var disc = disclosed(), imp = impact(totalMW(disc));
    var ws = DATA.filter(function (d) { return d.water_stressed; });
    var pipeline = DATA.filter(function (d) { return d.status === "under_construction" || d.status === "proposed"; });
    var ops = DATA.filter(function (d) { return d.status === "operational"; });
    var servers = totalMW(disc) * 2000; // ~0.5 kW IT per server
    var turnover = Math.round((servers * 20 / 1000) / 4); // 20kg/server, 4-yr refresh, tonnes/yr
    var live = {
      energy: "~" + nf(imp.gwh) + " GWh", water: "~" + imp.waterBn.toFixed(1) + " bn L",
      ewaste: "~" + nf(turnover) + " t/yr", location: ws.length + " facilities",
      scalability: pipeline.length + " facilities", noise: ops.length + " operational"
    };
    Object.keys(live).forEach(function (k) {
      var el = document.querySelector('[data-live="' + k + '"]'); if (el) el.textContent = live[k];
    });
  }

  // ---- concern data modals ----
  function head(icon, title, desc) {
    return '<h3 style="font-size:20px;margin:0 0 4px">' + icon + " " + esc(title) + "</h3>" +
           '<p class="lede" style="margin:0 0 16px">' + desc + "</p>";
  }
  function cards(list) {
    return '<div class="impact-out">' + list.map(function (c) {
      return '<div class="impact-card ' + (c.cls || "") + '"><div class="n">' + c.n + '</div><div class="l">' + c.l + "</div></div>";
    }).join("") + "</div>";
  }
  function holder(id, title) {
    return '<div class="chart-card" style="margin-top:14px"><h3>' + esc(title) + '</h3><div class="holder"><canvas id="' + id + '"></canvas></div></div>';
  }
  function assumptionNote() {
    return '<p class="note-sm">Impact figures are best-effort estimates from <b>disclosed IT load only</b>, ' +
      'annualised at nameplate load. Assumptions: PUE ' + PUE + ', water ' + WUE + ' L/kWh (direct+indirect), grid ' +
      GRID + ' tCO₂/MWh (CEA). Many facilities do not disclose load, so real totals are higher. Not a substitute for measured data.</p>';
  }
  function noCharts() { return chartsReady() ? "" : '<p class="note-sm">⚠ Charts need the Chart.js CDN, which appears blocked. Numbers above are still computed from the dataset.</p>'; }

  var CONCERNS = {
    energy: function () {
      var disc = disclosed(), tmw = totalMW(disc), imp = impact(tmw);
      var html = head("⚡", "Power draw",
        "Estimated from disclosed IT load across <b>" + disc.length + " of " + DATA.length + "</b> facilities (" + nf(tmw) + " MW).") +
        cards([
          { n: nf(tmw) + " MW", l: "Disclosed IT load" },
          { n: nf(imp.gwh) + " GWh", l: "Est. electricity / year", cls: "e" },
          { n: imp.co2Mt.toFixed(2) + " Mt", l: "Est. CO₂ / year", cls: "c" },
          { n: nf(imp.homes / 1000) + "k", l: "Homes-equivalent power", cls: "e" }
        ]) + holder("cc-e-trend", "Cumulative disclosed IT load by year (MW)") +
        holder("cc-e-ops", "Top operators by disclosed IT load (MW)") + assumptionNote() + noCharts();
      return { html: html, draw: function () {
        var t = cumulativeByYear(disc, function (d) { return d.it_load_mw || 0; });
        mk("cc-e-trend", line(t.labels, t.data, STATUS_COLOR.under_construction), concernCharts);
        var o = topEntries(mwByKey(disc, function (d) { return d.operator; }), 10);
        mk("cc-e-ops", bar(o.map(function (e) { return e[0]; }), o.map(function (e) { return Math.round(e[1]); }), { h: true, color: PAL[5] }), concernCharts);
      } };
    },
    water: function () {
      var disc = disclosed(), imp = impact(totalMW(disc));
      var ws = DATA.filter(function (d) { return d.water_stressed; });
      var pct = Math.round((ws.length / DATA.length) * 100);
      var statesAff = Object.keys(countBy(ws, function (d) { return d.state; })).length;
      var html = head("💧", "Cooling water",
        "Cooling water estimated from disclosed IT load; water-stress flags follow WRI-style regional analysis.") +
        cards([
          { n: imp.waterBn.toFixed(1) + " bn L", l: "Est. cooling water / year", cls: "w" },
          { n: ws.length + " / " + DATA.length, l: "In water-stressed regions", cls: "w" },
          { n: pct + "%", l: "Share water-stressed", cls: "w" },
          { n: statesAff, l: "States affected" }
        ]) + holder("cc-w-state", "Water-stressed facilities by state") +
        holder("cc-w-mw", "Est. annual cooling water by state (bn L)") + assumptionNote() + noCharts();
      return { html: html, draw: function () {
        var byState = topEntries(countBy(ws, function (d) { return d.state; }), 12);
        mk("cc-w-state", bar(byState.map(function (e) { return e[0]; }), byState.map(function (e) { return e[1]; }), { h: true, color: PAL[4] }), concernCharts);
        var mwState = topEntries(mwByKey(disc.filter(function (d) { return d.water_stressed; }), function (d) { return d.state; }), 10);
        mk("cc-w-mw", bar(mwState.map(function (e) { return e[0]; }),
          mwState.map(function (e) { return Math.round(impact(e[1]).waterBn * 100) / 100; }), { h: true, color: "#3fb6c4" }), concernCharts);
      } };
    },
    ewaste: function () {
      var disc = disclosed(), tmw = totalMW(disc);
      var servers = tmw * 2000, mass = servers * 20 / 1000, turnover = mass / 4;
      var html = head("🗑️", "Hardware waste",
        "First-order estimate from installed IT capacity. Assumes ~0.5 kW IT per server, ~20 kg/server, 4-year refresh.") +
        cards([
          { n: nf(tmw) + " MW", l: "Disclosed IT capacity" },
          { n: nf(servers), l: "Est. servers installed" },
          { n: nf(mass) + " t", l: "Est. installed hardware" },
          { n: nf(turnover) + " t/yr", l: "Est. hardware turnover", cls: "c" }
        ]) + holder("cc-ew-ops", "Hardware footprint proxy — IT load by operator (MW)") +
        holder("cc-ew-status", "Capacity by status (MW)") + assumptionNote() + noCharts();
      return { html: html, draw: function () {
        var o = topEntries(mwByKey(disc, function (d) { return d.operator; }), 10);
        mk("cc-ew-ops", bar(o.map(function (e) { return e[0]; }), o.map(function (e) { return Math.round(e[1]); }), { h: true, color: PAL[6] }), concernCharts);
        var st = mwByKey(disc, function (d) { return d.status; });
        mk("cc-ew-status", doughnut(["Operational", "Under construction", "Proposed"],
          [Math.round(st.operational || 0), Math.round(st.under_construction || 0), Math.round(st.proposed || 0)],
          [STATUS_COLOR.operational, STATUS_COLOR.under_construction, STATUS_COLOR.proposed]), concernCharts);
      } };
    },
    location: function () {
      var ws = DATA.filter(function (d) { return d.water_stressed; });
      var pct = Math.round((ws.length / DATA.length) * 100);
      var hubs = DATA.filter(function (d) { return /Chennai|Hyderabad|Visakhapatnam/.test(d.city) && d.water_stressed; }).length;
      var pipeStressed = ws.filter(function (d) { return d.status !== "operational"; }).length;
      var html = head("⚠️", "Where they're sited",
        "Where facilities sit relative to water-stressed and high-exposure districts.") +
        cards([
          { n: ws.length + " / " + DATA.length, l: "In water-stressed regions", cls: "w" },
          { n: pct + "%", l: "Share of all facilities", cls: "w" },
          { n: hubs, l: "In Chennai / Hyderabad / Vizag" },
          { n: pipeStressed, l: "Planned in stressed regions", cls: "c" }
        ]) + holder("cc-l-state", "Facilities by state — water-stressed vs not") +
        holder("cc-l-status", "Status mix within water-stressed regions") + noCharts();
      return { html: html, draw: function () {
        var states = topEntries(countBy(DATA, function (d) { return d.state; }), 12).map(function (e) { return e[0]; });
        var stressed = states.map(function (s) { return DATA.filter(function (d) { return d.state === s && d.water_stressed; }).length; });
        var notst = states.map(function (s) { return DATA.filter(function (d) { return d.state === s && !d.water_stressed; }).length; });
        mk("cc-l-state", stacked(states, [
          { label: "Water-stressed", data: stressed, backgroundColor: "#3fb6c4" },
          { label: "Not flagged", data: notst, backgroundColor: "#3a4756" }
        ]), concernCharts);
        var bs = countBy(ws, function (d) { return d.status; });
        mk("cc-l-status", doughnut(["Operational", "Under construction", "Proposed"],
          [bs.operational || 0, bs.under_construction || 0, bs.proposed || 0],
          [STATUS_COLOR.operational, STATUS_COLOR.under_construction, STATUS_COLOR.proposed]), concernCharts);
      } };
    },
    scalability: function () {
      var ops = DATA.filter(function (d) { return d.status === "operational"; });
      var pipe = DATA.filter(function (d) { return d.status === "under_construction" || d.status === "proposed"; });
      var opMW = totalMW(ops), pipeMW = totalMW(pipe);
      var mult = opMW > 0 ? (1 + pipeMW / opMW).toFixed(1) + "×" : "—";
      var html = head("📈", "Outpacing the grid",
        "The build pipeline relative to what is already operational — the strain ahead of the grid.") +
        cards([
          { n: ops.length, l: "Operational" },
          { n: pipe.length, l: "Under construction + proposed", cls: "e" },
          { n: nf(pipeMW) + " MW", l: "Disclosed pipeline IT load", cls: "e" },
          { n: mult, l: "Projected capacity vs today" }
        ]) + holder("cc-s-trend", "Adoption curve — cumulative facilities by year") +
        holder("cc-s-pipe", "Disclosed pipeline IT load by state (MW)") + noCharts();
      return { html: html, draw: function () {
        var t = cumulativeByYear(DATA, function () { return 1; });
        mk("cc-s-trend", line(t.labels, t.data, STATUS_COLOR.proposed), concernCharts);
        var ps = topEntries(mwByKey(pipe, function (d) { return d.state; }), 10);
        mk("cc-s-pipe", bar(ps.map(function (e) { return e[0]; }), ps.map(function (e) { return Math.round(e[1]); }), { h: true, color: STATUS_COLOR.under_construction }), concernCharts);
      } };
    },
    noise: function () {
      var ops = DATA.filter(function (d) { return d.status === "operational"; });
      var cities = countBy(ops, function (d) { return d.city; });
      var top = topEntries(cities, 12);
      var topCity = top[0] || ["—", 0];
      var top5 = top.slice(0, 5).reduce(function (a, e) { return a + e[1]; }, 0);
      var html = head("🔊", "Round-the-clock noise",
        "Operational facilities run cooling and backup generators 24/7. Density near communities is the exposure proxy.") +
        cards([
          { n: ops.length, l: "Operational (run 24/7)" },
          { n: Object.keys(cities).length, l: "Cities with live facilities" },
          { n: topCity[1] + " in " + topCity[0], l: "Densest cluster" },
          { n: top5, l: "In the top-5 hub cities" }
        ]) + holder("cc-n-city", "Operational facilities by city (community exposure)") + noCharts();
      return { html: html, draw: function () {
        mk("cc-n-city", bar(top.map(function (e) { return e[0]; }), top.map(function (e) { return e[1]; }), { h: true, color: PAL[0] }), concernCharts);
      } };
    }
  };

  function openConcern(key) {
    var def = CONCERNS[key]; if (!def) return;
    destroyConcernCharts();
    var built = def();
    document.getElementById("concern-body").innerHTML = built.html;
    document.getElementById("modal-concern").classList.add("open");
    if (built.draw) built.draw();
  }

  function wireConcerns() {
    Array.prototype.forEach.call(document.querySelectorAll(".concern[data-concern]"), function (el) {
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      var h = el.querySelector("h3");
      el.setAttribute("aria-label", (h ? h.textContent : "concern") + " — open data and trends");
      var ic = el.querySelector(".ic"); if (ic) ic.setAttribute("aria-hidden", "true");
      el.addEventListener("click", function () { openConcern(el.getAttribute("data-concern")); });
    });
  }

  // ---- community impact (data-driven) ----
  var STORIES = (window.IMPACT_STORIES || []).slice();
  var ISTATS = (window.IMPACT_STATS || []).slice();
  var impactTheme = "all";

  function impactHost(url) { try { return url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]; } catch (e) { return "source"; } }

  function setImpactTheme(t) {
    impactTheme = t;
    var fl = document.getElementById("impact-filters");
    if (fl) Array.prototype.forEach.call(fl.querySelectorAll(".chip"), function (c) {
      c.classList.toggle("active", c.getAttribute("data-theme") === t);
    });
    renderImpactList();
  }

  function buildImpactStats() {
    var el = document.getElementById("impact-stats"); if (!el) return;
    el.innerHTML = ISTATS.map(function (s) {
      var go = s.theme === "all" ? "See all reports →" : "See " + s.theme + " reports →";
      return '<div class="istat" data-theme="' + esc(s.theme) + '" role="button" tabindex="0" aria-label="' + esc(s.stat) + ' — see related reports" title="Filter the reports below">' +
        '<div class="v">' + esc(s.value) + '</div>' +
        '<div class="s">' + esc(s.stat) + '</div>' +
        '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" data-src="1">' + esc(s.attribution) + " ↗</a>" +
        '<div class="go">' + go + "</div></div>";
    }).join("");
    Array.prototype.forEach.call(el.querySelectorAll(".istat"), function (card) {
      card.addEventListener("click", function (e) {
        if (e.target.closest("[data-src]")) return; // let the source link open in a new tab
        setImpactTheme(card.getAttribute("data-theme"));
        var anchor = document.getElementById("impact-filters");
        if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function renderImpactList() {
    var el = document.getElementById("impact-list"); if (!el) return;
    var rows = STORIES.filter(function (s) { return impactTheme === "all" || s.theme === impactTheme; });
    el.innerHTML = rows.map(function (s) {
      return "<blockquote>" + esc(s.quote) +
        '<div class="meta"><cite>— ' + esc(s.attribution) + "</cite>" +
        '<span><span class="loc">' + esc(s.location) + "</span> " +
        '<a class="src" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(impactHost(s.url)) + " ↗</a></span></div></blockquote>";
    }).join("");
    var c = document.getElementById("impact-count"); if (c) c.textContent = rows.length;
  }

  function buildImpactFilters() {
    var el = document.getElementById("impact-filters"); if (!el) return;
    var themes = ["all"].concat(Array.from(new Set(STORIES.map(function (s) { return s.theme; }))).sort());
    el.innerHTML = themes.map(function (t) {
      var n = t === "all" ? STORIES.length : STORIES.filter(function (s) { return s.theme === t; }).length;
      return '<span class="chip' + (t === impactTheme ? " active" : "") + '" data-theme="' + t + '" role="button" tabindex="0">' +
        (t === "all" ? "All" : t) + " · " + n + "</span>";
    }).join("");
    Array.prototype.forEach.call(el.querySelectorAll(".chip"), function (chip) {
      chip.addEventListener("click", function () { setImpactTheme(chip.getAttribute("data-theme")); });
    });
  }

  function buildImpact() { buildImpactStats(); buildImpactFilters(); renderImpactList(); }

  // ---- action / response + partners (data-driven) ----
  var ACTIONS = (window.RESPONSE_ACTIONS || []).slice();
  var PARTNERS = (window.PARTNERS || []).slice();
  var actionCat = "all";
  var CAT_LABEL = {
    policy: "Policy & incentives", regulatory: "Regulatory & clearances", legal: "Legal action",
    transparency: "Transparency & RTI", rights: "Rights & free speech", mobilization: "Petitions & mobilization"
  };

  function renderActions() {
    var el = document.getElementById("action-list"); if (!el) return;
    var rows = ACTIONS.filter(function (a) { return actionCat === "all" || a.cat === actionCat; });
    el.innerHTML = rows.map(function (a) {
      return '<div class="action ' + a.cat + '">' +
        '<div class="catlabel">' + esc(CAT_LABEL[a.cat] || a.cat) + "</div>" +
        "<h4>" + esc(a.title) + "</h4>" +
        "<p>" + esc(a.summary) + "</p>" +
        '<div class="foot"><span class="loc">' + esc(a.location) + "</span>" +
        '<a class="src" href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.attribution) + " ↗</a></div></div>";
    }).join("");
    var c = document.getElementById("action-count"); if (c) c.textContent = rows.length;
  }

  function buildActionFilters() {
    var el = document.getElementById("action-filters"); if (!el) return;
    var cats = ["all"].concat(Object.keys(CAT_LABEL).filter(function (k) {
      return ACTIONS.some(function (a) { return a.cat === k; });
    }));
    el.innerHTML = cats.map(function (t) {
      var n = t === "all" ? ACTIONS.length : ACTIONS.filter(function (a) { return a.cat === t; }).length;
      return '<span class="chip' + (t === actionCat ? " active" : "") + '" data-cat="' + t + '" role="button" tabindex="0">' +
        (t === "all" ? "All" : CAT_LABEL[t]) + " · " + n + "</span>";
    }).join("");
    Array.prototype.forEach.call(el.querySelectorAll(".chip"), function (chip) {
      chip.addEventListener("click", function () {
        actionCat = chip.getAttribute("data-cat");
        Array.prototype.forEach.call(el.querySelectorAll(".chip"), function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        renderActions();
      });
    });
  }

  function buildPartners() {
    var el = document.getElementById("partners-grid"); if (!el) return;
    el.innerHTML = PARTNERS.map(function (p) {
      return '<a class="partner" href="' + esc(p.url) + '" target="_blank" rel="noopener">' +
        '<span class="pname">' + esc(p.name) + '</span><span class="ptype">' + esc(p.type) + "</span>" +
        '<div class="prole">' + esc(p.role) + "</div>" +
        '<span class="plink">Visit ↗</span></a>';
    }).join("");
  }

  function buildResponse() {
    var t = document.getElementById("action-total"); if (t) t.textContent = ACTIONS.length;
    buildActionFilters(); renderActions(); buildPartners();
  }

  // ---- CSV download ----
  var CSV_COLS = ["id", "name", "operator", "city", "state", "latitude", "longitude",
                  "status", "it_load_mw", "commissioned_year", "water_stressed", "notes", "source"];
  function toCSV(rows) {
    function cell(v) {
      if (v == null) return "";
      v = String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }
    var out = [CSV_COLS.join(",")];
    rows.forEach(function (d) {
      out.push(CSV_COLS.map(function (c) {
        if (c === "water_stressed") return d.water_stressed == null ? "" : String(d.water_stressed);
        return cell(d[c]);
      }).join(","));
    });
    return out.join("\n");
  }
  function download(name, text) {
    var b = new Blob([text], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = name; a.click();
  }
  function wireDownloads() {
    var f = document.getElementById("dl-csv");
    if (f) f.addEventListener("click", function () { download("india-datacenters-filtered.csv", toCSV(currentFilter())); });
    var a = document.getElementById("dl-csv-all");
    if (a) a.addEventListener("click", function () { download("india-datacenters-full.csv", toCSV(DATA)); });
  }

  // ---- init ----
  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("f-state").addEventListener("change", render);
    document.getElementById("f-operator").addEventListener("input", render);
    document.getElementById("f-water").addEventListener("change", render);
    document.getElementById("f-reset").addEventListener("click", function () {
      document.getElementById("f-state").value = "";
      document.getElementById("f-operator").value = "";
      document.getElementById("f-water").checked = false;
      render();
    });
    var tot = document.getElementById("dir-total"); if (tot) tot.textContent = DATA.length;
    initChartDefaults();
    buildHeaderStats(); buildBigStats(); buildStatsCharts(); buildStateChart();
    setLiveFigures(); wireConcerns(); wireDownloads(); buildImpact(); buildResponse();
    buildPhotos(); loadLiveReports();
    buildLegend(); buildStateSelect(); wireReport(); wireModals(); render(); setupTabs();
    // Leaflet measures the container on init; if layout settles a tick later
    // (fonts, grid sizing), recalc so tiles fill the map instead of staying blank.
    setTimeout(function () { map.invalidateSize(); }, 200);
    window.addEventListener("load", function () { map.invalidateSize(); });
  });
})();
