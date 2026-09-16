import { NextRequest } from "next/server";
import { computeLotExposure } from "@/lib/parkingData";

/**
 * GET /api/parking?stadium=<id>&month=<1-12>&hour=<0-23>
 *
 * Real parking-lot geometry (OpenStreetMap, scripts/fetch_parking_lots.py)
 * + real climatology WBGT + one clearly-tagged modeled surcharge for
 * walking across open sunlit pavement. See lib/parkingData.ts.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stadiumId = searchParams.get("stadium");
  const month = Number(searchParams.get("month") ?? 7);
  const hour = Number(searchParams.get("hour") ?? 15);
  if (!stadiumId) return Response.json({ error: "stadium is required" }, { status: 400 });

  const lots = computeLotExposure(stadiumId, month, hour);
  return Response.json({ stadium_id: stadiumId, month, hour, lots });
}
