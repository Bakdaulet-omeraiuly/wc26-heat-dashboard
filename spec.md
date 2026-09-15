# World Cup Heat Risk Dashboard -- Build Spec

Rice University Urban Sustainability Hackathon, Track 3 (Public Health &
the Built Environment). Deadline: Sep 18, 2026 @ 12:45am EDT.

## 1. The problem, precisely

FIFA World Cup 2026 runs June 11 - July 19 across 11 US host cities --
peak US summer heat season, in several of the hottest metro areas in the
country (Dallas, Houston, Miami, Kansas City among them). Outdoor fan
zones, stadium approach routes, tailgate lots, and concession lines will
expose potentially millions of attendees -- many international visitors
unfamiliar with local climate -- to real heat-illness risk for hours at
a time. FIFA already requires 3-minute hydration breaks each half
(confirmed, published rule) -- an acknowledgment the risk is real, not
hypothetical.

**FIFA has already rescheduled an entire World Cup once specifically
because of heat** -- Qatar 2022 was moved from its traditional May-July
window to November-December, and Qatar's stadiums were built with
cooling systems reducing in-stadium temperature by up to 20°C
(confirmed, Wikipedia's 2022 World Cup article). **2026 doesn't have
that option** -- June-July is fixed by the broadcast/hosting agreement
-- which is exactly why city- and stadium-level mitigation (this
project) matters more here than it did in Qatar, not less.

A smaller, verified detail worth a mention in the pitch: several 2026
venues normally run artificial turf for their regular tenants and are
installing natural grass specifically to meet FIFA's field regulations
-- SoFi Stadium (LA) confirmed. Not a heat-driven decision by FIFA, but
a real, genuinely relevant side effect: synthetic turf surfaces run
measurably hotter than grass, so this incidentally helps at exactly the
venues doing it.

Cities need a way to answer, with real numbers: **which host cities,
and which specific match dates/times, carry the highest heat risk, so
cooling infrastructure investment (shade structures, misting stations,
hydration points, medical staffing) gets prioritized where it actually
matters -- and to see, quantitatively, how much a given intervention
would move the needle.**

## 2. The Discovery -- a real computed finding, not just a dashboard

Everything below is genuinely computable from data this spec already
lines up (20-year hourly climatology + the real published 78-match
schedule + real sun-position math) -- the point is that nobody has
published this specific cross-reference before, because it only exists
once you combine all three. This is the pitch's opening hook, in the
same spirit as caspian-dash's "sea level fell below its historical
minimum in 2025" headline -- a specific, surprising, checkable number,
not a generic claim.

**2.1 Match-Specific Heat Exposure Index.** For each of the 78 real
scheduled US matches (exact date + kickoff time + venue, public since
Dec 6, 2025), compute WBGT from that exact hour-of-day and day-of-year's
20-year historical distribution at that specific station -- not a
city's general June-July average, but THAT match's own historical
odds. The headline number for the pitch: **"X of the 78 scheduled US
matches have historically exceeded [FIFA's/the sports-safety] cooling-
break WBGT threshold more than half the time at that exact kickoff
hour."** We don't know X yet -- it only exists once the real pipeline
runs -- but the shape of the finding is real and the method is sound.
Rank all 78 by this index; the top of that ranked list (not just "top
5 hottest cities" but "these specific N matches") is a genuinely new
artifact.

**2.2 Per-Section Cumulative Sun Exposure Ranking.** The 3D model
(Section 6) already computes, for one moment, which stand section is
sunlit. Running that same SunCalc calculation across EVERY match hour
scheduled at a given stadium (not just one selected moment) and summing
exposure per section produces a real ranking: which specific stand
(not just "the stadium," but e.g. "the west upper deck") accumulates
the most direct-sun hours across the tournament at that venue. This is
a genuinely finer-grained finding than any city- or stadium-level heat
study -- actionable at the level a city could actually act on ("put the
shade structure over section X specifically"), and it falls directly
out of infrastructure this spec was already building for the 3D view,
not a separate build effort.

**2.3 A real 20-year local trend line, per venue** (same statistical
move as caspian-dash's own sea-level regression -- compute two models,
show the honest uncertainty band between them, don't hide it). Is
June/July WBGT at each specific stadium's station measurably higher
now than 20 years ago? If yes, quantify it ("+X°F per decade at
[station]") -- turns "climate change is happening" from a generic claim
into a specific, local, checkable one. If the trend turns out flat or
noisy at some stations, say that honestly too -- a null result reported
plainly is still more credible than cherry-picking the stations that
show a trend.

**Where this lives in the task list**: this is analysis run ONCE
against the pre-fetched data (Checkpoint 1, after the SQLite store
exists), producing a small set of headline numbers + the per-section
ranking -- not a new UI surface by itself, though 2.1's ranked list
and 2.2's per-section ranking are natural additions to Views A and E.

## 3. What we're building

An interactive research-grade web app, five views. The homepage IS the
stadium map + 3D model (per the team's explicit direction: this is the
site's front door, not a buried tab).

### View A (homepage) -- 11-Stadium Map + 3D Model
- A US map (deck.gl, own basemap from Natural Earth files -- same as
  caspian-dash, no map API key needed) of all 11 stadiums, each marker
  colored by heat
  risk using the **NWS HeatRisk 5-level scale** (Green/Yellow/Orange/
  Red/Magenta) -- a real, existing government methodology, not an
  invented one.
- **A time scrubber slider sits directly on this view** -- the same
  interaction pattern as the team's earlier Caspian Watch project (a
  year slider that live-updates which mineral deposits show on the
  map). Here it's a date+hour scrubber: dragging it instantly recolors
  all 11 stadium markers to that exact moment's real heat-risk level,
  no submit button, no page reload -- the map visibly animates/updates
  as you drag, exactly like Caspian's did.
- Click a stadium -> the 3D parametric stand model for that venue loads
  (Three.js + SunCalc, see Section 6) for whatever moment the scrubber
  is currently set to, showing which stand sections are sunlit vs.
  shaded right now, plus that moment's real temperature/humidity/WBGT
  readout in an instrument-panel-style data strip (not a decorative
  card) -- moving the SAME scrubber updates the 3D sun position live too.

### View B -- 20-Year Historical Explorer
- Pick any stadium + any month/day/year/hour going back 20 years ->
  the actual recorded temperature/humidity/WBGT for that exact moment
  (from the pre-fetched NOAA LCD SQLite store), plotted against that
  day's full 24-hour curve for context.
- Built for a researcher's actual workflow: fast keyboard-friendly date
  entry (not just a slow calendar-click UI), a persistent URL/state per
  query (shareable/citable), and a raw-data export (CSV) button --
  real research tools let you get your numbers back out.

### View C -- Ranked Comparison
- A horizontal bar chart ranking all 11 cities by heat risk score,
  highest first. This is the "compare across host cities" deliverable
  requirement made concrete.

### View D -- Scenario Simulator (the differentiator)
Sliders/toggles per selected city:
- Shade coverage added (0-100%, reduces effective radiant heat term)
- Misting/cooling stations added (count -> a modeled score offset)
- Kickoff time shift (afternoon -> evening -- directly reduces the
  temperature/radiant terms used in the WBGT approximation)
- Roof open/closed, for the retractable-roof venues (see Section 6)
Recalculates the risk score live and shows before/after on the same
color scale -- this directly satisfies the deliverable's explicit
"scenario comparisons... understand the measurable impact of proposed
interventions" requirement, not just a static report.

### View E -- Priority List
A ranked "invest here first" table (city, current risk, projected risk
if top intervention applied, estimated attendee-hours at risk) --
speaks directly to "Legacy" and "Impact" judging criteria (this outlives
the tournament itself as a general heat-preparedness tool).

## 4. The risk score -- grounded in real methodology, not invented

Two real, established frameworks, layered:

1. **WBGT (Wet-Bulb Globe Temperature)** -- the actual metric US sports
   or medicine bodies (ACSM, used for college athletics heat safety)
   use for outdoor activity risk. Outdoor formula:
   `WBGT = 0.7*Tw + 0.2*Tg + 0.1*Td` (wet-bulb, globe, dry-bulb temps).
   We won't have globe-thermometer readings from a public API, so we
   use the standard simplified approximation from air temp + humidity
   (Australian Bureau of Meteorology form): `WBGT ≈ 0.567*Ta + 0.393*e + 3.94`
   where `Ta` = air temp (°C) and `e` = water vapor pressure (from
   dew point/relative humidity). **Verify this approximation's error
   margin against a couple of known reference values before trusting it
   in the pitch** -- cite it as an approximation, not a lab-grade
   reading.
2. Map the resulting WBGT onto the **real 5-flag sports-safety scale**
   (White ≤81.9°F, Green 82-84.9, Yellow 85-87.9, Red 88-89.9, Black
   ≥90°F) AND separately onto the **NWS HeatRisk 5-color scale** for the
   map view, since that's the scale the public/officials already
   recognize.

This means every number on the dashboard traces back to a named,
external, checkable methodology -- defensible under judging, not an
ad-hoc "risk score out of 100" we made up.

## 5. Data sources -- confirmed vs. needs verification at build time

| Source | Status | Use |
|---|---|---|
| NOAA CDO API | **Confirmed**: free, JSON, token-based, queryable by station/city/date range | Historical June-July temperature per host city |
| NOAA `global-hourly` (ISD) via NCEI's Access Data Service | **CONFIRMED WORKING, live-tested**: direct bulk CSV per station-year at `https://www.ncei.noaa.gov/data/global-hourly/access/{year}/{station-id}.csv` -- no token, no rate limit hit. Verified for the DFW-area station (72259003927, ~1km from AT&T Stadium): real TMP + DEW columns present, hourly resolution, confirmed data back to at least 2005 (2026 not yet complete, as expected). This supersedes the earlier "LCD, needs verification" entry -- it's actually working, not hypothetical. | WBGT's humidity term (DEW) + temperature (TMP), and the raw per-year hourly rows View B/Discovery 2.3 need |
| 2026 match schedule (exact dates/kickoff times per US venue) | **Confirmed public** (released Dec 6, 2025) but not yet pulled into a usable list in this pass -- FIFA's match centre is a JS app, not fetchable as static HTML | Tying risk scores to the ACTUAL scheduled kickoff time per match, not just a city's general climatology. **Fallback if this proves too slow to scrape**: use historical June-July hourly climatology only (still a real, defensible dataset on its own) |
| NWS HeatRisk methodology/scale | **Confirmed** (5-level, public, documented) | The color scale/legend for View A |
| WBGT sports-safety flag thresholds | **Confirmed** (public, ACSM/university sports medicine standard) | The score's real-world "is this dangerous" framing |
| CDC/EPA Heat & Health Tracker | **Confirmed DOWN** (maintenance, checked live) | Not usable -- don't depend on it |
| FIFA's own WBGT trigger value for cooling breaks | **Not verified** -- commonly cited in sports-science writing as ~32°C WBGT, introduced at the 2014 Brazil World Cup, but several direct attempts to confirm this against an authoritative FIFA source this pass all hit dead ends (search engines block automated fetches; Wikipedia's own "Cooling breaks" section content wasn't retrievable). **Would be a genuinely strong addition** -- if confirmed, we could show each host city/time directly against FIFA's OWN real threshold, not just an external sports-medicine scale. Worth 10-15 minutes with a real browser on Day 1, not worth more automated fetch attempts. | Would strengthen View A/D's framing if found |
| EPA EJScreen (environmental-justice/heat-vulnerability by census tract) | **Not verified** -- every attempt to reach it 404'd this pass; the tool has reportedly had availability/content changes since 2025. Don't plan around it being there. | Would have added an equity angle (are under-resourced neighborhoods near fan zones more heat-exposed) -- skip unless it turns out to be reachable |

## 6. Tech stack -- adopted directly from the team's own proven `caspian-dash` architecture

Found the real source and its documentation: **github.com/muhammed03/caspian-dash**
(the live site at caspian-dash-tr1c.vercel.app is its deployment).
This is a genuinely excellent, already-battle-tested architecture for
almost exactly this kind of project (a scrubber-driven map + 3D object +
charts + honestly-labeled data). Copying its proven decisions instead
of re-deriving a new stack from scratch is the right call, especially
given Streamlit can't cleanly do custom WebGL 3D -- the same category
of risk this team already hit once (`streamlit-drawable-canvas` broke
on a routine Streamlit version bump on the DadHero project).

**Stack (same as caspian-dash):**
- **Next.js 15 + React 19 + TypeScript** -- app framework, routes AND
  server API in one project (no separate Python backend needed).
- **Tailwind CSS 4** -- styling/design tokens.
- **deck.gl** -- the map and all data layers. Caspian Watch's own
  basemap is built from Natural Earth geometry files, not a tile
  server -- no Mapbox/Google Maps API key needed, and it works fully
  offline. Do the same here: US states/coastline from Natural Earth,
  11 stadium points as a deck.gl layer on top.
- **Three.js + React Three Fiber** -- the 3D object. Caspian Watch uses
  this for a shrinking sea volume on the homepage; here it's the 11
  parametric stadium bowl models (see below), same library, same
  pattern (a 3D hero object driven by real computed data, not a static
  decoration).
- **SunCalc** (new addition, not in caspian-dash but same category of
  tiny dependency-free library) -- real sun azimuth/altitude for any
  date+time, confirmed ~0.08° accuracy validated against JPL Horizons/
  USNO. Drives which part of each 3D stadium model is lit vs. shaded.
- **Recharts** -- charts (ranked comparison, historical curves).
- **Zustand** -- shared state: selected stadium, the scrubber's current
  date/time, active layers -- exactly the role it plays in caspian-dash
  for map year/layers/camera.
- **TanStack Query** -- data fetching/caching from the app's own API
  routes.
- **Docker Compose**, `docker compose up` -- one-command run for
  judges, no setup friction. Copy this directly; it's a real, judge-
  facing convenience caspian-dash already validated works.

**Data pipeline (same philosophy as caspian-dash's `scripts/pipeline/`)**:
a pre-fetch script pulls NOAA data ONCE, ahead of time, saved as
committed files in `data/` -- the running app never depends on a live
external API during judging. 20 years x hourly x 11 stations is real
volume: query it from **SQLite** (`better-sqlite3` from a Next.js API
route) rather than shipping raw JSON to the browser -- this is what
actually serves the "any month/day/year/hour" explorer as a real
filtered query.

**Every number gets a REAL / SEMI / MOCK source tag, shown in the UI**
-- copied directly from caspian-dash's own data-honesty convention
(their `sources.json` + visible badge under every chart). Ours:
- REAL: NOAA temperature/humidity readings, stadium lat/lon.
- SEMI: field compass orientation and roof type (hand-researched from
  satellite view/web search, not machine-read from a dataset -- exactly
  caspian-dash's own definition of SEMI).
- MOCK/modeled: the scenario simulator's intervention effect sizes
  (shade %, misting station offset) -- state this as plainly as
  caspian-dash states its own model-vs-measurement gaps in its
  "honest limitations" section (Section 10 of their doc) -- **we
  should write the same kind of section, not skip it.**

**Where's the AI, if a judge asks** -- same honest answer pattern as
caspian-dash: the WBGT/HeatRisk scores are deterministic formulas, not
an AI guess -- reproducible, checkable by hand. If we add any narrative
text generation at all (a plain-language summary of a stadium's risk),
generate it OFFLINE via a pipeline script against a strict schema
(matching their Zod-schema + offline `gen-insights` pattern) rather
than a live API call during the demo -- no key needed on stage, same
answer every run.

**3D stadium models**: NOT 11 photorealistic replicas (unrealistic in
the time left, and licensing found 3D assets is its own risk). Instead,
one **parametric bowl-shaped stand geometry** (Three.js primitives via
React Three Fiber), reused across all 11, individually parameterized by
each stadium's REAL latitude/longitude (public, e.g. Wikipedia
infoboxes) and REAL field orientation (compass bearing of the pitch's
long axis -- usually NOT written down explicitly; read it off satellite
view per stadium, a real ~5-minute task each, 11 total -- tag this
SEMI, per the convention above). SunCalc then drives which modeled
stand section is lit vs. shaded for whatever date/hour the researcher
picks -- a real physics-based answer, not a decorative 3D model. Roof
type matters too: at least Dallas has a confirmed retractable roof;
verify Atlanta and Houston before asserting the same -- worth a "roof
open/closed" toggle in the scenario simulator for those specific
venues, since closing the roof is a real mitigation a city could
actually do.

## 7. Rough task split (2 people, ~1.5 days left)

The scope grew significantly with the 3D + 20-year explorer additions.
Sequenced so that if time runs out, what's already done is still a
complete, demoable product at each checkpoint -- never leave it
half-wired.

**Checkpoint 1 -- data (do this first, everything else depends on it)**
- [ ] NOAA CDO/LCD API token; confirm exact dataset+field names for
      hourly temp/dew point/humidity per station (the one thing not yet
      verified live in this pass)
- [ ] Pick one representative station per host city (usually the main
      airport) and bulk-pull ~20 years hourly data for all 11
- [ ] Build the local SQLite store + a thin query layer (station, date
      range -> rows)
- [ ] Implement WBGT approximation + NWS HeatRisk/sports-flag mappings;
      sanity-check against a known reference WBGT value before trusting it
- [ ] Compile `stadiums.json`: for each of the 11 -- lat/lon (from
      Wikipedia infoboxes), field compass orientation (read off satellite
      view, ~5 min each), roof type (open/retractable/fixed -- verify
      each, don't assume from memory)

**Checkpoint 2 -- Next.js API routes serving that data (no separate backend)**
- [ ] Route handlers: list stadiums, current/selected-time reading per
      stadium, historical query (stadium + date range) against the
      SQLite store, scenario recompute (given a stadium+time+
      intervention params, return the adjusted WBGT/risk level)
- [ ] `sources.json`-style registry tagging every data field REAL/SEMI/
      MOCK, same convention as caspian-dash

**Checkpoint 3 -- frontend, in priority order (stop here if time runs
out and still have something whole to demo)**
- [ ] Homepage: deck.gl map of the 11 stadiums, color-coded by current
      risk level -- alone, this is already a complete Track 3 entry
- [ ] Click-through to the 3D view: Three.js parametric bowl + SunCalc
      sun position for the selected stadium+time, sunlit/shaded stand
      sections rendered, live data-strip readout
- [ ] Ranked comparison chart + priority list (View C/E) -- fast to
      build once the API exists
- [ ] 20-year historical explorer (View B) -- date/time picker against
      the SQLite-backed endpoint, with CSV export
- [ ] Scenario simulator sliders (View D) -- the most "nice to have but
      cuttable last" piece if time is genuinely short, since Views A/B/C
      alone already satisfy the stated deliverable

**Checkpoint 4 -- pitch + video**
- [ ] Write a "Section 10: Honest Limitations" and a "Section 11:
      Answers ready for judges' questions" in the README, same as
      caspian-dash's own docs -- copy that discipline directly, it's a
      real strength (judges saw an unusually candid, checkable project
      and it clearly worked for them once already)
- [ ] `docker compose up` -- confirm it actually works clean, same
      judge-facing convenience caspian-dash offers
- [ ] Pitch narrative: problem -> real methodology (WBGT/HeatRisk, name
      them) -> live demo -> Legacy/Impact framing against the named
      judging criteria
- [ ] Record the demo video with the teammate

## 8. Open risks (say plainly, don't hide)

- The humidity-inclusive NOAA dataset/fields haven't actually been
  pulled yet -- verify this FIRST, since the whole WBGT approach and
  the 20-year explorer both depend on it existing and being accessible
  in the free tier, at real hourly granularity, that far back.
- Scope is now large for the time left. The checkpoint ordering above
  is deliberate: Views A+B+C alone are already a complete, credible
  Track 3 submission. The 3D model and scenario simulator are the
  differentiators, not the floor -- don't let them block having
  SOMETHING finished and demoable.
- The scenario simulator's "how much does a misting station actually
  reduce WBGT" mapping is a modeled assumption, not a directly measured
  fact -- state that honestly in the pitch rather than presenting it as
  a measured outcome.
- Field orientation and roof type for all 11 stadiums are being
  hand-researched (satellite view + web search), not pulled from a
  dataset -- budget real time for this, and double-check each rather
  than relying on general/remembered knowledge about specific stadiums.
- Real per-match kickoff times may not be scrapable in time (FIFA's
  match centre is a JS app, not plain-fetchable) -- the climatology-only
  view is still a complete, defensible product on its own if this
  doesn't pan out.
