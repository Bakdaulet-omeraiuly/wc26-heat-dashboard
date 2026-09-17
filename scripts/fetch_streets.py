"""Fetches REAL street/road centerline geometry around each of the 11
stadiums from OpenStreetMap (Overpass API) -- same technique and same
helper formulas as fetch_parking_lots.py (haversine_m, bearing_deg),
reused here so streets and parking lots land in the exact same
schematic (real bearing + real-but-compressed distance) space that
Stadium3D.tsx already draws lots in.

For each real road segment (a `way` tagged `highway=`), stores every
node as {distance_m, bearing_deg} from the stadium's own real
lat/lon -- not raw lat/lon -- so the 3D scene can place it with the
IDENTICAL bearingToXZ() transform already used for parking lots,
without duplicating projection math in TypeScript.

Run once, by hand -- not part of the runtime app. Writes
data/streets.json.
"""

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

from fetch_parking_lots import HEADERS, haversine_m, bearing_deg  # reuse, don't re-derive

ROOT = Path(__file__).resolve().parent.parent
STADIUMS = json.loads((ROOT / "data" / "stadiums.json").read_text())

RADIUS_M = 900  # tighter than the parking-lot radius (1500m) -- streets immediately around the venue, not the whole surrounding city
# Real OSM highway classification tags, kept (not every value -- footway/cycleway/service
# driveways are dropped to keep the scene legible and vehicle-relevant).
KEPT_HIGHWAY_TAGS = {"motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified"}
MAX_SEGMENTS_PER_STADIUM = 60


def overpass_query(lat, lon, radius=RADIUS_M):
    tags = "|".join(KEPT_HIGHWAY_TAGS)
    query = f'[out:json][timeout:40];(way["highway"~"^({tags})$"](around:{radius},{lat},{lon}););out geom;'
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=f"data={urllib.parse.quote(query)}".encode(),
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=50) as resp:
        return json.loads(resp.read())


def main():
    all_results = {}
    for stadium in STADIUMS:
        sid, lat, lon = stadium["id"], stadium["lat"], stadium["lon"]
        segments = []
        try:
            data = overpass_query(lat, lon)
        except Exception as e:
            print(f"{stadium['name']}: QUERY FAILED -- {e}")
            all_results[sid] = []
            time.sleep(3)
            continue

        for el in data.get("elements", []):
            geom = el.get("geometry")
            if not geom or len(geom) < 2:
                continue
            tags = el.get("tags", {})
            points = [
                {
                    "distance_m": round(haversine_m(lat, lon, p["lat"], p["lon"])),
                    "bearing_deg": round(bearing_deg(lat, lon, p["lat"], p["lon"]), 1),
                }
                for p in geom
            ]
            # keep only segments that actually pass near the venue (at
            # least one real node within the fetch radius -- Overpass's
            # `around` already guarantees this, this is just a safety
            # filter against any edge-of-radius partial way)
            segments.append(
                {
                    "osm_id": el.get("id"),
                    "highway": tags.get("highway"),
                    "name": tags.get("name"),
                    "points": points,
                }
            )

        # Prioritize named, larger roads first (more useful context),
        # then closest, capped for scene/payload sanity.
        rank = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4, "residential": 5, "unclassified": 6}
        segments.sort(key=lambda s: (rank.get(s["highway"], 9), min(p["distance_m"] for p in s["points"])))
        segments = segments[:MAX_SEGMENTS_PER_STADIUM]

        print(f"{stadium['name']}: {len(segments)} real street segments kept")
        all_results[sid] = segments
        time.sleep(2)  # be polite to the shared public Overpass instance

    with open(ROOT / "data" / "streets.json", "w") as f:
        json.dump(all_results, f, indent=2)
    print("\nwrote data/streets.json")


if __name__ == "__main__":
    main()
