import { NextRequest } from "next/server";
import { computeLotExposure, computeLotOccupancy } from "@/lib/parkingData";

/**
 * GET /api/parking?stadium=<id>&month=<1-12>&hour=<0-23>&hours_from_kickoff=<-4..5>
 *
 * Real parking-lot geometry (OpenStreetMap, scripts/fetch_parking_lots.py)
 * + real climatology WBGT + one clearly-tagged modeled surcharge for
 * walking across open sunlit pavement (see lib/parkingData.ts). When
 * hours_from_kickoff is provided, also attaches match-day occupancy
 * per lot (real area -> SEMI space count -> MOCK fill-curve estimate).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stadiumId = searchParams.get("stadium");
  const month = Number(searchParams.get("month") ?? 7);
  const hour = Number(searchParams.get("hour") ?? 15);
  if (!stadiumId) return Response.json({ error: "stadium is required" }, { status: 400 });

  const exposure = computeLotExposure(stadiumId, month, hour);
  const hoursFromKickoffRaw = searchParams.get("hours_from_kickoff");

  if (hoursFromKickoffRaw === null) {
    return Response.json({ stadium_id: stadiumId, month, hour, lots: exposure });
  }

  const hoursFromKickoff = Number(hoursFromKickoffRaw);
  const occupancyByOsmId = new Map(computeLotOccupancy(stadiumId, hoursFromKickoff).map((o) => [o.lot.osm_id, o]));
  const merged = exposure.map((e) => ({ ...e, occupancy: occupancyByOsmId.get(e.lot.osm_id) ?? null }));

  return Response.json({ stadium_id: stadiumId, month, hour, hours_from_kickoff: hoursFromKickoff, lots: merged });
}
