"""Retry street fetch for the stadiums that hit Overpass rate-limits/
timeouts on the first pass -- same escalating-backoff pattern as
retry_parking_lots.py."""

import json
import time
from pathlib import Path

from fetch_parking_lots import haversine_m, bearing_deg, STADIUMS
from fetch_streets import overpass_query, KEPT_HIGHWAY_TAGS, MAX_SEGMENTS_PER_STADIUM

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ["att-stadium", "mercedes-benz-stadium", "gillette-stadium", "nrg-stadium", "metlife-stadium", "lincoln-financial-field"]
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

    segments = []
    for el in data.get("elements", []):
        geom = el.get("geometry")
        if not geom or len(geom) < 2:
            continue
        tags = el.get("tags", {})
        points = [
            {"distance_m": round(haversine_m(lat, lon, p["lat"], p["lon"])), "bearing_deg": round(bearing_deg(lat, lon, p["lat"], p["lon"]), 1)}
            for p in geom
        ]
        segments.append({"osm_id": el.get("id"), "highway": tags.get("highway"), "name": tags.get("name"), "points": points})

    rank = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4, "residential": 5, "unclassified": 6}
    segments.sort(key=lambda s: (rank.get(s["highway"], 9), min(p["distance_m"] for p in s["points"])))
    return segments[:MAX_SEGMENTS_PER_STADIUM]


def main():
    existing = json.loads((ROOT / "data" / "streets.json").read_text())
    by_id = {s["id"]: s for s in STADIUMS}
    for sid in TARGETS:
        segs = fetch_one(by_id[sid])
        print(f"{by_id[sid]['name']}: {len(segs)} real street segments")
        existing[sid] = segs
        time.sleep(3)

    with open(ROOT / "data" / "streets.json", "w") as f:
        json.dump(existing, f, indent=2)
    print("\nupdated data/streets.json")


if __name__ == "__main__":
    main()
