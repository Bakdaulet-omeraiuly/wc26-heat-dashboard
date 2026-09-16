"""Fetches REAL hourly weather for June 11 - July 19, 2026 (the World
Cup window) from the Iowa State Mesonet ASOS archive, and matches it
to each real match's real kickoff time (data/matches.json, from
scripts/fetch_match_schedule.py) to compute the real WBGT during real
matches -- "the Discovery, part 2": not a climatology average, but
what actually happened.

WHY Mesonet and not our usual NOAA global-hourly bulk archive: verified
live this session that NOAA's own bulk ISD archive (used by
fetch_noaa_data.py for 2006-2025) has not yet published a 2026 file --
https://www.ncei.noaa.gov/data/global-hourly/access/ lists only up to
2025. Iowa State's Mesonet ASOS archive mirrors the SAME underlying
real automated-surface-station network (it's real METAR/ASOS data,
not a different measurement), just published with less lag -- verified
by cross-referencing every one of our 11 stations against NOAA's own
isd-history.csv to get the exact matching ICAO code, so this is the
SAME physical station as our 20-year climatology, not a substitute
location.

Each match's real kickoff-time reading is the nearest real observation
within +/-75 minutes (ASOS reports hourly plus irregular "special"
reports; nearest-within-tolerance mirrors what scripts/find_stations.py
already established as this project's standard for "real reading
matched to a specific moment"). A match's "peak" WBGT is the max real
reading in the [kickoff, kickoff+2h] window (a World Cup match, plus
stoppage time, roughly fits this).
"""

import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Real ICAO codes, cross-referenced against NOAA's own isd-history.csv
# against the EXACT station id each stadium already uses for its
# 20-year climatology (see this session's research) -- not a fresh
# nearest-airport guess.
STATION_ICAO = {
    "att-stadium": "KDFW",
    "mercedes-benz-stadium": "KFTY",
    "gillette-stadium": "KOWD",
    "nrg-stadium": "KHOU",
    "arrowhead-stadium": "KMKC",
    "sofi-stadium": "KLAX",
    "hard-rock-stadium": "KFLL",
    "metlife-stadium": "KEWR",
    "lincoln-financial-field": "KPHL",
    "levis-stadium": "KSJC",
    "lumen-field": "KBFI",
}

WINDOW_START = (2026, 6, 10)  # a day of slack either side of the real tournament window
WINDOW_END = (2026, 7, 20)

HEADERS = {"User-Agent": "WC26HeatDashboard/1.0 (hackathon research; contact: galamdyq@gmail.com)"}


def vapor_pressure_from_dewpoint(dew_c: float) -> float:
    import math

    return 6.105 * math.exp((17.27 * dew_c) / (237.7 + dew_c))


def approximate_wbgt(air_c: float, dew_c: float) -> float:
    e = vapor_pressure_from_dewpoint(dew_c)
    return 0.567 * air_c + 0.393 * e + 3.94


def fetch_station_readings(icao: str):
    y1, m1, d1 = WINDOW_START
    y2, m2, d2 = WINDOW_END
    params = {
        "station": icao,
        "data": "tmpc,dwpc",
        "year1": y1, "month1": m1, "day1": d1,
        "year2": y2, "month2": m2, "day2": d2,
        "tz": "Etc/UTC",
        "format": "onlycomma",
        "latlon": "no", "elev": "no",
        "missing": "M", "trace": "T", "direct": "no",
    }
    url = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        text = resp.read().decode("utf-8")

    readings = []
    lines = text.strip().splitlines()
    for line in lines[1:]:  # skip header
        parts = line.split(",")
        if len(parts) < 4:
            continue
        _, valid, tmpc, dwpc = parts[0], parts[1], parts[2], parts[3]
        if tmpc in ("M", "") or dwpc in ("M", ""):
            continue
        try:
            dt = datetime.strptime(valid, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
            readings.append((dt, float(tmpc), float(dwpc)))
        except ValueError:
            continue
    readings.sort(key=lambda r: r[0])
    return readings


def nearest_reading(readings, target_dt, tolerance_minutes=75):
    best = None
    best_diff = None
    for dt, t, d in readings:
        diff = abs((dt - target_dt).total_seconds()) / 60
        if diff <= tolerance_minutes and (best_diff is None or diff < best_diff):
            best, best_diff = (dt, t, d), diff
    return best


def peak_in_window(readings, start_dt, end_dt):
    best_wbgt = None
    best = None
    for dt, t, d in readings:
        if start_dt <= dt <= end_dt:
            wbgt = approximate_wbgt(t, d)
            if best_wbgt is None or wbgt > best_wbgt:
                best_wbgt, best = wbgt, (dt, t, d, wbgt)
    return best


def main():
    matches = json.loads((ROOT / "data" / "matches.json").read_text())
    by_station_cache = {}
    enriched = []
    missing_station = 0

    for stadium_id in set(m["stadium_id"] for m in matches):
        icao = STATION_ICAO.get(stadium_id)
        if not icao:
            continue
        print(f"fetching {icao} ({stadium_id}) ...")
        try:
            by_station_cache[stadium_id] = fetch_station_readings(icao)
            print(f"  {len(by_station_cache[stadium_id])} real hourly readings")
        except Exception as e:
            print(f"  FAILED: {e}")
            by_station_cache[stadium_id] = []
        time.sleep(2)

    for m in matches:
        readings = by_station_cache.get(m["stadium_id"], [])
        kickoff = datetime.fromisoformat(m["kickoff_utc_iso"])
        near = nearest_reading(readings, kickoff)
        peak = peak_in_window(readings, kickoff, kickoff + timedelta(hours=2))

        entry = dict(m)
        if near:
            dt, t, d, = near
            entry["real_kickoff_temp_c"] = round(t, 1)
            entry["real_kickoff_dewpoint_c"] = round(d, 1)
            entry["real_kickoff_wbgt_c"] = round(approximate_wbgt(t, d), 1)
            entry["real_reading_minutes_from_kickoff"] = round((dt - kickoff).total_seconds() / 60, 1)
        else:
            entry["real_kickoff_temp_c"] = None
            entry["real_kickoff_dewpoint_c"] = None
            entry["real_kickoff_wbgt_c"] = None
            entry["real_reading_minutes_from_kickoff"] = None
            missing_station += 1

        if peak:
            _, pt, pd, pw = peak
            entry["real_peak_wbgt_c"] = round(pw, 1)
        else:
            entry["real_peak_wbgt_c"] = None

        entry["weather_data_source"] = (
            "Iowa State Mesonet ASOS archive (real METAR/ASOS observations from the same "
            f"physical station used for this stadium's 20-year climatology, ICAO {STATION_ICAO.get(m['stadium_id'], '?')}) "
            "-- used because NOAA's own bulk global-hourly archive has not yet published 2026."
        )
        entry["weather_data_status"] = "REAL" if near else "MISSING"
        enriched.append(entry)

    enriched.sort(key=lambda m: (m["real_peak_wbgt_c"] is None, -(m["real_peak_wbgt_c"] or 0)))

    print(f"\n{len(enriched)} matches processed, {missing_station} missing a nearby real reading")
    print("\nTop 10 hottest real matches (by real peak WBGT during play):")
    for m in enriched[:10]:
        print(f"  {m['kickoff_utc_iso'][:10]} {m['matchup_raw'][:40]:40s} @ {m['city']:35s} peak={m['real_peak_wbgt_c']}C")

    with open(ROOT / "data" / "match_weather.json", "w") as f:
        json.dump(enriched, f, indent=2)
    print("\nwrote data/match_weather.json")


if __name__ == "__main__":
    main()
