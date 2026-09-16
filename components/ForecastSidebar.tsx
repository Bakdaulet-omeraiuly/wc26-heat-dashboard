"use client";

import { useEffect, useState } from "react";
import { useHeatDashboardStore } from "@/lib/store";

type Stadium = { id: string; name: string; city: string; roof_type: string };
type Snapshot = {
  wbgt_mean_c: number | null;
  sample_size: number | null;
  heat_risk_level: string | null;
  sports_flag: string | null;
  data_status: string;
};
type Trend = {
  trend_c_per_decade: number;
  direction: "warming" | "cooling" | "flat";
  first_year: number;
  last_year: number;
  first_year_july_wbgt_c: number;
  last_year_july_wbgt_c: number;
};
type ForecastHour = { time_local: string; wbgt_c: number; sports_flag: string; temp_c: number };
type ForecastData = { hours: ForecastHour[]; data_status: string } | { error: string };

type Payload = {
  stadium: Stadium;
  current: Snapshot | null;
  trend: Trend | null;
  forecast: ForecastData;
};

const FLAG_HEX: Record<string, string> = {
  white: "#e8e8e8",
  green: "#228b54",
  yellow: "#d4af28",
  red: "#c43c30",
  black: "#1a1a1a",
};

const STADIUMS: Stadium[] = [
  { id: "att-stadium", name: "AT&T Stadium", city: "Dallas (Arlington), TX", roof_type: "retractable" },
  { id: "mercedes-benz-stadium", name: "Mercedes-Benz Stadium", city: "Atlanta, GA", roof_type: "retractable" },
  { id: "gillette-stadium", name: "Gillette Stadium", city: "Boston (Foxborough), MA", roof_type: "open" },
  { id: "nrg-stadium", name: "NRG Stadium", city: "Houston, TX", roof_type: "retractable" },
  { id: "arrowhead-stadium", name: "Arrowhead Stadium", city: "Kansas City, MO", roof_type: "open" },
  { id: "sofi-stadium", name: "SoFi Stadium", city: "Los Angeles (Inglewood), CA", roof_type: "open-canopy" },
  { id: "hard-rock-stadium", name: "Hard Rock Stadium", city: "Miami (Miami Gardens), FL", roof_type: "open-canopy" },
  { id: "metlife-stadium", name: "MetLife Stadium", city: "New York/New Jersey", roof_type: "open" },
  { id: "lincoln-financial-field", name: "Lincoln Financial Field", city: "Philadelphia, PA", roof_type: "open" },
  { id: "levis-stadium", name: "Levi's Stadium", city: "Santa Clara, CA", roof_type: "open" },
  { id: "lumen-field", name: "Lumen Field", city: "Seattle, WA", roof_type: "open-canopy" },
];

function fmtHour(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", hour12: true });
}

/** The Ask view's right-hand "at a glance" panel -- a real NWS forecast
 * plus the same climatology/trend numbers the agent's tools use,
 * rendered directly (no LLM round-trip) so it's fast and always
 * visible while someone is mid-conversation with the agent on the
 * left. See app/api/forecast/route.ts. */
export default function ForecastSidebar() {
  const { selectedStadiumId, setSelectedStadium } = useHeatDashboardStore();
  const stadiumId = selectedStadiumId ?? "att-stadium";
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/forecast?stadium=${stadiumId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => !cancelled && setErr(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [stadiumId]);

  const forecastHours = data && "hours" in data.forecast ? data.forecast.hours : [];
  const forecastError = data && "error" in data.forecast ? data.forecast.error : null;
  const peak = forecastHours.length > 0 ? forecastHours.reduce((a, b) => (b.wbgt_c > a.wbgt_c ? b : a)) : null;
  const maxWbgt = forecastHours.length > 0 ? Math.max(...forecastHours.map((h) => h.wbgt_c)) : 1;

  return (
    <aside className="w-80 shrink-0 border-l border-zinc-800 flex flex-col font-mono text-xs overflow-auto">
      <div className="px-3 py-3 border-b border-zinc-800">
        <div className="text-zinc-600 uppercase tracking-wide mb-1.5">Stadium</div>
        <select
          value={stadiumId}
          onChange={(e) => setSelectedStadium(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
        >
          {STADIUMS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {loading && <div className="px-3 py-4 text-zinc-600">loading real data&hellip;</div>}
      {err && <div className="px-3 py-4 text-red-400">error: {err}</div>}

      {data && (
        <>
          <div className="px-3 py-3 border-b border-zinc-800">
            <div className="text-zinc-600 uppercase tracking-wide mb-1.5">Right Now &middot; 20-yr Average</div>
            {data.current?.wbgt_mean_c != null ? (
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 border border-zinc-700"
                  style={{ background: FLAG_HEX[data.current.sports_flag ?? "white"] }}
                />
                <span className="text-zinc-100 text-lg font-bold">{data.current.wbgt_mean_c.toFixed(1)}&deg;C</span>
                <span className="text-zinc-500">WBGT</span>
              </div>
            ) : (
              <div className="text-zinc-600">no data for this hour</div>
            )}
            <div className="text-zinc-600 mt-1">
              REAL &middot; n={data.current?.sample_size ?? "?"} readings, 2006-2025
            </div>
          </div>

          <div className="px-3 py-3 border-b border-zinc-800">
            <div className="text-zinc-600 uppercase tracking-wide mb-1.5">Next 48h &middot; Real NWS Forecast</div>
            {forecastError && <div className="text-zinc-600">{forecastError}</div>}
            {forecastHours.length > 0 && (
              <>
                <div className="flex items-end gap-0.5 h-16 mb-2 bg-zinc-900 rounded p-1">
                  {forecastHours.map((h, i) => (
                    <div
                      key={i}
                      title={`${fmtHour(h.time_local)}: ${h.wbgt_c}°C WBGT (${h.sports_flag} flag)`}
                      className="flex-1 rounded-t-sm min-w-[2px] border-t-2"
                      style={{
                        height: `${Math.max(10, (h.wbgt_c / maxWbgt) * 100)}%`,
                        background: FLAG_HEX[h.sports_flag] ?? "#666",
                        borderTopColor: h.sports_flag === "black" ? "#ef4444" : "transparent",
                      }}
                    />
                  ))}
                </div>
                {peak && (
                  <div className="text-zinc-300">
                    Peak: <span className="font-bold">{peak.wbgt_c}&deg;C</span> ({peak.sports_flag} flag) at{" "}
                    {fmtHour(peak.time_local)}
                  </div>
                )}
                <div className="text-zinc-600 mt-1">REAL-FORECAST &middot; api.weather.gov, updated hourly</div>
              </>
            )}
          </div>

          <div className="px-3 py-3 border-b border-zinc-800">
            <div className="text-zinc-600 uppercase tracking-wide mb-1.5">20-Year Trend (July)</div>
            {data.trend ? (
              <>
                <div className="text-zinc-100">
                  <span
                    className={
                      data.trend.direction === "warming"
                        ? "text-red-400 font-bold"
                        : data.trend.direction === "cooling"
                          ? "text-blue-400 font-bold"
                          : "text-zinc-400"
                    }
                  >
                    {data.trend.direction === "warming" ? "↑" : data.trend.direction === "cooling" ? "↓" : "→"}{" "}
                    {data.trend.trend_c_per_decade > 0 ? "+" : ""}
                    {data.trend.trend_c_per_decade.toFixed(2)}&deg;C / decade
                  </span>
                </div>
                <div className="text-zinc-600 mt-1">
                  {data.trend.first_year_july_wbgt_c}&deg;C ({data.trend.first_year}) &rarr;{" "}
                  {data.trend.last_year_july_wbgt_c}&deg;C ({data.trend.last_year})
                </div>
                <div className="text-zinc-600 mt-1">REAL &middot; linear regression, real NOAA data</div>
              </>
            ) : (
              <div className="text-zinc-600">no trend data</div>
            )}
          </div>

          <div className="px-3 py-3 text-zinc-600 leading-relaxed">
            Ask the agent on the left for a full-week forecast, a specific date, or a &quot;what if&quot; scenario
            &mdash; this panel is just the fast-glance version.
          </div>
        </>
      )}
    </aside>
  );
}
