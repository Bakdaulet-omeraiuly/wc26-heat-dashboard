import { NextRequest } from "next/server";
import { findStadium } from "@/lib/agentData";
import { getStadiumForecast } from "@/lib/nwsForecast";

/**
 * GET /api/event-forecast?stadium=<id>&kickoff_utc_iso=<ISO datetime>
 *
 * The "real live mode" piece: for a real UPCOMING event (an NFL game
 * from data/stadium_events.json) that falls within the NWS's real
 * ~7-day forecast window, returns the real forecast hour nearest that
 * kickoff -- fetched live on demand (api.weather.gov), not baked into
 * a static file, so it's always the actual current real forecast at
 * whatever moment someone opens the dashboard. Outside that window,
 * honestly returns "not yet available" rather than a stale or invented
 * number.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stadiumId = searchParams.get("stadium");
  const kickoffIso = searchParams.get("kickoff_utc_iso");
  if (!stadiumId || !kickoffIso) return Response.json({ error: "stadium and kickoff_utc_iso are required" }, { status: 400 });

  const stadium = findStadium(stadiumId);
  if (!stadium) return Response.json({ error: `unknown stadium: ${stadiumId}` }, { status: 404 });

  const kickoff = new Date(kickoffIso);
  const hoursUntilKickoff = (kickoff.getTime() - Date.now()) / 3600000;
  if (hoursUntilKickoff < -3 || hoursUntilKickoff > 168) {
    return Response.json({
      error:
        hoursUntilKickoff > 168
          ? "Real forecast not available yet -- NWS only forecasts about 7 days ahead; check back closer to kickoff."
          : "This kickoff is too far in the past for the live forecast window.",
    });
  }

  const forecast = await getStadiumForecast(stadium, { hoursAhead: 168 });
  if ("error" in forecast) return Response.json({ error: forecast.error });

  let nearest = null;
  let nearestDiffMin = Infinity;
  for (const h of forecast.hours) {
    const diffMin = Math.abs((new Date(h.time_local).getTime() - kickoff.getTime()) / 60000);
    if (diffMin < nearestDiffMin) {
      nearest = h;
      nearestDiffMin = diffMin;
    }
  }
  if (!nearest || nearestDiffMin > 90) {
    return Response.json({ error: "No real forecast hour found close enough to this kickoff yet." });
  }

  return Response.json({
    wbgt_c: nearest.wbgt_c,
    temp_c: nearest.temp_c,
    sports_flag: nearest.sports_flag,
    forecast_time_local: nearest.time_local,
    minutes_from_kickoff: Math.round(nearestDiffMin),
    data_status: "REAL-FORECAST",
    source: "NOAA National Weather Service (api.weather.gov), fetched live",
  });
}
