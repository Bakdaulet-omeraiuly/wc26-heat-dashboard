"""Retry building fetch for the stadiums that hit Overpass rate-limits/
timeouts on the first pass -- same escalating-backoff pattern as
retry_parking_lots.py and retry_streets.py."""

import json
import time
from pathlib import Path

from fetch_parking_lots import STADIUMS
from fetch_buildings import overpass_query, real_height, MAX_BUILDINGS_PER_STADIUM
from fetch_parking_lots import haversine_m, bearing_deg, polygon_area_m2, centroid, oriented_dimensions

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ["mercedes-benz-stadium", "arrowhead-stadium", "hard-rock-stadium", "levis-stadium"]
BACKOFFS = [15, 30, 60, 90, 120]


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

    buildings = []
    for el in data.get("elements", []):
        geom = el.get("geometry")
        if not geom or len(geom) < 4:
            continue
        tags = el.get("tags", {})
        if tags.get("building") in ("stadium", "grandstand") or tags.get("leisure") == "stadium":
            continue
        c_lat, c_lon = centroid(geom)
        area = polygon_area_m2(geom, c_lat)
        if area < 20:
            continue
        dist = haversine_m(lat, lon, c_lat, c_lon)
        bearing = bearing_deg(lat, lon, c_lat, c_lon)
        orientation_deg, length_m, width_m = oriented_dimensions(geom, c_lat)
        height_m, height_status = real_height(tags)
        buildings.append(
            {
                "osm_id": el.get("id"),
                "name": tags.get("name"),
                "distance_m": round(dist),
                "bearing_from_stadium_deg": round(bearing, 1),
                "orientation_deg": orientation_deg,
                "length_m": length_m,
                "width_m": width_m,
                "area_m2": round(area),
                "height_m": height_m,
                "height_status": height_status,
            }
        )
    buildings.sort(key=lambda b: b["distance_m"])
    return buildings[:MAX_BUILDINGS_PER_STADIUM]


def main():
    existing = json.loads((ROOT / "data" / "buildings.json").read_text())
    by_id = {s["id"]: s for s in STADIUMS}
    for sid in TARGETS:
        buildings = fetch_one(by_id[sid])
        print(f"{by_id[sid]['name']}: {len(buildings)} real buildings")
        existing[sid] = buildings
        time.sleep(3)

    with open(ROOT / "data" / "buildings.json", "w") as f:
        json.dump(existing, f, indent=2)
    print("\nupdated data/buildings.json")


if __name__ == "__main__":
    main()
