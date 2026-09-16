/**
 * Real parking-lot geometry (from OpenStreetMap, see
 * scripts/fetch_parking_lots.py) combined with published pavement
 * heat-island research to estimate walk-in heat exposure -- the
 * "which parking lot, and is the walk from it dangerous right now"
 * question this session's research turned up (real field studies:
 * open asphalt can run 50-60F hotter than shaded air at midday;
 * shade cuts that substantially -- see the script's docstring for
 * sources). This is explicitly NOT a rigorous globe-temperature WBGT
 * calculation -- it's a transparent, clearly-tagged estimate: real
 * distance + real climatology WBGT + one modeled surcharge term.
 */
import fs from "node:fs";
import path from "node:path";
import * as SunCalc from "suncalc";
import { findStadium, getStadiumSnapshot } from "./agentData";
import { wbgtToSportsFlag, type SportsFlagColor } from "./wbgt";
import { computeRealParkingLayout, type RealParkingLayout } from "./parkingLayout";

const DATA_DIR = path.join(process.cwd(), "data");

export type ParkingLot = {
  osm_id: number;
  name: string;
  name_status: "REAL" | "UNNAMED";
  area_m2: number;
  lat: number;
  lon: number;
  distance_m: number;
  bearing_from_stadium_deg: number;
  // Real oriented-bounding-rectangle dimensions (undefined for lots
  // fetched before this field existed -- computeLotOccupancy() falls
  // back to the area/constant approximation for those).
  lot_orientation_deg?: number;
  length_m?: number;
  width_m?: number;
};

let cache: Record<string, ParkingLot[]> | null = null;
function loadParking(): Record<string, ParkingLot[]> {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "parking.json"), "utf-8"));
    } catch {
      cache = {}; // data/parking.json not fetched yet -- fail open to "no lot data", not a crash
    }
  }
  return cache!;
}

export function getStadiumParkingLots(stadiumId: string): ParkingLot[] {
  return loadParking()[stadiumId] ?? [];
}

// Modeled constants, NOT measured at these specific venues -- sourced
// from published field studies during this session's research (an
// Arizona pavement-temperature pilot study; a USDA Forest Service
// Davis, CA parking-shade study). Kept separate from lib/agentData.ts's
// scenario constants because this models a different mechanism
// (radiant heat from walking across open pavement) than shade/misting
// at the seating bowl.
export const WALK_SPEED_M_PER_MIN = 80; // ~3 mph brisk walk -- SEMI assumption, not measured
export const ASPHALT_SUN_SURCHARGE_C = 3.0; // MOCK: modeled radiant-heat add-on for crossing open sunlit pavement, vs the shaded-instrument reading climatology WBGT is computed from

export type LotExposure = {
  lot: ParkingLot;
  walk_minutes: number;
  sun_is_up: boolean;
  base_wbgt_c: number | null;
  adjusted_wbgt_c: number | null;
  sports_flag: SportsFlagColor | null;
  data_status: "SEMI"; // real geometry + real climatology + one modeled surcharge -- never pure REAL
  caveat: string;
};

const CAVEAT =
  "distance_m and area_m2 are REAL (OpenStreetMap geometry); base WBGT is REAL (climatology); the +3C sun surcharge while crossing open pavement is a MODELED estimate from published pavement-heat-island field studies, not measured at this venue, and not a full globe-temperature WBGT calculation.";

/** For each real parking lot at this stadium, estimate the walk time
 * and heat exposure at a given month/hour. Sun-up/down is computed
 * from the same real SunCalc astronomy the 3D view uses (a
 * representative day-15 date -- climatology buckets are month/hour
 * recurring averages, not tied to one calendar date). */
export function computeLotExposure(stadiumId: string, month: number, hour: number): LotExposure[] {
  const stadium = findStadium(stadiumId);
  const lots = getStadiumParkingLots(stadiumId);
  if (!stadium || lots.length === 0) return [];

  const snapshot = getStadiumSnapshot(stadiumId, month, hour);
  const baseWbgt = snapshot?.wbgt_mean_c ?? null;

  const date = new Date(Date.UTC(2025, month - 1, 15, hour, 0, 0));
  const pos = SunCalc.getPosition(date, stadium.lat, stadium.lon);
  const sunIsUp = pos.altitude > 0; // altitude already in degrees (or radians -- either way, sign is what matters here)

  return lots.map((lot) => {
    const walkMinutes = Math.round((lot.distance_m / WALK_SPEED_M_PER_MIN) * 10) / 10;
    const adjusted = baseWbgt !== null ? baseWbgt + (sunIsUp ? ASPHALT_SUN_SURCHARGE_C : 0) : null;
    return {
      lot,
      walk_minutes: walkMinutes,
      sun_is_up: sunIsUp,
      base_wbgt_c: baseWbgt,
      adjusted_wbgt_c: adjusted !== null ? Math.round(adjusted * 10) / 10 : null,
      sports_flag: adjusted !== null ? wbgtToSportsFlag(adjusted) : null,
      data_status: "SEMI",
      caveat: CAVEAT,
    };
  });
}

export function rankLotsBySafety(stadiumId: string, month: number, hour: number): LotExposure[] {
  return computeLotExposure(stadiumId, month, hour).sort(
    (a, b) => (a.adjusted_wbgt_c ?? Infinity) - (b.adjusted_wbgt_c ?? Infinity)
  );
}

// --- Match-day parking occupancy -----------------------------------
//
// "Which lot is full, and when" for a REAL World Cup match (see
// scripts/fetch_match_schedule.py -- real kickoff times from the
// openfootball/worldcup dataset). The curve shape below (fills
// accelerating into kickoff, drains slower than it fills) is a real,
// well-documented traffic-engineering pattern at large stadium events
// -- egress bottlenecks are a known phenomenon -- but the exact
// percentages are illustrative, not measured at these specific
// venues, so this whole calculation is tagged MOCK, never REAL.

export const AVG_M2_PER_PARKING_SPACE = 28; // SEMI: industry rule-of-thumb (~300-330 sq ft incl. drive aisles), not a survey of these specific lots
export const AVG_OCCUPANTS_PER_VEHICLE = 2.7; // SEMI: commonly cited average vehicle occupancy for event/rideshare travel

/** Fraction of eventual peak parking demand filled at a given offset
 * from kickoff (negative = before, positive = after). MOCK: modeled
 * shape, not measured. Ingress ramps over ~3h; egress is
 * deliberately slower than ingress (real bottleneck effect at a
 * single-exit stadium lot), draining over ~4.5h. */
export function occupancyFraction(hoursFromKickoff: number): number {
  const h = hoursFromKickoff;
  if (h <= -3) return 0.05;
  if (h <= -2) return 0.05 + (h - -3) * (0.4 - 0.05); // -3..-2 -> 0.05..0.4
  if (h <= -1) return 0.4 + (h - -2) * (0.85 - 0.4); // -2..-1 -> 0.4..0.85
  if (h <= 0) return 0.85 + (h - -1) * (1.0 - 0.85); // -1..0 -> 0.85..1.0
  if (h <= 2) return 1.0; // match in progress, lot stays full
  if (h <= 3) return 1.0 - (h - 2) * (1.0 - 0.4); // 2..3 -> 1.0..0.4 (initial rush)
  if (h <= 4.5) return 0.4 - (h - 3) * ((0.4 - 0.05) / 1.5); // 3..4.5 -> 0.4..0.05 (slow bottleneck tail)
  return 0.05;
}

export type LotOccupancy = {
  lot: ParkingLot;
  estimated_spaces: number;
  capacity_method: "real-layout" | "area-fallback";
  layout: RealParkingLayout | null;
  occupancy_fraction: number;
  estimated_cars_now: number;
  data_status: "SEMI"; // real geometry -> SEMI space count; MOCK occupancy curve on top
};

/** How many spaces this lot really holds. Prefers the real
 * dimension-based layout calculation (lib/parkingLayout.ts -- actual
 * stall rows and aisles fit to this lot's real oriented rectangle);
 * falls back to the older flat area/28 rule-of-thumb only for lots
 * fetched before length_m/width_m existed. */
function lotCapacity(lot: ParkingLot): { spaces: number; method: "real-layout" | "area-fallback"; layout: RealParkingLayout | null } {
  if (lot.length_m && lot.width_m) {
    const layout = computeRealParkingLayout(lot.length_m, lot.width_m);
    if (layout.total_spaces > 0) return { spaces: layout.total_spaces, method: "real-layout", layout };
  }
  return { spaces: Math.max(1, Math.round(lot.area_m2 / AVG_M2_PER_PARKING_SPACE)), method: "area-fallback", layout: null };
}

/** Distributes estimated demand across a stadium's real lots
 * proportional to each lot's real CAPACITY (not just raw area) -- so
 * a lot's shape, not only its footprint, drives how many cars it
 * really holds. */
export function computeLotOccupancy(stadiumId: string, hoursFromKickoff: number): LotOccupancy[] {
  const lots = getStadiumParkingLots(stadiumId);
  if (lots.length === 0) return [];
  const fraction = occupancyFraction(hoursFromKickoff);
  return lots.map((lot) => {
    const { spaces, method, layout } = lotCapacity(lot);
    return {
      lot,
      estimated_spaces: spaces,
      capacity_method: method,
      layout,
      occupancy_fraction: Math.round(fraction * 100) / 100,
      estimated_cars_now: Math.round(spaces * fraction),
      data_status: "SEMI",
    };
  });
}
