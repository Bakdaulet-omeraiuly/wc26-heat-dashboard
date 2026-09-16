"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as SunCalc from "suncalc";
import { useHeatDashboardStore } from "@/lib/store";

type Occupancy = {
  estimated_spaces: number;
  occupancy_fraction: number;
  estimated_cars_now: number;
};

type LotExposure = {
  lot: {
    osm_id: number;
    name: string;
    name_status: "REAL" | "UNNAMED";
    area_m2: number;
    distance_m: number;
    bearing_from_stadium_deg: number;
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
};

const MAX_RENDERED_CARS_PER_LOT = 9; // rendering cap for perf/legibility -- the real estimated_cars_now count is shown as text regardless

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

/** One schematic car: a low body + a smaller raised cabin, so it
 * reads as "a car" from the default camera angle rather than a plain
 * box -- a deliberate small step up in realism per this session's
 * "паркингтің 3D моделін ... реалистично" request, while staying well
 * short of a literal car model (out of scope for the time available). */
function Car({ position, color, rotationY }: { position: [number, number, number]; color: string; rotationY: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.12, 0]} castShadow>
        <boxGeometry args={[0.58, 0.22, 0.28]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[-0.04, 0.27, 0]} castShadow>
        <boxGeometry args={[0.3, 0.16, 0.24]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}

const CAR_COLORS = ["#c0c0c0", "#8a8a8a", "#2a3a55", "#6b1f1f", "#e8e2d0", "#1a1a1a"]; // a plain plausible parking-lot color mix, not data-driven

function ParkingLots({
  lots,
  onHover,
  showCars,
}: {
  lots: LotExposure[];
  onHover: (l: LotExposure | null) => void;
  showCars: boolean;
}) {
  const cars = useMemo(() => {
    if (!showCars) return [];
    const items: { position: [number, number, number]; color: string; rotationY: number; key: string }[] = [];
    for (const le of lots) {
      if (!le.occupancy || le.occupancy.estimated_cars_now <= 0) continue;
      const scaledRadius = 15 + (Math.min(le.lot.distance_m, 1200) / 1200) * 8;
      const [cx, cz] = bearingToXZ(le.lot.bearing_from_stadium_deg, scaledRadius);
      const footprint = Math.min(3.2, Math.max(0.6, Math.sqrt(le.lot.area_m2) / 15));
      const count = Math.min(MAX_RENDERED_CARS_PER_LOT, le.occupancy.estimated_cars_now);
      const cols = Math.ceil(Math.sqrt(count));
      const spacing = Math.max(0.5, Math.min(0.75, (footprint * 0.9) / Math.max(1, cols)));
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const offsetX = (col - (cols - 1) / 2) * spacing;
        const offsetZ = (row - (cols - 1) / 2) * spacing;
        items.push({
          key: `${le.lot.osm_id}-${i}`,
          position: [cx + offsetX, 0.02, cz + offsetZ],
          color: CAR_COLORS[(le.lot.osm_id + i) % CAR_COLORS.length],
          rotationY: ((le.lot.osm_id % 4) * Math.PI) / 2,
        });
      }
    }
    return items;
  }, [lots, showCars]);

  return (
    <group>
      {lots.map((le) => {
        const scaledRadius = 15 + (Math.min(le.lot.distance_m, 1200) / 1200) * 8;
        const [x, z] = bearingToXZ(le.lot.bearing_from_stadium_deg, scaledRadius);
        const size = Math.min(3.2, Math.max(0.6, Math.sqrt(le.lot.area_m2) / 15));
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
            position={[x, 0.05, z]}
            onPointerOver={(e) => {
              e.stopPropagation();
              onHover(le);
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              onHover(null);
            }}
          >
            <boxGeometry args={[size, isBlackFlag ? 0.4 : 0.15, size]} />
            <meshStandardMaterial
              color={isBlackFlag ? "#3a0a0a" : color}
              emissive={isBlackFlag ? "#ff2222" : "#000000"}
              emissiveIntensity={isBlackFlag ? 0.7 : 0}
              transparent
              opacity={showCars ? 0.55 : 1}
            />
          </mesh>
        );
      })}
      {cars.map((c) => (
        <Car key={c.key} position={c.position} color={c.color} rotationY={c.rotationY} />
      ))}
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
  const [hoursFromKickoff, setHoursFromKickoff] = useState(0);
  const [matchMode, setMatchMode] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setMatchIdx(0);
    setHoursFromKickoff(0);
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

  const { sunDirection, altitudeDeg, azimuthDeg } = useMemo(() => {
    // A representative date for the selected month -- the 15th, noon
    // UTC baseline then overridden to the scrubber's hour. Year choice
    // doesn't matter much for sun position (it repeats annually to
    // within fractions of a degree), 2026 chosen since that's the
    // tournament year.
    const date = new Date(Date.UTC(2026, month - 1, 15, hour, 0, 0));
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
  }, [stadium.lat, stadium.lon, month, hour]);

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
          <ParkingLots lots={lots} onHover={setHoveredLot} showCars={matchMode && hasMatches} />
          <OrbitControls />
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
              {hoursFromKickoff <= 0 ? `${-hoursFromKickoff}h before` : `${hoursFromKickoff}h after`} kickoff
            </span>
            <input
              type="range"
              min={-3}
              max={4}
              step={0.5}
              value={hoursFromKickoff}
              onChange={(e) => setHoursFromKickoff(Number(e.target.value))}
              disabled={!matchMode}
              className="flex-1"
            />
            {selectedMatch && (
              <span className="text-zinc-600 shrink-0">
                real kickoff {selectedMatch.local_kickoff} UTC{selectedMatch.utc_offset}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
