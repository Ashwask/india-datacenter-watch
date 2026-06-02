#!/usr/bin/env python3
"""Generate web/data.js from data/datacenters.csv.

Keeps the CSV as the single source of truth while letting the static map work
with no server (file:// or any static host). Run after editing the dataset:

    python3 web/build_data.py
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "data" / "datacenters.csv"
OUT = ROOT / "web" / "data.js"


def num(v):
    v = (v or "").strip()
    return float(v) if v else None


def integer(v):
    v = (v or "").strip()
    return int(v) if v else None


def boolean(v):
    v = (v or "").strip().lower()
    if v in ("true", "1", "yes"):
        return True
    if v in ("false", "0", "no"):
        return False
    return None


def main() -> None:
    rows = []
    with CSV.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            rows.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "operator": r["operator"],
                    "city": r["city"],
                    "state": r["state"],
                    "latitude": float(r["latitude"]),
                    "longitude": float(r["longitude"]),
                    "status": r["status"],
                    "it_load_mw": num(r.get("it_load_mw", "")),
                    "commissioned_year": integer(r.get("commissioned_year", "")),
                    "water_stressed": boolean(r.get("water_stressed", "")),
                    "notes": (r.get("notes") or "").strip() or None,
                    "source": (r.get("source") or "").strip() or None,
                }
            )
    payload = json.dumps(rows, ensure_ascii=False, indent=2)
    OUT.write_text(
        "// AUTO-GENERATED from data/datacenters.csv by build_data.py — do not edit by hand.\n"
        f"window.DATACENTERS = {payload};\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(rows)} facilities to {OUT}")


if __name__ == "__main__":
    main()
