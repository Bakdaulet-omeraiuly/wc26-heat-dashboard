/**
 * Real building footprints (OpenStreetMap, see scripts/fetch_buildings.py)
 * around each stadium -- real centroid distance/bearing (same schematic
 * placement convention every other real layer in this app uses), real
 * oriented footprint dimensions, and a height that's REAL when OSM
 * carries a real `height` tag, SEMI when derived from a real
 * `building:levels` count (x a real published 3m/level average), or a
 * flat MOCK default only when OSM has neither.
 */
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

export type Building = {
  osm_id: number;
  name: string | null;
  distance_m: number;
  bearing_from_stadium_deg: number;
  orientation_deg: number;
  length_m: number;
  width_m: number;
  area_m2: number;
  height_m: number;
  height_status: "REAL" | "SEMI" | "MOCK";
};

let cache: Record<string, Building[]> | null = null;
function loadBuildings(): Record<string, Building[]> {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "buildings.json"), "utf-8"));
    } catch {
      cache = {}; // data/buildings.json not fetched yet -- fail open, not a crash
    }
  }
  return cache!;
}

export function getStadiumBuildings(stadiumId: string): Building[] {
  return loadBuildings()[stadiumId] ?? [];
}
