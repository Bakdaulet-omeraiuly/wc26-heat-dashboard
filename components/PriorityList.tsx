"use client";

import { useEffect, useState } from "react";
import { useHeatDashboardStore } from "@/lib/store";

type LotExposure = { name: string; distance_m: number; walk_minutes: number; adjusted_wbgt_c: number | null; sports_flag: string | null };

type PriorityRow = {
  id: string;
  name: string;
  city: string;
  roof_type: string;
  heat_risk: {
    wbgt_mean_c: number;
    wbgt_p10_c: number | null;
    wbgt_p90_c: number | null;
    heat_risk_level: string | null;
    sports_flag: string | null;
    percentile_within_stadium_year: number | null;
    sample_size: number | null;
    data_status: "REAL";
  };
  trend: { trend_c_per_decade: number; direction: "warming" | "cooling" | "flat"; n_years: number; first_year: number; last_year: number; data_status: "REAL" } | null;
  walk_exposure: { safest: LotExposure; hottest: LotExposure; total_lots: number; data_status: "SEMI" } | null;
  mitigation: {
    baseline_wbgt_c: number;
    projected_wbgt_c: number;
    reduction_c: number;
    roof_closed_applied: boolean;
    inputs: { shade_pct: number; misting_stations: number; roof_closed: boolean };
    data_status: "MOCK";
    caveat: string;
  } | null;
  why_priority: string[];
};

const RISK_HEX: Record<string, string> = {
  green: "#228b54",
  yellow: "#d4af28",
  orange: "#db8226",
  red: "#c43c30",
  magenta: "#a22a82",
};

const FLAG_HEX: Record<string, string> = {
  white: "#e8e8e8",
  green: "#228b54",
  yellow: "#d4af28",
  red: "#c43c30",
  black: "#3a0a0a",
};

/** A small, consistently-styled tag naming exactly how sure this app
 * is of the number next to it -- carried through every section of
 * this view so a reader never has to guess which numbers are
 * measured, derived, or modeled. */
function DataTag({ status }: { status: "REAL" | "SEMI" | "MOCK" | "MODELED" }) {
  const styles: Record<string, string> = {
    REAL: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    SEMI: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    MOCK: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    MODELED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide border ${styles[status]}`}>{status}</span>;
}

function Pill({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide border"
      style={color ? { background: `${color}26`, borderColor: `${color}66`, color } : { borderColor: "#3f3f46", color: "#a1a1aa" }}
    >
      {children}
    </span>
  );
}

export default function PriorityList() {
  const { month, hour, setSelectedStadium } = useHeatDashboardStore();
  const [rows, setRows] = useState<PriorityRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/priority?month=${month}&hour=${hour}`)
      .then((r) => r.json())
      .then((data) => setRows(data.stadiums ?? []))
      .finally(() => setLoading(false));
  }, [month, hour]);

  return (
    <div className="max-w-4xl mx-auto font-mono text-xs space-y-4">
      <div>
        <h2 className="text-zinc-100 text-lg font-bold">PRIORITY ACTION &mdash; where to invest first</h2>
        <p className="text-zinc-500 mt-1 max-w-2xl leading-relaxed">
          All 11 real host stadiums, ranked by current real WBGT (the simplest defensible ordering: fix the hottest
          place first). A true attendee-hours-at-risk ranking would need real per-venue capacity data this app
          doesn&apos;t have verified yet, so it isn&apos;t fabricated here. Every number below is tagged{" "}
          <DataTag status="REAL" /> (measured), <DataTag status="SEMI" /> (real geometry + one modeled term), or{" "}
          <DataTag status="MOCK" /> (a modeled assumption, not measured at this venue).
        </p>
      </div>

      {loading && <div className="text-zinc-600">loading&hellip;</div>}

      <div className="space-y-3">
        {rows.map((s, i) => {
          const riskColor = s.heat_risk.heat_risk_level ? RISK_HEX[s.heat_risk.heat_risk_level] : undefined;
          return (
            <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-zinc-600 text-sm font-bold">#{i + 1}</span>
                  <button onClick={() => setSelectedStadium(s.id)} className="text-zinc-100 font-bold text-sm hover:underline text-left">
                    {s.name}
                  </button>
                  <span className="text-zinc-500">{s.city}</span>
                </div>
                {s.heat_risk.heat_risk_level && <Pill color={riskColor}>{s.heat_risk.heat_risk_level}</Pill>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Heat risk */}
                <div className="bg-zinc-950/60 border border-zinc-800 rounded p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-zinc-500 text-[10px] uppercase tracking-wide">Heat risk now</span>
                    <DataTag status="REAL" />
                  </div>
                  <div className="text-xl font-bold text-zinc-100 tabular-nums">{s.heat_risk.wbgt_mean_c.toFixed(1)}&deg;C</div>
                  <div className="text-zinc-500 text-[10px]">
                    {s.heat_risk.percentile_within_stadium_year != null && `${Math.round(s.heat_risk.percentile_within_stadium_year * 100)}th pct`}
                    {s.heat_risk.sample_size != null && ` · n=${s.heat_risk.sample_size}`}
                  </div>
                  {s.trend && (
                    <div className="text-[10px] mt-1 pt-1 border-t border-zinc-800 flex items-center gap-1">
                      <span className={s.trend.direction === "warming" ? "text-orange-400" : s.trend.direction === "cooling" ? "text-sky-400" : "text-zinc-500"}>
                        {s.trend.direction === "warming" ? "↗" : s.trend.direction === "cooling" ? "↘" : "→"} {s.trend.trend_c_per_decade > 0 ? "+" : ""}
                        {s.trend.trend_c_per_decade.toFixed(2)}&deg;C/decade
                      </span>
                      <DataTag status="REAL" />
                    </div>
                  )}
                </div>

                {/* Walking exposure */}
                <div className="bg-zinc-950/60 border border-zinc-800 rounded p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-zinc-500 text-[10px] uppercase tracking-wide">Parking walk exposure</span>
                    <DataTag status="SEMI" />
                  </div>
                  {s.walk_exposure ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.walk_exposure.safest.sports_flag ? FLAG_HEX[s.walk_exposure.safest.sports_flag] : "#666" }} />
                        <span className="text-zinc-300 truncate">Safest: {s.walk_exposure.safest.name}</span>
                        <span className="text-zinc-500 ml-auto tabular-nums">{s.walk_exposure.safest.adjusted_wbgt_c}&deg;C</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.walk_exposure.hottest.sports_flag ? FLAG_HEX[s.walk_exposure.hottest.sports_flag] : "#666" }} />
                        <span className="text-zinc-300 truncate">Hottest: {s.walk_exposure.hottest.name}</span>
                        <span className="text-zinc-500 ml-auto tabular-nums">{s.walk_exposure.hottest.adjusted_wbgt_c}&deg;C</span>
                      </div>
                      <div className="text-zinc-600 text-[10px] mt-1 pt-1 border-t border-zinc-800">{s.walk_exposure.total_lots} real lots &middot; {s.walk_exposure.hottest.walk_minutes}min worst walk</div>
                    </>
                  ) : (
                    <div className="text-zinc-600">no real lot data</div>
                  )}
                </div>

                {/* Mitigation */}
                <div className="bg-zinc-950/60 border border-zinc-800 rounded p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-zinc-500 text-[10px] uppercase tracking-wide">Modeled mitigation</span>
                    <DataTag status="MOCK" />
                  </div>
                  {s.mitigation ? (
                    <>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-zinc-500 tabular-nums">{s.mitigation.baseline_wbgt_c.toFixed(1)}&deg;C</span>
                        <span className="text-zinc-600">&rarr;</span>
                        <span className="text-lg font-bold text-emerald-400 tabular-nums">{s.mitigation.projected_wbgt_c.toFixed(1)}&deg;C</span>
                      </div>
                      <div className="text-zinc-500 text-[10px]">
                        -{s.mitigation.reduction_c.toFixed(1)}&deg;C: full shade + misting{s.mitigation.roof_closed_applied ? " + roof closed" : ""}
                      </div>
                      <div className="text-zinc-600 text-[9px] mt-1 pt-1 border-t border-zinc-800 leading-snug">A modeled ceiling on impact, not a promised outcome.</div>
                    </>
                  ) : (
                    <div className="text-zinc-600">no data</div>
                  )}
                </div>
              </div>

              {s.why_priority.length > 0 && (
                <div className="mt-3 pt-3 border-t border-zinc-800 text-zinc-400 text-[11px] leading-relaxed">
                  <span className="text-zinc-500 uppercase tracking-wide text-[10px] mr-1.5">Why:</span>
                  {s.why_priority.join(" · ")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
