"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as SunCalc from "suncalc";
import { useHeatDashboardStore } from "@/lib/store";

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
};

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

function ParkingLots({ lots, onHover }: { lots: LotExposure[]; onHover: (l: LotExposure | null) => void }) {
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
            />
          </mesh>
        );
      })}
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

  useEffect(() => {
    let cancelled = false;
    setHoveredLot(null);
    fetch(`/api/parking?stadium=${stadium.id}&month=${month}&hour=${hour}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setLots(d.lots ?? []))
      .catch(() => !cancelled && setLots([]));
    return () => {
      cancelled = true;
    };
  }, [stadium.id, month, hour]);

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

  return (
    <div className="w-full h-full relative">
      <Canvas shadows camera={{ position: [27, 23, 27], fov: 45 }}>
        <ambientLight intensity={altitudeDeg > 0 ? 0.45 : 0.15} />
        <directionalLight
          position={[sunDirection[0] * 20, Math.max(sunDirection[1] * 20, 2), sunDirection[2] * 20]}
          intensity={altitudeDeg > 0 ? 1.2 : 0.2}
          castShadow
        />
        <StadiumBowl stadium={stadium} sunDirection={sunDirection} />
        <SunMarker direction={sunDirection} altitude={altitudeDeg} />
        <ParkingLots lots={lots} onHover={setHoveredLot} />
        <OrbitControls />
      </Canvas>

      <div className="absolute bottom-2 left-2 bg-black/70 text-zinc-100 font-mono text-xs px-3 py-2 rounded border border-zinc-700">
        <div>SUN ALTITUDE: {altitudeDeg.toFixed(1)}&deg; {altitudeDeg < 0 ? "(below horizon)" : ""}</div>
        <div>SUN AZIMUTH: {azimuthDeg.toFixed(0)}&deg; (0=N, 90=E, 180=S, 270=W)</div>
        <div className="text-zinc-500 mt-1">
          Field orientation: {stadium.field_orientation_deg !== null ? `${stadium.field_orientation_deg}°` : "not yet verified (SEMI, see spec.md)"}
        </div>
      </div>

      {lots.length > 0 && (
        <div className="absolute top-2 left-2 bg-black/70 text-zinc-100 font-mono text-[10px] leading-snug px-2.5 py-1.5 rounded border border-zinc-700 max-w-[180px]">
          <div className="text-zinc-400 mb-1">
            REAL PARKING LOTS ({lots.length}) &mdash; hover a square
          </div>
          {hoveredLot ? (
            <>
              <div className="font-bold">{hoveredLot.lot.name}</div>
              <div>{hoveredLot.lot.distance_m}m away &middot; {hoveredLot.walk_minutes} min walk</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className="w-2 h-2 rounded-full border border-zinc-600"
                  style={{ background: hoveredLot.sports_flag ? FLAG_HEX[hoveredLot.sports_flag] : "#666" }}
                />
                <span>
                  {hoveredLot.adjusted_wbgt_c !== null ? `${hoveredLot.adjusted_wbgt_c}°C walk-in WBGT` : "no data"}
                </span>
              </div>
              <div className="text-zinc-600 mt-1 leading-snug">
                SEMI: real distance + real WBGT + modeled pavement-sun surcharge
              </div>
            </>
          ) : (
            <div className="text-zinc-600 leading-snug">
              Real OSM lot geometry, placed by real compass bearing &amp; distance (compressed for
              visualization, not to scale).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
