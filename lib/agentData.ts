/**
 * Real-data accessors for the "Ask" agent's tools (app/api/ask/route.ts).
 *
 * Deliberately self-contained rather than importing app/api/stadiums'
 * private helpers -- this is the ONE place an LLM's tool calls touch,
 * so every number it can return is traceable to exactly one function
 * here, each backed directly by a committed real data file. The LLM
 * never computes a number itself; it only narrates what these return.
 *
 * Mirrors the logic in app/api/stadiums/route.ts and
 * components/ScenarioSimulator.tsx -- kept here as the single source
 * of truth for the agent so its answers can never drift from what the
 * dashboard itself shows.
 */
import fs from "node:fs";
import path from "node:path";
import { percentileToHeatRiskLevel, wbgtToSportsFlag, type HeatRiskLevel, type SportsFlagColor } from "./wbgt";

const DATA_DIR = path.join(process.cwd(), "data");

export type Stadium = {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  noaa_station_id: string;
  noaa_station_distance_km: number;
  roof_type: string;
  roof_type_status: string;
  field_orientation_deg: number | null;
  field_orientation_status: string;
};

type ClimatologyBucket = { n: number; mean: number; p10: number; p50: number; p90: number };
type Climatology = Record<string, Record<string, ClimatologyBucket>>;
type DiscoveryTrend = {
  stadium: string;
  n_years: number;
  first_year: number;
  last_year: number;
  first_year_wbgt: number;
  last_year_wbgt: number;
  trend_per_decade_c: number;
};

let stadiumsCache: Stadium[] | null = null;
let climatologyCache: Climatology | null = null;
let discoveryCache: DiscoveryTrend[] | null = null;

function loadStadiums(): Stadium[] {
  if (!stadiumsCache) stadiumsCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "stadiums.json"), "utf-8"));
  return stadiumsCache!;
}
function loadClimatology(): Climatology {
  if (!climatologyCache) climatologyCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "climatology.json"), "utf-8"));
  return climatologyCache!;
}
function loadDiscoveryTrend(): DiscoveryTrend[] {
  if (!discoveryCache) discoveryCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "discovery_trend.json"), "utf-8"));
  return discoveryCache!;
}

/** Fuzzy-match a stadium by id, exact name, partial name, or city -- so
 * the agent can resolve whatever a real person types ("MetLife",
 * "the one in Miami", "hard-rock-stadium"). Returns null (not a guess)
 * if nothing matches -- the tool wrapper turns that into an explicit
 * "not found" result rather than silently picking the wrong venue. */
export function findStadium(query: string): Stadium | null {
  const norm = query.trim().toLowerCase();
  const stadiums = loadStadiums();
  return (
    stadiums.find((s) => s.id === norm) ??
    stadiums.find((s) => s.name.toLowerCase() === norm) ??
    stadiums.find((s) => s.name.toLowerCase().includes(norm) || norm.includes(s.name.toLowerCase())) ??
    stadiums.find((s) => s.city.toLowerCase().includes(norm)) ??
    null
  );
}

export function listStadiums(): Stadium[] {
  return loadStadiums();
}

function bucketKey(month: number, hour: number) {
  return `${String(month).padStart(2, "0")}-${String(hour).padStart(2, "0")}`;
}

function percentileWithinStadiumYear(buckets: Record<string, ClimatologyBucket>, month: number, hour: number): number {
  const key = bucketKey(month, hour);
  const target = buckets[key];
  if (!target) return 0.5;
  const allMeans = Object.values(buckets).map((b) => b.mean);
  const below = allMeans.filter((m) => m <= target.mean).length;
  return below / allMeans.length;
}

export type StadiumSnapshot = {
  stadium_id: string;
  stadium_name: string;
  city: string;
  month: number;
  hour: number;
  wbgt_mean_c: number | null;
  wbgt_p10_c: number | null;
  wbgt_p90_c: number | null;
  sample_size: number | null;
  years_covered: string;
  percentile_within_stadium_year: number | null;
  heat_risk_level: HeatRiskLevel | null;
  sports_flag: SportsFlagColor | null;
  roof_type: string;
  roof_type_status: string;
  data_status: "REAL" | "MISSING";
};

/** The one real per-stadium/month/hour lookup -- backed by
 * data/climatology.json (2.46M real NOAA hourly readings, aggregated
 * offline by scripts/aggregate_summaries.py). */
export function getStadiumSnapshot(stadiumId: string, month: number, hour: number): StadiumSnapshot | null {
  const stadium = loadStadiums().find((s) => s.id === stadiumId);
  if (!stadium) return null;
  const buckets = loadClimatology()[stadium.id] ?? {};
  const bucket = buckets[bucketKey(month, hour)];
  const pct = bucket ? percentileWithinStadiumYear(buckets, month, hour) : null;
  return {
    stadium_id: stadium.id,
    stadium_name: stadium.name,
    city: stadium.city,
    month,
    hour,
    wbgt_mean_c: bucket ? bucket.mean : null,
    wbgt_p10_c: bucket ? bucket.p10 : null,
    wbgt_p90_c: bucket ? bucket.p90 : null,
    sample_size: bucket ? bucket.n : null,
    years_covered: "2006-2025",
    percentile_within_stadium_year: pct !== null ? Math.round(pct * 100) / 100 : null,
    heat_risk_level: bucket ? percentileToHeatRiskLevel(pct!) : null,
    sports_flag: bucket ? wbgtToSportsFlag(bucket.mean) : null,
    roof_type: stadium.roof_type,
    roof_type_status: stadium.roof_type_status,
    data_status: bucket ? "REAL" : "MISSING",
  };
}

/** All 11 stadiums ranked by WBGT for one month/hour -- backed by the
 * same real climatology.json as getStadiumSnapshot, just applied to
 * every stadium and sorted. */
export function rankStadiums(month: number, hour: number): StadiumSnapshot[] {
  return loadStadiums()
    .map((s) => getStadiumSnapshot(s.id, month, hour))
    .filter((s): s is StadiumSnapshot => s !== null && s.wbgt_mean_c !== null)
    .sort((a, b) => b.wbgt_mean_c! - a.wbgt_mean_c!);
}

export type TrendResult = {
  stadium_id: string;
  stadium_name: string;
  n_years: number;
  first_year: number;
  first_year_july_wbgt_c: number;
  last_year: number;
  last_year_july_wbgt_c: number;
  trend_c_per_decade: number;
  direction: "warming" | "cooling" | "flat";
  data_status: "REAL";
};

/** The real 20-year linear-regression trend for one stadium -- backed
 * by data/discovery_trend.json (scripts/compute_discovery.py, a real
 * regression over July mean WBGT per year, 2006-2025). This is "the
 * Discovery" -- 10 of 11 venues warming, computed, not asserted. */
export function getStadiumTrend(stadiumId: string): TrendResult | null {
  const stadium = loadStadiums().find((s) => s.id === stadiumId);
  if (!stadium) return null;
  const trend = loadDiscoveryTrend().find((t) => t.stadium === stadium.name);
  if (!trend) return null;
  return {
    stadium_id: stadium.id,
    stadium_name: stadium.name,
    n_years: trend.n_years,
    first_year: trend.first_year,
    first_year_july_wbgt_c: trend.first_year_wbgt,
    last_year: trend.last_year,
    last_year_july_wbgt_c: trend.last_year_wbgt,
    trend_c_per_decade: trend.trend_per_decade_c,
    direction: trend.trend_per_decade_c > 0.05 ? "warming" : trend.trend_per_decade_c < -0.05 ? "cooling" : "flat",
    data_status: "REAL",
  };
}

export function getAllTrends(): TrendResult[] {
  return loadStadiums()
    .map((s) => getStadiumTrend(s.id))
    .filter((t): t is TrendResult => t !== null)
    .sort((a, b) => b.trend_c_per_decade - a.trend_c_per_decade);
}

type YearlyBucket = { n: number; mean: number };
let yearlyCache: Record<string, Record<string, YearlyBucket>> | null = null;
function loadYearlyTrend(): Record<string, Record<string, YearlyBucket>> {
  if (!yearlyCache) yearlyCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "yearly_trend.json"), "utf-8"));
  return yearlyCache!;
}

/** The real year-by-year series getStadiumTrend()'s regression was
 * computed from -- backed by data/yearly_trend.json
 * (scripts/compute_discovery.py's own real per-year/month aggregate of
 * the 2.46M-row NOAA table). Verified directly against
 * discovery_trend.json before this was written: this file's own
 * `mean` for the July bucket matches that file's first_year_wbgt/
 * last_year_wbgt exactly, so it's the same real number, just every
 * year instead of only the two endpoints. */
export function getStadiumYearlySeries(stadiumId: string, month = 7): { year: number; wbgt_c: number; sample_size: number }[] {
  const buckets = loadYearlyTrend()[stadiumId] ?? {};
  const monthKey = String(month).padStart(2, "0");
  return Object.entries(buckets)
    .filter(([key]) => key.endsWith(`-${monthKey}`))
    .map(([key, b]) => ({ year: Number(key.slice(0, 4)), wbgt_c: b.mean, sample_size: b.n }))
    .sort((a, b) => a.year - b.year);
}

export type ProjectionResult = {
  stadium_id: string;
  stadium_name: string;
  target_year: number;
  based_on: { first_year: number; last_year: number; last_year_july_wbgt_c: number; trend_c_per_decade: number };
  projected_july_wbgt_c: number;
  years_beyond_data: number;
  data_status: "EXTRAPOLATION";
  caveat: string;
};

const MAX_YEARS_BEYOND_DATA = 15;

/** A NAIVE linear extrapolation of the real 20-year July-WBGT trend --
 * NOT a validated climate forecast. It answers "if the observed
 * 2006-2025 trend continued in a straight line, what would July WBGT
 * be in year X" -- nothing more. Real future heat depends on things
 * this can't see: El Nino/La Nina cycles, urban heat island growth,
 * emissions scenarios, station relocations. Deliberately refuses
 * (returns null) beyond MAX_YEARS_BEYOND_DATA out, because a straight
 * line stops being a remotely reasonable approximation of climate
 * further out than that, and this tool should fail honestly rather
 * than hand back an authoritative-looking number for 2060. */
export function projectFutureWBGT(stadiumId: string, targetYear: number): ProjectionResult | { error: string } | null {
  const stadium = loadStadiums().find((s) => s.id === stadiumId);
  if (!stadium) return null;
  const trend = getStadiumTrend(stadium.id);
  if (!trend) return null;

  const yearsBeyond = targetYear - trend.last_year;
  if (yearsBeyond <= 0) {
    return { error: `target_year must be after ${trend.last_year} (the last year with real data) -- use get_stadium_trend or get_stadium_snapshot for years already observed.` };
  }
  if (yearsBeyond > MAX_YEARS_BEYOND_DATA) {
    return {
      error: `Refusing to extrapolate ${yearsBeyond} years beyond the real data (last observed: ${trend.last_year}). A straight-line projection of a 20-year trend is not a credible climate forecast that far out -- capped at ${MAX_YEARS_BEYOND_DATA} years beyond ${trend.last_year} (i.e. up to ${trend.last_year + MAX_YEARS_BEYOND_DATA}).`,
    };
  }

  const projected = trend.last_year_july_wbgt_c + (trend.trend_c_per_decade / 10) * yearsBeyond;
  return {
    stadium_id: stadium.id,
    stadium_name: stadium.name,
    target_year: targetYear,
    based_on: {
      first_year: trend.first_year,
      last_year: trend.last_year,
      last_year_july_wbgt_c: trend.last_year_july_wbgt_c,
      trend_c_per_decade: trend.trend_c_per_decade,
    },
    projected_july_wbgt_c: Math.round(projected * 100) / 100,
    years_beyond_data: yearsBeyond,
    data_status: "EXTRAPOLATION",
    caveat:
      "Naive straight-line extrapolation of the real 2006-2025 trend -- NOT a validated climate model. Does not account for El Nino/La Nina cycles, urban heat island growth, emissions scenarios, or station changes. Present as 'if the past trend continues' framing, never as a confident prediction.",
  };
}

// Scenario-simulator constants -- MODELED assumptions, not measured at
// these venues. Kept numerically identical to
// components/ScenarioSimulator.tsx and components/PriorityList.tsx on
// purpose; if you change one, change all three.
export const SHADE_EFFECT_PER_10PCT = 0.03;
export const MISTING_EFFECT_PER_STATION = 0.5;
export const MISTING_CAP = 3;
export const ROOF_CLOSED_EFFECT = 3;

export type ScenarioResult = {
  stadium_id: string;
  stadium_name: string;
  baseline_wbgt_c: number;
  adjusted_wbgt_c: number;
  reduction_c: number;
  can_close_roof: boolean;
  roof_closed_applied: boolean;
  inputs: { shade_pct: number; misting_stations: number; roof_closed: boolean };
  data_status: "MOCK";
  caveat: string;
};

/** Applies the same MODELED (not measured) intervention formula the
 * dashboard's Scenario Simulator uses. Always flagged data_status:
 * "MOCK" -- these effect sizes are plausible published assumptions,
 * not something measured at these specific venues. */
export function simulateScenario(
  stadiumId: string,
  month: number,
  hour: number,
  opts: { shadePct?: number; mistingStations?: number; roofClosed?: boolean }
): ScenarioResult | null {
  const snapshot = getStadiumSnapshot(stadiumId, month, hour);
  if (!snapshot || snapshot.wbgt_mean_c === null) return null;
  const shadePct = opts.shadePct ?? 0;
  const mistingStations = opts.mistingStations ?? 0;
  const roofClosed = !!opts.roofClosed;
  const canCloseRoof = snapshot.roof_type === "retractable";
  const roofClosedApplied = canCloseRoof && roofClosed;

  let w = snapshot.wbgt_mean_c;
  w -= (shadePct / 10) * SHADE_EFFECT_PER_10PCT;
  w -= Math.min(mistingStations * MISTING_EFFECT_PER_STATION, MISTING_CAP);
  if (roofClosedApplied) w -= ROOF_CLOSED_EFFECT;
  w = Math.round(w * 100) / 100;

  return {
    stadium_id: snapshot.stadium_id,
    stadium_name: snapshot.stadium_name,
    baseline_wbgt_c: snapshot.wbgt_mean_c,
    adjusted_wbgt_c: w,
    reduction_c: Math.round((snapshot.wbgt_mean_c - w) * 100) / 100,
    can_close_roof: canCloseRoof,
    roof_closed_applied: roofClosedApplied,
    inputs: { shade_pct: shadePct, misting_stations: mistingStations, roof_closed: roofClosed },
    data_status: "MOCK",
    caveat:
      "Effect sizes (shade, misting, roof) are modeled plausible assumptions from published heat-mitigation literature, not measured at this specific venue.",
  };
}

// --- Real match schedule + real match-day heat ----------------------
//
// The tournament (June 11 - July 19, 2026) already happened as of
// this session (today is September 2026). scripts/fetch_match_schedule.py
// pulled the real 78-match US-venue schedule; scripts/fetch_match_weather.py
// matched each real kickoff to a real weather reading (Iowa State
// Mesonet ASOS -- the same physical station as this stadium's 20-year
// climatology; used because NOAA's own bulk archive hasn't published
// 2026 yet). See DISCOVERY.md Section 4 for the full writeup.

export type RealMatch = {
  match_number: number | null;
  stadium_id: string;
  city: string;
  round: string;
  stage: "group" | "knockout";
  local_kickoff: string;
  utc_offset: number;
  kickoff_utc_iso: string;
  matchup_raw: string;
  real_kickoff_temp_c: number | null;
  real_kickoff_dewpoint_c: number | null;
  real_kickoff_wbgt_c: number | null;
  real_peak_wbgt_c: number | null;
  weather_data_status: "REAL" | "MISSING";
};

let matchesCache: RealMatch[] | null = null;
function loadMatches(): RealMatch[] {
  if (!matchesCache) {
    for (const file of ["match_weather.json", "matches.json"]) {
      try {
        matchesCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
        break;
      } catch {
        continue;
      }
    }
    if (!matchesCache) matchesCache = [];
  }
  return matchesCache!;
}

/** Every real match played at one stadium, with real match-day WBGT
 * where available (data_status REAL, from the actual observed weather
 * that day -- NOT the 20-year climatology average). */
export function getStadiumMatches(stadiumId: string): RealMatch[] {
  return loadMatches()
    .filter((m) => m.stadium_id === stadiumId)
    .sort((a, b) => a.kickoff_utc_iso.localeCompare(b.kickoff_utc_iso));
}

/** The hottest real moments of the real tournament, across all 11 US
 * venues, ranked by real peak WBGT during play. */
export function getHottestRealMatches(limit = 10): RealMatch[] {
  return loadMatches()
    .filter((m) => m.real_peak_wbgt_c !== null)
    .sort((a, b) => (b.real_peak_wbgt_c ?? 0) - (a.real_peak_wbgt_c ?? 0))
    .slice(0, limit);
}
