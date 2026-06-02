"""India Datacenter Watch — API serving the open India data center dataset.

Run locally:
    pip install -r requirements.txt
    uvicorn main:app --reload
Then open http://127.0.0.1:8000/docs
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "datacenters.csv"

app = FastAPI(
    title="India Datacenter Watch API",
    description="Open, community-accountable dataset of data centers across India.",
    version="0.1.0",
)

# Open data + browser dashboard: permissive read-only CORS is intentional.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


class Datacenter(BaseModel):
    id: str
    name: str
    operator: str
    city: str
    state: str
    latitude: float
    longitude: float
    status: str
    it_load_mw: Optional[float] = None
    commissioned_year: Optional[int] = None
    water_stressed: Optional[bool] = None
    notes: Optional[str] = None
    source: Optional[str] = None


def _num(v: str) -> Optional[float]:
    v = (v or "").strip()
    return float(v) if v else None


def _int(v: str) -> Optional[int]:
    v = (v or "").strip()
    return int(v) if v else None


def _bool(v: str) -> Optional[bool]:
    v = (v or "").strip().lower()
    if v in ("true", "1", "yes"):
        return True
    if v in ("false", "0", "no"):
        return False
    return None


def load_datacenters() -> list[Datacenter]:
    if not DATA_FILE.exists():
        raise RuntimeError(f"Dataset not found at {DATA_FILE}")
    rows: list[Datacenter] = []
    with DATA_FILE.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            rows.append(
                Datacenter(
                    id=row["id"],
                    name=row["name"],
                    operator=row["operator"],
                    city=row["city"],
                    state=row["state"],
                    latitude=float(row["latitude"]),
                    longitude=float(row["longitude"]),
                    status=row["status"],
                    it_load_mw=_num(row.get("it_load_mw", "")),
                    commissioned_year=_int(row.get("commissioned_year", "")),
                    water_stressed=_bool(row.get("water_stressed", "")),
                    notes=row.get("notes") or None,
                    source=row.get("source") or None,
                )
            )
    return rows


# Loaded once at import. Dataset is small and static; restart to reload.
DATACENTERS: list[Datacenter] = load_datacenters()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "count": len(DATACENTERS)}


@app.get("/datacenters", response_model=list[Datacenter])
def list_datacenters(
    state: Optional[str] = Query(None, description="Indian state, case-insensitive"),
    city: Optional[str] = Query(None, description="City, case-insensitive substring"),
    operator: Optional[str] = Query(None, description="Operator, case-insensitive substring"),
    status: Optional[str] = Query(None, description="operational | under_construction | proposed | community_reported | decommissioned"),
    water_stressed: Optional[bool] = Query(None, description="Filter facilities in water-stressed regions"),
) -> list[Datacenter]:
    results = DATACENTERS
    if state:
        results = [d for d in results if d.state.lower() == state.lower()]
    if city:
        results = [d for d in results if city.lower() in d.city.lower()]
    if operator:
        results = [d for d in results if operator.lower() in d.operator.lower()]
    if status:
        results = [d for d in results if d.status == status]
    if water_stressed is not None:
        results = [d for d in results if d.water_stressed is water_stressed]
    return results


@app.get("/datacenters/{dc_id}", response_model=Datacenter)
def get_datacenter(dc_id: str) -> Datacenter:
    for d in DATACENTERS:
        if d.id == dc_id:
            return d
    raise HTTPException(status_code=404, detail=f"No datacenter with id '{dc_id}'")


@app.get("/stats")
def stats() -> dict:
    by_state: dict[str, int] = {}
    by_status: dict[str, int] = {}
    water_stressed = 0
    for d in DATACENTERS:
        by_state[d.state] = by_state.get(d.state, 0) + 1
        by_status[d.status] = by_status.get(d.status, 0) + 1
        if d.water_stressed:
            water_stressed += 1
    return {
        "total": len(DATACENTERS),
        "water_stressed": water_stressed,
        "by_state": dict(sorted(by_state.items(), key=lambda kv: -kv[1])),
        "by_status": by_status,
    }
