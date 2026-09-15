# Rice University Urban Sustainability Hackathon -- Research

Deadline: **Sep 18, 2026 @ 12:45am EDT** (online submission -- the page's
"Jun 23-24 Houston kickoff workshop" text appears to be leftover from an
earlier phase of this hackathon and isn't relevant to a last-minute
online submission).

Deliverables required: (1) a solution pitch, (2) an interactive data
visualization (maps + charts + scenario comparisons) for one of 4 tracks.
Judging: Impact, Data Analytics, Innovation, Feasibility, Legacy,
Visualization, Presentation.

## The 11 US host cities (2026 FIFA World Cup, June 11 - Jul 19, 2026)

| Metro area | Stadium |
|---|---|
| Atlanta, GA | Mercedes-Benz Stadium |
| Boston (Foxborough), MA | Gillette Stadium |
| Dallas (Arlington), TX | AT&T Stadium |
| Houston, TX | NRG Stadium |
| Kansas City, MO | Arrowhead Stadium |
| Los Angeles (Inglewood), CA | SoFi Stadium |
| Miami (Miami Gardens), FL | Hard Rock Stadium |
| New York/New Jersey (East Rutherford) | MetLife Stadium |
| Philadelphia, PA | Lincoln Financial Field |
| San Francisco Bay Area (Santa Clara), CA | Levi's Stadium |
| Seattle, WA | Lumen Field |

## Track-by-track data feasibility (checked directly, not assumed)

### Track 3 -- Public Health & Built Environment (heat) -- ✅ most buildable
- **NOAA Climate Data Online (CDO) API**: free, JSON, needs just an API
  token (5 req/s, 10k/day). Query by station/city/lat-lon/date range --
  can pull historical June-July temperature/heat-index data for a
  weather station near each of the 11 stadiums directly.
- **CDC/EPA Heat & Health Tracker**: currently down for maintenance
  (checked live) -- can't be a live data source right now. A dead end
  unless it comes back before the deadline.
- **NASA MODIS Land Surface Temperature**: real satellite urban-heat-
  island data exists, but it's raster/geospatial processing (not a
  simple JSON API) -- doable but the highest-effort option of the three,
  probably not worth it in a 2-day build.
- **Verdict**: NOAA CDO alone is enough for a real, defensible dataset:
  "which host cities/stadiums face the highest heat risk during their
  actual scheduled match times" is a genuine, checkable, visualizable
  question with real numbers behind it.

### Track 1 -- Transportation & Access -- ✅ also buildable
- **Transitland API** (transit.land): aggregates GTFS (routes, stops,
  frequency) for US transit agencies behind ONE unified REST API, free
  tier with rate limits. Covers all 11 metro areas without needing to
  integrate 11 separate transit agencies' raw GTFS feeds by hand.
- Would need to pair this with match schedule + venue location/capacity
  (public, e_g. from FIFA's own site) to build a "transit capacity vs.
  expected demand" comparison per host city.
- **Verdict**: feasible, comparable effort to Track 3. The story is a
  bit more inference-heavy (predicting "visitor movement" isn't something
  a dataset hands you directly -- more modeling assumptions needed than
  Track 3's more directly-measurable heat risk).

### Track 2 -- Energy-Food-Water Nexus -- ⚠️ weakest fit for 2 days
- **EPA eGRID**: real, downloadable (.xlsx), but only covers ENERGY
  (grid subregion emissions mix) -- not food or water. Also subregional,
  not per-city, so stadiums need to be manually mapped to a grid
  subregion.
- Water and food-supply-chain data at a comparable per-city granularity
  was not found in this pass -- likely exists but scattered across
  USGS/local utility sources with no unified API, meaning real
  integration risk in a 2-day window.
- **Verdict**: the track's own name promises 3 data pillars; only 1 has
  an easy, verified path to real data right now. Would likely mean
  faking or hand-estimating 2 of the 3 pillars, which cuts against the
  "Data Analytics" judging criterion.

### Track 4 -- High Intensity Corridors & Future Growth Districts
- Not researched in this pass (least concretely scoped of the four, and
  1 and 3 already look solid) -- worth a deeper look only if both of
  the above get ruled out for some other reason.

## UNLEASH Innovation Methodology

Mentioned in the brief as the framing process organizers want teams to
use. Couldn't get their specific step-by-step framework from their
public site in this pass (homepage describes the org's mission, not the
methodology's stages) -- not a blocker for the deliverable itself
(pitch + visualization), but worth a mention in the pitch narrative
("we framed this using a user-centered problem statement...") if time
allows, since "Innovation"/"Feasibility" are named judging criteria.

## Recommendation

**Track 3 (heat) or Track 1 (transit)** are the two realistic choices
for a 2-person, 2-day build -- both have a single, free, well-documented
API covering all 11 cities. Track 2 is the highest risk of the three
because two of its three named data pillars don't have an equally easy
path to real numbers yet.

Between the two: Track 3's story is more directly measurable from the
data alone (a temperature reading is a temperature reading), where
Track 1 requires more assumptions layered on top (predicting "visitor
movement" from transit capacity + a match schedule). For a short
timeline, less inference = less risk of the whole thing feeling
hand-wavy to judges scoring "Data Analytics."

Next: pick a track, then scope the exact idea/visualization before
writing any code.
