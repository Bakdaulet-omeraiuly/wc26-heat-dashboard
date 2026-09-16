"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Instances, Instance } from "@react-three/drei";
import * as THREE from "three";
import * as SunCalc from "suncalc";
import { useHeatDashboardStore } from "@/lib/store";
import { stallPositions, STALL_WIDTH_M, STALL_DEPTH_M, type RealParkingLayout } from "@/lib/parkingLayout";

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
  matchup_raw: string;
  real_kickoff_wbgt_c?: number | null;
  real_peak_wbgt_c?: number | null;
};

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
    const localX = (p.along_m - lengthM / 2) / SCENE_SCALE_M;
    const localZ = (p.across_m - widthM / 2) / SCENE_SCALE_M;
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
}: {
  lots: LotExposure[];
  onHover: (l: LotExposure | null) => void;
  onFocus: (position: [number, number, number]) => void;
  showCars: boolean;
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

type StadiumInfo = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  roof_type: string;
  field_orientation_deg: number | null;
};

/** A simplified parametric stadium bowl -- NOT a photorealistic replica
 * of any specific venue (see spec.md Section 6 for why: 11 accurate
 * models isn't realistic in the time available, and it would distract
 * from the actual point, which is the real sun-position physics, not
 * architectural detail). One oval ring of "stands" + a flat pitch,
 * reused for every stadium, individually lit by each stadium's own
 * real lat/lon + the scrubber's real month/hour via SunCalc. */
function StadiumBowl({ stadium, sunDirection }: { stadium: StadiumInfo; sunDirection: [number, number, number] }) {
  const standSegments = useMemo(() => {
    const segments = 24;
    const items = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = Math.cos(angle) * 12;
      const z = Math.sin(angle) * 8;
      items.push({ angle, x, z });
    }
    return items;
  }, []);

  return (
    <group>
      {/* Field */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 9]} />
        <meshStandardMaterial color="#2d5a2d" />
      </mesh>

      {/* Stand segments -- each one's own material darkens if it's on
          the shaded side, computed from the real sun direction, not a
          decorative gradient. */}
      {standSegments.map((seg, i) => {
        const segNormal = [Math.cos(seg.angle), 0, Math.sin(seg.angle)];
        const dot = segNormal[0] * sunDirection[0] + segNormal[2] * sunDirection[2];
        const sunlit = dot > 0.15;
        return (
          <mesh key={i} position={[seg.x, 1.5, seg.z]} castShadow receiveShadow>
            <boxGeometry args={[1.6, 3, 1.6]} />
            <meshStandardMaterial
              color={sunlit ? "#d9c896" : "#4a5568"}
              emissive={sunlit ? "#3a3010" : "#000000"}
              emissiveIntensity={sunlit ? 0.15 : 0}
            />
          </mesh>
        );
      })}

      {/* Roof, for retractable/canopy venues -- a plain visual cue, not
          load-bearing to the sun computation itself. */}
      {stadium.roof_type !== "open" && (
        <mesh position={[0, 6, 0]}>
          <torusGeometry args={[13, 0.3, 8, 24]} />
          <meshStandardMaterial color="#888888" transparent opacity={0.4} />
        </mesh>
      )}
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

export default function Stadium3D({ stadium }: { stadium: StadiumInfo }) {
  const { month, hour } = useHeatDashboardStore();
  const [lots, setLots] = useState<LotExposure[]>([]);
  const [hoveredLot, setHoveredLot] = useState<LotExposure | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchIdx, setMatchIdx] = useState(0);
  const [matchMode, setMatchMode] = useState(true);
  const controlsRef = useRef<any>(null);
  const [focusTarget, setFocusTarget] = useState<[number, number, number] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMatchIdx(0);
    fetch(`/api/matches?stadium=${stadium.id}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setMatches(d.matches ?? []))
      .catch(() => !cancelled && setMatches([]));
    return () => {
      cancelled = true;
    };
  }, [stadium.id]);

  const selectedMatch = matches[matchIdx] ?? null;
  const hasMatches = matches.length > 0;

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

  const [hoursFromKickoff, setHoursFromKickoff] = useState(0);
  useEffect(() => {
    setHoursFromKickoff(scrubberHoursFromKickoff);
  }, [scrubberHoursFromKickoff]);

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
        <Canvas shadows camera={{ position: [27, 23, 27], fov: 45 }}>
          <ambientLight intensity={altitudeDeg > 0 ? 0.45 : 0.15} />
          <directionalLight
            position={[sunDirection[0] * 20, Math.max(sunDirection[1] * 20, 2), sunDirection[2] * 20]}
            intensity={altitudeDeg > 0 ? 1.2 : 0.2}
            castShadow
          />
          <StadiumBowl stadium={stadium} sunDirection={sunDirection} />
          <SunMarker direction={sunDirection} altitude={altitudeDeg} />
          <ParkingLots lots={lots} onHover={setHoveredLot} onFocus={setFocusTarget} showCars={matchMode && hasMatches} />
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
              value={matchIdx}
              onChange={(e) => setMatchIdx(Number(e.target.value))}
              className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-zinc-100"
            >
              {matches.map((m, i) => (
                <option key={i} value={i}>
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
              onChange={(e) => setHoursFromKickoff(Number(e.target.value))}
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
        </div>
      )}
    </div>
  );
}
