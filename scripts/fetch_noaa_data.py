"""Pipeline script (run once, ahead of time -- NOT part of the running
app, same philosophy as caspian-dash's scripts/pipeline/). Bulk-fetches
20 years of real hourly TMP+DEW data for all 11 stadiums' NOAA stations
and loads it into one local SQLite file the Next.js app reads at
request time.

Usage: python3 scripts/fetch_noaa_data.py
"""

import csv
import io
import json
import sqlite3
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STADIUMS = json.loads((ROOT / "data" / "stadiums.json").read_text())
DB_PATH = ROOT / "data" / "heat.db"
YEARS = range(2006, 2026)  # 2006-2025 inclusive, 20 years


def parse_tenths(field: str) -> float | None:
    """NOAA global-hourly TMP/DEW fields look like '+0006,1' -- signed
    four-digit tenths of a degree C, comma, quality code. '+9999' means
    missing. Returns degrees C, or None if missing/malformed."""
    if not field or "," not in field:
        return None
    value_str = field.split(",")[0]
    try:
        value = int(value_str)
    except ValueError:
        return None
    if value == 9999 or value == -9999:
        return None
    return value / 10.0


def fetch_station_year(station_id: str, year: int) -> list[tuple[str, float | None, float | None]]:
    url = f"https://www.ncei.noaa.gov/data/global-hourly/access/{year}/{station_id}.csv"
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return []  # station has no data for this year -- skip, don't crash the whole pipeline
        raise
    rows = []
    reader = csv.DictReader(io.StringIO(raw))
    for row in reader:
        date = row.get("DATE")
        tmp = parse_tenths(row.get("TMP", ""))
        dew = parse_tenths(row.get("DEW", ""))
        if date and (tmp is not None or dew is not None):
            rows.append((date, tmp, dew))
    return rows


def main():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    # observed_at stored as an INTEGER unix timestamp (not the original
    # ISO text) and station_id dropped entirely (it's a per-stadium
    # constant already in stadiums.json, not a per-row fact) -- cut a
    # first-draft 400MB file to 172MB for the same 2.46M rows. Still
    # too big for git (GitHub's 100MB/file limit) -- this file stays
    # gitignored and is a build-time artifact (see data/README or
    # Dockerfile), not something committed directly.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS hourly_readings (
            stadium_id TEXT NOT NULL,
            observed_at INTEGER NOT NULL,
            temp_c REAL,
            dewpoint_c REAL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_stadium_time ON hourly_readings(stadium_id, observed_at)")
    conn.commit()

    total_rows = 0
    for stadium in STADIUMS:
        station_id = stadium["noaa_station_id"]
        stadium_id = stadium["id"]
        existing = conn.execute(
            "SELECT COUNT(*) FROM hourly_readings WHERE stadium_id = ?", (stadium_id,)
        ).fetchone()[0]
        if existing > 1000:
            print(f"{stadium['name']}: already has {existing} rows, skipping re-fetch")
            total_rows += existing
            continue

        stadium_rows = 0
        for year in YEARS:
            try:
                rows = fetch_station_year(station_id, year)
            except Exception as e:
                print(f"  {stadium['name']} {year}: FAILED -- {e}")
                continue
            if rows:
                conn.executemany(
                    "INSERT INTO hourly_readings (stadium_id, observed_at, temp_c, dewpoint_c) VALUES (?, ?, ?, ?)",
                    [
                        # NOAA's global-hourly DATE field is UTC (documented in
                        # the dataset's own format spec) with no timezone
                        # suffix -- parse naive, then explicitly attach UTC
                        # rather than letting fromisoformat().timestamp()
                        # silently assume the machine's local timezone (a
                        # real correctness bug if this script ever runs
                        # somewhere other than UTC/PST-adjacent).
                        (stadium_id, int(datetime.fromisoformat(date).replace(tzinfo=timezone.utc).timestamp()), tmp, dew)
                        for date, tmp, dew in rows
                    ],
                )
                stadium_rows += len(rows)
            time.sleep(0.15)  # be polite to NCEI's server, no explicit rate limit documented but don't hammer it
        conn.commit()
        print(f"{stadium['name']} ({station_id}): {stadium_rows} rows across {len(list(YEARS))} years")
        total_rows += stadium_rows

    print(f"\nTotal rows in {DB_PATH}: {total_rows}")
    conn.close()


if __name__ == "__main__":
    main()
