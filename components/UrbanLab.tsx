"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Instances, Instance } from "@react-three/drei";
import { useHeatDashboardStore } from "@/lib/store";
import { stallPositions, type RealParkingLayout } from "@/lib/parkingLayout";
import Stadium3D, { type StadiumInterventions } from "@/components/Stadium3D";

/**
 * "Urban Lab" -- all 5 of the EPA's real heat-island reduction
 * strategies (epa.gov/green-infrastructure/reduce-heat-islands),
 * applied to one real stadium's real parking lots and streets. Every
 * number here is computed by /api/urban-lab from real geometry (OSM)
 * and real cited research (see that route's and lib/interventions.ts's
 * docstrings) -- never invented -- and stays tagged SEMI/MOCK since
 * none of it is a survey of what these specific venues look like
 * today. The strategies are shown as independent cards, never summed
 * into one composite number, since their real effects overlap the
 * same physical surface area.
 */

const SCALE = 0.045; // meters -> scene units, tuned so a ~300m lot fills a small canvas

type StadiumFull = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  roof_type: string;
  field_orientation_deg: number | null;
};

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
type CoolPavement = {
  coverage_fraction: number;
  temp_reduction_c: number;
  base_wbgt_c: number | null;
  treated_wbgt_c: number | null;
};
type SmartGrowth = {
  converted_fraction: number;
  temp_reduction_c: number;
  base_wbgt_c: number | null;
  treated_wbgt_c: number | null;
  spaces_before: number;
  spaces_after: number;
  spaces_lost: number;
};
type LabResponse = {
  lots: LotOption[];
  selected_osm_id: number;
  tree_shade: TreeShade;
  angle_comparison: AngleComparison | null;
  cool_pavement: CoolPavement;
  smart_growth: SmartGrowth;
};

function flagColor(wbgt: number | null): string {
  if (wbgt === null) return "#71717a";
  if (wbgt < 27.8) return "#22c55e";
  if (wbgt < 29.4) return "#eab308";
  if (wbgt < 31.7) return "#f97316";
  return "#ef4444";
}

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

function carGrid(lengthScene: number, widthScene: number, cols: number, rows: number, skipFraction = 0): [number, number][] {
  const spots: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Skip a contiguous fraction of columns (from one edge) to
      // visually represent "this portion of the lot is no longer
      // parking" -- consistent with the real space-count reduction
      // reported alongside it, not an arbitrary decoration.
      if (c / cols >= 1 - skipFraction) continue;
      spots.push([(((c + 0.5) / cols) - 0.5) * lengthScene, (((r + 0.5) / rows) - 0.5) * widthScene * 0.9]);
    }
  }
  return spots;
}

function TreeShadeScene({ lengthM, widthM, treeCount }: { lengthM: number; widthM: number; treeCount: number }) {
  const lengthScene = Math.min(6, lengthM * SCALE);
  const widthScene = Math.min(4.5, widthM * SCALE);
  const renderedTrees = Math.min(treeCount, 400);
  const trees = useMemo(() => treePositions(renderedTrees, lengthScene, widthScene), [renderedTrees, lengthScene, widthScene]);
  const cars = useMemo(() => carGrid(lengthScene, widthScene, 10, 4), [lengthScene, widthScene]);

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

/** Shared scene for the two "re-surface part of the lot" scenarios --
 * cool pavement (tints toward white) and smart growth (tints toward
 * green AND visually drops cars from the converted fraction, since
 * that pavement stops being parking at all). */
function SurfaceScene({
  lengthM,
  widthM,
  coverageFraction,
  tint,
  dropCars,
}: {
  lengthM: number;
  widthM: number;
  coverageFraction: number;
  tint: string;
  dropCars: boolean;
}) {
  const lengthScene = Math.min(6, lengthM * SCALE);
  const widthScene = Math.min(4.5, widthM * SCALE);
  const cars = useMemo(
    () => carGrid(lengthScene, widthScene, 10, 4, dropCars ? coverageFraction : 0),
    [lengthScene, widthScene, dropCars, coverageFraction]
  );
  const overlayLength = lengthScene * coverageFraction;

  return (
    <Canvas camera={{ position: [lengthScene * 0.9, lengthScene * 0.75, widthScene * 1.3], fov: 45 }}>
      <ambientLight intensity={0.75} />
      <directionalLight position={[5, 8, 3]} intensity={1.1} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[lengthScene, widthScene]} />
        <meshStandardMaterial color="#3f3f46" />
      </mesh>
      {coverageFraction > 0 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[lengthScene / 2 - overlayLength / 2, -0.01, 0]}>
          <planeGeometry args={[overlayLength, widthScene]} />
          <meshStandardMaterial color={tint} />
        </mesh>
      )}
      <Instances limit={200}>
        <boxGeometry args={[0.22, 0.09, 0.11]} />
        <meshStandardMaterial color="#a1a1aa" />
        {cars.map(([x, z], i) => (
          <Instance key={i} position={[x, 0.045, z]} />
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

  const [stadiums, setStadiums] = useState<StadiumFull[]>([]);
  const [stadiumId, setStadiumId] = useState<string | null>(storeStadiumId);
  const [treeCount, setTreeCount] = useState(20);
  const [angle, setAngle] = useState<"90" | "60" | "45">("90");
  const [coolPavementCoverage, setCoolPavementCoverage] = useState(0.5);
  const [smartGrowthCoverage, setSmartGrowthCoverage] = useState(0.25);
  const [data, setData] = useState<LabResponse | null>(null);
  const [osmId, setOsmId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeCard, setActiveCard] = useState<"trees" | "roofs" | "pavement" | "growth" | "angle">("trees");

  // The big context scene's own toggles -- independent of the per-lot
  // scenario sliders above (this view shows a stadium-wide illustration,
  // the cards below show one lot's exact real numbers).
  const [ctxGreenRoof, setCtxGreenRoof] = useState(false);
  const [ctxCoolRoof, setCtxCoolRoof] = useState(false);
  const [ctxCoolPavement, setCtxCoolPavement] = useState(0);
  const [ctxSmartGrowth, setCtxSmartGrowth] = useState(0);
  const [ctxStreets, setCtxStreets] = useState(true);
  const [ctxStreetTrees, setCtxStreetTrees] = useState(false);

  useEffect(() => {
    fetch("/api/stadiums")
      .then((r) => r.json())
      .then((d) => setStadiums(d.stadiums));
  }, []);

  useEffect(() => {
    if (storeStadiumId && !stadiumId) setStadiumId(storeStadiumId);
  }, [storeStadiumId, stadiumId]);

  const activeStadiumId = stadiumId ?? stadiums[0]?.id ?? null;
  const activeStadium = stadiums.find((s) => s.id === activeStadiumId) ?? null;

  useEffect(() => {
    if (!activeStadiumId) return;
    setLoading(true);
    const params = new URLSearchParams({
      stadium: activeStadiumId,
      trees: String(treeCount),
      cool_pavement: String(coolPavementCoverage),
      smart_growth: String(smartGrowthCoverage),
      month: String(month),
      hour: String(hour),
    });
    if (osmId !== null) params.set("osm_id", String(osmId));
    fetch(`/api/urban-lab?${params}`)
      .then((r) => r.json())
      .then((d: LabResponse) => {
        if (!d.lots) return; // error shape
        setData(d);
        if (osmId === null) setOsmId(d.selected_osm_id);
      })
      .finally(() => setLoading(false));
  }, [activeStadiumId, treeCount, coolPavementCoverage, smartGrowthCoverage, month, hour, osmId]);

  const lot = data?.tree_shade?.lot;
  const angleLayout = data?.angle_comparison?.by_angle?.[angle] ?? null;

  const interventions: StadiumInterventions = {
    greenRoof: ctxGreenRoof,
    coolRoof: ctxCoolRoof,
    coolPavementCoverage: ctxCoolPavement,
    smartGrowthCoverage: ctxSmartGrowth,
    showStreets: ctxStreets,
    showStreetTrees: ctxStreetTrees,
  };

  return (
    <div className="p-6 max-w-6xl mx-auto font-mono text-sm text-zinc-200 space-y-8">
      <div>
        <h2 className="text-lg font-bold text-zinc-50">URBAN LAB &middot; EPA&apos;s 5 heat-island strategies, applied</h2>
        <p className="text-zinc-500 text-xs mt-1 max-w-3xl">
          Real questions, computed from real lot/street geometry (OpenStreetMap) and real published research (EPA,
          USDA Forest Service, City of Kerrville TX) -- never invented. Each strategy below is independent, never
          summed into one number, since their real effects overlap the same physical surface. All tagged SEMI/MOCK:
          none of this is a survey of what these specific venues look like today.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <label className="text-zinc-500 text-xs">STADIUM</label>
        <select
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs"
          value={activeStadiumId ?? ""}
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
        <label className="text-zinc-500 text-xs ml-2">LOT (for cards 1, 4, 5)</label>
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

      {/* --- Stadium + streets context: the hero. Real bowl geometry
          (two decks, floodlights that light up at real night, a
          scoreboard, a real per-venue roof shape, the field rotated to
          this stadium's own real measured compass orientation), real
          OSM streets rendered as paved ribbons, real parking lots --
          every strategy toggle below drives this ONE shared scene. */}
      <section className="border border-zinc-800 rounded-lg p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-zinc-300 font-bold text-xs tracking-wide">STADIUM + STREETS &middot; {activeStadium?.name ?? "..."}</h3>
          <span className="text-zinc-600 text-[10px]">drag to orbit &middot; scroll to zoom &middot; click a lot to fly in</span>
        </div>
        <div className="h-[540px] bg-zinc-900 rounded overflow-hidden border border-zinc-800">
          {activeStadium && <Stadium3D stadium={activeStadium} interventions={interventions} />}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs bg-zinc-900/60 border border-zinc-800 rounded p-3">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={ctxStreets} onChange={(e) => setCtxStreets(e.target.checked)} />
            Streets
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={ctxStreetTrees} onChange={(e) => setCtxStreetTrees(e.target.checked)} />
            Street trees
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={ctxGreenRoof}
              onChange={(e) => {
                setCtxGreenRoof(e.target.checked);
                if (e.target.checked) setCtxCoolRoof(false);
              }}
            />
            2&#41; Green roof
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={ctxCoolRoof}
              onChange={(e) => {
                setCtxCoolRoof(e.target.checked);
                if (e.target.checked) setCtxGreenRoof(false);
              }}
            />
            3&#41; Cool roof
          </label>
          <div className="col-span-2 md:col-span-1">
            <div className="flex justify-between text-zinc-500 mb-0.5">
              <span>4&#41; Cool pavement</span>
              <span>{Math.round(ctxCoolPavement * 100)}%</span>
            </div>
            <input type="range" min={0} max={1} step={0.05} value={ctxCoolPavement} onChange={(e) => setCtxCoolPavement(Number(e.target.value))} className="w-full" />
          </div>
          <div className="col-span-2 md:col-span-1">
            <div className="flex justify-between text-zinc-500 mb-0.5">
              <span>5&#41; Smart growth</span>
              <span>{Math.round(ctxSmartGrowth * 100)}%</span>
            </div>
            <input type="range" min={0} max={1} step={0.05} value={ctxSmartGrowth} onChange={(e) => setCtxSmartGrowth(Number(e.target.value))} className="w-full" />
          </div>
        </div>
        <p className="text-[10px] text-zinc-600 leading-relaxed">
          Still a schematic model, not a CAD-accurate replica of any one venue -- but every real number this app has
          about this stadium is now applied to it: real field compass orientation, real roof type, real OSM streets
          and lots, real sun position for lighting/floodlights. Roof/pavement/growth tints apply uniformly across all
          lots here; the exact real number for one specific lot is in the cards below.
        </p>
      </section>

      {/* --- Tab bar: one scenario card visible at a time, not all 5
          stacked and scrolled through -- each is still fully real/SEMI,
          just not all shown at once. */}
      <div className="flex flex-wrap gap-2 border-b border-zinc-800 pb-3">
        {(
          [
            ["trees", "1) Trees"],
            ["roofs", "2–3) Roofs"],
            ["pavement", "4) Cool pavement"],
            ["growth", "5) Smart growth"],
            ["angle", "Angled parking"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveCard(key)}
            className={`px-3 py-1.5 rounded border text-xs ${
              activeCard === key ? "bg-zinc-100 text-zinc-900 border-zinc-100" : "border-zinc-700 text-zinc-400 hover:text-zinc-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* --- 1) Tree shade --- */}
      <section hidden={activeCard !== "trees"} className="border border-zinc-800 rounded-lg p-4 space-y-3">
        <h3 className="text-zinc-300 font-bold text-xs tracking-wide">1&#41; TREE SHADE &middot; {lot?.name ?? "..."}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-64 bg-zinc-900 rounded overflow-hidden border border-zinc-800">
            {activeCard === "trees" && lot?.length_m && lot?.width_m ? (
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
              over pavement (~4-8&deg;F / 2.2-4.4&deg;C cooler air, USDA Forest Service Davis, CA study).
            </p>
          </div>
        </div>
      </section>

      {/* --- 2/3) Green roof / cool roof info --- */}
      <section hidden={activeCard !== "roofs"} className="border border-zinc-800 rounded-lg p-4 space-y-3">
        <h3 className="text-zinc-300 font-bold text-xs tracking-wide">2&#41; GREEN ROOF &middot; 3&#41; COOL ROOF</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-zinc-900 border border-zinc-800 rounded p-3 space-y-1.5">
            <div className="text-zinc-300 font-bold">Green roof</div>
            <div>
              Pedestrian-level air temperature: <span className="text-emerald-400 font-bold">-0.2&deg;C</span> (real cited
              range 0.10-0.30&deg;C, midpoint)
            </div>
            <div className="text-zinc-600">
              Small and localized compared to tree shade or cool pavement -- a green roof cools the structure and its
              immediate surroundings, not the parking fields. Source: EPA, Using Green Roofs to Reduce Heat Islands.
            </div>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded p-3 space-y-1.5">
            <div className="text-zinc-300 font-bold">Cool (reflective) roof</div>
            <div>
              Roof surface: <span className="text-emerald-400 font-bold">-28&deg;C</span> (~50&deg;F, 80% vs 20% reflective) &middot;
              indoor: <span className="text-emerald-400 font-bold">-1.2 to -3.3&deg;C</span>
            </div>
            <div className="text-zinc-600">
              Honestly: no published outdoor/pedestrian WBGT number exists for cool roofs -- the real, cited benefit is
              roof-surface and indoor/energy, not outdoor heat exposure. Shown here for structural context only, not
              counted as a WBGT reduction. Source: EPA, Using Cool Roofs to Reduce Heat Islands.
            </div>
          </div>
        </div>
      </section>

      {/* --- 4) Cool pavement --- */}
      <section hidden={activeCard !== "pavement"} className="border border-zinc-800 rounded-lg p-4 space-y-3">
        <h3 className="text-zinc-300 font-bold text-xs tracking-wide">4&#41; COOL PAVEMENT &middot; {lot?.name ?? "..."}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-64 bg-zinc-900 rounded overflow-hidden border border-zinc-800">
            {activeCard === "pavement" && lot?.length_m && lot?.width_m ? (
              <SurfaceScene lengthM={lot.length_m} widthM={lot.width_m} coverageFraction={coolPavementCoverage} tint="#e8e8ec" dropCars={false} />
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-600 text-xs">no real dimensions for this lot</div>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>COVERAGE</span>
                <span>{Math.round(coolPavementCoverage * 100)}% of this lot re-surfaced</span>
              </div>
              <input type="range" min={0} max={1} step={0.05} value={coolPavementCoverage} onChange={(e) => setCoolPavementCoverage(Number(e.target.value))} className="w-full" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-zinc-900 border border-zinc-800 rounded p-2">
                <div className="text-[10px] text-zinc-500">TEMP DROP</div>
                <div className="text-lg font-bold text-emerald-400">-{data?.cool_pavement.temp_reduction_c ?? 0}&deg;C</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded p-2">
                <div className="text-[10px] text-zinc-500">WBGT NOW</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold" style={{ color: flagColor(data?.cool_pavement.base_wbgt_c ?? null) }}>
                    {data?.cool_pavement.base_wbgt_c ?? "-"}
                  </span>
                  <span className="text-zinc-600">&rarr;</span>
                  <span className="text-lg font-bold" style={{ color: flagColor(data?.cool_pavement.treated_wbgt_c ?? null) }}>
                    {data?.cool_pavement.treated_wbgt_c ?? "-"}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-zinc-600 leading-relaxed">
              SEMI: real cited "up to 2&deg;C" ambient air-temperature reduction at full reflective/permeable-pavement
              coverage (EPA, Using Cool Pavements to Reduce Heat Islands; a real Arizona pavement-temperature pilot
              study), scaled linearly by how much of this lot is re-surfaced. Smaller than tree shade or smart growth
              since it changes reflectivity only, not canopy or evapotranspiration.
            </p>
          </div>
        </div>
      </section>

      {/* --- 5) Smart growth --- */}
      <section hidden={activeCard !== "growth"} className="border border-zinc-800 rounded-lg p-4 space-y-3">
        <h3 className="text-zinc-300 font-bold text-xs tracking-wide">5&#41; SMART GROWTH &middot; {lot?.name ?? "..."}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-64 bg-zinc-900 rounded overflow-hidden border border-zinc-800">
            {activeCard === "growth" && lot?.length_m && lot?.width_m ? (
              <SurfaceScene lengthM={lot.length_m} widthM={lot.width_m} coverageFraction={smartGrowthCoverage} tint="#2e7d32" dropCars />
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-600 text-xs">no real dimensions for this lot</div>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>CONVERTED TO GREEN SPACE</span>
                <span>{Math.round(smartGrowthCoverage * 100)}% of this lot</span>
              </div>
              <input type="range" min={0} max={1} step={0.05} value={smartGrowthCoverage} onChange={(e) => setSmartGrowthCoverage(Number(e.target.value))} className="w-full" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-zinc-900 border border-zinc-800 rounded p-2">
                <div className="text-[10px] text-zinc-500">TEMP DROP</div>
                <div className="text-lg font-bold text-emerald-400">-{data?.smart_growth.temp_reduction_c ?? 0}&deg;C</div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded p-2">
                <div className="text-[10px] text-zinc-500">WBGT NOW</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-bold" style={{ color: flagColor(data?.smart_growth.base_wbgt_c ?? null) }}>
                    {data?.smart_growth.base_wbgt_c ?? "-"}
                  </span>
                  <span className="text-zinc-600">&rarr;</span>
                  <span className="text-lg font-bold" style={{ color: flagColor(data?.smart_growth.treated_wbgt_c ?? null) }}>
                    {data?.smart_growth.treated_wbgt_c ?? "-"}
                  </span>
                </div>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded p-2">
                <div className="text-[10px] text-zinc-500">SPACES LOST</div>
                <div className="text-lg font-bold text-orange-400">
                  -{data?.smart_growth.spaces_lost ?? 0}
                </div>
                <div className="text-[9px] text-zinc-600">
                  {data?.smart_growth.spaces_before ?? "-"} &rarr; {data?.smart_growth.spaces_after ?? "-"}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-zinc-600 leading-relaxed">
              SEMI: converting pavement to real vegetated ground reuses the vegetative-cooling magnitude (2.2-4.4&deg;C,
              same USDA Forest Service study as card 1) since it's real green space, not just a coating -- but it
              isn't free: the real capacity math (lib/parkingLayout.ts) shows exactly how many spaces that trade costs.
              Source: EPA, Smart Growth and Heat Islands.
            </p>
          </div>
        </div>
      </section>

      {/* --- Re-striping for more cars --- */}
      <section hidden={activeCard !== "angle"} className="border border-zinc-800 rounded-lg p-4 space-y-3">
        <h3 className="text-zinc-300 font-bold text-xs tracking-wide">RE-STRIPING FOR MORE CARS &middot; {lot?.name ?? "..."}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-64 bg-zinc-900 rounded overflow-hidden border border-zinc-800">
            {activeCard === "angle" && angleLayout && lot?.length_m && lot?.width_m ? (
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
              standards for 45&deg;/60&deg;/90&deg; stall width, depth and aisle width.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
