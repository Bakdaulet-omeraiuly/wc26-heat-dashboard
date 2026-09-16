"""Retry parking-lot fetch for the stadiums that hit Overpass
rate-limits/timeouts on the first pass -- same escalating-backoff
pattern as retry_field_orientation.py, which fixed the same class of
problem there. Safe to import from fetch_parking_lots.py: that module
is properly guarded (def main(): / if __name__), so importing it here
has no side effects."""

import json
import time
from pathlib import Path

from fetch_parking_lots import (
    STADIUMS,
    overpass_query,
    haversine_m,
    bearing_deg,
    polygon_area_m2,
    centroid,
    oriented_dimensions,
    MAX_LOTS_PER_STADIUM,
)

ROOT = Path(__file__).resolve().parent.parent
TARGETS = [
    "mercedes-benz-stadium", "nrg-stadium", "arrowhead-stadium", "sofi-stadium",
    "metlife-stadium", "lincoln-financial-field", "lumen-field",
]  # the 7 that hit Overpass 504s on the full re-fetch (adding length_m/width_m)
BACKOFFS = [15, 30, 60, 90]


def fetch_one(stadium):
    lat, lon = stadium["lat"], stadium["lon"]
    data = None
    for attempt in range(len(BACKOFFS) + 1):
        try:
            data = overpass_query(lat, lon)
            break
        except Exception as e:
            print(f"{stadium['name']}: attempt {attempt+1} failed -- {e}")
            if attempt < len(BACKOFFS):
                time.sleep(BACKOFFS[attempt])
    if data is None:
        print(f"{stadium['name']}: giving up")
        return []

    lots = []
    for el in data.get("elements", []):
        geom = el.get("geometry")
        if not geom or len(geom) < 4:
            continue
        c_lat, c_lon = centroid(geom)
        area = polygon_area_m2(geom, c_lat)
        if area < 200:
            continue
        dist = haversine_m(lat, lon, c_lat, c_lon)
        bearing = bearing_deg(lat, lon, c_lat, c_lon)
        lot_orientation_deg, length_m, width_m = oriented_dimensions(geom, c_lat)
        tags = el.get("tags", {})
        lots.append(
            {
                "osm_id": el.get("id"),
                "name": tags.get("name"),
                "name_status": "REAL" if tags.get("name") else "UNNAMED",
                "area_m2": round(area),
                "lat": round(c_lat, 6),
                "lon": round(c_lon, 6),
                "distance_m": round(dist),
                "bearing_from_stadium_deg": round(bearing, 1),
                "lot_orientation_deg": lot_orientation_deg,
                "length_m": length_m,
                "width_m": width_m,
            }
        )
    lots.sort(key=lambda l: l["distance_m"])
    lots = lots[:MAX_LOTS_PER_STADIUM]
    for i, lot in enumerate(lots):
        if not lot["name"]:
            lot["name"] = f"Lot {i + 1}"
    return lots


def main():
    existing = json.loads((ROOT / "data" / "parking.json").read_text())
    by_id = {s["id"]: s for s in STADIUMS}
    for sid in TARGETS:
        lots = fetch_one(by_id[sid])
        total = sum(l["area_m2"] for l in lots)
        print(f"{by_id[sid]['name']}: {len(lots)} lots, {total:,} m^2 total")
        existing[sid] = lots
        time.sleep(3)

    with open(ROOT / "data" / "parking.json", "w") as f:
        json.dump(existing, f, indent=2)
    print("\nupdated data/parking.json")


if __name__ == "__main__":
    main()
