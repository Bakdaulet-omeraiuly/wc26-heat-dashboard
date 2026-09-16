import { NextRequest } from "next/server";
import { findStadium, getStadiumSnapshot, getStadiumTrend } from "@/lib/agentData";
import { getStadiumForecast } from "@/lib/nwsForecast";
import { rankLotsBySafety, getStadiumParkingLots, computeLotOccupancy } from "@/lib/parkingData";

/**
 * GET /api/forecast?stadium=<id>
 *
 * Bundles four real, independently-tagged pieces for the Ask view's
 * sidebar (components/ForecastSidebar.tsx) -- deliberately NOT routed
 * through the LLM: this is a glanceable stats panel, not a
 * conversation, so it goes straight to the same real data the agent's
 * tools use, with no API cost/latency from a model call.
 *
 * - current: this month/hour's real climatology (2006-2025 average),
 *   data_status REAL
 * - trend: the real 20-year regression, data_status REAL
 * - forecast: a real NOAA NWS short-term prediction, data_status
 *   REAL-FORECAST (fetched live from api.weather.gov -- can fail if
 *   that service is unreachable; reported as an error field, not
 *   silently dropped)
 * - parking: real lot count/total capacity, plus the safest and most
 *   heat-exposed real lot for this same month/hour (lib/parkingData.ts
 *   -- real distance/capacity, SEMI walk-in WBGT)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stadiumId = searchParams.get("stadium");
  if (!stadiumId) return Response.json({ error: "stadium is required" }, { status: 400 });

  const stadium = findStadium(stadiumId);
  if (!stadium) return Response.json({ error: `unknown stadium: ${stadiumId}` }, { status: 404 });

  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const hour = now.getUTCHours();
  const current = getStadiumSnapshot(stadium.id, month, hour);
  const trend = getStadiumTrend(stadium.id);
  const forecast = await getStadiumForecast(stadium, { hoursAhead: 48 });

  const allLots = getStadiumParkingLots(stadium.id);
  const ranked = rankLotsBySafety(stadium.id, month, hour);
  // Exact real-layout capacity (lib/parkingLayout.ts), same method the
  // 3D view's "X / Y spaces est." total uses -- occupancy_fraction is
  // irrelevant to the total itself, so any hoursFromKickoff works here.
  const totalCapacity = computeLotOccupancy(stadium.id, 0).reduce((sum, o) => sum + o.estimated_spaces, 0);
  const parking =
    ranked.length > 0
      ? {
          total_lots: allLots.length,
          total_capacity: totalCapacity,
          safest: { name: ranked[0].lot.name, distance_m: ranked[0].lot.distance_m, walk_minutes: ranked[0].walk_minutes, adjusted_wbgt_c: ranked[0].adjusted_wbgt_c, sports_flag: ranked[0].sports_flag },
          most_exposed: {
            name: ranked[ranked.length - 1].lot.name,
            distance_m: ranked[ranked.length - 1].lot.distance_m,
            walk_minutes: ranked[ranked.length - 1].walk_minutes,
            adjusted_wbgt_c: ranked[ranked.length - 1].adjusted_wbgt_c,
            sports_flag: ranked[ranked.length - 1].sports_flag,
          },
          data_status: "SEMI" as const,
        }
      : null;

  return Response.json({ stadium, current, trend, forecast, parking });
}
