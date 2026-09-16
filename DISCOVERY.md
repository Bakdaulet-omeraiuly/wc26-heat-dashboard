# The Discovery -- real, computed findings

Everything below is a genuine output of this project's own data
pipeline (2.46M real NOAA hourly readings, 2006-2025, 11 stadiums) --
not asserted, not estimated by hand. Reproducible: `python3
scripts/fetch_noaa_data.py && python3 scripts/aggregate_summaries.py &&
python3 scripts/compute_discovery.py`.

## 1. Ten of eleven FIFA 2026 US host stadiums are measurably getting hotter

Linear regression on July mean WBGT (Wet-Bulb Globe Temperature), 2006-2025,
per stadium's nearest NOAA weather station:

| Stadium | Trend | 2006 | 2025 |
|---|---|---|---|
| MetLife Stadium (NY/NJ) | **+1.15°C/decade** | 27.2°C | 28.3°C |
| Lincoln Financial Field (Philadelphia) | +1.12°C/decade | 27.4°C | 29.4°C |
| Mercedes-Benz Stadium (Atlanta) | +0.97°C/decade | 27.6°C | 29.5°C |
| Hard Rock Stadium (Miami) | +0.91°C/decade | 30.5°C | 31.8°C |
| NRG Stadium (Houston) | +0.86°C/decade | 30.3°C | 31.8°C |
| Gillette Stadium (Boston) | +0.86°C/decade | 25.8°C | 25.3°C |
| Lumen Field (Seattle) | +0.59°C/decade | 20.0°C | 20.5°C |
| AT&T Stadium (Dallas) | +0.45°C/decade | 29.8°C | 30.0°C |
| Arrowhead Stadium (Kansas City) | +0.36°C/decade | 28.2°C | 29.7°C |
| Levi's Stadium (SF Bay Area) | +0.30°C/decade | 22.3°C | 20.1°C |
| SoFi Stadium (LA) | **-0.17°C/decade** | 24.7°C | 21.5°C |

**Why this matters for the pitch:** this isn't "climate change is
happening" as a generic claim -- it's a specific, local, checkable
number for the exact 11 places and the exact month FIFA 2026 will be
played in. SoFi is reported as the one cooling exception rather than
hidden, the same way caspian-dash reports its own regression's honest
uncertainty rather than only showing the trend that fits the story.

## 2. Miami and Houston are consistently the highest-risk venues; Seattle and the Bay Area consistently the safest

Ranked by mean WBGT, July 3pm UTC bucket (see `data/climatology.json`,
View C in the running app): Hard Rock Stadium (32.8°C) and NRG Stadium
(32.2°C) top the list; Lumen Field (19.2°C) and Levi's Stadium (19.9°C)
are lowest -- a ~13.6°C spread across host cities for the SAME sport,
SAME month, SAME rough kickoff-time window.

## 3. Risk is relative, not just absolute -- Gillette Stadium is a real example

Gillette Stadium's July WBGT (27.3°C) is objectively cooler than
several other venues, but it lands in our percentile-based risk scale's
top ("magenta") category -- because it's much more unusual FOR BOSTON
specifically than a similar reading would be for Houston. Absolute WBGT
and percentile-relative risk answer two different, both-real questions:
"how dangerous is this in absolute terms" and "how prepared is this
specific city's infrastructure/population likely to be for this."

## 4. What's still open (say plainly)

- **Match-specific index (spec.md Discovery 2.1)**: cross-referencing
  the real published 78-match schedule against each match's own exact
  kickoff-hour historical odds is NOT yet computed -- the schedule
  itself wasn't successfully pulled into a structured list in the time
  available (FIFA's match centre is a JS app, not simply fetchable).
  The climatology-only findings above stand on their own regardless.
- **Per-section sun-exposure ranking (Discovery 2.2)**: the 3D model
  computes real sun position per stadium/moment (verified, see the
  running app's Map+3D tab), but summing that across every scheduled
  match hour into a per-section ranking needs the same match schedule
  data as #1 above, plus each stadium's real field compass orientation
  (still marked SEMI/TODO in `data/stadiums.json` -- not yet
  hand-researched from satellite imagery).
