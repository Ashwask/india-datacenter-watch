/* India Datacenter Watch — map + filters + statistics + reporting.
   Data comes from data.js (window.DATACENTERS), generated from data/datacenters.csv. */
(function () {
  "use strict";

  var DATA = (window.DATACENTERS || []).slice();

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

  // ---- map ----
  var map = L.map("map", { scrollWheelZoom: true, zoomControl: true }).setView([22.0, 80.0], 5);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19, subdomains: "abcd"
  }).addTo(map);

  var layer = L.layerGroup().addTo(map);
  var enabled = { operational: true, under_construction: true, proposed: true, community_reported: true };
  var legendRows = {};

  function syncLegend() {
    Object.keys(legendRows).forEach(function (k) {
      legendRows[k].classList.toggle("off", !enabled[k]);
    });
  }
  function scrollToMap() {
    var el = document.getElementById("map-anchor");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
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
      return '<div class="stat ' + c.cls + '" data-act="' + c.act + '" title="Filter the map">' +
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

  function buildStateBars() {
    var byState = {};
    DATA.forEach(function (d) { byState[d.state] = (byState[d.state] || 0) + 1; });
    var sorted = Object.keys(byState).map(function (k) { return [k, byState[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    var max = sorted.length ? sorted[0][1] : 1;
    document.getElementById("statebars").innerHTML = sorted.map(function (kv) {
      var pct = Math.round((kv[1] / max) * 100);
      return '<div class="bar-row" data-state="' + esc(kv[0]) + '" title="Show on map">' +
        '<span class="name">' + esc(kv[0]) + '</span>' +
        '<span class="track"><span class="fill" style="width:' + pct + '%"></span></span>' +
        '<span class="v">' + kv[1] + "</span></div>";
    }).join("");
    Array.prototype.forEach.call(document.querySelectorAll(".bar-row[data-state]"), function (el) {
      el.addEventListener("click", function () {
        document.getElementById("f-state").value = el.getAttribute("data-state");
        Object.keys(enabled).forEach(function (k) { enabled[k] = true; });
        document.getElementById("f-water").checked = false;
        syncLegend(); render(); scrollToMap();
      });
    });
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
      row.innerHTML = '<span class="pin ' + s.cls + '"></span><span class="nm">' + s.label +
        '</span><span class="cnt">' + (counts[k] || 0) + "</span>";
      row.addEventListener("click", function () {
        enabled[k] = !enabled[k];
        row.classList.toggle("off", !enabled[k]);
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
  function msg(t) { var m = document.getElementById("r-status-msg"); m.style.display = "block"; m.textContent = t; }

  function wireReport() {
    document.getElementById("r-email").addEventListener("click", function () {
      var r = gatherReport();
      if (!r.agreed) { msg("Please tick the agreement box before submitting."); return; }
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
      msg("Report downloaded. Attach it to a GitHub issue, or email it to us — thank you.");
    });
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
    buildHeaderStats(); buildBigStats(); buildStateBars();
    buildLegend(); buildStateSelect(); wireReport(); wireModals(); wireScrollSpy(); render();
    // Leaflet measures the container on init; if layout settles a tick later
    // (fonts, grid sizing), recalc so tiles fill the map instead of staying blank.
    setTimeout(function () { map.invalidateSize(); }, 200);
    window.addEventListener("load", function () { map.invalidateSize(); });
  });
})();
