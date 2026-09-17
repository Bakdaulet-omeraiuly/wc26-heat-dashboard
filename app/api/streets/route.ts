import { NextRequest } from "next/server";
import { getStadiumStreets } from "@/lib/streetData";

/** GET /api/streets?stadium=<id> -- real OSM road-centerline segments
 * near this stadium (scripts/fetch_streets.py), each node already
 * expressed as {distance_m, bearing_deg} from the stadium for direct
 * use with Stadium3D's bearingToXZ() placement. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stadiumId = searchParams.get("stadium");
  if (!stadiumId) return Response.json({ error: "stadium is required" }, { status: 400 });
  return Response.json({ stadium_id: stadiumId, segments: getStadiumStreets(stadiumId) });
}
