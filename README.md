# India Datacenter Watch

An open, **community-accountability map of data centers across India** — operational, under
construction, proposed, and resident-reported — with a public **source link for every facility**.

Inspired by the [Brockovich Data Center map](https://brockovichdatacenter.com/) for the US, this
project brings the same transparency lens to India's fast-growing data-center footprint and its
**energy, water, e-waste, land, and noise** impacts on local communities.

> India's operational data-center stock crossed **~1,520 MW IT** in 2025 (+34% YoY) and is projected
> to triple by 2030. A WRI India analysis found **more than half of India's data centers sit in
> water-stressed regions**, even as cooling demand is set to rise from ~150 billion litres (2025) to
> ~358 billion by 2030.

## What's in here

```
datacenters/
├── data/
│   ├── datacenters.csv      # the dataset — one row per facility, with a source URL
│   └── schema.json          # JSON Schema for a facility row
├── web/                     # the map (static, no build step required)
│   ├── index.html           # map + key concerns + statistics + news + FAQ + report form
│   ├── app.js               # map, filters, live statistics, reporting
│   ├── data.js              # AUTO-GENERATED from data/datacenters.csv
│   └── build_data.py        # regenerate data.js after editing the CSV
├── api/                     # optional read-only API over the same dataset
│   ├── main.py              # FastAPI app
│   └── requirements.txt
└── docs/
    └── overview.md
```

The dataset currently tracks **191 facilities** across **46 operators**, **31 cities**, and
**18 states/UTs** — from hyperscale campuses to edge and GPU/AI sites, including 4 sourced
community-reported entries. Every row carries a source.

The site is fully data-driven (Leaflet + Chart.js):

- **Statistics** — live charts: status mix, top operators, cumulative-growth trend, IT load by state.
- **Key Concerns** — each of the six cards is clickable and opens a data modal with **impact
  calculations** (energy, CO₂, water, e-waste, homes-equivalent) and **trend graphs** specific to that
  concern. Estimates are derived transparently from disclosed IT load (PUE 1.6, water 1.8 L/kWh, grid
  0.71 tCO₂/MWh) and labelled as estimates.
- **Sources** — full facility directory table with a Source column (collapsible), plus **Download CSV**
  (filtered or full dataset).
- **About / Photos / Report** — an About section, a community Photos gallery, and a report form with photo
  upload. With the optional Cloudflare Worker backend (`/worker`) deployed and its URL set in
  `web/config.js`, the form submits live, photos upload, and **approved** reports appear as
  community-reported map pins and in the gallery. Without it, the form falls back to email / JSON download.
- **Terms / Privacy** — standalone `terms.html` / `privacy.html` pages.

## Run the map (no server needed)

```bash
# After editing data/datacenters.csv, regenerate the embedded data:
python3 web/build_data.py

# Then just open the page — or serve it for clean local URLs:
cd web && python3 -m http.server 8080
# open http://127.0.0.1:8080
```

## Run the API (optional)

```bash
cd api
pip install -r requirements.txt
uvicorn main:app --reload
# open http://127.0.0.1:8000/docs
```

Endpoints: `GET /datacenters` (filter by `state`, `city`, `operator`, `status`, `water_stressed`),
`GET /datacenters/{id}`, `GET /stats`, `GET /health`.

## Adding or correcting a facility

1. Add/edit a row in `data/datacenters.csv` (see `data/schema.json` for fields).
2. **Every row must have a real `source` URL.** Use city-centroid coordinates if exact siting isn't
   public, and note that in `notes`.
3. Run `python3 web/build_data.py` to refresh the map data.
4. Open a PR. Community reports submitted via the website are reviewed before being added as
   `community_reported`.

## Checks

```bash
python3 scripts/validate_dataset.py   # schema, unique ids, every row cited, in-bounds
python3 scripts/check_links.py        # every cited source URL resolves; reports aggregator skew
```

CI runs both: `validate_dataset` on every push/PR, and `check_links` weekly + on PRs that touch
the data. The link checker fails only on genuinely dead links (404/410/DNS); bot-blocked (403) and
TLS-cert-chain (gov sites) sources are reported but don't fail the build.

## Data caveats

- Coordinates are placed at city/cluster centroid where exact siting is undisclosed (e.g. cloud
  "regions" and many hyperscale campuses) — the popup says so.
- `it_load_mw` is shown only where a public figure exists.
- `water_stressed` is a **watch flag** for regions identified as water-stressed (e.g. WRI India),
  not a measured per-facility figure.
- Smaller captive, edge, and unannounced facilities may still be missing. Corrections welcome.

## License

Code is open source under the **[MIT License](LICENSE)**. Data is shared under **CC BY 4.0** — please
keep attribution and source links.

Built by [**Studio Ikigai**](https://www.thestudioikigai.com/).
