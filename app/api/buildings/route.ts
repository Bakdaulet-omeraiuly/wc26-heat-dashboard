import { NextRequest } from "next/server";
import { getStadiumBuildings } from "@/lib/buildingData";

/** GET /api/buildings?stadium=<id> -- real OSM building footprints
 * near this stadium (scripts/fetch_buildings.py), each already
 * expressed as {distance_m, bearing_from_stadium_deg} for direct use
 * with Stadium3D's bearingToXZ() placement, plus a real oriented
 * footprint and a height tagged REAL/SEMI/MOCK by how it was sourced. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stadiumId = searchParams.get("stadium");
  if (!stadiumId) return Response.json({ error: "stadium is required" }, { status: 400 });
  return Response.json({ stadium_id: stadiumId, buildings: getStadiumBuildings(stadiumId) });
}
