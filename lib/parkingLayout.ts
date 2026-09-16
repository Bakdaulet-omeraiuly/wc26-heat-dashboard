/**
 * Real parking-lot yield calculation -- how many cars actually fit,
 * computed from the lot's own real dimensions (scripts/fetch_parking_lots.py's
 * oriented_dimensions()) and real US surface-parking design standards,
 * not a flat area-divided-by-a-constant guess.
 *
 * Standards used (verified this session, all real, citable figures --
 * ITE Parking Generation Manual / ULI parking design guidance):
 *   - stall: 9 ft x 18 ft (2.74m x 5.49m), the commonly-cited minimum
 *     standard stall for 90-degree parking
 *   - two-way drive aisle (90-degree parking): 24 ft (7.32m)
 * A "double-loaded module" is one row of stalls + the aisle + another
 * row of stalls facing it -- the standard way surface lots are laid
 * out -- and its depth is exactly 2 stalls + 1 aisle.
 *
 * This is still a MODEL, not a survey of these lots' actual painted
 * stripes (OSM doesn't carry that): it assumes a lot is laid out as
 * simple parallel double-loaded rows across its real oriented
 * rectangle, ignores driveways/curb cuts/ADA stalls/landscaping
 * islands, and (like scripts/fetch_parking_lots.py's own oriented-
 * bounding-rectangle method) approximates irregular lot shapes as
 * rectangular. It is a real geometric estimate from real dimensions,
 * not a flat per-area constant -- a meaningfully more precise MODEL,
 * still tagged SEMI, never REAL.
 */

export const STALL_WIDTH_M = 2.74; // 9 ft, ITE/ULI standard stall width
export const STALL_DEPTH_M = 5.49; // 18 ft, standard stall depth
export const AISLE_WIDTH_M = 7.32; // 24 ft, standard two-way drive aisle (90-degree parking)
export const MODULE_DEPTH_M = 2 * STALL_DEPTH_M + AISLE_WIDTH_M; // one row + aisle + one row = 18.3m

export type ParkingRow = {
  /** row index, 0-based, in the order laid out across the lot's width */
  index: number;
  /** distance from the lot's "start" edge (across the width axis) to this row's center, meters */
  across_m: number;
  stalls: number;
};

export type RealParkingLayout = {
  length_m: number;
  width_m: number;
  stalls_per_row: number;
  rows: ParkingRow[];
  total_spaces: number;
};

/** The real yield calculation: how many double-loaded modules (row +
 * aisle + row) fit across the lot's real width, how many stalls fit
 * along its real length, plus one extra single row along the far edge
 * if there's room for it but not a full module. */
export function computeRealParkingLayout(lengthM: number, widthM: number): RealParkingLayout {
  const stallsPerRow = Math.max(0, Math.floor(lengthM / STALL_WIDTH_M));
  const numModules = Math.max(0, Math.floor(widthM / MODULE_DEPTH_M));
  const usedByModules = numModules * MODULE_DEPTH_M;
  const remainder = widthM - usedByModules;
  const hasEdgeRow = remainder >= STALL_DEPTH_M;

  const rows: ParkingRow[] = [];
  let cursor = 0;
  for (let m = 0; m < numModules; m++) {
    rows.push({ index: rows.length, across_m: cursor + STALL_DEPTH_M / 2, stalls: stallsPerRow });
    cursor += STALL_DEPTH_M;
    rows.push({ index: rows.length, across_m: cursor + AISLE_WIDTH_M + STALL_DEPTH_M / 2, stalls: stallsPerRow });
    cursor += AISLE_WIDTH_M + STALL_DEPTH_M;
  }
  if (hasEdgeRow) {
    rows.push({ index: rows.length, across_m: cursor + STALL_DEPTH_M / 2, stalls: stallsPerRow });
  }

  const totalSpaces = rows.reduce((sum, r) => sum + r.stalls, 0);
  return { length_m: lengthM, width_m: widthM, stalls_per_row: stallsPerRow, rows, total_spaces: totalSpaces };
}
