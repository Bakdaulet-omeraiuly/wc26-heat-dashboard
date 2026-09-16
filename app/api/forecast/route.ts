import { NextRequest } from "next/server";
import { findStadium, getStadiumSnapshot, getStadiumTrend } from "@/lib/agentData";
import { getStadiumForecast } from "@/lib/nwsForecast";

/**
 * GET /api/forecast?stadium=<id>
 *
 * Bundles three real, independently-tagged pieces for the Ask view's
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
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stadiumId = searchParams.get("stadium");
  if (!stadiumId) return Response.json({ error: "stadium is required" }, { status: 400 });

  const stadium = findStadium(stadiumId);
  if (!stadium) return Response.json({ error: `unknown stadium: ${stadiumId}` }, { status: 404 });

  const now = new Date();
  const current = getStadiumSnapshot(stadium.id, now.getUTCMonth() + 1, now.getUTCHours());
  const trend = getStadiumTrend(stadium.id);
  const forecast = await getStadiumForecast(stadium, { hoursAhead: 48 });

  return Response.json({ stadium, current, trend, forecast });
}
