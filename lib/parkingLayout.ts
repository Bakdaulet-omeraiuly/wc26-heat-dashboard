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

/**
 * Angled-parking layouts (60-degree and 45-degree), added to answer a
 * real, computable question: for a REAL lot's own real dimensions,
 * does re-striping it at an angle actually fit more cars, or fewer?
 * Not assumed either way -- computed per lot from real standards below.
 *
 * Standards used (real, citable, government source -- City of
 * Kerrville, TX municipal parking design standards, Figures 15-19):
 * https://kerrvilletx.gov/DocumentCenter/View/34300/K_Parking-Minimum-Standards-7-24-2019
 *
 *   Angle | Stall width (A) | Stall depth (B) | Aisle width (C) | Skew width (D)
 *   45°   | 9'-0"           | 19'-1"          | 11'-0"          | 12'-9"
 *   60°   | 9'-0"           | 17'-0"          | 17'-0"          | 10'-5"
 *   90°   | 9'-0"           | 18'-0"          | 23'-27'         | --
 *
 * "Skew width" (D) is the real along-row spacing each angled stall
 * consumes -- wider than the 9ft stall width itself because the stall
 * is slanted, not perpendicular to the row (D = stall_width / sin(angle),
 * which checks out: 9/sin(45°) = 12.73ft ≈ 12'-9", 9/sin(60°) = 10.39ft
 * ≈ 10'-5" -- the published table matches the real trig). A
 * double-loaded angled module is shallower per row-pair than 90°'s
 * (2 stall-depths + 1 aisle, using the ANGLED stall depth and aisle,
 * both smaller than 90°'s 18ft/24ft), which can fit more row-pairs
 * across a lot's real width -- at the cost of each row holding fewer,
 * wider-spaced cars. Which trade wins is real lot-shape-dependent, so
 * this is computed per lot, not assumed.
 */
export type ParkingAngle = 90 | 60 | 45;

const ANGLED_SPECS: Record<60 | 45, { skewWidth_m: number; stallDepth_m: number; aisleWidth_m: number }> = {
  60: { skewWidth_m: 3.175, stallDepth_m: 5.182, aisleWidth_m: 5.182 }, // 10'-5", 17'-0", 17'-0"
  45: { skewWidth_m: 3.886, stallDepth_m: 5.817, aisleWidth_m: 3.353 }, // 12'-9", 19'-1", 11'-0"
};

/** Same real double-loaded-module method as computeRealParkingLayout(),
 * but using the angled stall's real skew-width (along the row) and the
 * angle's own real stall depth / aisle width instead of the 90-degree
 * constants. Returns the same RealParkingLayout shape so it can reuse
 * stallPositions() and every downstream renderer/consumer unchanged. */
export function computeAngledParkingLayout(lengthM: number, widthM: number, angle: 60 | 45): RealParkingLayout {
  const spec = ANGLED_SPECS[angle];
  const stallsPerRow = Math.max(0, Math.floor(lengthM / spec.skewWidth_m));
  const moduleDepth = 2 * spec.stallDepth_m + spec.aisleWidth_m;
  const numModules = Math.max(0, Math.floor(widthM / moduleDepth));
  const usedByModules = numModules * moduleDepth;
  const remainder = widthM - usedByModules;
  const hasEdgeRow = remainder >= spec.stallDepth_m;

  const rows: ParkingRow[] = [];
  let cursor = 0;
  for (let m = 0; m < numModules; m++) {
    rows.push({ index: rows.length, across_m: cursor + spec.stallDepth_m / 2, stalls: stallsPerRow });
    cursor += spec.stallDepth_m;
    rows.push({ index: rows.length, across_m: cursor + spec.aisleWidth_m + spec.stallDepth_m / 2, stalls: stallsPerRow });
    cursor += spec.aisleWidth_m + spec.stallDepth_m;
  }
  if (hasEdgeRow) {
    rows.push({ index: rows.length, across_m: cursor + spec.stallDepth_m / 2, stalls: stallsPerRow });
  }

  const totalSpaces = rows.reduce((sum, r) => sum + r.stalls, 0);
  return { length_m: lengthM, width_m: widthM, stalls_per_row: stallsPerRow, rows, total_spaces: totalSpaces };
}

export type AngleComparison = {
  length_m: number;
  width_m: number;
  by_angle: Record<ParkingAngle, RealParkingLayout>;
  best_angle: ParkingAngle;
  best_total: number;
  current_total: number; // always the 90-degree figure, since that's what's shown elsewhere as this lot's real capacity
  gain_vs_90: number; // best_total - current_total; can be 0 or negative-showing (90 already best) -- never inflated
};

/** Computes real capacity at all three angles for one lot and reports
 * which is genuinely best -- honestly, including the case where 90 is
 * already optimal and re-striping would gain nothing or lose spaces. */
export function compareParkingAngles(lengthM: number, widthM: number): AngleComparison {
  const layout90 = computeRealParkingLayout(lengthM, widthM);
  const layout60 = computeAngledParkingLayout(lengthM, widthM, 60);
  const layout45 = computeAngledParkingLayout(lengthM, widthM, 45);
  const by_angle: Record<ParkingAngle, RealParkingLayout> = { 90: layout90, 60: layout60, 45: layout45 };
  let best_angle: ParkingAngle = 90;
  let best_total = layout90.total_spaces;
  for (const angle of [60, 45] as const) {
    if (by_angle[angle].total_spaces > best_total) {
      best_total = by_angle[angle].total_spaces;
      best_angle = angle;
    }
  }
  return {
    length_m: lengthM,
    width_m: widthM,
    by_angle,
    best_angle,
    best_total,
    current_total: layout90.total_spaces,
    gain_vs_90: best_total - layout90.total_spaces,
  };
}

export type StallPosition = {
  /** position along the lot's real long axis, meters from one edge (not centered) */
  along_m: number;
  /** position across the lot's real width, meters from one edge */
  across_m: number;
};

/** Every individual real stall's real local position (before rotation/
 * translation into the 3D scene) -- reconstructed from the compact
 * row summary (RealParkingLayout.rows), not re-fetched or re-sent per
 * stall. When a lot has more stalls than `maxCount`, samples an EVENLY
 * SPACED subset across the whole real layout (not just the first N)
 * so a render cap still shows the lot's real full extent -- the
 * caller is responsible for scaling the filled/total counts by the
 * same sampling ratio so the on/off proportion stays exact. */
export function stallPositions(layout: RealParkingLayout, maxCount?: number): StallPosition[] {
  const all: StallPosition[] = [];
  for (const row of layout.rows) {
    for (let col = 0; col < row.stalls; col++) {
      all.push({ along_m: (col + 0.5) * STALL_WIDTH_M, across_m: row.across_m });
    }
  }
  if (!maxCount || all.length <= maxCount) return all;
  const stride = all.length / maxCount;
  const sampled: StallPosition[] = [];
  for (let i = 0; i < maxCount; i++) {
    sampled.push(all[Math.floor(i * stride)]);
  }
  return sampled;
}
