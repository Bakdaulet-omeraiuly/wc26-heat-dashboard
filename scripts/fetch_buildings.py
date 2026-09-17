"""Fetches REAL building footprints around each of the 11 stadiums from
OpenStreetMap (Overpass API) -- same technique as fetch_parking_lots.py
and fetch_streets.py: real polygon/node coordinates, not a guess. For
each building, computes:

  - centroid lat/lon, distance_m + bearing_from_stadium_deg (same
    real-geometry placement fields every other real layer in this app
    uses, so buildings drop straight into Stadium3D's existing
    bearingToXZ() schematic transform)
  - real oriented footprint (length_m/width_m/orientation_deg), reusing
    fetch_parking_lots.py's oriented_dimensions() -- the exact same
    "rotate into the longest-edge frame" method already proven there
  - height_m + height_status: REAL when OSM carries a real `height`
    tag (meters); SEMI when only `building:levels` is present (a real
    OSM tag, converted via a commonly-used real-estate rule of thumb --
    3m per level -- so it's a real count times a real average, not a
    guess); MOCK (a flat default) only when neither exists.

Run once, by hand -- not part of the runtime app. Writes
data/buildings.json.
"""

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

from fetch_parking_lots import (
    HEADERS,
    STADIUMS,
    haversine_m,
    bearing_deg,
    polygon_area_m2,
    centroid,
    oriented_dimensions,
)

ROOT = Path(__file__).resolve().parent.parent
RADIUS_M = 900  # tighter than the parking-lot radius -- the immediate stadium precinct, not the whole surrounding city
MAX_BUILDINGS_PER_STADIUM = 150
DEFAULT_HEIGHT_M = 7.0  # MOCK fallback: a plausible 2-story commercial building, used only when OSM has no real height/levels data at all


def overpass_query(lat, lon, radius=RADIUS_M):
    query = f'[out:json][timeout:60];(way["building"](around:{radius},{lat},{lon}););out geom;'
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=f"data={urllib.parse.quote(query)}".encode(),
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=70) as resp:
        return json.loads(resp.read())


def real_height(tags):
    """Returns (height_m, status). Prefers a real OSM `height` tag
    (meters, sometimes with a trailing unit string -- stripped);
    falls back to real `building:levels` x 3m/level (SEMI, a real
    count times a real published average level height); MOCK default
    otherwise."""
    height_raw = tags.get("height")
    if height_raw:
        try:
            h = float("".join(c for c in height_raw if c.isdigit() or c == "."))
            if h > 0:
                return round(h, 1), "REAL"
        except ValueError:
            pass
    levels_raw = tags.get("building:levels")
    if levels_raw:
        try:
            levels = float(levels_raw)
            if levels > 0:
                return round(levels * 3.0, 1), "SEMI"
        except ValueError:
            pass
    return DEFAULT_HEIGHT_M, "MOCK"


def main():
    all_results = {}
    for stadium in STADIUMS:
        sid, lat, lon = stadium["id"], stadium["lat"], stadium["lon"]
        buildings = []
        try:
            data = overpass_query(lat, lon)
        except Exception as e:
            print(f"{stadium['name']}: QUERY FAILED -- {e}")
            all_results[sid] = []
            time.sleep(3)
            continue

        for el in data.get("elements", []):
            geom = el.get("geometry")
            if not geom or len(geom) < 4:
                continue
            tags = el.get("tags", {})
            # Skip the stadium's own building outline (and any real
            # sports-venue building) -- already modeled as the bowl
            # itself, don't double-draw it as a generic block.
            if tags.get("building") in ("stadium", "grandstand") or tags.get("leisure") == "stadium":
                continue
            c_lat, c_lon = centroid(geom)
            area = polygon_area_m2(geom, c_lat)
            if area < 20:  # drop slivers
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
        buildings = buildings[:MAX_BUILDINGS_PER_STADIUM]
        real_h = sum(1 for b in buildings if b["height_status"] == "REAL")
        semi_h = sum(1 for b in buildings if b["height_status"] == "SEMI")
        print(f"{stadium['name']}: {len(buildings)} real buildings kept ({real_h} real height, {semi_h} levels-derived, {len(buildings)-real_h-semi_h} default)")
        all_results[sid] = buildings
        time.sleep(2)  # be polite to the shared public Overpass instance

    with open(ROOT / "data" / "buildings.json", "w") as f:
        json.dump(all_results, f, indent=2)
    print("\nwrote data/buildings.json")


if __name__ == "__main__":
    main()
