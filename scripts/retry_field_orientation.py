"""Retry field-orientation lookup for the 5 stadiums that failed the
first pass (rate limits/timeouts on the shared public Overpass
instance, or no matching geometry found within the length filter) --
more generous delays, wider radius, and a looser length filter for
soccer-only pitches (some are tagged closer to real soccer-pitch
length ~105m rather than the wider NFL-field-plus-endzones range)."""

import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from find_field_orientation import HEADERS, haversine_m, long_axis_bearing  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TARGETS = {
    "mercedes-benz-stadium": (33.75556, -84.4),
    "sofi-stadium": (33.953, -118.339),
    "metlife-stadium": (40.813528, -74.074361),
}


def overpass_query_wide(lat, lon, radius=600):
    query = (
        "[out:json][timeout:60];"
        f'(way["leisure"="pitch"](around:{radius},{lat},{lon});'
        f'way["sport"~"american_football|soccer"](around:{radius},{lat},{lon}););'
        "out geom;"
    )
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=f"data={urllib.parse.quote(query)}".encode(),
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=70) as resp:
        return json.loads(resp.read())


stadiums = json.loads((ROOT / "data" / "stadiums.json").read_text())
by_id = {s["id"]: s for s in stadiums}

BACKOFFS = [15, 30, 60, 90]  # seconds -- escalating, this shared instance
# has been hit hard today (429s and 504s on nearly every stadium at some
# point), so a flat short backoff wasn't enough on the earlier pass.

for sid, (lat, lon) in TARGETS.items():
    name = by_id[sid]["name"]
    data = None
    for attempt in range(len(BACKOFFS) + 1):
        try:
            data = overpass_query_wide(lat, lon)
            break
        except Exception as e:
            print(f"{name}: attempt {attempt+1} failed -- {e}")
            if attempt < len(BACKOFFS):
                time.sleep(BACKOFFS[attempt])
    if data is None:
        print(f"{name}: giving up after {len(BACKOFFS)+1} attempts")
        continue

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
        # loosened length range: 85-175m covers both soccer pitches and
        # full NFL fields+endzones+apron
        if 85 <= length <= 175 and dist < best_dist:
            best = (length, bearing, dist, el.get("tags", {}))
            best_dist = dist

    if best:
        length, bearing, dist, tags = best
        print(f"{name}: bearing={bearing:.1f} deg, long-edge={length:.1f}m, {dist:.0f}m away, tags={tags}")
        by_id[sid]["field_orientation_deg"] = round(bearing, 1)
        by_id[sid]["field_orientation_status"] = "REAL"
    else:
        candidates = [
            (el.get("tags", {}).get("name") or el.get("tags", {}).get("sport"), long_axis_bearing(el["geometry"])[0])
            for el in data.get("elements", [])
            if el.get("geometry") and len(el["geometry"]) >= 4
        ]
        print(f"{name}: still no match in range. Candidates seen: {candidates}")

    time.sleep(3)

with open(ROOT / "data" / "stadiums.json", "w") as f:
    json.dump(list(by_id.values()), f, indent=2)
print("\nupdated data/stadiums.json")
