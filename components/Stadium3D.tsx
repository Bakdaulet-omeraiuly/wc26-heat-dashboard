"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Instances, Instance } from "@react-three/drei";
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

    const camPos = controls.object.position as THREE.Vector3;
    const desiredCamPos = new THREE.Vector3(tx + 4.5, ty + 4, tz + 4.5);
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
const SCENE_SCALE_M = 45;
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
 * Distance is compressed into a fixed visual range (15-35 scene
 * units); this is schematic, not to scale -- same honesty convention
 * as the stand bowl itself (see the file's top comment). */
function bearingToXZ(bearingDeg: number, radius: number): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  return [Math.sin(rad) * radius, -Math.cos(rad) * radius];
}

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

// Real-dimension footprint: use the lot's real oriented length/width
// (scripts/fetch_parking_lots.py's oriented_dimensions()) so the
// ground marker's proportions and rotation match the real rectangle,
// not a generic square -- falls back to a sqrt(area) square for the
// rare lot fetched before that field existed.
function footprintFor(lot: LotExposure["lot"]): { lengthScene: number; widthScene: number; rotationRad: number } {
  if (lot.length_m && lot.width_m) {
    return {
      lengthScene: Math.min(4.5, Math.max(0.8, lot.length_m / SCENE_SCALE_M)),
      widthScene: Math.min(3, Math.max(0.5, lot.width_m / SCENE_SCALE_M)),
      rotationRad: ((lot.lot_orientation_deg ?? 0) * Math.PI) / 180,
    };
  }
  const square = Math.min(3.2, Math.max(0.6, Math.sqrt(lot.area_m2) / 15));
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
  const renderTotal = Math.min(totalReal, PER_LOT_STALL_RENDER_CAP);
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
      rotationY: rotationRad + (bandParity === 0 ? 0 : Math.PI),
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
      const scaledRadius = 15 + (Math.min(le.lot.distance_m, 1200) / 1200) * 8;
      const [cx, cz] = bearingToXZ(le.lot.bearing_from_stadium_deg, scaledRadius);
      items.push(...realCarsForLot(le, cx, cz));
    }
    return items;
  }, [lots, showCars]);

  return (
    <group>
      {lots.map((le) => {
        const scaledRadius = 15 + (Math.min(le.lot.distance_m, 1200) / 1200) * 8;
        const [x, z] = bearingToXZ(le.lot.bearing_from_stadium_deg, scaledRadius);
        const { lengthScene, widthScene, rotationRad } = footprintFor(le.lot);
        const color = le.sports_flag ? FLAG_HEX[le.sports_flag] : "#555555";
        // "Black" flag (#1a1a1a) is real-but-invisible against this
        // scene's dark background -- same problem hit in
        // ForecastSidebar's bar chart. Give it an emissive red glow
        // instead of relying on the literal near-black fill, so the
        // highest-risk lots read as alarming rather than disappearing.
        const isBlackFlag = le.sports_flag === "black";
        return (
          <mesh
            key={le.lot.osm_id}
            position={[x, 0.03, z]}
            rotation={[0, rotationRad, 0]}
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
            <boxGeometry args={[lengthScene, isBlackFlag ? 0.35 : 0.1, widthScene]} />
            <meshStandardMaterial
              color={isBlackFlag ? "#3a0a0a" : color}
              emissive={isBlackFlag ? "#ff2222" : "#000000"}
              emissiveIntensity={isBlackFlag ? 0.6 : 0}
              transparent
              opacity={showCars ? 0.45 : 1}
            />
          </mesh>
        );
      })}

      {/* Illustrative coverage overlays -- see the props' docstring. A
          higher coverage fraction reads as more opaque, not a bigger
          footprint (the real capacity trade-off for smart growth is a
          text figure in Urban Lab, computed exactly per lot). */}
      {(coolPavementCoverage > 0 || smartGrowthCoverage > 0) &&
        lots.map((le) => {
          const scaledRadius = 15 + (Math.min(le.lot.distance_m, 1200) / 1200) * 8;
          const [x, z] = bearingToXZ(le.lot.bearing_from_stadium_deg, scaledRadius);
          const { lengthScene, widthScene, rotationRad } = footprintFor(le.lot);
          return (
            <group key={`overlay-${le.lot.osm_id}`}>
              {coolPavementCoverage > 0 && (
                <mesh position={[x, 0.06, z]} rotation={[0, rotationRad, 0]}>
                  <boxGeometry args={[lengthScene, 0.02, widthScene]} />
                  <meshStandardMaterial color="#f4f4f4" transparent opacity={coolPavementCoverage * 0.7} />
                </mesh>
              )}
              {smartGrowthCoverage > 0 && (
                <mesh position={[x, 0.07, z]} rotation={[0, rotationRad, 0]}>
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
const ROAD_WIDTH: Record<string, number> = {
  motorway: 0.55,
  trunk: 0.45,
  primary: 0.38,
  secondary: 0.3,
  tertiary: 0.24,
  residential: 0.16,
  unclassified: 0.13,
};

type RoadQuad = { x: number; z: number; length: number; rotationY: number; width: number };

/** Real OSM street centerlines (scripts/fetch_streets.py), placed with
 * the exact same bearingToXZ() schematic transform as parking lots --
 * real compass bearing, compressed-not-to-scale radius -- so streets
 * line up visually with the lots they actually serve. Rendered as flat
 * paved ribbons (one quad per real consecutive node pair, width keyed
 * to real OSM highway classification) instead of a thin wireframe
 * line, plus a center-line stripe on the two largest real road
 * classes -- a real, if schematic, "this is pavement" look rather
 * than a debug overlay. */
function Streets({ segments }: { segments: StreetSegment[] }) {
  const quads = useMemo(() => {
    const items: (RoadQuad & { highway: string })[] = [];
    for (const seg of segments) {
      const width = ROAD_WIDTH[seg.highway ?? "unclassified"] ?? 0.13;
      for (let i = 0; i < seg.points.length - 1; i++) {
        const a = seg.points[i];
        const b = seg.points[i + 1];
        const ra = 15 + (Math.min(a.distance_m, 1200) / 1200) * 8;
        const rb = 15 + (Math.min(b.distance_m, 1200) / 1200) * 8;
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

  const majorQuads = quads.filter((q) => q.highway === "motorway" || q.highway === "trunk" || q.highway === "primary");

  return (
    <group>
      {quads.map((q, i) => (
        <mesh key={i} position={[q.x, 0.015, q.z]} rotation={[-Math.PI / 2, 0, q.rotationY]}>
          <planeGeometry args={[q.width, q.length]} />
          <meshStandardMaterial color="#4a4a52" roughness={0.9} />
        </mesh>
      ))}
      {/* Center-line stripes, major roads only -- a cheap real detail
          that reads as "this is a real road", not decoration. */}
      {majorQuads.map((q, i) => (
        <mesh key={`c${i}`} position={[q.x, 0.017, q.z]} rotation={[-Math.PI / 2, 0, q.rotationY]}>
          <planeGeometry args={[0.02, q.length * 0.9]} />
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
        const ra = 15 + (Math.min(a.distance_m, 1200) / 1200) * 8;
        const rb = 15 + (Math.min(b.distance_m, 1200) / 1200) * 8;
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
}) {
  // Real NFL field proportions: 120yd x 53.33yd (incl. end zones) --
  // ratio ~2.25:1, not the old placeholder 14:9 (~1.56:1). Scene units
  // keep the same rough footprint size as before, just corrected shape.
  const FIELD_LEN = 16;
  const FIELD_WID = 7.1;

  const lowerBowl = useMemo(() => {
    const segments = 28;
    const items = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      items.push({ angle, x: Math.cos(angle) * (FIELD_LEN * 0.95), z: Math.sin(angle) * (FIELD_WID * 1.55) });
    }
    return items;
  }, []);
  const upperBowl = useMemo(() => {
    const segments = 28;
    const items = [];
    for (let i = 0; i < segments; i++) {
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

  return (
    <group>
      {/* Paved concourse ground -- everything else used to float over
          nothing. Subtle asphalt tone, distinct from the parking lots'
          own (brighter/flag-colored) ground markers further out. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
        <circleGeometry args={[FIELD_LEN * 2.6, 48]} />
        <meshStandardMaterial color="#26262b" roughness={0.95} />
      </mesh>

      {/* Field + yard markings -- rotated to this stadium's own REAL
          measured compass field orientation (see this file's own
          field-orientation research), not left at a fixed scene angle. */}
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
    const scaledRadius = 15 + (Math.min(le.lot.distance_m, 1200) / 1200) * 8;
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

  return (
    <div className="w-full h-full flex flex-col">
      <div className="relative flex-1 min-h-0">
        <Canvas shadows camera={{ position: [24, 19, 24], fov: 42 }}>
          <color attach="background" args={[altitudeToSkyColor(altitudeDeg)]} />
          <fog attach="fog" args={[altitudeToSkyColor(altitudeDeg), 45, 130]} />
          <ambientLight intensity={altitudeDeg > 0 ? 0.5 : 0.22} />
          <directionalLight
            position={[sunDirection[0] * 20, Math.max(sunDirection[1] * 20, 2), sunDirection[2] * 20]}
            intensity={altitudeDeg > 0 ? 1.3 : 0.25}
            castShadow
            shadow-mapSize={[1024, 1024]}
          />
          <StadiumBowl
            stadium={stadium}
            sunDirection={sunDirection}
            altitudeDeg={altitudeDeg}
            roofMode={interventions?.greenRoof ? "green" : interventions?.coolRoof ? "cool" : null}
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
          <OrbitControls
            ref={controlsRef}
            enableZoom
            enablePan={false}
            minDistance={2.5}
            maxDistance={70}
            zoomSpeed={0.9}
            onStart={() => setFocusTarget(null)}
          />
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
          <div className="text-zinc-600 leading-snug">
            Drag this slider for a quick preview, or the HOUR scrubber (Map+3D view, bottom) to move the
            whole scene's sun/heat too &mdash; the scrubber re-syncs this slider each time it moves.
          </div>
          {selectedMatch && selectedMatch.real_kickoff_wbgt_c != null && (
            <div className="text-zinc-400">
              REAL weather that day: {selectedMatch.real_kickoff_wbgt_c}&deg;C at kickoff, peaked{" "}
              <span className="text-zinc-100 font-bold">{selectedMatch.real_peak_wbgt_c}&deg;C</span> during play
              &mdash; not climatology, what actually happened (Mesonet ASOS, same station).
            </div>
          )}
          {selectedMatch?.is_future && (
            <div className="text-zinc-400">
              {liveForecast === null && "loading live forecast…"}
              {liveForecast && "error" in liveForecast && <span className="text-zinc-600">{liveForecast.error}</span>}
              {liveForecast && "wbgt_c" in liveForecast && (
                <>
                  LIVE forecast for this real upcoming game:{" "}
                  <span className="text-zinc-100 font-bold">{liveForecast.wbgt_c}&deg;C</span> WBGT ({liveForecast.sports_flag}{" "}
                  flag) &mdash; fetched live from api.weather.gov, not a stored value.
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
