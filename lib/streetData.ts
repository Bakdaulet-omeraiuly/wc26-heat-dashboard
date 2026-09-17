/**
 * Real street/road geometry (OpenStreetMap, see scripts/fetch_streets.py)
 * around each stadium -- stored as {distance_m, bearing_deg} per node,
 * so it can be placed with the exact same bearingToXZ() schematic
 * transform Stadium3D.tsx already uses for parking lots (real compass
 * direction, compressed-not-to-scale radius) -- not raw lat/lon, and
 * not a second, inconsistent projection.
 */
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

export type StreetPoint = { distance_m: number; bearing_deg: number };
export type StreetSegment = { osm_id: number; highway: string | null; name: string | null; points: StreetPoint[] };

let cache: Record<string, StreetSegment[]> | null = null;
function loadStreets(): Record<string, StreetSegment[]> {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "streets.json"), "utf-8"));
    } catch {
      cache = {}; // data/streets.json not fetched yet -- fail open, not a crash
    }
  }
  return cache!;
}

export function getStadiumStreets(stadiumId: string): StreetSegment[] {
  return loadStreets()[stadiumId] ?? [];
}
