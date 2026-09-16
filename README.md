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

## The 5 views

| View | What it shows |
|---|---|
| **A -- Map + 3D** (homepage) | All 11 stadiums on a real US map, colored by heat risk; a month/hour scrubber recolors everything live; click a stadium for a 3D model showing real sun/shade (SunCalc-computed) |
| **B -- 20-Year Explorer** | Any stadium + exact date/hour, 2006-2025 -- the real recorded temp/dewpoint/WBGT curve for that day, CSV export |
| **C -- Ranked Comparison** | All 11 cities ranked by WBGT for the selected month/hour |
| **D -- Scenario Simulator** | Shade/misting/roof-closed sliders, live-recomputed WBGT (modeled effect sizes, stated plainly as such) |
| **E -- Priority List** | Ranked "invest here first," current vs. projected-after-mitigation |

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
4. **The real 78-match schedule isn't wired in yet.** The exact
   kickoff dates/times per US venue were published (Dec 6, 2025) but
   FIFA's match centre is a JS app, not simply fetchable in the time
   available -- so the match-specific heat index (`DISCOVERY.md`
   Section 4) isn't computed. The climatology-based findings that ARE
   computed stand on their own regardless.
5. **Docker + the 20-year explorer**: see Quick Start above -- a real,
   reproduced virtiofs issue on macOS, not a hypothetical one.

## Project docs

- `research.md` -- initial hackathon research (data source feasibility
  per track)
- `spec.md` -- the full build spec, including the tech-stack reasoning
  and the "Discovery" framing
- `DISCOVERY.md` -- the actual computed findings
