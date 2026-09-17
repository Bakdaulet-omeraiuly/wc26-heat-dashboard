---
title: "HCHIS — Technical Appendix for Judges"
subtitle: "Host-City Stadium Heat Intelligence System"
---

**Live site:** https://wc26-heat-dashboard.vercel.app
**Source code:** https://github.com/Bakdaulet-omeraiuly/wc26-heat-dashboard
**Track:** Rice University Urban Sustainability Hackathon — Track 3, Public Health & the Built Environment

This appendix is written for judges and organizers who want to verify the claims in the public project story. It is more technical than the public write-up and does not appear on the project page.

## 1. The core rule this project followed

Every number shown anywhere in the app is tagged by how it was produced:

- **REAL** — measured directly from a real source (NOAA, Mesonet, OpenStreetMap, api.weather.gov).
- **SEMI** — real geometry or real measurement combined with exactly one modeled term (clearly named at the point of use).
- **MOCK** — a modeled assumption drawn from published research, explicitly not measured at these specific venues.

Nothing is shown with more precision than it can actually support, and no number was invented for a screen or a demo. Several claims below were checked against the live API before being written into copy — one draft statistic ("safest vs. hottest lot at one venue differ in WBGT") was caught and discarded during this process because the underlying model doesn't actually produce a non-zero difference; it was replaced with a verified real finding instead (see §5).

## 2. Real data sources (all cited in-app)

| Source | Used for |
|---|---|
| NOAA Global Hourly (2006–2025) | 20-year per-stadium climatology, ~2.46M raw hourly readings |
| Iowa Environmental Mesonet ASOS archive | Real per-match weather at real 2026 kickoff times |
| OpenStreetMap / Overpass API | Real parking-lot polygons, street centerlines, building footprints (411 lots, streets and buildings across all 11 venues) |
| api.weather.gov (NWS) | Live short-range forecasts for upcoming real events |
| nflverse (`games.csv`) | Real NFL 2026 schedule at the same 11 venues (since the World Cup itself is in the past for this dataset) |
| EPA Heat Island Reduction research | Cited effect sizes for tree shade, green/cool roofs, cool pavement, smart growth |
| Real field-study citations (solar-carport shading, parking-lot radiation) | Solar carport strategy in Urban Lab |
| City of Kerrville, TX municipal parking standards | Real 45°/60°/90° stall/aisle dimensions for the angled-parking capacity comparison |

## 3. Architecture

- **Next.js 16 (App Router) + TypeScript + React 19**, deployed on Vercel.
- **Data layer**: static JSON committed to the repo, produced once by Python scripts in `scripts/` (Overpass queries, NOAA/Mesonet fetches, nflverse schedule parsing). No scraping happens at request time.
- **20-year hourly table** (172MB / 2.46M rows) lives in a hosted Turso (libSQL) database — too large for a normal Git push, so this is the one endpoint that queries a live database instead of a committed JSON file.
- **3D**: Three.js via `@react-three/fiber` + `drei`, GPU-instanced parking-stall rendering, `SunCalc` for real sun-position physics tied to each venue's real lat/lon and the selected match's real kickoff time, `@react-three/postprocessing` for ambient occlusion and bloom.
- **AI agent**: Claude (`claude-sonnet-4-5`) via the Anthropic API, function-calling only — the model can call ~12 tools backed directly by the same real-data accessor functions the UI uses; it never computes or invents a number itself.
- **Charts**: Recharts (already used for the 20-year hourly explorer; reused for the homepage's interactive trend chart).

## 4. Real engineering problems found and fixed (with verification)

These are documented directly in the commit history and in code comments at the point of the fix, not just asserted here:

1. **WebGL buffer overflow.** Instancing car geometry with an instance limit derived from initially-empty data locked the GPU buffer at capacity 1; later writes corrupted the render. Fixed with a fixed, sufficiently large static limit.
2. **A measured performance cliff.** Rendering all ~90,000 real stalls at the largest single lot (NRG Stadium) caused multi-second freezes, timed directly (0.17s–13.6s across repeated trials) rather than guessed. Fixed with a render cap tuned from real timing data, while the exact real count is always shown in text regardless of what's drawn.
3. **A coordinate-normalization bug.** Cars from long real lots were rendered outside their own lot's drawn boundary (into the stadium bowl) because their placement used the lot's raw real length instead of the same clamped scene size the lot's outline used. Fixed by normalizing to a fraction of real length before scaling.
4. **A rotation-convention mismatch.** The app's own lot-placement helper function and Three.js's native mesh `rotation.y` property use mathematically opposite conventions for the same angle. This caused a lot's boundary outline to visibly disagree with its own paved pad. Found by deriving both rotation matrices by hand and comparing them, then fixed and documented at the source of the helper function so it can't regress silently.
5. **A statistic caught before publication.** While drafting the homepage, a planned "biggest real WBGT swing between the safest and hottest lot at one venue" statistic was checked against the live `/api/parking` endpoint first — every lot at a given stadium/hour shares an identical `adjusted_wbgt_c` in the current walk-exposure model (it applies one flat sun-exposure surcharge per stadium, not a per-lot one), so the intended statistic would always read zero. It was replaced with a verified, non-trivial real finding instead: the single longest real walk across all 11 venues' real lots (Arrowhead Stadium, Lot 22 — 1,569m / 19.6 minutes in real 31.4°C WBGT).

## 5. Headline findings, and how to verify them

| Claim | How it was verified |
|---|---|
| 78 real matches analyzed | `data/match_weather.json` — record count |
| 54 of 78 hotter than that stadium's own 20-year normal | Computed live: for each match's real month/hour, fetched that stadium's climatological mean from `/api/stadiums` and compared to `real_peak_wbgt_c` |
| 35.3°C hottest real peak WBGT | `max(real_peak_wbgt_c)` across all 78 real matches |
| 10 of 11 stadiums warming | `data/discovery_trend.json` — real linear regression over 2006–2025 July WBGT per stadium; only SoFi Stadium's trend is negative |
| 411 real parking lots | Sum of lots returned by `/api/home-story` across all 11 stadiums |
| Longest real walk: Arrowhead Stadium, Lot 22, 1,569m / 19.6 min, 31.4°C | `/api/home-story`'s `parking.longest_real_walk` field, computed from real OSM lot distances |

All of the above can be reproduced by calling the live app's own API routes directly (e.g. `curl https://wc26-heat-dashboard.vercel.app/api/home-story`).

## 6. Known, explicitly documented limitations

- The walk-in-heat model applies one modeled sun-exposure surcharge per stadium/time rather than a per-lot radiative model — a deliberate simplification, tagged SEMI, not presented as more precise than it is.
- The pedestrian route's "stadium entrance" point is a real approximation (the edge of the stadium's real paved campus at the lot's own real bearing), since no public per-gate entrance survey exists for these venues.
- Building heights are REAL when OpenStreetMap carries a real `height` tag, SEMI when derived from a real `building:levels` count, and a flat MOCK default only when neither exists — each building carries its own status.
- The 3D scene is an intentionally schematic model, not a CAD-accurate replica of any one venue's real architecture — see the code's own documentation of this decision.

## 7. Additional artifacts

- 12-slide pitch deck: https://claude.ai/code/artifact/1b10796d-d3cc-471b-91ea-61fe540f1bf1
- Kazakh-language project summary with screenshots: https://claude.ai/code/artifact/f7b4f835-c215-4d32-a93f-435461e7f70a
