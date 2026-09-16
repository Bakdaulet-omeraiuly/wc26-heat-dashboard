"""Builds two SMALL, git-committable summary files from the large local
heat.db (172MB, gitignored -- see fetch_noaa_data.py's docstring for
why that file itself isn't committed):

  data/climatology.json -- per stadium x month x hour-of-day: mean/p10/
    p50/p90 of temp, dewpoint, and derived WBGT, from all 20 years of
    that bucket's readings. Powers View A (current risk), View C
    (ranked comparison), View D (scenario simulator baseline) -- none
    of which need the full 2.46M-row raw table at runtime.

  data/yearly_trend.json -- per stadium x year x month: mean WBGT.
    Powers Discovery 2.3 (the 20-year local trend line/regression) --
    small (11 x 20 x 12 = 2,640 rows) without needing raw hourly detail.

View B (the literal "any exact historical date+hour" explorer) and any
other need for raw per-reading detail still reads heat.db directly --
that's a local/Docker-build-time artifact, not something this script
tries to shrink away.
"""

import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "heat.db"


def vapor_pressure(dewpoint_c: float) -> float:
    from math import exp

    return 6.105 * exp((17.27 * dewpoint_c) / (237.7 + dewpoint_c))


def wbgt(temp_c: float, dewpoint_c: float) -> float:
    return 0.567 * temp_c + 0.393 * vapor_pressure(dewpoint_c) + 3.94


def percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return float("nan")
    k = (len(sorted_values) - 1) * p
    f, c = int(k), min(int(k) + 1, len(sorted_values) - 1)
    if f == c:
        return sorted_values[f]
    return sorted_values[f] + (sorted_values[c] - sorted_values[f]) * (k - f)


def main():
    conn = sqlite3.connect(DB_PATH)
    stadium_ids = [r[0] for r in conn.execute("SELECT DISTINCT stadium_id FROM hourly_readings").fetchall()]

    climatology = {}
    yearly_trend = {}

    for stadium_id in stadium_ids:
        print(f"aggregating {stadium_id}...")
        rows = conn.execute(
            "SELECT observed_at, temp_c, dewpoint_c FROM hourly_readings "
            "WHERE stadium_id = ? AND temp_c IS NOT NULL AND dewpoint_c IS NOT NULL",
            (stadium_id,),
        ).fetchall()

        # month/hour -> list of wbgt values (climatology)
        buckets: dict[tuple[int, int], list[float]] = defaultdict(list)
        # year/month -> list of wbgt values (trend)
        year_month: dict[tuple[int, int], list[float]] = defaultdict(list)

        for ts, temp_c, dewpoint_c in rows:
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            w = wbgt(temp_c, dewpoint_c)
            buckets[(dt.month, dt.hour)].append(w)
            year_month[(dt.year, dt.month)].append(w)

        stadium_climatology = {}
        for (month, hour), values in buckets.items():
            values.sort()
            stadium_climatology[f"{month:02d}-{hour:02d}"] = {
                "n": len(values),
                "mean": round(mean(values), 2),
                "p10": round(percentile(values, 0.10), 2),
                "p50": round(percentile(values, 0.50), 2),
                "p90": round(percentile(values, 0.90), 2),
            }
        climatology[stadium_id] = stadium_climatology

        stadium_trend = {}
        for (year, month), values in year_month.items():
            stadium_trend[f"{year}-{month:02d}"] = {"n": len(values), "mean": round(mean(values), 2)}
        yearly_trend[stadium_id] = stadium_trend

    (ROOT / "data" / "climatology.json").write_text(json.dumps(climatology, indent=2))
    (ROOT / "data" / "yearly_trend.json").write_text(json.dumps(yearly_trend, indent=2))
    print("\nwrote data/climatology.json and data/yearly_trend.json")
    conn.close()


if __name__ == "__main__":
    main()
