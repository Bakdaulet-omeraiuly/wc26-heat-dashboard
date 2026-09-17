import { NextRequest } from "next/server";
import { getStadiumParkingLots, simulateTreeShade, getLotAngleComparison } from "@/lib/parkingData";

/**
 * GET /api/urban-lab?stadium=<id>&osm_id=<lot id>&trees=<int>&month=<1-12>&hour=<0-23>
 *
 * Backs the "Urban Lab" tab's two real what-if scenarios for one real
 * parking lot: (1) a tree-count -> shaded-fraction -> air-temperature
 * -> WBGT reduction estimate (SEMI: real lot area + real climatology +
 * one modeled linear-shade term cited from published shade research),
 * and (2) a real 90/60/45-degree capacity comparison computed from the
 * lot's own real oriented dimensions (see lib/parkingLayout.ts, sourced
 * from the City of Kerrville, TX's published parking design standards).
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

  return Response.json({
    stadium_id: stadiumId,
    lots: lots.map((l) => ({ osm_id: l.osm_id, name: l.name, area_m2: l.area_m2, has_dimensions: !!(l.length_m && l.width_m) })),
    selected_osm_id: osmId,
    tree_shade: treeShade,
    angle_comparison: angleComparison,
  });
}
