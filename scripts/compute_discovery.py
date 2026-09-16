"""Computes Discovery 2.3 (spec.md Section 2) -- a real 20-year local
trend line per stadium, using yearly_trend.json's already-aggregated
per-year-per-month mean WBGT. Linear regression, same statistical move
as caspian-dash's own sea-level trend (compute it, report it plainly,
including when it's flat/noisy -- don't cherry-pick).

Focuses on July (month 7) since that's within the tournament window
and has full-month data for every year (June 2026 itself is still
mid-tournament and incomplete, months outside June-July aren't the
point here).
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STADIUMS = {s["id"]: s["name"] for s in json.loads((ROOT / "data" / "stadiums.json").read_text())}
TREND = json.loads((ROOT / "data" / "yearly_trend.json").read_text())


def linreg(xs: list[float], ys: list[float]) -> tuple[float, float]:
    n = len(xs)
    mean_x, mean_y = sum(xs) / n, sum(ys) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    den = sum((x - mean_x) ** 2 for x in xs)
    slope = num / den if den else 0.0
    intercept = mean_y - slope * mean_x
    return slope, intercept


results = []
for stadium_id, name in STADIUMS.items():
    stadium_trend = TREND.get(stadium_id, {})
    years, wbgts = [], []
    for year in range(2006, 2026):
        key = f"{year}-07"
        entry = stadium_trend.get(key)
        if entry and entry["n"] >= 100:  # a real month's worth of hourly obs, not a sparse partial year
            years.append(year)
            wbgts.append(entry["mean"])

    if len(years) < 10:
        results.append({"stadium": name, "status": "insufficient_data", "n_years": len(years)})
        continue

    slope, intercept = linreg(years, wbgts)
    per_decade = slope * 10
    results.append(
        {
            "stadium": name,
            "n_years": len(years),
            "first_year": years[0],
            "last_year": years[-1],
            "first_year_wbgt": round(wbgts[0], 2),
            "last_year_wbgt": round(wbgts[-1], 2),
            "trend_per_decade_c": round(per_decade, 3),
        }
    )

results.sort(key=lambda r: r.get("trend_per_decade_c", -999), reverse=True)

print("July WBGT trend, 2006-2025 (linear regression, per stadium):\n")
for r in results:
    if r.get("status") == "insufficient_data":
        print(f"  {r['stadium']}: insufficient data ({r['n_years']} years) -- not reporting a trend")
    else:
        sign = "+" if r["trend_per_decade_c"] >= 0 else ""
        print(
            f"  {r['stadium']}: {sign}{r['trend_per_decade_c']}°C/decade "
            f"({r['first_year']}: {r['first_year_wbgt']}°C -> {r['last_year']}: {r['last_year_wbgt']}°C, n={r['n_years']} years)"
        )

(ROOT / "data" / "discovery_trend.json").write_text(json.dumps(results, indent=2))
print("\nwrote data/discovery_trend.json")
