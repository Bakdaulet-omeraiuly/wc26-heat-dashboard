"""Fetches REAL parking-lot geometry around each of the 11 stadiums from
OpenStreetMap (Overpass API) -- same technique proven in
find_field_orientation.py: real polygon coordinates, not a guess or an
LLM description. For each lot, computes:

  - area_m2 (shoelace formula on a local equirectangular projection)
  - centroid lat/lon
  - distance_m from the lot centroid to the stadium's known coordinates
  - bearing_from_stadium_deg (compass direction from stadium to lot,
    used to place it around the 3D model)
  - length_m / width_m / orientation_deg: the lot's own real oriented
    bounding rectangle -- rotate every real node into the frame of its
    longest edge, then take the extent along vs. across that axis.
    This is what lets lib/parkingLayout.ts compute a REAL stall-by-stall
    parking capacity (rows x aisles) instead of a flat area/constant
    guess -- same "verify from real geometry" discipline as field
    orientation.

Run once, by hand -- not part of the runtime app. Writes data/parking.json.

Feasibility spot-checked live before writing this script: AT&T Stadium
returned 99 real named lots ("Lot 11", "Lot 13", ...), Hard Rock
Stadium returned 29 real but mostly-unnamed lots -- both handled below
(name falls back to "Lot" + a stable index when OSM has none).
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
RADIUS_M = 1500  # generous enough to catch a stadium's full lot complex without pulling in unrelated retail lots miles away
MAX_LOTS_PER_STADIUM = 40  # cap for payload size / 3D scene sanity -- keeps the biggest, closest lots


def overpass_query(lat, lon, radius=RADIUS_M):
    query = f'[out:json][timeout:40];(way["amenity"="parking"](around:{radius},{lat},{lon}););out geom;'
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=f"data={urllib.parse.quote(query)}".encode(),
        headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=50) as resp:
        return json.loads(resp.read())


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000
    dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def bearing_deg(lat1, lon1, lat2, lon2):
    """Compass bearing from point 1 to point 2, 0=N, 90=E, clockwise."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def polygon_area_m2(geom, ref_lat):
    """Shoelace formula on a local equirectangular (lat/lon -> meters)
    projection centered near the polygon -- accurate enough at this
    scale (a few hundred meters), not meant for large-area GIS work."""
    pts = []
    for p in geom:
        x = (p["lon"]) * 111320 * math.cos(math.radians(ref_lat))
        y = (p["lat"]) * 111320
        pts.append((x, y))
    area = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2


def centroid(geom):
    lat = sum(p["lat"] for p in geom) / len(geom)
    lon = sum(p["lon"] for p in geom) / len(geom)
    return lat, lon


def to_local_meters(geom, ref_lat):
    return [(p["lon"] * 111320 * math.cos(math.radians(ref_lat)), p["lat"] * 111320) for p in geom]


def oriented_dimensions(geom, ref_lat):
    """Real oriented bounding rectangle of this lot's real node
    coordinates: find the longest edge's bearing (the lot's natural
    "long axis" -- true for the large majority of real surface lots,
    which are built as one or two rectangular rows), rotate every real
    point into that axis-aligned frame, then take the coordinate
    extents. Returns (orientation_deg, length_m, width_m) -- length
    along the long axis, width across it. Not a substitute for the
    lot's real as-built stall layout (which OSM doesn't carry), but a
    real geometric measurement, not a guessed aspect ratio."""
    pts = to_local_meters(geom, ref_lat)
    n = len(pts)
    best_len = -1
    best_bearing = 0
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        edge_len = math.hypot(dx, dy)
        if edge_len > best_len:
            best_len = edge_len
            best_bearing = (math.degrees(math.atan2(dx, dy)) + 360) % 360

    theta = math.radians(best_bearing)
    sin_t, cos_t = math.sin(theta), math.cos(theta)
    along = [x * sin_t + y * cos_t for x, y in pts]  # projection onto the long-axis direction
    across = [x * cos_t - y * sin_t for x, y in pts]  # projection onto the perpendicular direction
    length_m = max(along) - min(along)
    width_m = max(across) - min(across)
    # the "long axis" by construction is the longer of the two extents;
    # occasionally the longest EDGE isn't the longest SPAN (an L-shaped
    # or angled lot) -- guard by swapping if that happens, so length_m
    # is always >= width_m as the name promises.
    if width_m > length_m:
        length_m, width_m = width_m, length_m
    return round(best_bearing, 1), round(length_m, 1), round(width_m, 1)


def main():
    all_results = {}
    for stadium in STADIUMS:
        sid, lat, lon = stadium["id"], stadium["lat"], stadium["lon"]
        lots = []
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
            c_lat, c_lon = centroid(geom)
            area = polygon_area_m2(geom, c_lat)
            if area < 200:  # drop slivers / driveways mistagged as lots
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

        total_area = sum(l["area_m2"] for l in lots)
        print(f"{stadium['name']}: {len(lots)} real lots kept, {total_area:,} m^2 total, "
              f"nearest {lots[0]['distance_m']}m" if lots else f"{stadium['name']}: no lots found")
        all_results[sid] = lots
        time.sleep(2)  # be polite to the shared public Overpass instance

    with open(ROOT / "data" / "parking.json", "w") as f:
        json.dump(all_results, f, indent=2)
    print("\nwrote data/parking.json")


if __name__ == "__main__":
    main()
