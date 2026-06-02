#!/usr/bin/env python3
"""Validate data/datacenters.csv. Exits non-zero (and prints errors) on any problem.

Run locally:  python3 scripts/validate_dataset.py
Also run in CI on every push / PR.
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "data" / "datacenters.csv"

REQUIRED = ["id", "name", "operator", "city", "state", "latitude", "longitude", "status"]
STATUSES = {"operational", "under_construction", "proposed", "community_reported", "decommissioned"}
# India bounding box (generous).
LAT_MIN, LAT_MAX = 6.0, 37.5
LON_MIN, LON_MAX = 68.0, 98.0


def main() -> int:
    if not CSV.exists():
        print(f"ERROR: dataset not found at {CSV}")
        return 1

    errors: list[str] = []
    rows = list(csv.DictReader(CSV.open(newline="", encoding="utf-8")))
    if not rows:
        print("ERROR: dataset is empty")
        return 1

    seen_ids: set[str] = set()
    for i, r in enumerate(rows, start=2):  # row 1 is the header
        rid = (r.get("id") or "").strip()
        where = f"row {i} (id={rid or '?'})"

        for col in REQUIRED:
            if not (r.get(col) or "").strip():
                errors.append(f"{where}: missing required field '{col}'")

        if rid in seen_ids:
            errors.append(f"{where}: duplicate id")
        seen_ids.add(rid)

        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
            if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
                errors.append(f"{where}: coordinates {lat},{lon} fall outside India")
        except (ValueError, KeyError):
            errors.append(f"{where}: latitude/longitude not numeric")

        status = (r.get("status") or "").strip()
        if status and status not in STATUSES:
            errors.append(f"{where}: invalid status '{status}'")

        for numcol in ("it_load_mw", "commissioned_year"):
            v = (r.get(numcol) or "").strip()
            if v:
                try:
                    float(v)
                except ValueError:
                    errors.append(f"{where}: {numcol} '{v}' is not a number")

        ws = (r.get("water_stressed") or "").strip().lower()
        if ws and ws not in ("true", "false"):
            errors.append(f"{where}: water_stressed must be true/false/empty, got '{ws}'")

        src = (r.get("source") or "").strip()
        if not src.startswith("http"):
            errors.append(f"{where}: source must be a URL (every facility needs a citation)")

    if errors:
        print(f"Dataset validation FAILED — {len(errors)} problem(s):")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"Dataset OK: {len(rows)} facilities, {len(seen_ids)} unique ids, all cited and in-bounds.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
