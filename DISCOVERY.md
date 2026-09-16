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

## 4. What actually happened during the real matches (not a forecast -- it already occurred)

FIFA World Cup 2026 ran June 11 - July 19, 2026 -- which, as of this
write-up (September 2026), is in the past. That unlocked something
better than the match-specific *index* originally planned: the real,
observed weather during every real match.

**Data**: `scripts/fetch_match_schedule.py` parses the real 78-match
US-venue schedule (openfootball/worldcup open dataset -- real kickoff
date/time/UTC-offset per match, plus real final scores kept as display
text only). `scripts/fetch_match_weather.py` then pulls real hourly
temperature/dew point for the whole tournament window from the Iowa
State Mesonet ASOS archive -- the SAME physical weather stations this
project's 20-year climatology already uses (cross-checked against
NOAA's own `isd-history.csv`), just published faster than NOAA's own
bulk `global-hourly` archive has caught up to 2026 (verified live: that
archive currently lists only through 2025). Every one of the 78
matches got a real reading within 75 minutes of kickoff -- 0 missing.

**Finding: the real 2026 tournament ran hotter than the 20-year normal
for those exact time slots.** Across all 78 matches, the real kickoff
WBGT averaged **+0.89°C above** the stadium's own 2006-2025 climatology
mean for that same month/hour bucket -- 54 matches ran hotter than
normal, 24 ran cooler. This is an independent real-world check on
Finding #1's warming trend, not just a restatement of it: the actual
tournament lived up to the trend.

**The hottest real moments of the tournament** (peak real WBGT in the
[kickoff, kickoff+2h] window):

| Date | Match | Venue | Peak real WBGT |
|---|---|---|---|
| Jul 4 | Canada 0-3 Morocco | Houston (NRG Stadium) | **35.3°C** |
| Jun 29 | Brazil 2-1 Japan | Houston (NRG Stadium) | 35.2°C |
| Jul 1 | England 2-1 DR Congo | Atlanta (Mercedes-Benz Stadium) | 34.8°C |
| Jun 23 | Portugal 5-0 Uzbekistan | Houston (NRG Stadium) | 34.5°C |
| Jun 22 | Argentina 2-0 Austria | Dallas (AT&T Stadium) | 34.4°C |

All five sit in the "black flag" (extreme risk) range of the sports-
safety scale used throughout this app (`lib/wbgt.ts`) -- and three of
the five real hottest moments were at the same venue, Houston.

**Biggest single-day anomalies vs. the 20-year normal**: a Jun 15
Seattle kickoff ran +6.2°C over Lumen Field's own climatology mean for
that slot -- the single largest surprise of the tournament, real
weather doing what a 20-year average can never promise it won't.

See `scripts/fetch_match_weather.py`'s own docstring for the full
methodology and honesty notes (data_status REAL, tagged distinctly
from the climatology's REAL and the scenario simulator's MOCK).

## 5. Parking is where Track 1 (Transportation) and Track 3 (Public Health) meet

`scripts/fetch_parking_lots.py` pulled real OpenStreetMap parking-lot
geometry around all 11 stadiums (area, distance, compass bearing --
same Overpass technique proven for field orientation). Combined with
the real match kickoff times above, `lib/parkingData.ts` estimates
walk-in heat exposure (real distance + real WBGT + a modeled pavement-
sun surcharge from published heat-island field studies) and match-day
parking fill (real capacity-implied space counts + a modeled,
literature-shaped fill curve keyed to real kickoff time). See the
running app's Map+3D tab -- select a real match and watch the real
parking lots fill with cars as kickoff approaches.

## 6. What's still open (say plainly)

- **Per-section sun-exposure ranking (spec.md Discovery 2.2)**: the 3D
  model computes real sun position for any stadium/moment, including
  now the exact real moment of any real match (verified -- selecting a
  match drives the sun physics from that match's real kickoff instant,
  not an approximation). Turning that into a per-*named-section*
  ranking still needs real field compass orientation for all 11
  venues -- 9 of 11 are REAL (Overpass-computed), 2 (Mercedes-Benz,
  SoFi) remain SEMI/TODO after repeated real Overpass rate-limiting.
- **Parking occupancy and the pavement-sun surcharge are explicitly
  MOCK/SEMI**, not measured at these specific venues -- see
  `lib/parkingData.ts`'s own comments and the app's Honest Limitations
  section in `README.md`.
