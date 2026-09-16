# WC26 Heat Risk Dashboard

Rice University Urban Sustainability Hackathon 2026 · Track 3 (Public
Health & the Built Environment)

A research-grade interactive dashboard answering one question with real
numbers: **which of the 11 FIFA World Cup 2026 US host stadiums carry
the highest heat risk, when, and how much would a given intervention
actually help?**

## What it does -- in three sentences

FIFA World Cup 2026 runs June 11 - July 19 across 11 US cities, several
among the hottest metro areas in the country, exposing potentially
millions of attendees to real heat-illness risk. This dashboard pulls
20 years of real hourly NOAA weather data per venue, computes WBGT
(Wet-Bulb Globe Temperature -- the actual metric US sports medicine
uses for outdoor heat safety) for any date/time, and lets a city
planner see -- live, on a map and a real 3D stadium model driven by
actual sun-position astronomy -- how much shade, misting, or closing a
retractable roof would change the risk. See `DISCOVERY.md` for the real
findings this pipeline surfaced (10 of 11 venues are measurably getting
hotter over 20 years).

## Quick start

```bash
docker compose up
```

Open http://localhost:3000. Views A/C/D/E (map, 3D model, ranked
comparison, scenario simulator, priority list) work immediately, no
setup, fully offline -- they read the small committed
`data/climatology.json`/`data/yearly_trend.json`.

View B (the 20-year historical explorer, "pick any exact real date and
see what actually happened") needs the full 172MB raw NOAA dataset,
which isn't committed to git (GitHub's 100MB/file limit -- see
`scripts/fetch_noaa_data.py`'s docstring). To enable it:

```bash
python3 scripts/fetch_noaa_data.py      # ~10-15 min, needs internet
npm install && npm run dev              # or: npm run build && npm start
```

(Running View B specifically through Docker hit a real, reproduced
virtiofs bind-mount issue on macOS -- see `docker-compose.yml`'s
comments. Views A/C/D/E work fine in Docker regardless; View B is the
one case where running directly on the host is the more reliable path
right now.)

## The 6 views

| View | What it shows |
|---|---|
| **A -- Map + 3D** (homepage) | All 11 stadiums on a real US map, colored by heat risk; a month/hour scrubber recolors everything live; click a stadium for a 3D model showing real sun/shade (SunCalc-computed) plus its real parking lots, placed by real compass bearing/distance and colored by estimated walk-in heat exposure |
| **B -- 20-Year Explorer** | Any stadium + exact date/hour, 2006-2025 -- the real recorded temp/dewpoint/WBGT curve for that day, CSV export |
| **C -- Ranked Comparison** | All 11 cities ranked by WBGT for the selected month/hour |
| **D -- Scenario Simulator** | Shade/misting/roof-closed sliders, live-recomputed WBGT (modeled effect sizes, stated plainly as such) |
| **E -- Priority List** | Ranked "invest here first," current vs. projected-after-mitigation |
| **F -- Ask** | Natural-language Q&A over the real data, e.g. "which stadium is safest for a June kickoff?" -- see below |

### Parking lots, in 3D and in the Discovery -- solving two tracks at once

City planners asking "is our stadium heat-safe" and "is our parking
heat-safe" are really asking one question: what does the walk from a
parked car to the gate feel like. Real field studies (EPA's heat-island
program, a USDA Forest Service Davis, CA shading study) show open
asphalt running 40-60°F hotter than shaded air at midday, and this
session's research turned that into a real, geometry-backed feature
rather than a hand-wavy add-on:

- `scripts/fetch_parking_lots.py` pulls REAL parking-lot polygons from
  OpenStreetMap around each stadium (the same Overpass technique
  proven for field orientation) -- real area, real centroid, real
  distance and compass bearing from the stadium. 40 lots kept per
  venue (nearest first), e.g. AT&T Stadium: 40 real named lots
  ("Lot 11", "Lot 13", ...), 527,000 m² total.
- `lib/parkingData.ts` turns that into a walk-in heat estimate: real
  distance -> a SEMI walk time (~3mph assumption), plus the real
  climatology WBGT for the selected month/hour, plus one clearly-MOCK
  surcharge (+3°C) for crossing open sunlit pavement -- never
  presented as a rigorous globe-temperature WBGT.
- The 3D view (`components/Stadium3D.tsx`) places each real lot at its
  real bearing/distance around the stadium bowl (distance compressed
  for visualization, not to scale) and colors it by that estimate --
  hover a lot for its name, distance, walk time, and heat flag.
- The Ask agent has a matching `get_parking_exposure` tool, so "which
  lot is safest to park in" gets the same real-data-grounded treatment
  as every other question.

This deliberately overlaps Track 1 (Transportation & Access) from
inside a Track 3 submission -- the walk from a parking lot is exactly
where "built environment" and "access" meet.

### The Ask agent -- retrieval, not invention

`components/AskAgent.tsx` + `app/api/ask/route.ts`. A real LLM (Claude,
via function-calling) answers free-text questions, but it is only
allowed to state a number that came back from one of eleven tool calls
into `lib/agentData.ts` / `lib/nwsForecast.ts` / `lib/parkingData.ts`
-- each a thin wrapper
around either the dashboard's own real data files
(`climatology.json` / `discovery_trend.json` / scenario formula) or a
live real external source. The system prompt requires every claim to
carry its data_status, and requires an honest "not yet verified"
answer instead of a guess when a tool returns null (e.g. asking which
section of Mercedes-Benz Stadium gets the most sun -- its field
orientation is still TODO-SEMI, and the agent says so rather than
inventing a section name). Every answer's "data used" panel expands to
show the exact tool calls and raw tagged JSON that produced it -- for
this audience (researchers, not casual users), seeing the underlying
number matters more than a smooth chat UI.

Two data_status values are specific to "future" questions, and the
agent is instructed never to conflate them:
- **EXTRAPOLATION** (`project_future_wbgt`) -- a naive straight-line
  projection of the real 2006-2025 trend, capped at 15 years past 2025
  and refusing (with an explanation) beyond that. No forecast skill,
  explicitly framed as "if the past trend continues," not a
  prediction.
- **REAL-FORECAST** (`get_weather_forecast`) -- an actual NOAA
  National Weather Service prediction (`api.weather.gov`, free, no
  key) for the next ~7 days, with WBGT computed from the real
  forecast temp/dewpoint the same way the rest of the app computes it
  from historical readings.

A THIRD kind, plain **REAL** (not REAL-FORECAST, not EXTRAPOLATION):
`get_stadium_matches` / `get_hottest_real_matches` return the actual
observed weather during the actual 2026 World Cup, which already
happened (see DISCOVERY.md Section 4) -- a real historical fact, not a
model of any kind, matched to each real match's real kickoff via the
Iowa State Mesonet ASOS archive (used because NOAA's own bulk
`global-hourly` archive hasn't published 2026 yet -- verified live,
not assumed).

Needs `ANTHROPIC_API_KEY` set (`.env.local` locally, a Vercel env var
in production); without it, `/api/ask` returns a clear 503 instead of
failing silently.

## How it's built

- **Next.js 16 + React + TypeScript + Tailwind CSS** -- one app, routes
  and API in the same project.
- **deck.gl** with its own basemap (US Census Bureau boundaries via
  `us-atlas`, ISC-licensed) -- no map API key needed, works offline.
- **Three.js + React Three Fiber** for the 3D stadium view, **SunCalc**
  for real sun azimuth/altitude at any date/time/location.
- **Recharts, Zustand, TanStack Query** for charts/state/data-fetching.
- **SQLite** (`better-sqlite3`) for the 172MB local historical table;
  two small committed JSON files (`climatology.json`, `yearly_trend.json`)
  for everything else, so the app doesn't need the full table for most
  views.

This stack was deliberately modeled on the team's own earlier project,
[Caspian Watch](https://github.com/muhammed03/caspian-dash) -- same
scrubber-drives-map interaction, same REAL/SEMI/MOCK data-honesty
convention, same "state your limitations plainly" discipline. See
`spec.md` Section 6 for the full reasoning.

## The data

All real, NOAA `global-hourly` (ISD), fetched directly, no synthetic or
estimated readings:

- 2.46 million real hourly temperature + dew point readings
- 11 stadiums, each matched to its nearest real weather station
  (verified within ~18km, most within 15km -- see `data/stadiums.json`)
- 2006-2025 (20 years)

WBGT is computed from these via the standard Australian Bureau of
Meteorology approximation (temp + dew point -> vapor pressure -> WBGT)
-- an approximation, stated as such everywhere it's shown, not a
lab-grade sensor reading. See `lib/wbgt.ts` for the formula and its
reference-value check.

## Reproducing the data pipeline

```bash
python3 scripts/fetch_noaa_data.py       # pulls 2.46M real NOAA rows -> data/heat.db
python3 scripts/aggregate_summaries.py   # -> data/climatology.json, data/yearly_trend.json
python3 scripts/compute_discovery.py     # -> data/discovery_trend.json, prints the trend findings
python3 scripts/fetch_parking_lots.py    # -> data/parking.json, real OSM parking-lot geometry
python3 scripts/fetch_match_schedule.py  # -> data/matches.json, real 78-match US-venue schedule
python3 scripts/fetch_match_weather.py   # -> data/match_weather.json, real weather during real matches
```

## Honest limitations

Stated plainly, not hidden -- same principle as this team's earlier
Caspian Watch documentation:

1. **WBGT is an approximation.** The full outdoor WBGT formula needs a
   globe-thermometer reading and wind speed; we only have temperature
   and dew point from NOAA, so we use a standard published
   approximation. It's checked against one real reference value
   (`lib/wbgt.ts`), not independently validated against a physical
   sensor.
2. **Scenario simulator effect sizes are modeled, not measured.** How
   much a misting station or shade coverage actually reduces WBGT at
   these specific venues hasn't been measured -- the sliders use
   plausible, documented assumptions (see `components/ScenarioSimulator.tsx`).
3. **Field orientation and exact roof geometry are incomplete.**
   `data/stadiums.json` marks these `TODO-SEMI` for most venues --
   verifying each stadium's real compass orientation from satellite
   imagery wasn't finished in the time available. The 3D model's sun
   position is real astronomy regardless; it just can't yet label a
   specific named stand section for every venue.
4. **The real 78-match schedule and real match-day weather ARE now
   wired in** (`scripts/fetch_match_schedule.py`, `fetch_match_weather.py`
   -- see `DISCOVERY.md` Section 4) -- an earlier draft of this doc said
   this wasn't feasible because FIFA's own match centre is a JS app;
   the openfootball/worldcup open dataset turned out to have the same
   real schedule in a plain, parseable text format instead. The one
   remaining gap is the *per-section* sun-exposure ranking
   (`spec.md` Discovery 2.2), which still needs real field orientation
   for the 2 stadiums (Mercedes-Benz, SoFi) still marked SEMI below.
5. **Docker + the 20-year explorer**: see Quick Start above -- a real,
   reproduced virtiofs issue on macOS, not a hypothetical one.
6. **Parking walk-in heat exposure is SEMI, not REAL.** The lot
   geometry (distance, area, bearing) is real OpenStreetMap data, and
   the baseline WBGT is real climatology -- but the +3°C sun surcharge
   for crossing open pavement is a modeled figure from published
   heat-island field studies at OTHER locations, not measured at these
   specific stadiums, and it isn't a full globe-temperature WBGT
   calculation (no pavement thermometer, no wind). Walk time assumes a
   flat ~3mph pace, not accounting for crowd density on event day. A
   few stadiums' Overpass queries were rate-limited on the first pass
   and needed a retry (`scripts/retry_parking_lots.py`) -- same
   real, reproduced Overpass rate-limiting already documented for
   field orientation above.
7. **Match-day weather comes from a different real source than the
   20-year climatology, for a documented reason.** NOAA's own bulk
   `global-hourly` archive (used for 2006-2025) has not yet published
   a 2026 file as of this writing -- verified live, not assumed. Real
   2026 weather instead comes from the Iowa State Mesonet ASOS
   archive, which is the SAME underlying real automated-surface-station
   network (cross-checked station-by-station against NOAA's own
   `isd-history.csv` to get the matching ICAO code), just published
   with less lag. Not a different or lower-quality measurement, but
   worth stating plainly rather than silently switching sources.
8. **Parking match-day occupancy is MOCK on top of REAL inputs.** Real
   kickoff time and a lot's real capacity (see below) feed a modeled
   fill curve (`lib/parkingData.ts`) shaped like a real, documented
   stadium-egress pattern (ingress accelerates into kickoff, egress
   drains slower -- a known bottleneck effect) but with illustrative,
   not measured, percentages. The 3D view's rendered car count is
   additionally capped for performance/legibility (9 per lot); the
   real estimated count is always shown as text alongside it.
9. **Lot capacity is a real geometric calculation, not a survey.**
   `scripts/fetch_parking_lots.py` computes each lot's real oriented
   length/width from its real OSM node coordinates (rotate into the
   frame of its longest edge, take the extents); `lib/parkingLayout.ts`
   then fits real 9ft x 18ft stalls and a real 24ft two-way aisle
   (ITE/ULI standard 90-degree parking dimensions) into that rectangle
   as double-loaded rows. This is a real yield calculation from real
   dimensions -- meaningfully more precise than a flat area/constant
   guess -- but still assumes a lot is laid out as simple parallel
   rows (ignores driveways, curb cuts, ADA stalls, landscaping
   islands) and approximates irregular lot shapes as rectangular. All
   40 (or fewer) lots at all 11 stadiums now use this real-layout
   method (verify: `capacity_method: "real-layout"` in `/api/parking`'s
   response) -- the flat-area fallback exists only for future lots
   fetched before dimensions are computed.
10. **The 3D view renders exactly the real occupied-space count -- up
    to a measured performance ceiling.** Every rendered car is one real
    stall at its real position (`lib/parkingLayout.ts`'s
    `stallPositions()`), not a decorative scatter -- "1000 real spaces
    occupied" draws 1000 cars, "900 an hour later" draws exactly 900
    (verified live: Hard Rock Stadium showed 36,631/36,631 at kickoff
    and 1,833/36,631 -- the real 5% floor -- 12 hours off it). Past
    ~300 real stalls in a single lot, the render samples an evenly
    spaced subset at the identical fill ratio instead of every stall,
    because rendering tens of thousands of individual React/three.js
    instances on every hour-scrub caused real, measured multi-second
    freezes (verified live at NRG Stadium's ~90,000-space total,
    ranging from under a second up to 10+ seconds depending on how
    many were changing). The exact real numbers are always shown as
    text/tooltips regardless of this rendering cap -- only the literal
    car count drawn in the 3D scene is capped, never what's reported.

## Project docs

- `research.md` -- initial hackathon research (data source feasibility
  per track)
- `spec.md` -- the full build spec, including the tech-stack reasoning
  and the "Discovery" framing
- `DISCOVERY.md` -- the actual computed findings
