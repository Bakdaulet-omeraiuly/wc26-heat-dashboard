"""Computes each stadium's REAL field compass orientation from OpenStreetMap
geometry (Overpass API) -- not looked up from prose (rarely stated
explicitly) or guessed. Finds the 'pitch'/'stadium' way tagged for
football/soccer closest to each stadium's known coordinates, then
computes its long-axis bearing directly from the real node coordinates.
Run once, by hand -- not part of the runtime app.

IMPORTANT: guarded behind main() / `if __name__` on purpose -- an
earlier version had this logic at module level, so importing this file
from scripts/retry_field_orientation.py silently re-ran the entire
original pass a second time and clobbered a stadium (MetLife) that had
already succeeded, purely because that second unplanned pass happened
to get rate-limited. Caught by noticing the JSON output regress on a
direct re-read, not assumed -- see git history for the real before/
after.
"""

import json
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STADIUMS = json.loads((ROOT / "data" / "stadiums.json").read_text())

HEADERS = {"User-Agent": "WC26HeatDashboard/1.0 (hackathon research; contact: galamdyq@gmail.com)"}


def overpass_query(lat, lon, radius=500):
    query = (
        "[out:json];"
        f'(way["leisure"="pitch"]["sport"~"american_football|soccer"](around:{radius},{lat},{lon});'
        f'way["leisure"="pitch"](around:{radius},{lat},{lon}););'
        "out geom;"
    )
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=f"data={urllib.parse.quote(query)}".encode(),
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def long_axis_bearing(geom):
    pts = [(p["lat"], p["lon"]) for p in geom]
    edges = []
    for i in range(len(pts) - 1):
        lat1, lon1 = pts[i]
        lat2, lon2 = pts[i + 1]
        dlat = (lat2 - lat1) * 111320
        dlon = (lon2 - lon1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
        length = math.hypot(dlat, dlon)
        bearing = (math.degrees(math.atan2(dlon, dlat)) + 360) % 360
        edges.append((length, bearing))
    edges.sort(reverse=True)
    return edges[0]  # (length_m, bearing_deg) of the longest edge


def main():
    results = []
    for stadium in STADIUMS:
        lat, lon = stadium["lat"], stadium["lon"]
        try:
            data = overpass_query(lat, lon)
        except Exception as e:
            print(f"{stadium['name']}: QUERY FAILED -- {e}")
            results.append({**stadium, "field_orientation_deg": None, "field_orientation_status": "TODO-SEMI"})
            continue

        # among all pitch ways found, pick the one whose centroid is
        # closest to the stadium's known coordinates AND whose long edge
        # is in a plausible football-field length range (~90-170m,
        # covers field + end zones + a little surrounding apron) --
        # rules out small unrelated practice/park pitches.
        best = None
        best_dist = float("inf")
        for el in data.get("elements", []):
            geom = el.get("geometry")
            if not geom or len(geom) < 4:
                continue
            centroid_lat = sum(p["lat"] for p in geom) / len(geom)
            centroid_lon = sum(p["lon"] for p in geom) / len(geom)
            dist = haversine_m(lat, lon, centroid_lat, centroid_lon)
            length, bearing = long_axis_bearing(geom)
            if 90 <= length <= 170 and dist < best_dist:
                best = (length, bearing, dist, el.get("tags", {}))
                best_dist = dist

        if best:
            length, bearing, dist, tags = best
            print(f"{stadium['name']}: bearing={bearing:.1f} deg, long-edge={length:.1f}m, {dist:.0f}m from known coords, tags={tags}")
            results.append({**stadium, "field_orientation_deg": round(bearing, 1), "field_orientation_status": "REAL"})
        else:
            print(f"{stadium['name']}: NO SUITABLE PITCH GEOMETRY FOUND")
            results.append({**stadium, "field_orientation_deg": None, "field_orientation_status": "TODO-SEMI"})

        time.sleep(1.5)  # be polite to the shared public Overpass instance

    with open(ROOT / "data" / "stadiums.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nwrote data/stadiums.json with real field orientations where found")


if __name__ == "__main__":
    main()
