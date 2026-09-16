/**
 * Real short-term weather forecast via NOAA's National Weather Service
 * API (api.weather.gov) -- free, no key, no auth. Used only by the Ask
 * agent's get_weather_forecast tool, to answer "what's it actually
 * forecast to be like there this week" questions -- distinct from
 * climatology.json's 20-year historical AVERAGE, this is a real,
 * time-limited PREDICTION for the next ~7 days.
 *
 * Verified live (2026-09-16) against AT&T Stadium's coordinates:
 * /points/{lat},{lon} needs <=4 decimal places or it 301-redirects;
 * temperature comes back in whatever temperatureUnit says (usually F),
 * dewpoint as a {unitCode, value} pair (usually degC) -- both handled
 * explicitly below rather than assumed.
 */
import { approximateWBGT, wbgtToSportsFlag, type SportsFlagColor } from "./wbgt";
import type { Stadium } from "./agentData";

const USER_AGENT = "WC26HeatDashboard/1.0 (hackathon research; contact: galamdyq@gmail.com)";

type NWSPeriod = {
  startTime: string;
  temperature: number;
  temperatureUnit: string;
  dewpoint: { unitCode: string; value: number | null };
  shortForecast: string;
};

const gridUrlCache = new Map<string, string>();

async function getForecastHourlyUrl(lat: number, lon: number): Promise<string> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = gridUrlCache.get(key);
  if (cached) return cached;
  const res = await fetch(`https://api.weather.gov/points/${key}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`NWS /points lookup failed: HTTP ${res.status}`);
  const data = await res.json();
  const url = data?.properties?.forecastHourly;
  if (!url) throw new Error("NWS /points response had no forecastHourly URL");
  gridUrlCache.set(key, url);
  return url;
}

function fToC(f: number): number {
  return ((f - 32) * 5) / 9;
}

export type ForecastHour = {
  time_local: string;
  temp_c: number;
  dewpoint_c: number;
  wbgt_c: number;
  sports_flag: SportsFlagColor;
  short_forecast: string;
};

export type ForecastResult = {
  stadium_id: string;
  stadium_name: string;
  source: string;
  hours: ForecastHour[];
  data_status: "REAL-FORECAST";
  caveat: string;
};

export async function getStadiumForecast(
  stadium: Stadium,
  opts: { targetDate?: string; hoursAhead?: number } = {}
): Promise<ForecastResult | { error: string }> {
  let url: string;
  try {
    url = await getForecastHourlyUrl(stadium.lat, stadium.lon);
  } catch (e) {
    return { error: `Could not reach the NWS forecast service: ${e instanceof Error ? e.message : String(e)}` };
  }

  let periods: NWSPeriod[];
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return { error: `NWS hourly forecast fetch failed: HTTP ${res.status}` };
    const data = await res.json();
    periods = data?.properties?.periods ?? [];
  } catch (e) {
    return { error: `NWS hourly forecast fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (periods.length === 0) return { error: "NWS returned no forecast periods for this location." };

  if (opts.targetDate) {
    const matched = periods.filter((p) => p.startTime.slice(0, 10) === opts.targetDate);
    if (matched.length === 0) {
      return {
        error: `No forecast available for ${opts.targetDate}. NWS only forecasts about 7 days ahead from today; this date is either in the past or too far out.`,
      };
    }
    periods = matched;
  } else {
    periods = periods.slice(0, Math.max(1, Math.min(opts.hoursAhead ?? 48, periods.length)));
  }

  const hours: ForecastHour[] = periods
    .filter((p) => p.dewpoint?.value !== null && p.dewpoint?.value !== undefined)
    .map((p) => {
      const tempC = p.temperatureUnit === "F" ? fToC(p.temperature) : p.temperature;
      const dewC = p.dewpoint.unitCode.toLowerCase().includes("degf") ? fToC(p.dewpoint.value as number) : (p.dewpoint.value as number);
      const wbgt = approximateWBGT(tempC, dewC);
      return {
        time_local: p.startTime,
        temp_c: Math.round(tempC * 10) / 10,
        dewpoint_c: Math.round(dewC * 10) / 10,
        wbgt_c: Math.round(wbgt * 10) / 10,
        sports_flag: wbgtToSportsFlag(wbgt),
        short_forecast: p.shortForecast,
      };
    });

  return {
    stadium_id: stadium.id,
    stadium_name: stadium.name,
    source: "NOAA National Weather Service (api.weather.gov) hourly forecast -- a real prediction, not historical climatology",
    hours,
    data_status: "REAL-FORECAST",
    caveat:
      "This is a real NWS short-term forecast (updated hourly by NWS, typically reliable a few days out and less certain near the end of the ~7-day window) -- not the 20-year historical average shown elsewhere in this dashboard. WBGT is computed from the forecast temp/dewpoint using the same approximation as the rest of the app.",
  };
}
