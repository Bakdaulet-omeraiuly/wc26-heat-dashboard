"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Instances, Instance } from "@react-three/drei";
import { useHeatDashboardStore } from "@/lib/store";
import { stallPositions, type RealParkingLayout } from "@/lib/parkingLayout";

/**
 * "Urban Lab" -- two real what-if scenarios on one real parking lot,
 * backed by /api/urban-lab (see that route's docstring for the exact
 * cited research and standards). Both scenarios stay clearly SEMI/MOCK
 * -tagged: real lot geometry and real climatology feed a modeled shade
 * effect and a real capacity-standard calculation, never a claim about
 * what these specific lots actually look like today.
 */

const SCALE = 0.045; // meters -> scene units, tuned so a ~300m lot fills the small canvas

type LotOption = { osm_id: number; name: string; area_m2: number; has_dimensions: boolean };
type TreeShade = {
  lot: { name: string; area_m2: number; length_m?: number; width_m?: number };
  tree_count: number;
  shaded_fraction: number;
  temp_reduction_c: number;
  base_wbgt_c: number | null;
  shaded_wbgt_c: number | null;
  max_useful_trees: number;
};
type AngleComparison = {
  length_m: number;
  width_m: number;
  by_angle: Record<"90" | "60" | "45", RealParkingLayout>;
  best_angle: 90 | 60 | 45;
  best_total: number;
  current_total: number;
  gain_vs_90: number;
};
type LabResponse = {
  lots: LotOption[];
  selected_osm_id: number;
  tree_shade: TreeShade;
  angle_comparison: AngleComparison | null;
};

function flagColor(wbgt: number | null): string {
  if (wbgt === null) return "#71717a";
  if (wbgt < 27.8) return "#22c55e";
  if (wbgt < 29.4) return "#eab308";
  if (wbgt < 31.7) return "#f97316";
  return "#ef4444";
}

/** Deterministic pseudo-random grid placement within a length x width
 * footprint -- for illustrating shade coverage, not real tree survey
 * positions (there is no such survey; OSM doesn't carry tree data). */
function treePositions(count: number, lengthScene: number, widthScene: number): [number, number][] {
  const cols = Math.max(1, Math.ceil(Math.sqrt((count * lengthScene) / widthScene)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const positions: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const jitterX = ((i * 37) % 11) / 11 - 0.5;
    const jitterZ = ((i * 53) % 7) / 7 - 0.5;
    const x = (((c + 0.5) / cols) - 0.5) * lengthScene + jitterX * (lengthScene / cols) * 0.3;
    const z = (((r + 0.5) / rows) - 0.5) * widthScene + jitterZ * (widthScene / rows) * 0.3;
    positions.push([x, z]);
  }
  return positions;
}

function TreeShadeScene({ lengthM, widthM, treeCount }: { lengthM: number; widthM: number; treeCount: number }) {
  const lengthScene = Math.min(6, lengthM * SCALE);
  const widthScene = Math.min(4.5, widthM * SCALE);
  const renderedTrees = Math.min(treeCount, 400); // render cap, same reasoning as Stadium3D's PER_LOT_STALL_RENDER_CAP -- keeps the frame smooth
  const trees = useMemo(() => treePositions(renderedTrees, lengthScene, widthScene), [renderedTrees, lengthScene, widthScene]);
  // A fixed illustrative parked-car pattern (not tied to real occupancy -- this scene is about shade, not fill level)
  const cars = useMemo(() => {
    const spots: [number, number][] = [];
    const cols = 10;
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        spots.push([(((c + 0.5) / cols) - 0.5) * lengthScene, (((r + 0.5) / rows) - 0.5) * widthScene * 0.9]);
      }
    }
    return spots;
  }, [lengthScene, widthScene]);

  return (
    <Canvas camera={{ position: [lengthScene * 0.9, lengthScene * 0.75, widthScene * 1.3], fov: 45 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 3]} intensity={1.1} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[lengthScene, widthScene]} />
        <meshStandardMaterial color="#3f3f46" />
      </mesh>
      <Instances limit={200}>
        <boxGeometry args={[0.22, 0.09, 0.11]} />
        <meshStandardMaterial color="#a1a1aa" />
        {cars.map(([x, z], i) => (
          <Instance key={i} position={[x, 0.045, z]} />
        ))}
      </Instances>
      {trees.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[0.02, 0.03, 0.16, 6]} />
            <meshStandardMaterial color="#5c4322" />
          </mesh>
          <mesh position={[0, 0.24, 0]}>
            <sphereGeometry args={[0.16, 8, 8]} />
            <meshStandardMaterial color="#3f8f3f" />
          </mesh>
        </group>
      ))}
      <OrbitControls enablePan={false} minDistance={2} maxDistance={20} />
    </Canvas>
  );
}

function AngledLayoutScene({ layout, lengthM, widthM }: { layout: RealParkingLayout; lengthM: number; widthM: number }) {
  const lengthScene = Math.min(6, lengthM * SCALE);
  const widthScene = Math.min(4.5, widthM * SCALE);
  const positions = useMemo(() => {
    const stalls = stallPositions(layout, 600);
    return stalls.map((p) => [
      (p.along_m / layout.length_m - 0.5) * lengthScene,
      (p.across_m / layout.width_m - 0.5) * widthScene,
    ]) as [number, number][];
  }, [layout, lengthScene, widthScene]);

  return (
    <Canvas camera={{ position: [lengthScene * 0.9, lengthScene * 0.9, widthScene * 1.4], fov: 45 }}>
      <ambientLight intensity={0.75} />
      <directionalLight position={[5, 8, 3]} intensity={1.1} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[lengthScene, widthScene]} />
        <meshStandardMaterial color="#3f3f46" />
      </mesh>
      <Instances limit={2000}>
        <boxGeometry args={[0.18, 0.08, 0.09]} />
        <meshStandardMaterial color="#60a5fa" />
        {positions.map(([x, z], i) => (
          <Instance key={i} position={[x, 0.04, z]} />
        ))}
      </Instances>
      <OrbitControls enablePan={false} minDistance={2} maxDistance={20} />
    </Canvas>
  );
}

export default function UrbanLab() {
  const storeStadiumId = useHeatDashboardStore((s) => s.selectedStadiumId);
  const month = useHeatDashboardStore((s) => s.month);
  const hour = useHeatDashboardStore((s) => s.hour);

  const [stadiums, setStadiums] = useState<{ id: string; name: string }[]>([]);
  const [stadiumId, setStadiumId] = useState<string | null>(storeStadiumId);
  const [treeCount, setTreeCount] = useState(20);
  const [angle, setAngle] = useState<"90" | "60" | "45">("90");
  const [data, setData] = useState<LabResponse | null>(null);
  const [osmId, setOsmId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/stadiums")
      .then((r) => r.json())
      .then((d) => setStadiums(d.stadiums.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }))));
  }, []);

  useEffect(() => {
    if (storeStadiumId && !stadiumId) setStadiumId(storeStadiumId);
  }, [storeStadiumId, stadiumId]);

  const activeStadium = stadiumId ?? stadiums[0]?.id ?? null;

  useEffect(() => {
    if (!activeStadium) return;
    setLoading(true);
    const params = new URLSearchParams({ stadium: activeStadium, trees: String(treeCount), month: String(month), hour: String(hour) });
    if (osmId !== null) params.set("osm_id", String(osmId));
    fetch(`/api/urban-lab?${params}`)
      .then((r) => r.json())
      .then((d: LabResponse) => {
        if (!d.lots) return; // error shape
        setData(d);
        if (osmId === null) setOsmId(d.selected_osm_id);
      })
      .finally(() => setLoading(false));
  }, [activeStadium, treeCount, month, hour, osmId]);

  const lot = data?.tree_shade?.lot;
  const angleLayout = data?.angle_comparison?.by_angle?.[angle] ?? null;

  return (
    <div className="p-6 max-w-6xl mx-auto font-mono text-sm text-zinc-200 space-y-8">
      <div>
        <h2 className="text-lg font-bold text-zinc-50">URBAN LAB &middot; &laquo;what if&raquo; scenarios</h2>
        <p className="text-zinc-500 text-xs mt-1 max-w-3xl">
          Two real, computed questions on one real parking lot: how much would tree shade actually cool it, and does
          re-striping its real dimensions at an angle actually fit more cars. Both scenarios are grounded in real lot
          geometry (OpenStreetMap) and real published standards -- never invented -- and stay tagged SEMI/MOCK since
          neither is a survey of what these specific lots look like today.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <label className="text-zinc-500 text-xs">STADIUM</label>
        <select
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs"
          value={activeStadium ?? ""}
          onChange={(e) => {
            setStadiumId(e.target.value);
            setOsmId(null);
          }}
        >
          {stadiums.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="text-zinc-500 text-xs ml-2">LOT</label>
        <select
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs max-w-[220px]"
          value={osmId ?? ""}
          onChange={(e) => setOsmId(Number(e.target.value))}
        >
          {data?.lots.map((l) => (
            <option key={l.osm_id} value={l.osm_id} disabled={!l.has_dimensions}>
              {l.name} &middot; {Math.round(l.area_m2).toLocaleString()}m&sup2;{!l.has_dimensions ? " (no dims)" : ""}
            </option>
          ))}
        </select>
        {loading && <span className="text-zinc-600 text-xs">loading&hellip;</span>}
      </div>

      {/* --- Tree shade scenario --- */}
      <section className="border border-zinc-800 rounded-lg p-4 space-y-3">
        <h3 className="text-zinc-300 font-bold text-xs tracking-wide">
          1&#41; TREE SHADE &middot; {lot?.name ?? "..."}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-64 bg-zinc-900 rounded overflow-hidden border border-zinc-800">
            {lot?.length_m && lot?.width_m ? (
              <TreeShadeScene lengthM={lot.length_m} widthM={lot.width_m} treeCount={treeCount} />
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-600 text-xs">no real dimensions for this lot</div>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>TREE COUNT</span>
                <span>
                  {treeCount} &middot; full shade at ~{data?.tree_shade.max_useful_trees ?? "?"} trees
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(50, (data?.tree_shade.max_useful_trees ?? 50) * 1.2)}
                value={treeCount}
                onChange={(e) => setTreeCount(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-zinc-900 border border-zinc-800 rounded p-2">
                <div className="text-[10px] text-zinc-500">SHADED</div>
                <div className="text-lg font-bold">{Math.round((data?.tree_shade.shaded_fraction ?? 0) * 100)}%</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded p-2">
                <div className="text-[10px] text-zinc-500">TEMP DROP</div>
                <div className="text-lg font-bold text-emerald-400">-{data?.tree_shade.temp_reduction_c ?? 0}&deg;C</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded p-2">
                <div className="text-[10px] text-zinc-500">WBGT NOW</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold" style={{ color: flagColor(data?.tree_shade.base_wbgt_c ?? null) }}>
                    {data?.tree_shade.base_wbgt_c ?? "-"}
                  </span>
                  <span className="text-zinc-600">&rarr;</span>
                  <span className="text-lg font-bold" style={{ color: flagColor(data?.tree_shade.shaded_wbgt_c ?? null) }}>
                    {data?.tree_shade.shaded_wbgt_c ?? "-"}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-zinc-600 leading-relaxed">
              SEMI: real lot area feeds a linear shade model (mature-canopy diameter ~10.7m, a standard cited in city
              parking-shade ordinances) scaled to a real published air-temperature effect of full tree-canopy shade
              over pavement (~4-8&deg;F / 2.2-4.4&deg;C cooler air, USDA Forest Service Davis, CA study) -- not a
              measurement at this specific lot.
            </p>
          </div>
        </div>
      </section>

      {/* --- Angled layout scenario --- */}
      <section className="border border-zinc-800 rounded-lg p-4 space-y-3">
        <h3 className="text-zinc-300 font-bold text-xs tracking-wide">2&#41; RE-STRIPING FOR MORE CARS &middot; {lot?.name ?? "..."}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-64 bg-zinc-900 rounded overflow-hidden border border-zinc-800">
            {angleLayout && lot?.length_m && lot?.width_m ? (
              <AngledLayoutScene layout={angleLayout} lengthM={lot.length_m} widthM={lot.width_m} />
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-600 text-xs">no real dimensions for this lot</div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex gap-2">
              {(["90", "60", "45"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAngle(a)}
                  className={`px-3 py-1 rounded border text-xs ${
                    angle === a ? "bg-zinc-100 text-zinc-900 border-zinc-100" : "border-zinc-700 text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {a}&deg;{data?.angle_comparison?.best_angle === Number(a) ? " ★" : ""}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(["90", "60", "45"] as const).map((a) => (
                <div key={a} className={`bg-zinc-900 border rounded p-2 ${angle === a ? "border-zinc-500" : "border-zinc-800"}`}>
                  <div className="text-[10px] text-zinc-500">{a}&deg;</div>
                  <div className="text-lg font-bold">{data?.angle_comparison?.by_angle?.[a]?.total_spaces ?? "-"}</div>
                </div>
              ))}
            </div>
            {data?.angle_comparison && (
              <div className="text-xs">
                {data.angle_comparison.gain_vs_90 > 0 ? (
                  <span className="text-emerald-400">
                    Re-striping at {data.angle_comparison.best_angle}&deg; fits +{data.angle_comparison.gain_vs_90} more real spaces
                    than the current 90&deg; layout ({data.angle_comparison.current_total} &rarr; {data.angle_comparison.best_total}).
                  </span>
                ) : (
                  <span className="text-zinc-400">
                    For this lot&apos;s real shape, 90&deg; is already the best of the three -- angled parking would not gain
                    spaces here.
                  </span>
                )}
              </div>
            )}
            <p className="text-[11px] text-zinc-600 leading-relaxed">
              SEMI: real double-loaded-module capacity math applied to this lot&apos;s own real oriented dimensions
              (scripts/fetch_parking_lots.py), using the City of Kerrville, TX&apos;s published parking design
              standards for 45&deg;/60&deg;/90&deg; stall width, depth and aisle width -- not a survey of this lot&apos;s
              actual striping.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
