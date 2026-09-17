import { NextRequest } from "next/server";
import { getStadiumParkingLots, simulateTreeShade, getLotAngleComparison } from "@/lib/parkingData";
import { computeRealParkingLayout } from "@/lib/parkingLayout";
import { simulateCoolPavement, simulateSmartGrowth, simulateSolarCarport } from "@/lib/interventions";

/**
 * GET /api/urban-lab?stadium=<id>&osm_id=<lot id>&trees=<int>&cool_pavement=<0-1>&smart_growth=<0-1>&month=<1-12>&hour=<0-23>
 *
 * Backs the "Urban Lab" tab's real what-if scenarios for one real
 * parking lot -- the EPA's 5 heat-island reduction strategies
 * (epa.gov/green-infrastructure/reduce-heat-islands) plus one more
 * this session's research turned up, each computed independently
 * (never summed, to avoid double-counting overlapping surface area):
 *   1) tree shade -- tree count -> shaded fraction -> WBGT (lib/parkingData.ts)
 *   2) green roof -- fixed real pedestrian-level effect (lib/interventions.ts)
 *   3) cool roof -- real roof-surface/indoor effect, honestly NO ambient WBGT number
 *   4) cool pavement -- coverage fraction -> WBGT (lib/interventions.ts)
 *   5) smart growth -- pavement-to-green-space conversion fraction -> WBGT + real space-count cost
 *   6) solar carports -- coverage fraction -> WBGT + real annual kWh generation (lib/interventions.ts)
 * plus a real 90/60/45-degree capacity comparison (lib/parkingLayout.ts,
 * City of Kerrville, TX's published parking design standards).
 *
 * osm_id defaults to the stadium's single largest real lot when
 * omitted, since that's usually the most legible one to visualize.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stadiumId = searchParams.get("stadium");
  if (!stadiumId) return Response.json({ error: "stadium is required" }, { status: 400 });

  const month = Number(searchParams.get("month") ?? 7);
  const hour = Number(searchParams.get("hour") ?? 15);
  const trees = Number(searchParams.get("trees") ?? 0);
  const coolPavementCoverage = Number(searchParams.get("cool_pavement") ?? 0);
  const smartGrowthCoverage = Number(searchParams.get("smart_growth") ?? 0);
  const solarCarportCoverage = Number(searchParams.get("solar_carport") ?? 0);

  const lots = getStadiumParkingLots(stadiumId);
  if (lots.length === 0) {
    return Response.json({ error: `No real parking-lot data for ${stadiumId}` }, { status: 404 });
  }

  // Prefer a lot that actually has real oriented dimensions (needed
  // for the angle comparison) over a plain-area-only one, then pick
  // the largest by area among those as the default.
  const withDims = lots.filter((l) => l.length_m && l.width_m);
  const candidates = withDims.length > 0 ? withDims : lots;
  const defaultLot = candidates.reduce((best, l) => (l.area_m2 > best.area_m2 ? l : best), candidates[0]);

  const osmIdRaw = searchParams.get("osm_id");
  const osmId = osmIdRaw !== null ? Number(osmIdRaw) : defaultLot.osm_id;

  const treeShade = simulateTreeShade(stadiumId, osmId, trees, month, hour);
  if (!treeShade) return Response.json({ error: `No lot ${osmId} at ${stadiumId}` }, { status: 404 });
  const angleComparison = getLotAngleComparison(stadiumId, osmId);

  const selectedLot = lots.find((l) => l.osm_id === osmId)!;
  const spacesBefore = selectedLot.length_m && selectedLot.width_m ? computeRealParkingLayout(selectedLot.length_m, selectedLot.width_m).total_spaces : 0;

  const coolPavement = simulateCoolPavement(coolPavementCoverage, treeShade.base_wbgt_c);
  const smartGrowth = simulateSmartGrowth(smartGrowthCoverage, treeShade.base_wbgt_c, spacesBefore);
  const solarCarport = simulateSolarCarport(solarCarportCoverage, treeShade.base_wbgt_c, spacesBefore);

  return Response.json({
    stadium_id: stadiumId,
    lots: lots.map((l) => ({ osm_id: l.osm_id, name: l.name, area_m2: l.area_m2, has_dimensions: !!(l.length_m && l.width_m) })),
    selected_osm_id: osmId,
    tree_shade: treeShade,
    angle_comparison: angleComparison,
    cool_pavement: coolPavement,
    smart_growth: smartGrowth,
    solar_carport: solarCarport,
  });
}
