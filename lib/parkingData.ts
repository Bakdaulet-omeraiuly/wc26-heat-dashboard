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
