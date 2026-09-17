"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Instances, Instance, Line } from "@react-three/drei";
import { EffectComposer, Bloom, N8AO } from "@react-three/postprocessing";
import * as THREE from "three";
import * as SunCalc from "suncalc";
import { useHeatDashboardStore } from "@/lib/store";
import { stallPositions, STALL_WIDTH_M, STALL_DEPTH_M, type RealParkingLayout } from "@/lib/parkingLayout";
import type { StreetSegment } from "@/lib/streetData";

/** Flies the camera to a clicked parking lot -- click a lot and orbit
 * smoothly re-centers on it and zooms in, instead of the user having
 * to manually pan/zoom to find it. Stops forcing the camera once it
 * arrives (or the instant the user grabs the controls mid-flight) so
 * normal orbiting resumes immediately -- it's a one-shot "fly to", not
 * a permanent camera lock. */
function CameraFocus({
  controlsRef,
  focusTarget,
  onArrived,
}: {
  controlsRef: React.RefObject<any>;
  focusTarget: [number, number, number] | null;
  onArrived: () => void;
}) {
  const desired = useRef(new THREE.Vector3());
  useFrame(() => {
    if (!focusTarget || !controlsRef.current) return;
    const controls = controlsRef.current;
    const target = controls.target as THREE.Vector3;
    const [tx, ty, tz] = focusTarget;
    desired.current.set(tx, ty, tz);
    target.lerp(desired.current, 0.1);

    // Real bug, screenshot-confirmed: a fixed [+4.5,+4,+4.5] camera
    // offset looked at every lot from the SAME fixed compass
    // direction regardless of where that lot actually sits relative
    // to the stadium -- for lots on one side, that pointed the close-
    // up view straight back through the stadium's own structures
    // (a floodlight pylon reads as a thin stray line crossing a
    // lot's car grid when it's this close to the camera and far in
    // the background). Fixed by computing the offset FROM the real
    // radial direction (stadium center -> this lot): the camera sits
    // slightly toward the stadium from the lot, elevated, so it
    // always looks OUTWARD past the lot -- away from the stadium,
    // never back through it -- whichever real bearing the lot is at.
    const radial = new THREE.Vector2(tx, tz);
    const dist = radial.length();
    const dir = dist > 0.001 ? radial.clone().normalize() : new THREE.Vector2(1, 0);
    const desiredCamPos = new THREE.Vector3(tx - dir.x * 6, ty + 6, tz - dir.y * 6);
    const camPos = controls.object.position as THREE.Vector3;
    camPos.lerp(desiredCamPos, 0.1);
    controls.update();

    if (target.distanceTo(desired.current) < 0.03) onArrived();
  });
  return null;
}

type Occupancy = {
  estimated_spaces: number;
  capacity_method: "real-layout" | "area-fallback";
  occupancy_fraction: number;
  estimated_cars_now: number;
  layout: RealParkingLayout | null;
};

type LotExposure = {
  lot: {
    osm_id: number;
    name: string;
    name_status: "REAL" | "UNNAMED";
    area_m2: number;
    distance_m: number;
    bearing_from_stadium_deg: number;
    lot_orientation_deg?: number;
    length_m?: number;
    width_m?: number;
  };
  walk_minutes: number;
  adjusted_wbgt_c: number | null;
  sports_flag: "white" | "green" | "yellow" | "red" | "black" | null;
  occupancy: Occupancy | null;
};

type Match = {
  match_number: number | null;
  kickoff_utc_iso: string;
  local_kickoff: string;
  utc_offset: number;
  round: string;
  stage?: "group" | "knockout" | "nfl";
  is_future?: boolean;
  matchup_raw: string;
  real_kickoff_wbgt_c?: number | null;
  real_peak_wbgt_c?: number | null;
};

type LiveForecast = { wbgt_c: number; sports_flag: string; forecast_time_local: string } | { error: string } | null;

// Meters-per-scene-unit for every real-world lot/stall measurement
// drawn in this scene -- one constant so the footprint rectangle, the
// stall grid, and each car all agree on scale.
const SCENE_SCALE_M = 35; // lower = every real lot maps to a bigger scene footprint before footprintFor()'s clamp kicks in
// Rendering ceiling per lot: a handful of real lots exceed 10,000
// real stalls (see DISCOVERY.md/README -- NRG Stadium's biggest lot
// alone is 21,183 real spaces). Instancing comfortably handles many
// thousands of boxes, but not unboundedly -- past this cap, an EVENLY
// SPACED subset of the real stall grid is drawn (lib/parkingLayout.ts's
// stallPositions()) and the filled/empty split is scaled by the exact
// same ratio, so the on-screen proportion still matches the real
// percentage exactly even though the absolute rendered count is
// capped. The real exact numbers are always shown as text regardless.
const PER_LOT_STALL_RENDER_CAP = 300; // measured, not guessed: React reconciling many thousands of <Instance> elements on every hour-scrub caused freezes ranging from sub-second to 10+ seconds (verified live, both at large single stadiums and repeatedly at the same stadium); capping lower trades exact rendering of the largest real lots for consistently smooth interaction -- the exact real count is always shown as text/tooltips regardless of this render cap

const FLAG_HEX: Record<string, string> = {
  white: "#e8e8e8",
  green: "#228b54",
  yellow: "#d4af28",
  red: "#c43c30",
  black: "#1a1a1a",
};

/** Ground-plane compass-bearing placement -- the SAME formula used for
 * the sun direction below (with altitude fixed at 0), so a parking
 * lot's marker sits at its real compass direction from the stadium.
 * Distance is compressed into a fixed visual range (lotRadius(), just
 * below); this is schematic, not to scale -- same honesty convention
 * as the stand bowl itself (see the file's top comment). */
function bearingToXZ(bearingDeg: number, radius: number): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  return [Math.sin(rad) * radius, -Math.cos(rad) * radius];
}

// How far out (in scene units) a parking lot/street node sits, given
// its REAL distance from the stadium -- one shared function so every
// caller (lot markers, cars, streets, street trees, the focus-camera
// lookup) agrees exactly, and so the gap from the stadium is set in
// ONE place. Previously this range started at 15 units, which
// overlapped the stadium bowl's own outer structures (the upper deck
// reaches ~19, the floodlight pylons ~22-24) -- a real reported bug:
// lots visually fused into the stadium model instead of reading as a
// separate structure across a plaza. Pushed out to 34-52 so there's a
// clear visible gap (the plaza ring below sits in between).
const LOT_RADIUS_MIN = 34;
const LOT_RADIUS_SPAN = 18;
function lotRadius(distanceM: number): number {
  return LOT_RADIUS_MIN + (Math.min(distanceM, 1200) / 1200) * LOT_RADIUS_SPAN;
}

// IMPORTANT, verified directly (a real bug this exact mismatch caused:
// a lot's own boundary outline/stall stripes rendering at a visibly
// different angle than its own paved pad): this rotates a point by
// `rad` in the OPPOSITE sense from Three.js's own mesh `rotation.y`
// prop (their rotation matrices are mirrors of each other -- rotateXZ(rad)
// puts a point where Three's `rotation.y = -rad` would). Any code that
// both (a) positions a lot's children via rotateXZ(..., rotationRad)
// AND (b) rotates a mesh directly via `rotation={[0, rotationRad, 0]}`
// for that SAME lot must negate one of the two, or they visually
// disagree. This file's convention: rotateXZ's sense is the "real"
// one; every direct `rotation.y` prop for a lot-oriented mesh uses
// `-rotationRad` to match it (see footprintFor() callers).
function rotateXZ(x: number, z: number, rad: number): [number, number] {
  return [x * Math.cos(rad) - z * Math.sin(rad), x * Math.sin(rad) + z * Math.cos(rad)];
}

const CAR_COLORS = ["#c0c0c0", "#8a8a8a", "#2a3a55", "#6b1f1f", "#e8e2d0", "#3f3f3f"]; // a plain plausible parking-lot color mix, not data-driven

/** Sky color driven by the SAME real sun altitude everything else in
 * this scene uses (SunCalc, this stadium's real lat/lon + the
 * scrubber's real date/time) -- not a decorative gradient. Blue by
 * day, warm near the horizon (real sunrise/sunset color shift), deep
 * navy at night. */
function altitudeToSkyColor(altitudeDeg: number): string {
  if (altitudeDeg > 15) return "#7ec8e3"; // full daylight
  if (altitudeDeg > 0) {
    // 0..15deg: blend day blue toward a warm horizon glow
    const t = altitudeDeg / 15;
    return t > 0.5 ? "#7ec8e3" : "#e8a15c";
  }
  if (altitudeDeg > -6) return "#3a3a5c"; // civil twilight
  return "#0b0e1a"; // night
}

// --- Procedural ground/pavement textures ---------------------------
//
// Studying real 3D map/city renderers (streets.gl, researched this
// session) for what actually makes their ground/pavement read as
// real: not polygon count -- an actual tileable surface texture
// (asphalt grain, terrain speckle) instead of one flat solid color.
// This app has no real per-venue surface photography to load (and
// wouldn't invent one), so these are procedurally generated (canvas-
// drawn noise, cached once) rather than a stock stock-photo asphalt
// image -- equally "not measured at this venue" as a flat color, but
// far more legible as actual ground/pavement.
function makeNoiseTexture(base: string, specks: { count: number; size: [number, number]; rgb: () => [number, number, number]; alpha: [number, number] }): THREE.Texture {
  // This scene lives entirely inside react-three-fiber's <Canvas>,
  // which only ever mounts its children client-side (both current
  // call sites also guard on a selected stadium being present before
  // rendering Stadium3D at all) -- so `document` should always exist
  // by the time this runs. Guarded anyway, matching this codebase's
  // "fail open, don't crash" convention (see lib/parkingData.ts):
  // an empty texture renders as an untextured surface, not a 500.
  if (typeof document === "undefined") return new THREE.Texture();
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < specks.count; i++) {
    const [r, g, b] = specks.rgb();
    const a = specks.alpha[0] + Math.random() * (specks.alpha[1] - specks.alpha[0]);
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    const s = specks.size[0] + Math.random() * (specks.size[1] - specks.size[0]);
    ctx.fillRect(Math.random() * size, Math.random() * size, s, s);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Real bug this session: a mesh's `color` prop multiplies its texture
// (never brightens it -- a value >1 per channel isn't valid), so a
// dark textured base times a mid-tone tint compounds into something
// much darker than either color looks alone (e.g. a base ~0.24 times
// a tint ~0.54 renders at ~0.13 -- visibly near-black under normal
// lighting, not the muted-but-visible ground either color suggested
// on its own). Fixed by making these base textures properly LIT-
// looking on their own, and treating every mesh's `color` as a light
// (<=1, usually close to white) tint from here on, never a rescue for
// a too-dark base.
let groundTextureCache: THREE.Texture | null = null;
function getGroundTexture(): THREE.Texture {
  if (!groundTextureCache) {
    groundTextureCache = makeNoiseTexture("#6e7458", {
      count: 1400,
      size: [1, 3.2],
      rgb: () => {
        const g = 90 + Math.random() * 55;
        return Math.random() < 0.5 ? [g, g + 14, g - 10] : [g + 12, g + 6, g - 8];
      },
      alpha: [0.2, 0.45],
    });
  }
  return groundTextureCache;
}

let asphaltTextureCache: THREE.Texture | null = null;
function getAsphaltTexture(): THREE.Texture {
  if (!asphaltTextureCache) {
    asphaltTextureCache = makeNoiseTexture("#84848c", {
      count: 1800,
      size: [0.6, 2],
      rgb: () => {
        const g = 95 + Math.random() * 60;
        return [g, g, g + 5];
      },
      alpha: [0.1, 0.28],
    });
  }
  return asphaltTextureCache;
}

// Per-lot clone of the shared asphalt texture with its OWN repeat set
// from this lot's real footprint size, so the grain reads at a
// consistent density on a tiny lot and a huge one alike -- cached by
// the lot's real, stable OSM id (same caching pattern as
// stallPositionCache below) so it's created once, not every render.
const lotTextureCache = new Map<number, THREE.Texture>();
function getLotAsphaltTexture(osmId: number, lengthScene: number, widthScene: number): THREE.Texture {
  let tex = lotTextureCache.get(osmId);
  if (!tex) {
    tex = getAsphaltTexture().clone();
    tex.needsUpdate = true;
    lotTextureCache.set(osmId, tex);
  }
  const TILE = 1.1; // scene units per texture repeat
  tex.repeat.set(Math.max(1, lengthScene / TILE), Math.max(1, widthScene / TILE));
  return tex;
}

// Real-dimension footprint: use the lot's real oriented length/width
// (scripts/fetch_parking_lots.py's oriented_dimensions()) so the
// ground marker's proportions and rotation match the real rectangle,
// not a generic square -- falls back to a sqrt(area) square for the
// rare lot fetched before that field existed. Clamp raised again this
// pass (6x4 -> 8x5, plus SCENE_SCALE_M lowered) now that lots sit
// further out (lotRadius() 34-52, separated from the stadium bowl --
// see that function's comment) with real room between neighbors: a
// real 60,000m2 lot can now visibly read as bigger than a real 700m2
// one instead of both hitting the same small cap.
function footprintFor(lot: LotExposure["lot"]): { lengthScene: number; widthScene: number; rotationRad: number } {
  if (lot.length_m && lot.width_m) {
    return {
      lengthScene: Math.min(8, Math.max(1, lot.length_m / SCENE_SCALE_M)),
      widthScene: Math.min(5, Math.max(0.65, lot.width_m / SCENE_SCALE_M)),
      rotationRad: ((lot.lot_orientation_deg ?? 0) * Math.PI) / 180,
    };
  }
  const square = Math.min(5, Math.max(0.75, Math.sqrt(lot.area_m2) / 12));
  return { lengthScene: square, widthScene: square, rotationRad: 0 };
}

type CarInstance = { position: [number, number, number]; rotationY: number; color: string };

// A lot's real stall grid (lib/parkingLayout.ts's stallPositions()) is
// a pure function of its real geometry -- it never changes while the
// user scrubs the hour slider, only WHICH of those positions render as
// a car does (occupancy_fraction). Recomputing tens of thousands of
// positions on every single hour-change was a real, measured multi-
// second freeze (verified: dragging the scrubber at a ~90,000-space
// stadium blocked the page for several seconds) -- caching per lot
// (keyed by its real, stable OSM id) turns that into a one-time cost.
const stallPositionCache = new Map<number, ReturnType<typeof stallPositions>>();

// A car instance's fixed rendered footprint (body box is 0.5 x 0.24
// scene units, see the Instances block below) plus a small render
// margin -- used to work out how many cars can ACTUALLY fit inside a
// lot's footprint without visually overlapping, not just an arbitrary
// count. A real bug this exact gap caused: a huge real lot (e.g. AT&T
// Stadium's Lot 21, 325m long) gets its FOOTPRINT clamped to a small
// legible scene size (footprintFor() caps at 4.5 units), so its real
// per-stall spacing once rendered can be a tiny fraction of a scene
// unit -- but PER_LOT_STALL_RENDER_CAP still tried to draw up to 300
// FIXED-SIZE car boxes into that tiny compressed space, so they
// visually piled on top of each other into a solid, z-fighting mass
// (reported live, screenshot-confirmed) instead of reading as
// separated cars.
const CAR_FOOTPRINT_LEN = 0.55;
const CAR_FOOTPRINT_WID = 0.32;

/** Every REAL stall this lot actually has, placed at its exact real
 * position (rotated/scaled/translated into the scene) -- not a
 * decorative scatter. The first `filledCount` (in real row-major
 * order: nearest edge, row by row) render as cars; the rest are
 * simply not drawn, so an empty lot at 3am shows nothing and a full
 * lot at kickoff shows every real stall occupied. When a lot exceeds
 * the render cap, both `filledCount` and the position sample are
 * scaled by the identical ratio, so "40% full" still looks 40% full. */
function realCarsForLot(le: LotExposure, cx: number, cz: number): CarInstance[] {
  const occ = le.occupancy;
  if (!occ || !occ.layout || occ.estimated_cars_now <= 0) return [];
  const { lengthScene, widthScene, rotationRad } = footprintFor(le.lot);
  const lengthM = le.lot.length_m!;
  const widthM = le.lot.width_m!;

  const totalReal = occ.layout.total_spaces;
  // Never try to render more cars than can actually fit, without
  // overlapping, inside this lot's own (possibly heavily clamped)
  // scene footprint -- see CAR_FOOTPRINT_LEN/WID's comment above.
  const visualCap = Math.max(1, Math.floor(lengthScene / CAR_FOOTPRINT_LEN)) * Math.max(1, Math.floor(widthScene / CAR_FOOTPRINT_WID));
  const renderTotal = Math.min(totalReal, PER_LOT_STALL_RENDER_CAP, visualCap);
  let positions = stallPositionCache.get(le.lot.osm_id);
  if (!positions || positions.length !== renderTotal) {
    positions = stallPositions(occ.layout, renderTotal);
    stallPositionCache.set(le.lot.osm_id, positions);
  }
  const filledRendered = Math.round(positions.length * occ.occupancy_fraction);

  const items: CarInstance[] = [];
  for (let i = 0; i < filledRendered; i++) {
    const p = positions[i];
    // Normalize to a -0.5..0.5 FRACTION of the lot's real length/width,
    // then scale by the footprint's CLAMPED scene size -- not a flat
    // /SCENE_SCALE_M conversion of the raw real meters. A real bug this
    // exact mismatch caused: footprintFor() clamps a very long real lot
    // to lengthScene<=4.5 for legibility, but cars placed via the raw
    // conversion ignored that clamp and spread across the lot's real
    // (unclamped) span instead -- for a long enough lot, that put cars
    // visibly drifting through the stadium bowl and neighboring lots.
    const localX = (p.along_m / lengthM - 0.5) * lengthScene;
    const localZ = (p.across_m / widthM - 0.5) * widthScene;
    const [offsetX, offsetZ] = rotateXZ(localX, localZ, rotationRad);
    // cars in a row all face the same way, aligned to the lot's real
    // orientation, alternating 180deg per aisle-facing row pair --
    // approximated here as alternating by STALL_DEPTH_M bands since
    // individual row identity isn't preserved after sampling.
    const bandParity = Math.floor(p.across_m / (STALL_DEPTH_M * 2)) % 2;
    items.push({
      position: [cx + offsetX, 0.02, cz + offsetZ],
      // NOTE: rotateXZ()'s angle convention is the OPPOSITE sense from
      // Three.js's own mesh `rotation.y` prop (verified directly: the
      // two use mirrored rotation matrices) -- this car's OWN facing
      // must be negated to actually align with the lot footprint box's
      // real visual rotation (which uses Three's rotation prop
      // directly, see footprintFor() callers below). Mixing the two
      // conventions un-negated is the exact bug that made a lot's
      // outline/stripes render at a mismatched angle from its own pad.
      rotationY: -rotationRad + (bandParity === 0 ? 0 : Math.PI),
      color: CAR_COLORS[(le.lot.osm_id + i) % CAR_COLORS.length],
    });
  }
  // Fallback square-grid sample for the rare lot without real
  // length_m/width_m/layout (fetched before those fields existed).
  if (!le.lot.length_m || !le.lot.width_m) {
    const count = Math.min(30, occ.estimated_cars_now);
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const spacing = Math.max(0.45, Math.min(0.75, (lengthScene * 0.9) / cols));
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      items.push({
        position: [cx + (col - (cols - 1) / 2) * spacing, 0.02, cz + (row - (cols - 1) / 2) * spacing],
        rotationY: row % 2 === 0 ? 0 : Math.PI,
        color: CAR_COLORS[(le.lot.osm_id + i) % CAR_COLORS.length],
      });
    }
  }
  return items;
}

function ParkingLots({
  lots,
  onHover,
  onFocus,
  showCars,
  coolPavementCoverage = 0,
  smartGrowthCoverage = 0,
}: {
  lots: LotExposure[];
  onHover: (l: LotExposure | null) => void;
  onFocus: (position: [number, number, number]) => void;
  showCars: boolean;
  /** Illustrative overlay only -- applied uniformly across every lot
   * (unlike Urban Lab's per-lot cards, this stadium-wide view isn't
   * trying to show one exact lot's math, just what a stadium-wide
   * rollout of either intervention would look like). The real,
   * exact-lot numbers live in lib/interventions.ts's simulate*
   * functions and Urban Lab's text cards, not in this opacity value. */
  coolPavementCoverage?: number;
  smartGrowthCoverage?: number;
}) {
  const allCars = useMemo(() => {
    if (!showCars) return [];
    const items: CarInstance[] = [];
    for (const le of lots) {
      const scaledRadius = lotRadius(le.lot.distance_m);
      const [cx, cz] = bearingToXZ(le.lot.bearing_from_stadium_deg, scaledRadius);
      items.push(...realCarsForLot(le, cx, cz));
    }
    return items;
  }, [lots, showCars]);

  return (
    <group>
      {/* Each real lot renders like an actual painted lot -- a plain
          asphalt pad with a crisp boundary outline and real stall-row
          stripes -- instead of one bold solid-colored block. Real
          parking-lot 3D models (researched this session: Sketchfab's
          asphalt-lot references, CityEngine's procedural street/
          parking styling) all do this: a neutral paved surface plus
          painted line markings carries the detail, not a flat color
          fill. The WBGT safety flag still reads at a glance -- now as
          the outline's color -- without turning every lot into a
          solid, visually competing block. */}
      {lots.map((le) => {
        const scaledRadius = lotRadius(le.lot.distance_m);
        const [x, z] = bearingToXZ(le.lot.bearing_from_stadium_deg, scaledRadius);
        const { lengthScene, widthScene, rotationRad } = footprintFor(le.lot);
        const isBlackFlag = le.sports_flag === "black";
        // "Black" flag's real hex (#1a1a1a) is real-but-invisible as
        // an OUTLINE stroke against this scene's dark ground -- same
        // problem already solved for the old solid-fill lot box (see
        // the point light below) and for ForecastSidebar's bar chart,
        // just not yet applied to this outline. Substituted with a
        // clearly visible gray here ONLY -- the real black-flag hex
        // stays exactly as-is everywhere else in the app (legend,
        // pills, bars), where it sits on a light background and reads
        // fine.
        const flagColor = le.sports_flag ? (isBlackFlag ? "#9a9aa2" : FLAG_HEX[le.sports_flag]) : "#8a8a90";
        const hx = lengthScene / 2;
        const hz = widthScene / 2;
        const corners: [number, number][] = [
          [-hx, -hz],
          [hx, -hz],
          [hx, hz],
          [-hx, hz],
          [-hx, -hz],
        ].map(([lx, lz]) => rotateXZ(lx, lz, rotationRad)) as [number, number][];
        const outlinePoints = corners.map(([lx, lz]) => new THREE.Vector3(x + lx, 0.05, z + lz));

        // Real stall-row stripes: this lot's own real layout.rows
        // (lib/parkingLayout.ts), capped and evenly sampled -- not
        // every single stall boundary (too many to draw legibly at
        // this scale), but the real row divisions, at their real
        // relative position across the lot's real width.
        const rows = le.occupancy?.layout?.rows ?? [];
        const widthM = le.lot.width_m ?? 1;
        const maxStripes = 6;
        const stride = rows.length > maxStripes ? rows.length / maxStripes : 1;
        const stripeRows = stride > 1 ? Array.from({ length: maxStripes }, (_, i) => rows[Math.floor(i * stride)]) : rows;

        return (
          <group key={le.lot.osm_id}>
            <mesh
              position={[x, 0.03, z]}
              rotation={[0, -rotationRad, 0]}
              onPointerOver={(e) => {
                e.stopPropagation();
                onHover(le);
              }}
              onPointerOut={(e) => {
                e.stopPropagation();
                onHover(null);
              }}
              onClick={(e) => {
                e.stopPropagation();
                onFocus([x, 0.15, z]);
              }}
            >
              <boxGeometry args={[lengthScene, 0.06, widthScene]} />
              <meshStandardMaterial map={getLotAsphaltTexture(le.lot.osm_id, lengthScene, widthScene)} color="#e8e8ec" roughness={0.92} />
            </mesh>
            {stripeRows.map((row, i) => {
              // Row's real across-lot position (lib/parkingLayout.ts's
              // RealParkingLayout.rows), normalized the same way real
              // stall/car positions are (fraction of real width x the
              // footprint's clamped scene size), then rotated into the
              // lot's own real orientation -- a box, not a rotated
              // plane, so it composes with rotationRad as a single
              // clean Y-axis rotation (no Euler-order ambiguity from
              // stacking a flattening X-rotation with a Y-rotation).
              const acrossOffset = (row.across_m / widthM - 0.5) * widthScene;
              const [lx, lz] = rotateXZ(0, acrossOffset, rotationRad);
              return (
                <mesh key={i} position={[x + lx, 0.05, z + lz]} rotation={[0, -rotationRad, 0]}>
                  <boxGeometry args={[lengthScene * 0.92, 0.01, 0.025]} />
                  <meshStandardMaterial color="#d8d8dc" />
                </mesh>
              );
            })}
            <Line
              points={outlinePoints}
              color={flagColor}
              lineWidth={isBlackFlag ? 2.5 : 1.5}
              transparent
              opacity={showCars ? 0.7 : 1}
            />
            {isBlackFlag && <pointLight position={[x, 0.6, z]} intensity={1.2} distance={4} color="#ff2222" />}
          </group>
        );
      })}

      {/* Illustrative coverage overlays -- see the props' docstring. A
          higher coverage fraction reads as more opaque, not a bigger
          footprint (the real capacity trade-off for smart growth is a
          text figure in Urban Lab, computed exactly per lot). */}
      {(coolPavementCoverage > 0 || smartGrowthCoverage > 0) &&
        lots.map((le) => {
          const scaledRadius = lotRadius(le.lot.distance_m);
          const [x, z] = bearingToXZ(le.lot.bearing_from_stadium_deg, scaledRadius);
          const { lengthScene, widthScene, rotationRad } = footprintFor(le.lot);
          return (
            <group key={`overlay-${le.lot.osm_id}`}>
              {coolPavementCoverage > 0 && (
                <mesh position={[x, 0.06, z]} rotation={[0, -rotationRad, 0]}>
                  <boxGeometry args={[lengthScene, 0.02, widthScene]} />
                  <meshStandardMaterial color="#f4f4f4" transparent opacity={coolPavementCoverage * 0.7} />
                </mesh>
              )}
              {smartGrowthCoverage > 0 && (
                <mesh position={[x, 0.07, z]} rotation={[0, -rotationRad, 0]}>
                  <boxGeometry args={[lengthScene, 0.02, widthScene]} />
                  <meshStandardMaterial color="#2e7d32" transparent opacity={smartGrowthCoverage * 0.7} />
                </mesh>
              )}
            </group>
          );
        })}

      {/* Every rendered car is one real stall, drawn at its real
          position -- not a decorative scatter (see realCarsForLot's
          docstring). Two Instances blocks (body + cabin) keep this
          performant into the thousands. */}
      {allCars.length > 0 && (
        <>
          <Instances limit={100000}>
            <boxGeometry args={[0.5, 0.18, 0.24]} />
            <meshStandardMaterial roughness={0.55} metalness={0.15} />
            {allCars.map((c, i) => (
              <Instance key={i} position={[c.position[0], 0.11, c.position[2]]} rotation={[0, c.rotationY, 0]} color={c.color} />
            ))}
          </Instances>
          <Instances limit={100000}>
            <boxGeometry args={[0.26, 0.14, 0.21]} />
            <meshStandardMaterial roughness={0.35} metalness={0.25} />
            {allCars.map((c, i) => (
              <Instance
                key={i}
                position={[c.position[0] - 0.06 * Math.cos(c.rotationY), 0.24, c.position[2] + 0.06 * Math.sin(c.rotationY)]}
                rotation={[0, c.rotationY, 0]}
                color={c.color}
              />
            ))}
          </Instances>
        </>
      )}
    </group>
  );
}

// Real OSM road width by classification (scene units, not to scale --
// same "compressed schematic" convention as everything else placed by
// bearingToXZ), so a real motorway visibly reads as wider pavement
// than a real residential street, not just a thicker wireframe line.
// Widened from the first pass (0.13-0.55) -- too thin to read clearly
// once lots got pushed further out; roads are the one real feature
// meant to be legible from the default zoomed-out view.
const ROAD_WIDTH: Record<string, number> = {
  motorway: 1.05,
  trunk: 0.9,
  primary: 0.75,
  secondary: 0.6,
  tertiary: 0.48,
  residential: 0.32,
  unclassified: 0.26,
};

type RoadQuad = { x: number; z: number; length: number; rotationY: number; width: number };
type RoadJoint = { x: number; z: number; radius: number };

/** Real OSM street centerlines (scripts/fetch_streets.py), placed with
 * the exact same bearingToXZ() schematic transform as parking lots --
 * real compass bearing, compressed-not-to-scale radius -- so streets
 * line up visually with the lots they actually serve. Rendered as flat
 * paved ribbons (one quad per real consecutive node pair, width keyed
 * to real OSM highway classification), plus a center-line stripe on
 * the largest real road classes -- a real, if schematic, "this is
 * pavement" look rather than a debug overlay.
 *
 * Round joints (this pass): the tricky part every real map renderer
 * (Google Maps, Mapbox, streets.gl) solves the same way -- a real
 * road's shape is a POLYLINE of many short real segments, and drawing
 * each one as an independent straight rectangle leaves visible gaps/
 * notches at every bend where two rectangles meet at an angle instead
 * of lining up flush. A small disc (radius = half the road's real
 * width) at every interior real node fills exactly that gap, the same
 * "round line join" technique real cartographic renderers use. */
function Streets({ segments }: { segments: StreetSegment[] }) {
  const quads = useMemo(() => {
    const items: (RoadQuad & { highway: string })[] = [];
    for (const seg of segments) {
      const width = ROAD_WIDTH[seg.highway ?? "unclassified"] ?? 0.13;
      for (let i = 0; i < seg.points.length - 1; i++) {
        const a = seg.points[i];
        const b = seg.points[i + 1];
        const ra = lotRadius(a.distance_m);
        const rb = lotRadius(b.distance_m);
        const [ax, az] = bearingToXZ(a.bearing_deg, ra);
        const [bx, bz] = bearingToXZ(b.bearing_deg, rb);
        const dx = bx - ax;
        const dz = bz - az;
        const length = Math.hypot(dx, dz);
        if (length < 0.001) continue;
        items.push({
          x: (ax + bx) / 2,
          z: (az + bz) / 2,
          length,
          rotationY: Math.atan2(dx, dz),
          width,
          highway: seg.highway ?? "unclassified",
        });
      }
    }
    return items;
  }, [segments]);

  const joints = useMemo(() => {
    const items: RoadJoint[] = [];
    for (const seg of segments) {
      const width = ROAD_WIDTH[seg.highway ?? "unclassified"] ?? 0.13;
      // Interior nodes only (skip the two endpoints) -- a real bend
      // in the road's own real shape, not a made-up point.
      for (let i = 1; i < seg.points.length - 1; i++) {
        const p = seg.points[i];
        const r = lotRadius(p.distance_m);
        const [x, z] = bearingToXZ(p.bearing_deg, r);
        items.push({ x, z, radius: width / 2 });
      }
    }
    return items;
  }, [segments]);

  const majorQuads = quads.filter((q) => q.highway === "motorway" || q.highway === "trunk" || q.highway === "primary");
  const roadTexture = useMemo(() => {
    const t = getAsphaltTexture().clone();
    t.needsUpdate = true;
    t.repeat.set(1, 2.5); // one shared repeat for every quad -- roads are thin ribbons, not worth a per-quad texture clone the way lots get one
    return t;
  }, []);

  return (
    <group>
      {quads.map((q, i) => (
        <mesh key={i} position={[q.x, 0.015, q.z]} rotation={[-Math.PI / 2, 0, q.rotationY]}>
          <planeGeometry args={[q.width, q.length]} />
          <meshStandardMaterial map={roadTexture} color="#c4c4ca" roughness={0.9} />
        </mesh>
      ))}
      {joints.map((j, i) => (
        <mesh key={`j${i}`} position={[j.x, 0.016, j.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[j.radius, 12]} />
          <meshStandardMaterial map={roadTexture} color="#c4c4ca" roughness={0.9} />
        </mesh>
      ))}
      {/* Center-line stripes, major roads only -- a cheap real detail
          that reads as "this is a real road", not decoration. */}
      {majorQuads.map((q, i) => (
        <mesh key={`c${i}`} position={[q.x, 0.017, q.z]} rotation={[-Math.PI / 2, 0, q.rotationY]}>
          <planeGeometry args={[0.035, q.length * 0.9]} />
          <meshStandardMaterial color="#d8c840" />
        </mesh>
      ))}
    </group>
  );
}

/** Illustrative street trees along real road centerlines -- placed at
 * fixed intervals between each real segment's real nodes (not a real
 * tree survey; OSM doesn't carry that), toggled on with the "street
 * trees" intervention. Purely visual context alongside the lot-level
 * tree-shade scenario in Urban Lab, which is where the actual WBGT
 * math for tree shade lives. */
function StreetTrees({ segments }: { segments: StreetSegment[] }) {
  const positions = useMemo(() => {
    const pts: [number, number][] = [];
    const SPACING_UNITS = 1.1;
    for (const seg of segments) {
      for (let i = 0; i < seg.points.length - 1; i++) {
        const a = seg.points[i];
        const b = seg.points[i + 1];
        const ra = lotRadius(a.distance_m);
        const rb = lotRadius(b.distance_m);
        const [ax, az] = bearingToXZ(a.bearing_deg, ra);
        const [bx, bz] = bearingToXZ(b.bearing_deg, rb);
        const segLen = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.floor(segLen / SPACING_UNITS));
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          pts.push([ax + (bx - ax) * t + 0.15, az + (bz - az) * t + 0.15]);
        }
      }
    }
    return pts;
  }, [segments]);

  return (
    <Instances limit={2000}>
      <coneGeometry args={[0.14, 0.32, 6]} />
      <meshStandardMaterial color="#3f8f3f" />
      {positions.map(([x, z], i) => (
        <Instance key={i} position={[x, 0.22, z]} />
      ))}
    </Instances>
  );
}

export type StadiumInterventions = {
  greenRoof?: boolean;
  coolRoof?: boolean;
  coolPavementCoverage?: number; // 0..1
  smartGrowthCoverage?: number; // 0..1
  showStreets?: boolean;
  showStreetTrees?: boolean;
};

type StadiumInfo = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  roof_type: string;
  field_orientation_deg: number | null;
};

/** A schematic, but far more DETAILED, stadium bowl -- still NOT a
 * photorealistic replica of any specific venue (see spec.md Section 6:
 * 11 CAD-accurate models is out of scope for a hackathon timeline, and
 * this project's whole discipline is "never claim more accuracy than
 * you have"). What changed from the original single-ring version:
 * real NFL field proportions and yard markings, a two-tier bowl (real
 * NFL stadiums are multi-deck), floodlight pylons that visibly light
 * up at real night (SunCalc altitude < 0, not decoration), a
 * scoreboard, a paved concourse ground plane so the model doesn't
 * float in void, and roof geometry that differs by this stadium's own
 * REAL roof_type (retractable vs open-canopy vs open) instead of one
 * shared torus for everything with a roof. The field itself is now
 * rotated to this stadium's own REAL measured compass orientation
 * (field_orientation_deg) -- previously that real number was only
 * shown as text nearby, not applied to the geometry it describes. */
function StadiumBowl({
  stadium,
  sunDirection,
  altitudeDeg,
  roofMode,
  onFocus,
}: {
  stadium: StadiumInfo;
  sunDirection: [number, number, number];
  altitudeDeg: number;
  /** "green" tints the roof to represent a green (vegetated) roof
   * intervention; "cool" tints it a bright reflective white -- both
   * purely visual (the real, cited effect sizes for each -- and cool
   * roof's honest lack of a published outdoor WBGT number -- are
   * shown as text in Urban Lab, not computed from this color). */
  roofMode?: "green" | "cool" | null;
  /** Click-to-fly-in on the stadium itself -- same CameraFocus
   * mechanism a lot's own click already uses, just targeting the
   * stadium's own center instead of a lot's real position. */
  onFocus?: (position: [number, number, number]) => void;
}) {
  // Real NFL field proportions: 120yd x 53.33yd (incl. end zones) --
  // ratio ~2.25:1, not the old placeholder 14:9 (~1.56:1). Scene units
  // keep the same rough footprint size as before, just corrected shape.
  const FIELD_LEN = 16;
  const FIELD_WID = 7.1;

  // Vomitoria: real stadium bowls aren't one continuous ring -- they're
  // built as distinct seating sections separated by narrow radial
  // access aisles. Skipping one slot every few segments (offset
  // between decks so the gaps stagger, same as real multi-deck design)
  // reads as sectioned seating instead of a solid drum.
  const lowerBowl = useMemo(() => {
    const segments = 28;
    const items = [];
    for (let i = 0; i < segments; i++) {
      if (i % 7 === 0) continue; // vomitoria gap
      const angle = (i / segments) * Math.PI * 2;
      items.push({ angle, x: Math.cos(angle) * (FIELD_LEN * 0.95), z: Math.sin(angle) * (FIELD_WID * 1.55) });
    }
    return items;
  }, []);
  const upperBowl = useMemo(() => {
    const segments = 28;
    const items = [];
    for (let i = 0; i < segments; i++) {
      if (i % 7 === 3) continue; // vomitoria gap, offset from the lower deck's
      const angle = (i / segments) * Math.PI * 2 + Math.PI / segments; // offset so upper deck seams don't line up with lower -- real stadiums stagger deck sections
      items.push({ angle, x: Math.cos(angle) * (FIELD_LEN * 1.18), z: Math.sin(angle) * (FIELD_WID * 1.85) });
    }
    return items;
  }, []);
  // 6 floodlight pylons, evenly spaced around the outer deck -- a real
  // detail present at essentially every large NFL stadium, and a
  // physically meaningful one here: they light up (emissive + an
  // actual point light) exactly when this stadium's real sun altitude
  // is below the horizon, i.e. a real night game.
  const pylons = useMemo(() => {
    const n = 6;
    const items = [];
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      items.push({ x: Math.cos(angle) * (FIELD_LEN * 1.4), z: Math.sin(angle) * (FIELD_WID * 2.15) });
    }
    return items;
  }, []);

  const isNight = altitudeDeg < 0;
  const fieldRotationRad = ((stadium.field_orientation_deg ?? 0) * Math.PI) / 180;
  const roofColor = roofMode === "green" ? "#2e7d32" : roofMode === "cool" ? "#f2f2f2" : "#8a8f98";

  // A real reported bug: the stadium's own ground/structures and the
  // real parking lots (placed by lotRadius(), starting at 34 scene
  // units) used to overlap -- the concourse disc alone used to reach
  // ~42 units, well past the lots' inner edge. Fixed by (1) shrinking
  // the stadium's own paved ground to stop just past its outermost
  // real structure (the floodlight pylons, ~24 units out) and (2)
  // adding a visually distinct plaza/walkway ring filling the gap up
  // to exactly where lotRadius() begins -- so the stadium campus and
  // the surrounding real lots read as two separate, adjoining things,
  // not one fused blob.
  const STADIUM_GROUND_RADIUS = 25;
  const PLAZA_OUTER_RADIUS = LOT_RADIUS_MIN; // meets the real lots' inner edge exactly, no gap and no overlap

  const campusTexture = useMemo(() => {
    const t = getAsphaltTexture().clone();
    t.needsUpdate = true;
    t.repeat.set(STADIUM_GROUND_RADIUS * 2, STADIUM_GROUND_RADIUS * 2);
    return t;
  }, [STADIUM_GROUND_RADIUS]);
  const plazaTexture = useMemo(() => {
    const t = getAsphaltTexture().clone();
    t.needsUpdate = true;
    t.repeat.set((PLAZA_OUTER_RADIUS - STADIUM_GROUND_RADIUS) * 3, (PLAZA_OUTER_RADIUS - STADIUM_GROUND_RADIUS) * 3);
    return t;
  }, [STADIUM_GROUND_RADIUS, PLAZA_OUTER_RADIUS]);

  return (
    <group>
      {/* Paved stadium-campus ground, stopping just past the pylons --
          NOT reaching the real parking lots. Clicking anywhere on the
          stadium's own campus (not just the field) flies the camera
          in close, the same one-shot CameraFocus mechanism a lot's
          own click already uses -- a big, forgiving click target
          rather than requiring a precise click on one small part of
          the bowl. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.05, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onFocus?.([0, 1.6, 0]);
        }}
      >
        <circleGeometry args={[STADIUM_GROUND_RADIUS, 48]} />
        <meshStandardMaterial map={campusTexture} color="#c8c8ce" roughness={0.95} />
      </mesh>
      {/* Plaza/walkway ring -- a distinct lighter concrete tone filling
          the real gap between the stadium campus and the parking
          lots, so the two read as adjoining but separate structures. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.045, 0]} receiveShadow>
        <ringGeometry args={[STADIUM_GROUND_RADIUS, PLAZA_OUTER_RADIUS, 48]} />
        <meshStandardMaterial map={plazaTexture} color="#eeeef0" roughness={0.9} />
      </mesh>

      {/* Everything below (field, bowl decks, pylons, roof, scoreboard)
          is ONE rigid building, rotated together to this stadium's own
          REAL measured compass field orientation -- not just the field
          paint alone. Rotating only the field inside a fixed bowl
          would leave the field sitting at a strange angle inside an
          oval that wasn't built around it; real stadiums are built as
          one oriented structure, so this model rotates as one too. */}
      <group rotation={[0, fieldRotationRad, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[FIELD_LEN, FIELD_WID]} />
          <meshStandardMaterial color="#245c33" roughness={0.85} />
        </mesh>
        {/* End zones -- neutral tone (this app has no real per-team
            color data, so it stays a generic marked zone, not a
            guessed team color). */}
        {[-1, 1].map((side) => (
          <mesh key={side} rotation={[-Math.PI / 2, 0, 0]} position={[side * (FIELD_LEN / 2 - FIELD_LEN * 0.083), 0.001, 0]}>
            <planeGeometry args={[FIELD_LEN * 0.167, FIELD_WID]} />
            <meshStandardMaterial color="#1c4a29" roughness={0.85} />
          </mesh>
        ))}
        {/* Yard-line stripes, real 10-yard spacing proportion (9 interior lines across the 100-yard playing field) */}
        {Array.from({ length: 9 }, (_, i) => {
          const t = (i + 1) / 10; // 0.1..0.9 across the 100yd playing field (excludes end zones)
          const x = (t - 0.5) * (FIELD_LEN * 0.833);
          return (
            <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.002, 0]}>
              <planeGeometry args={[0.04, FIELD_WID * 0.96]} />
              <meshStandardMaterial color="#e8ede8" />
            </mesh>
          );
        })}

        {/* Center-hung halo videoboard -- a real, modern NFL feature
            (SoFi Stadium's "Infinity Screen" is the famous example:
            a double-sided board spanning ~120 real yards, suspended
            ~122ft above the field -- epa/espn/athleticbusiness
            coverage). Not every one of these 11 venues has one this
            large in reality, so this is a generic, schematic hang
            (not claimed as any specific venue's real board), scaled
            proportionally to the same real field length. */}
        <group position={[0, 4.3, 0]}>
          <mesh castShadow>
            <boxGeometry args={[FIELD_LEN * 0.85, 0.9, 0.25]} />
            <meshStandardMaterial color="#0c0d10" roughness={0.7} />
          </mesh>
          {[1, -1].map((face) => (
            <mesh key={face} position={[0, 0, (face * 0.13)]} rotation={[0, face > 0 ? 0 : Math.PI, 0]}>
              <planeGeometry args={[FIELD_LEN * 0.8, 0.75]} />
              <meshStandardMaterial
                color={isNight ? "#bfe6ff" : "#33424c"}
                emissive={isNight ? "#bfe6ff" : "#000000"}
                emissiveIntensity={isNight ? 0.85 : 0}
              />
            </mesh>
          ))}
          {/* Suspension cables down to the roof structure */}
          {[-1, 1].map((side) =>
            [-1, 1].map((end) => (
              <mesh key={`${side}-${end}`} position={[end * FIELD_LEN * 0.35, 1.0, side * 0.1]}>
                <cylinderGeometry args={[0.015, 0.015, 1.8, 4]} />
                <meshStandardMaterial color="#222" />
              </mesh>
            ))
          )}
        </group>

        {/* Press box -- one long side, between the upper deck and the
            roofline; a real physical feature of every large stadium,
            not previously represented at all. Window strip is a
            plain visual cue, not data-driven. */}
        <group position={[0, 3.9, -FIELD_WID * 1.55]}>
          <mesh castShadow>
            <boxGeometry args={[FIELD_LEN * 0.55, 1.1, 1.0]} />
            <meshStandardMaterial color="#2c2e34" roughness={0.75} />
          </mesh>
          <mesh position={[0, 0.15, 0.51]}>
            <planeGeometry args={[FIELD_LEN * 0.5, 0.35]} />
            <meshStandardMaterial
              color={isNight ? "#ffe9b8" : "#7a8a94"}
              emissive={isNight ? "#ffe9b8" : "#000000"}
              emissiveIntensity={isNight ? 0.5 : 0}
            />
          </mesh>
        </group>

      {/* Lower bowl -- closer, shorter. Each segment darkens on the
          shaded side, computed from the real sun direction. */}
      {lowerBowl.map((seg, i) => {
        const segNormal = [Math.cos(seg.angle), 0, Math.sin(seg.angle)];
        const dot = segNormal[0] * sunDirection[0] + segNormal[2] * sunDirection[2];
        const sunlit = dot > 0.15 && !isNight;
        return (
          <mesh key={i} position={[seg.x, 1.1, seg.z]} castShadow receiveShadow>
            <boxGeometry args={[1.5, 2.2, 1.9]} />
            <meshStandardMaterial
              color={sunlit ? "#cbb98a" : isNight ? "#23262e" : "#4a5568"}
              emissive={sunlit ? "#3a3010" : isNight ? "#ffdca0" : "#000000"}
              emissiveIntensity={sunlit ? 0.12 : isNight ? 0.06 : 0}
              roughness={0.8}
            />
          </mesh>
        );
      })}

      {/* Upper deck -- further out, taller, staggered. Real multi-deck
          NFL bowls read very differently from a single ring. */}
      {upperBowl.map((seg, i) => {
        const segNormal = [Math.cos(seg.angle), 0, Math.sin(seg.angle)];
        const dot = segNormal[0] * sunDirection[0] + segNormal[2] * sunDirection[2];
        const sunlit = dot > 0.15 && !isNight;
        return (
          <mesh key={i} position={[seg.x, 2.6, seg.z]} castShadow receiveShadow>
            <boxGeometry args={[1.7, 3.0, 1.6]} />
            <meshStandardMaterial
              color={sunlit ? "#b7a878" : isNight ? "#1c1e24" : "#3d4452"}
              emissive={sunlit ? "#2e2308" : isNight ? "#ffdca0" : "#000000"}
              emissiveIntensity={sunlit ? 0.1 : isNight ? 0.04 : 0}
              roughness={0.85}
            />
          </mesh>
        );
      })}

      {/* Floodlight pylons -- real feature of essentially every large
          NFL venue, and physically meaningful here: they actually
          light up (emissive + a real point light) exactly when this
          stadium's own real sun altitude is below the horizon. */}
      {pylons.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh position={[0, 3.2, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.13, 6.4, 8]} />
            <meshStandardMaterial color="#3a3a3f" metalness={0.4} roughness={0.6} />
          </mesh>
          <mesh position={[0, 6.5, 0]}>
            <boxGeometry args={[1.1, 0.5, 0.25]} />
            <meshStandardMaterial
              color={isNight ? "#fff3d6" : "#55555c"}
              emissive={isNight ? "#ffdca0" : "#000000"}
              emissiveIntensity={isNight ? 1.1 : 0}
            />
          </mesh>
          {isNight && <pointLight position={[0, 6.5, 0]} intensity={4} distance={18} color="#ffe6b0" />}
          {/* Volumetric-looking light shaft, angled in toward the field
              -- a cheap additive-blended cone, not a real light
              simulation, but reads immediately as "stadium lights at
              night" the way a real point light alone doesn't. */}
          {isNight && (
            <mesh position={[-p.x * 0.35, 3.2, -p.z * 0.35]} rotation={[Math.atan2(p.x, 6.5) * 0.6, 0, -Math.atan2(p.z, 6.5) * 0.6]}>
              <coneGeometry args={[2.2, 6.6, 12, 1, true]} />
              <meshBasicMaterial color="#fff3d0" transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          )}
        </group>
      ))}

      {/* Scoreboard -- one end, above the upper deck, glowing at real night. */}
      <group position={[0, 3.6, -FIELD_WID * 2.3]}>
        <mesh castShadow>
          <boxGeometry args={[3.2, 1.5, 0.15]} />
          <meshStandardMaterial color="#111318" />
        </mesh>
        <mesh position={[0, 0, 0.09]}>
          <planeGeometry args={[2.9, 1.2]} />
          <meshStandardMaterial color={isNight ? "#8fd3ff" : "#2a3a44"} emissive={isNight ? "#8fd3ff" : "#000000"} emissiveIntensity={isNight ? 0.9 : 0} />
        </mesh>
      </group>

      {/* Roof -- shape differs by this stadium's own REAL roof_type,
          not one shared shape for every venue with any roof at all. */}
      {stadium.roof_type === "retractable" && (
        <mesh position={[0, 6.2, 0]}>
          <cylinderGeometry args={[FIELD_LEN * 1.15, FIELD_LEN * 1.25, 0.6, 32, 1, true]} />
          <meshStandardMaterial
            color={roofColor}
            emissive={roofMode === "cool" ? "#ffffff" : "#000000"}
            emissiveIntensity={roofMode === "cool" ? 0.2 : 0}
            transparent
            opacity={roofMode ? 0.85 : 0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {stadium.roof_type === "open-canopy" && (
        <mesh position={[0, 5.2, 0]}>
          <torusGeometry args={[FIELD_LEN * 1.3, 0.35, 8, 32]} />
          <meshStandardMaterial
            color={roofColor}
            emissive={roofMode === "cool" ? "#ffffff" : "#000000"}
            emissiveIntensity={roofMode === "cool" ? 0.2 : 0}
            transparent
            opacity={roofMode ? 0.85 : 0.4}
          />
        </mesh>
      )}
      {/* "open" roof_type: genuinely no roof structure at all -- honest, not an omission. */}
      </group>
    </group>
  );
}

function SunMarker({ direction, altitude }: { direction: [number, number, number]; altitude: number }) {
  const belowHorizon = altitude < 0;
  const pos: [number, number, number] = [direction[0] * 25, Math.max(direction[1] * 25, 1), direction[2] * 25];
  return (
    <mesh position={pos}>
      <sphereGeometry args={[1.2, 16, 16]} />
      <meshBasicMaterial color={belowHorizon ? "#333355" : "#ffcc33"} />
    </mesh>
  );
}

export default function Stadium3D({
  stadium,
  focusLotOsmId,
  interventions,
}: {
  stadium: StadiumInfo;
  /** Set from outside (StadiumPanel's stat rows) to fly the camera to
   * a specific real lot by its real OSM id -- the same mechanism a
   * direct click on a lot in this scene uses internally. */
  focusLotOsmId?: number | null;
  /** Urban Lab's toggles -- undefined/empty means the plain Map+3D
   * view (no visual change from before this feature existed). */
  interventions?: StadiumInterventions;
}) {
  const { month, hour, matchIndex, setMatchIndex, hoursFromKickoffOverride, setHoursFromKickoffOverride } = useHeatDashboardStore();
  const [lots, setLots] = useState<LotExposure[]>([]);
  const [hoveredLot, setHoveredLot] = useState<LotExposure | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchMode, setMatchMode] = useState(true);
  const controlsRef = useRef<any>(null);
  const [focusTarget, setFocusTarget] = useState<[number, number, number] | null>(null);
  const [streets, setStreets] = useState<StreetSegment[]>([]);

  useEffect(() => {
    if (!interventions?.showStreets && !interventions?.showStreetTrees) {
      setStreets([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/streets?stadium=${stadium.id}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setStreets(d.segments ?? []))
      .catch(() => !cancelled && setStreets([]));
    return () => {
      cancelled = true;
    };
  }, [stadium.id, interventions?.showStreets, interventions?.showStreetTrees]);

  useEffect(() => {
    let cancelled = false;
    setMatchIndex(0);
    fetch(`/api/matches?stadium=${stadium.id}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setMatches(d.matches ?? []))
      .catch(() => !cancelled && setMatches([]));
    return () => {
      cancelled = true;
    };
  }, [stadium.id, setMatchIndex]);

  // Focus a lot by real OSM id when asked from outside this component
  // (e.g. clicking "Safest: Lot 1" in StadiumPanel below) -- reuses
  // the exact same scene-position math as a direct in-canvas click.
  useEffect(() => {
    if (focusLotOsmId == null) return;
    const le = lots.find((l) => l.lot.osm_id === focusLotOsmId);
    if (!le) return;
    const scaledRadius = lotRadius(le.lot.distance_m);
    const [x, z] = bearingToXZ(le.lot.bearing_from_stadium_deg, scaledRadius);
    setFocusTarget([x, 0.15, z]);
  }, [focusLotOsmId, lots]);

  const selectedMatch = matches[matchIndex] ?? null;
  const hasMatches = matches.length > 0;

  // "Live mode": a selected event that's real and hasn't happened yet
  // (an upcoming NFL game, data/stadium_events.json) gets its weather
  // fetched live from NWS on demand, not baked into a static file --
  // see app/api/event-forecast. Past/played events keep using their
  // baked real_kickoff_wbgt_c/real_peak_wbgt_c instead.
  const [liveForecast, setLiveForecast] = useState<LiveForecast>(null);
  useEffect(() => {
    if (!selectedMatch?.is_future) {
      setLiveForecast(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/event-forecast?stadium=${stadium.id}&kickoff_utc_iso=${encodeURIComponent(selectedMatch.kickoff_utc_iso)}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setLiveForecast(d))
      .catch((e) => !cancelled && setLiveForecast({ error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [selectedMatch, stadium.id]);

  // Cars can be driven two ways, both kept: (1) the SAME hour scrubber
  // that drives the heat map/3D sun -- hoursFromKickoff is the signed
  // distance (shortest way around the 24h clock) between the
  // scrubber's current hour and this match's REAL kickoff hour (UTC,
  // matching how the scrubber's hour is defined everywhere else in the
  // app); or (2) the standalone slider below, for a quick before/after
  // preview without disturbing the heat map's hour. The slider always
  // starts synced to the scrubber and re-syncs whenever the scrubber
  // or the selected match changes; dragging it manually overrides that
  // sync until the next scrubber/match change.
  const scrubberHoursFromKickoff = useMemo(() => {
    if (!selectedMatch) return 0;
    const kickoffHour = new Date(selectedMatch.kickoff_utc_iso).getUTCHours();
    let diff = hour - kickoffHour;
    if (diff > 12) diff -= 24;
    if (diff < -12) diff += 24;
    return diff;
  }, [hour, selectedMatch]);

  // hoursFromKickoffOverride lives in the SHARED store (not local
  // state) specifically so StadiumPanel's parking numbers -- rendered
  // by a sibling component, not a child of this one -- agree with
  // whichever of the two controls actually moved. A real bug this
  // exact gap caused: dragging this slider changed the 3D cars but
  // left StadiumPanel showing a stale scrubber-derived figure.
  const hoursFromKickoff = hoursFromKickoffOverride ?? scrubberHoursFromKickoff;

  useEffect(() => {
    let cancelled = false;
    setHoveredLot(null);
    const occParam = matchMode && hasMatches ? `&hours_from_kickoff=${hoursFromKickoff}` : "";
    fetch(`/api/parking?stadium=${stadium.id}&month=${month}&hour=${hour}${occParam}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setLots(d.lots ?? []))
      .catch(() => !cancelled && setLots([]));
    return () => {
      cancelled = true;
    };
  }, [stadium.id, month, hour, matchMode, hasMatches, hoursFromKickoff]);

  // When a real match is selected (and "cars"/match-mode is on), drive
  // the sun physics from that match's REAL kickoff date, offset by the
  // hour scrubber's distance from the real kickoff hour -- so dragging
  // the SAME scrubber that fills the parking lot also moves the sun
  // realistically around that real day, instead of an approximation.
  // Falls back to the generic scrubber date otherwise.
  const effectiveDate = useMemo(() => {
    if (matchMode && selectedMatch) {
      return new Date(new Date(selectedMatch.kickoff_utc_iso).getTime() + hoursFromKickoff * 3600 * 1000);
    }
    // A representative date for the selected month -- the 15th, noon
    // UTC baseline then overridden to the scrubber's hour. Year choice
    // doesn't matter much for sun position (it repeats annually to
    // within fractions of a degree), 2026 chosen since that's the
    // tournament year.
    return new Date(Date.UTC(2026, month - 1, 15, hour, 0, 0));
  }, [matchMode, selectedMatch, hoursFromKickoff, month, hour]);

  const { sunDirection, altitudeDeg, azimuthDeg } = useMemo(() => {
    const date = effectiveDate;
    const pos = SunCalc.getPosition(date, stadium.lat, stadium.lon);
    // IMPORTANT, verified directly against this installed version's
    // source (node_modules/suncalc/index.js) rather than assumed from
    // memory: THIS version (2.0.2) returns azimuth/altitude already in
    // DEGREES, azimuth already north-based clockwise (0=N, 90=E,
    // 180=S, 270=W) -- not the older radians/south-based convention
    // some SunCalc docs/forks describe. Got a real bug from assuming
    // the old convention (altitude displayed as 2479.7 degrees) before
    // checking the actual source -- worth remembering if this
    // dependency is ever upgraded again.
    const azimuthDeg = pos.azimuth;
    const altitudeDeg = pos.altitude;
    const azRad = (azimuthDeg * Math.PI) / 180;
    const altRad = (altitudeDeg * Math.PI) / 180;
    const dir: [number, number, number] = [
      Math.sin(azRad) * Math.cos(altRad),
      Math.sin(altRad),
      -Math.cos(azRad) * Math.cos(altRad),
    ];
    return { sunDirection: dir, altitudeDeg, azimuthDeg };
  }, [stadium.lat, stadium.lon, effectiveDate]);

  const totalCarsNow = lots.reduce((sum, l) => sum + (l.occupancy?.estimated_cars_now ?? 0), 0);
  const totalSpaces = lots.reduce((sum, l) => sum + (l.occupancy?.estimated_spaces ?? 0), 0);
  const totalLotAreaM2 = lots.reduce((sum, l) => sum + l.lot.area_m2, 0);
  // Real street length, in real meters -- computed from each node's own
  // REAL {distance_m, bearing_deg} from the stadium (law of cosines on
  // two polar points sharing that origin), NOT from the compressed
  // scene-unit positions lotRadius() draws them at. Genuinely real,
  // independent of the visual compression used only for placement.
  const totalStreetLengthM = useMemo(() => {
    let total = 0;
    for (const seg of streets) {
      for (let i = 0; i < seg.points.length - 1; i++) {
        const a = seg.points[i];
        const b = seg.points[i + 1];
        const dTheta = ((b.bearing_deg - a.bearing_deg) * Math.PI) / 180;
        const d2 = a.distance_m ** 2 + b.distance_m ** 2 - 2 * a.distance_m * b.distance_m * Math.cos(dTheta);
        total += Math.sqrt(Math.max(0, d2));
      }
    }
    return total;
  }, [streets]);
  const groundRadius = LOT_RADIUS_MIN + LOT_RADIUS_SPAN + 12;
  const groundTexture = useMemo(() => {
    const t = getGroundTexture().clone();
    t.needsUpdate = true;
    t.repeat.set(groundRadius * 2.2, groundRadius * 2.2);
    return t;
  }, [groundRadius]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="relative flex-1 min-h-0">
        {/* Real bug from pushing the real lots out to lotRadius()'s new
            34-52 range (separating them from the stadium bowl, see
            that function's comment): the OLD default camera position
            was tuned for the OLD 15-23 range and sat almost inside the
            new, much farther-out lot ring -- rendering as a chaotic
            close-up jumble with no visible stadium shape. Pulled the
            camera back (and raised maxDistance to match) so the whole
            real complex -- stadium, plaza, streets, and every real lot
            -- fits in frame; scroll to zoom in for stall-level detail,
            or click a lot to fly right up to it. */}
        <Canvas shadows camera={{ position: [58, 46, 58], fov: 42 }}>
          <color attach="background" args={[altitudeToSkyColor(altitudeDeg)]} />
          <fog attach="fog" args={[altitudeToSkyColor(altitudeDeg), 60, 220]} />
          <ambientLight intensity={altitudeDeg > 0 ? 0.5 : 0.22} />
          <directionalLight
            position={[sunDirection[0] * 20, Math.max(sunDirection[1] * 20, 2), sunDirection[2] * 20]}
            intensity={altitudeDeg > 0 ? 1.3 : 0.25}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          {/* One continuous ground surface under the ENTIRE real
              complex -- stadium, plaza, streets, every real lot --
              instead of each piece sitting on its own disconnected
              patch. This was the core of the "scattered" complaint:
              lots floated as separate colored plates with nothing
              visually tying them to the stadium or to each other. Sits
              just below the stadium's own ground/plaza discs and each
              lot's own paved pad, so those still read as distinct
              surfaces layered on top of this one shared site. */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.09, 0]} receiveShadow>
            <circleGeometry args={[groundRadius, 64]} />
            <meshStandardMaterial map={groundTexture} color="#d8e0c0" roughness={1} />
          </mesh>
          <StadiumBowl
            stadium={stadium}
            sunDirection={sunDirection}
            altitudeDeg={altitudeDeg}
            roofMode={interventions?.greenRoof ? "green" : interventions?.coolRoof ? "cool" : null}
            onFocus={setFocusTarget}
          />
          <SunMarker direction={sunDirection} altitude={altitudeDeg} />
          {interventions?.showStreets && <Streets segments={streets} />}
          {interventions?.showStreetTrees && <StreetTrees segments={streets} />}
          <ParkingLots
            lots={lots}
            onHover={setHoveredLot}
            onFocus={setFocusTarget}
            showCars={matchMode && hasMatches}
            coolPavementCoverage={interventions?.coolPavementCoverage ?? 0}
            smartGrowthCoverage={interventions?.smartGrowthCoverage ?? 0}
          />
          <CameraFocus controlsRef={controlsRef} focusTarget={focusTarget} onArrived={() => setFocusTarget(null)} />
          {/* Google-Maps-style free movement: panning was OFF before
              (only rotate-around-a-fixed-point + zoom), which meant
              the only way to look elsewhere was to orbit around
              whatever the current target happened to be -- with no
              lot focused, that's the stadium's own center (0,0,0), so
              every drag just spun the whole real complex around the
              stadium instead of actually moving the view across it.
              Panning translates the camera+target together instead,
              the way dragging a real map does. Damping adds a touch
              of inertia so drags/zooms settle smoothly rather than
              stopping dead the instant the pointer lifts. */}
          <OrbitControls
            ref={controlsRef}
            enableZoom
            enablePan
            enableDamping
            dampingFactor={0.08}
            panSpeed={1.1}
            minDistance={2.5}
            maxDistance={170}
            zoomSpeed={0.9}
            onStart={() => setFocusTarget(null)}
          />
          {/* Real, achievable polish borrowed from studying dedicated
              3D-map renderers (streets.gl's real texture/material
              approach for ground and pavement -- see the ground/lot/
              street textures below for the bigger piece of that).
              Ambient occlusion (N8AO) gives the bowl decks and cars
              real contact shadow depth instead of flat-lit boxes;
              Bloom (high threshold, so only real emissive things --
              lit floodlights, the night scoreboard/videoboard, black-
              flag lots -- glow, not the daytime sky) adds the kind of
              light bleed a real camera sensor shows at night. */}
          <EffectComposer enableNormalPass>
            <N8AO intensity={2.2} aoRadius={2} distanceFalloff={1} quality="medium" />
            <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.25} intensity={0.55} mipmapBlur />
          </EffectComposer>
        </Canvas>

        <div className="absolute bottom-2 left-2 bg-black/70 text-zinc-100 font-mono text-[10px] leading-snug px-2.5 py-1.5 rounded border border-zinc-700">
          <div>SUN ALT {altitudeDeg.toFixed(1)}&deg; {altitudeDeg < 0 ? "(below horizon)" : ""} &middot; AZ {azimuthDeg.toFixed(0)}&deg;</div>
          <div className="text-zinc-500">
            Field orientation: {stadium.field_orientation_deg !== null ? `${stadium.field_orientation_deg}°` : "not yet verified (SEMI)"}
          </div>
        </div>

        {lots.length > 0 && (
          <div className="absolute top-2 left-2 bg-black/70 text-zinc-100 font-mono text-[10px] leading-snug px-2.5 py-1.5 rounded border border-zinc-700 max-w-[170px]">
            <div className="text-zinc-400 mb-1">REAL LOTS ({lots.length}) &mdash; hover a square</div>
            {hoveredLot ? (
              <>
                <div className="font-bold">{hoveredLot.lot.name}</div>
                <div>{hoveredLot.lot.distance_m}m &middot; {hoveredLot.walk_minutes} min walk</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    className="w-2 h-2 rounded-full border border-zinc-600 shrink-0"
                    style={{ background: hoveredLot.sports_flag ? FLAG_HEX[hoveredLot.sports_flag] : "#666" }}
                  />
                  <span>{hoveredLot.adjusted_wbgt_c !== null ? `${hoveredLot.adjusted_wbgt_c}°C` : "no data"}</span>
                </div>
                {hoveredLot.occupancy && (
                  <div className="mt-0.5">
                    {hoveredLot.occupancy.estimated_cars_now}/{hoveredLot.occupancy.estimated_spaces} spaces (
                    {Math.round(hoveredLot.occupancy.occupancy_fraction * 100)}%)
                    <span className="text-zinc-600">
                      {" "}
                      &mdash; {hoveredLot.occupancy.capacity_method === "real-layout" ? "real stall layout" : "area estimate"}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-zinc-600">Real OSM geometry, real bearing/distance (compressed, not to scale).</div>
            )}
          </div>
        )}

        {hasMatches && totalSpaces > 0 && (
          <div className="absolute top-2 right-2 bg-black/70 text-zinc-100 font-mono text-[10px] px-2.5 py-1.5 rounded border border-zinc-700">
            <div className="font-bold">
              {totalCarsNow.toLocaleString()} / {totalSpaces.toLocaleString()} spaces est.
            </div>
            <div className="text-zinc-500">across all real lots</div>
          </div>
        )}

        {/* Real aggregate stats -- every number here is a real sum over
            this stadium's own real lot/street data, not a decorative
            readout. Paved area from real OSM lot polygons
            (scripts/fetch_parking_lots.py); street length computed from
            each real node's own real distance/bearing from the
            stadium, independent of the compressed scene placement. */}
        {(totalLotAreaM2 > 0 || totalStreetLengthM > 0) && (
          <div
            className={`absolute ${hasMatches && totalSpaces > 0 ? "top-14" : "top-2"} right-2 bg-black/70 text-zinc-100 font-mono text-[10px] leading-snug px-2.5 py-1.5 rounded border border-zinc-700`}
          >
            <div className="text-zinc-500 mb-0.5">REAL AGGREGATE STATS</div>
            {totalLotAreaM2 > 0 && (
              <div>
                Paved lots: {(totalLotAreaM2 / 10000).toFixed(1)} ha ({lots.length} real lots)
              </div>
            )}
            {totalStreetLengthM > 0 && <div>Streets shown: {(totalStreetLengthM / 1000).toFixed(1)} km</div>}
          </div>
        )}
      </div>

      {hasMatches && (
        <div className="shrink-0 border-t border-zinc-800 bg-black font-mono text-[10px] px-2.5 py-1.5 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <select
              value={matchIndex}
              onChange={(e) => setMatchIndex(Number(e.target.value))}
              className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-zinc-100"
            >
              {matches.map((m, i) => (
                <option key={i} value={i}>
                  {m.is_future ? "● UPCOMING · " : m.stage === "nfl" ? "NFL · " : "WC26 · "}
                  {m.kickoff_utc_iso.slice(0, 10)} &middot; {m.matchup_raw.replace(/\s+/g, " ").slice(0, 24)}
                  {m.real_peak_wbgt_c != null ? ` (${m.real_peak_wbgt_c}°C)` : ""}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 cursor-pointer text-zinc-400 shrink-0">
              <input type="checkbox" checked={matchMode} onChange={(e) => setMatchMode(e.target.checked)} />
              cars
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 shrink-0 w-28">
              {hoursFromKickoff === 0 ? "at kickoff" : `${Math.abs(hoursFromKickoff)}h ${hoursFromKickoff < 0 ? "before" : "after"}`}
            </span>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={hoursFromKickoff}
              onChange={(e) => setHoursFromKickoffOverride(Number(e.target.value))}
              disabled={!matchMode}
              className="flex-1"
            />
            {selectedMatch && (
              <span className="text-zinc-600 shrink-0">
                real kickoff {String(new Date(selectedMatch.kickoff_utc_iso).getUTCHours()).padStart(2, "0")}:00 UTC
              </span>
            )}
          </div>
          <div className="text-zinc-600 text-[9px] leading-tight">
            Drag for a quick preview, or use the HOUR scrubber below to move sun/heat too (re-syncs this slider).
          </div>
          {selectedMatch && selectedMatch.real_kickoff_wbgt_c != null && (
            <div className="text-zinc-400 text-[9px] leading-tight">
              REAL weather that day: {selectedMatch.real_kickoff_wbgt_c}&deg;C at kickoff, peaked{" "}
              <span className="text-zinc-100 font-bold">{selectedMatch.real_peak_wbgt_c}&deg;C</span> (Mesonet ASOS).
            </div>
          )}
          {selectedMatch?.is_future && (
            <div className="text-zinc-400 text-[9px] leading-tight">
              {liveForecast === null && "loading live forecast…"}
              {liveForecast && "error" in liveForecast && <span className="text-zinc-600">{liveForecast.error}</span>}
              {liveForecast && "wbgt_c" in liveForecast && (
                <>
                  LIVE forecast: <span className="text-zinc-100 font-bold">{liveForecast.wbgt_c}&deg;C</span> WBGT ({liveForecast.sports_flag}{" "}
                  flag) &mdash; api.weather.gov, not stored.
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
