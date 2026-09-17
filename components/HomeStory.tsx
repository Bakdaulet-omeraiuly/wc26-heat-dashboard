"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/**
 * The homepage story: one question, the strongest verified real
 * findings, one clear next step -- structured as a hero + numbered
 * sections (a pattern referenced from another real environmental
 * dashboard the user pointed at, caspian-dash-tr1c.vercel.app), but
 * every number here is this app's own, verified directly against its
 * committed data before being written:
 *   - 78 real World Cup matches with real per-match weather
 *     (data/match_weather.json, Iowa Mesonet ASOS archive)
 *   - 54 of those 78 real matches had a real peak WBGT that exceeded
 *     that exact stadium's own real 20-year climatological mean for
 *     that exact month/hour (computed live against /api/stadiums)
 *   - 35.3C is the real maximum real_peak_wbgt_c across all 78 matches
 *   - 10 of 11 real stadiums show a real warming trend over the real
 *     2006-2025 NOAA record (data/discovery_trend.json's real linear
 *     regression; only SoFi Stadium's real trend is negative)
 * The numbered sections below reuse /api/home-story, which itself
 * reuses this app's existing real-data accessors -- no new numbers.
 */

type HomeStoryData = {
  trend: {
    warming_count: number;
    total: number;
    hottest_trend: { stadium_name: string; trend_c_per_decade: number } | null;
    stadiums: {
      stadium_id: string;
      stadium_name: string;
      trend_c_per_decade: number;
      direction: "warming" | "cooling" | "flat";
      yearly: { year: number; wbgt_c: number; sample_size: number }[];
    }[];
  };
  hottest_matches: { matchup_raw: string; city: string; round: string; kickoff_utc_iso: string; real_peak_wbgt_c: number }[];
  parking: {
    total_real_lots: number;
    longest_real_walk: { stadium: string; lot: string; walk_minutes: number; distance_m: number; wbgt_c: number } | null;
  };
};

function Tag({ status }: { status: "REAL" | "SEMI" | "MOCK" }) {
  const styles: Record<string, string> = {
    REAL: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    SEMI: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    MOCK: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide border shrink-0 ${styles[status]}`}>{status}</span>;
}

/** Counts up from 0 to `end` once, on mount -- the one cheap, honest
 * "moving" touch every reference dashboard like this uses for its
 * headline numbers (referenced from caspian-dash-tr1c.vercel.app):
 * animates HOW the real number is presented, never invents a
 * different one to animate toward. */
function CountUp({ end, decimals = 0, duration = 1100, suffix = "", prefix = "" }: { end: number; decimals?: number; duration?: number; suffix?: string; prefix?: string }) {
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const start = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(end * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [end, duration]);

  return (
    <>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </>
  );
}

function Section({ n, title, tag, children }: { n: string; title: string; tag: "REAL" | "SEMI" | "MOCK"; children: React.ReactNode }) {
  return (
    <section className="border-t border-zinc-800 py-8">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-zinc-700 text-2xl font-bold tabular-nums">{n}</span>
        <h2 className="text-zinc-100 font-bold text-base">{title}</h2>
        <Tag status={tag} />
      </div>
      {children}
    </section>
  );
}

export default function HomeStory({ onNavigate }: { onNavigate: (tab: "priority" | "map" | "lab" | "ask") => void }) {
  const [data, setData] = useState<HomeStoryData | null>(null);
  const [chartStadiumId, setChartStadiumId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/home-story")
      .then((r) => r.json())
      .then((d: HomeStoryData) => {
        setData(d);
        setChartStadiumId((prev) => prev ?? d.trend.stadiums[0]?.stadium_id ?? null);
      })
      .catch(() => setData(null));
  }, []);

  const maxTrend = data ? Math.max(...data.trend.stadiums.map((s) => Math.abs(s.trend_c_per_decade)), 0.1) : 0.1;
  const chartStadium = useMemo(() => data?.trend.stadiums.find((s) => s.stadium_id === chartStadiumId) ?? null, [data, chartStadiumId]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-12 font-mono">
        {/* --- Hero --- */}
        <div className="text-zinc-500 text-xs uppercase tracking-wide mb-3">Host-City Stadium Heat Intelligence System</div>
        <h1 className="text-2xl md:text-3xl font-bold text-zinc-50 leading-snug max-w-2xl">
          Where should cities act first to protect World Cup visitors from extreme heat?
        </h1>
        <p className="text-zinc-400 text-sm mt-4 max-w-2xl leading-relaxed">
          11 real host stadiums. 20 real years of NOAA hourly weather (2006-2025). Real 2026 match schedules, real
          parking-lot geometry, and a real live forecast feed -- combined into one answer: which venues, and which
          parts of each venue, need heat mitigation first.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
          {[
            { node: <CountUp end={78} />, label: "real matches analyzed", sub: "real per-match weather, Mesonet ASOS" },
            { node: <><CountUp end={54} /> / 78</>, label: "hotter than normal", sub: "real peak WBGT exceeded that stadium's own 20-yr average" },
            { node: <><CountUp end={35.3} decimals={1} />&deg;C</>, label: "hottest real peak WBGT", sub: "black-flag territory — highest measured across all 78" },
            { node: <><CountUp end={10} /> / 11</>, label: "stadiums warming", sub: "real 20-year NOAA trend, 2006-2025" },
          ].map((stat, i) => (
            <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 flex flex-col gap-1">
              <Tag status="REAL" />
              <div className="text-2xl font-bold text-zinc-100 tabular-nums leading-none mt-1">{stat.node}</div>
              <div className="text-zinc-400 text-xs">{stat.label}</div>
              <div className="text-zinc-600 text-[10px] leading-snug">{stat.sub}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 mt-8">
          <button
            onClick={() => onNavigate("priority")}
            className="px-4 py-2 rounded bg-zinc-100 text-zinc-900 font-bold text-sm hover:bg-white transition-colors"
          >
            See Priority Actions &rarr;
          </button>
          <button
            onClick={() => onNavigate("map")}
            className="px-4 py-2 rounded border border-zinc-700 text-zinc-300 text-sm hover:text-zinc-100 hover:border-zinc-500 transition-colors"
          >
            Explore the map + 3D
          </button>
        </div>

        {/* --- 01: The trend --- */}
        <Section n="01" title="20 real years, getting hotter" tag="REAL">
          {data ? (
            <>
              <p className="text-zinc-400 text-xs leading-relaxed mb-3 max-w-2xl">
                {data.trend.warming_count} of {data.trend.total} real host stadiums show a real warming trend in
                their own 2006-2025 NOAA record.{" "}
                {data.trend.hottest_trend && (
                  <>
                    <span className="text-zinc-100 font-bold">{data.trend.hottest_trend.stadium_name}</span> warms fastest,
                    at a real <span className="text-orange-400 font-bold">+{data.trend.hottest_trend.trend_c_per_decade.toFixed(2)}&deg;C</span> per decade.
                  </>
                )}
              </p>
              {/* Interactive: pick a stadium, watch its real 20-year July
                  WBGT line draw in -- the actual year-by-year series
                  getStadiumTrend()'s regression is computed from, not a
                  separate chart. */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {data.trend.stadiums.map((s) => (
                  <button
                    key={s.stadium_id}
                    onClick={() => setChartStadiumId(s.stadium_id)}
                    className={`px-2 py-1 rounded text-[10px] border transition-colors ${
                      chartStadiumId === s.stadium_id ? "bg-zinc-100 text-zinc-900 border-zinc-100" : "border-zinc-700 text-zinc-400 hover:text-zinc-100"
                    }`}
                  >
                    {s.stadium_name}
                  </button>
                ))}
              </div>
              {chartStadium && (
                <div className="rounded border border-zinc-800 bg-zinc-900 p-3 mb-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={chartStadium.yearly} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="year" stroke="#71717a" fontSize={10} tickLine={false} />
                      <YAxis stroke="#71717a" fontSize={10} tickLine={false} domain={["auto", "auto"]} unit="°C" />
                      <Tooltip
                        contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }}
                        labelFormatter={(y) => `July ${y}`}
                        formatter={(v) => [`${Number(v).toFixed(2)}°C`, "real July mean WBGT"]}
                      />
                      <Line type="monotone" dataKey="wbgt_c" stroke="#fb923c" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} animationDuration={900} />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="text-zinc-600 text-[10px] mt-1">
                    {chartStadium.stadium_name}: real July mean WBGT, {chartStadium.yearly[0]?.year}-{chartStadium.yearly[chartStadium.yearly.length - 1]?.year}
                    {" · "}
                    <span className={chartStadium.direction === "warming" ? "text-orange-400" : "text-sky-400"}>
                      {chartStadium.trend_c_per_decade > 0 ? "+" : ""}
                      {chartStadium.trend_c_per_decade.toFixed(2)}&deg;C/decade
                    </span>
                  </div>
                </div>
              )}
              <div className="space-y-1">
                {data.trend.stadiums.map((s) => (
                  <button
                    key={s.stadium_name}
                    onClick={() => setChartStadiumId(s.stadium_id)}
                    className={`w-full flex items-center gap-2 text-[11px] rounded px-1 -mx-1 hover:bg-zinc-900/60 transition-colors ${
                      chartStadiumId === s.stadium_id ? "bg-zinc-900" : ""
                    }`}
                  >
                    <span className="w-40 truncate text-zinc-400 text-left">{s.stadium_name}</span>
                    <div className="flex-1 h-3 bg-zinc-900 rounded overflow-hidden flex items-center">
                      <div
                        className={`h-full rounded transition-all ${s.direction === "warming" ? "bg-orange-500" : s.direction === "cooling" ? "bg-sky-500" : "bg-zinc-600"}`}
                        style={{ width: `${(Math.abs(s.trend_c_per_decade) / maxTrend) * 100}%` }}
                      />
                    </div>
                    <span className={`w-16 text-right tabular-nums ${s.direction === "warming" ? "text-orange-400" : "text-sky-400"}`}>
                      {s.trend_c_per_decade > 0 ? "+" : ""}
                      {s.trend_c_per_decade.toFixed(2)}&deg;C
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="text-zinc-600 text-xs">loading&hellip;</div>
          )}
        </Section>

        {/* --- 02: Match-day reality --- */}
        <Section n="02" title="Match-day reality" tag="REAL">
          <p className="text-zinc-400 text-xs leading-relaxed mb-3 max-w-2xl">
            The 5 real hottest World Cup matches by real peak WBGT (Mesonet ASOS, same station as each stadium&apos;s
            climatology) -- not modeled, what actually happened.
          </p>
          {data ? (
            <div className="space-y-1.5">
              {data.hottest_matches.map((m, i) => (
                <div key={i} className="flex items-center gap-3 text-[11px] py-1 border-b border-zinc-900">
                  <span className="text-zinc-600 w-4">{i + 1}</span>
                  <span className="text-zinc-200 flex-1 truncate">{m.matchup_raw}</span>
                  <span className="text-zinc-500 w-32 truncate hidden sm:inline">{m.city}</span>
                  <span className="text-zinc-600 w-24 hidden md:inline">{m.kickoff_utc_iso.slice(0, 10)}</span>
                  <span className="text-red-400 font-bold tabular-nums w-16 text-right">{m.real_peak_wbgt_c}&deg;C</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-zinc-600 text-xs">loading&hellip;</div>
          )}
        </Section>

        {/* --- 03: Parking and walking exposure --- */}
        <Section n="03" title="The walk from the car is part of the exposure" tag="SEMI">
          <p className="text-zinc-400 text-xs leading-relaxed mb-3 max-w-2xl">
            {data?.parking.total_real_lots.toLocaleString() ?? "…"} real parking lots mapped across all 11 venues
            (real OpenStreetMap geometry). The heat a fan experiences doesn&apos;t start at the gate -- it starts in
            the lot.
          </p>
          {data?.parking.longest_real_walk && (
            <div className="rounded border border-zinc-800 bg-zinc-900 p-3 max-w-md">
              <div className="text-zinc-500 text-[10px] uppercase tracking-wide mb-1">Longest real walk, across all 11 venues</div>
              <div className="text-zinc-100 font-bold">
                {data.parking.longest_real_walk.lot}, {data.parking.longest_real_walk.stadium}
              </div>
              <div className="text-zinc-400 text-xs mt-1">
                {data.parking.longest_real_walk.distance_m.toLocaleString()}m &middot;{" "}
                <span className="text-zinc-100 font-bold">{data.parking.longest_real_walk.walk_minutes} min</span> walk in real{" "}
                <span className="text-orange-400 font-bold">{data.parking.longest_real_walk.wbgt_c}&deg;C</span> WBGT
              </div>
            </div>
          )}
        </Section>

        {/* --- 04: What cities can do --- */}
        <Section n="04" title="What cities can do about it" tag="MOCK">
          <p className="text-zinc-400 text-xs leading-relaxed mb-3 max-w-2xl">
            6 real, published heat-mitigation strategies (EPA&apos;s heat-island framework, plus solar carports), each
            modeled on a real lot&apos;s real geometry -- tree shade, green/cool roofs, cool pavement, smart growth,
            angled re-striping, and solar carports. Every effect size is cited, never invented.
          </p>
          <button
            onClick={() => onNavigate("lab")}
            className="px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-xs hover:text-zinc-100 hover:border-zinc-500 transition-colors"
          >
            Open Urban Lab &rarr;
          </button>
        </Section>

        {/* --- 05: Ask the data --- */}
        <Section n="05" title="Ask the data directly" tag="REAL">
          <p className="text-zinc-400 text-xs leading-relaxed mb-3 max-w-2xl">
            A function-calling agent (Claude, real tool calls only -- it narrates real numbers, it never invents one)
            answers questions against this same real dataset: rankings, trends, live forecasts, parking exposure.
          </p>
          <button
            onClick={() => onNavigate("ask")}
            className="px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-xs hover:text-zinc-100 hover:border-zinc-500 transition-colors"
          >
            Open Ask &rarr;
          </button>
        </Section>

        {/* --- Methodology / honesty footer --- */}
        <div className="border-t border-zinc-800 pt-6 mt-2 text-zinc-600 text-[11px] leading-relaxed max-w-2xl">
          <div className="flex flex-wrap gap-3 mb-2">
            <span><Tag status="REAL" /> measured directly</span>
            <span><Tag status="SEMI" /> real geometry + one modeled term</span>
            <span><Tag status="MOCK" /> a modeled assumption, not measured here</span>
          </div>
          Sources: NOAA global-hourly (2006-2025), Iowa Mesonet ASOS archive, OpenStreetMap (Overpass), api.weather.gov,
          EPA heat-island reduction research, nflverse. Rice University Urban Sustainability Hackathon &middot; Track 3,
          Public Health &amp; the Built Environment.
        </div>
      </div>
    </div>
  );
}
