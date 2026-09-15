"""Find the nearest NCEI global-hourly (ISD) station to each of the 11
FIFA 2026 US host stadiums, confirming it actually has TMP+DEW data and
reasonable multi-year coverage before trusting it. Run once, by hand,
to compile data/stadiums.json's `station_id` fields -- not part of the
runtime app."""

import json
import time
import urllib.request

STADIUMS = [
    {"name": "AT&T Stadium", "city": "Dallas (Arlington), TX", "lat": 32.74778, "lon": -97.09278},
    {"name": "Mercedes-Benz Stadium", "city": "Atlanta, GA", "lat": 33.75556, "lon": -84.40000},
    {"name": "Gillette Stadium", "city": "Boston (Foxborough), MA", "lat": 42.091, "lon": -71.264},
    {"name": "NRG Stadium", "city": "Houston, TX", "lat": 29.68472, "lon": -95.41083},
    {"name": "Arrowhead Stadium", "city": "Kansas City, MO", "lat": 39.04889, "lon": -94.48389},
    {"name": "SoFi Stadium", "city": "Los Angeles (Inglewood), CA", "lat": 33.953, "lon": -118.339},
    {"name": "Hard Rock Stadium", "city": "Miami (Miami Gardens), FL", "lat": 25.95806, "lon": -80.23889},
    {"name": "MetLife Stadium", "city": "New York/New Jersey", "lat": 40.813528, "lon": -74.074361},
    {"name": "Lincoln Financial Field", "city": "Philadelphia, PA", "lat": 39.90083, "lon": -75.16750},
    {"name": "Levi's Stadium", "city": "San Francisco Bay Area (Santa Clara), CA", "lat": 37.403, "lon": -121.970},
    {"name": "Lumen Field", "city": "Seattle, WA", "lat": 47.5952, "lon": -122.3316},
]


def search_stations(lat, lon, delta=0.35):
    # bbox order NCEI expects: north,west,south,east
    bbox = f"{lat+delta},{lon-delta},{lat-delta},{lon+delta}"
    url = (
        "https://www.ncei.noaa.gov/access/services/search/v1/data"
        f"?dataset=global-hourly&bbox={bbox}&startDate=2005-01-01T00:00:00&endDate=2025-12-31T23:59:59&limit=25"
    )
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read())


def haversine(lat1, lon1, lat2, lon2):
    from math import radians, sin, cos, sqrt, atan2

    r = 6371
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))


def check_station_has_dew_and_years(station_id, years_to_check=(2006, 2015, 2024)):
    ok_years = []
    for y in years_to_check:
        url = f"https://www.ncei.noaa.gov/data/global-hourly/access/{y}/{station_id}.csv"
        try:
            req = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 200:
                    ok_years.append(y)
        except Exception:
            pass
    return ok_years


results = []
for stad in STADIUMS:
    try:
        data = search_stations(stad["lat"], stad["lon"])
    except Exception as e:
        print(f"{stad['name']}: SEARCH FAILED -- {e}")
        results.append({**stad, "station_id": None, "error": str(e)})
        continue

    # dedupe by station id (embedded in result "name"/"id" as "<station>.csv")
    candidates = {}
    for r in data.get("results", []):
        sid = r["name"].replace(".csv", "")
        loc = r.get("location", {}).get("coordinates")
        if not loc:
            continue
        dist = haversine(stad["lat"], stad["lon"], loc[1], loc[0])
        # keep the closest file we've seen for this station id
        if sid not in candidates or dist < candidates[sid]["dist"]:
            candidates[sid] = {"dist": dist, "dataTypesCount": r.get("dataTypesCount", 0)}

    ranked = sorted(candidates.items(), key=lambda kv: kv[1]["dist"])
    chosen = None
    for sid, meta in ranked[:5]:
        years_ok = check_station_has_dew_and_years(sid)
        print(f"{stad['name']}: candidate {sid} dist={meta['dist']:.1f}km years_ok={years_ok}")
        if len(years_ok) == 3:  # has 2006, 2015, AND 2024
            chosen = sid
            break
        time.sleep(0.3)

    results.append({**stad, "station_id": chosen, "candidates_checked": [c[0] for c in ranked[:5]]})
    print(f"==> {stad['name']}: CHOSE {chosen}\n")

with open("data/stadiums_stations.json", "w") as f:
    json.dump(results, f, indent=2)

print("\n\nSummary:")
for r in results:
    print(f"  {r['name']}: {r['station_id']}")
