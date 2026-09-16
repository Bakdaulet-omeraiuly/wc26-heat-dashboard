"use client";

import { useEffect, useState } from "react";
import { useHeatDashboardStore } from "@/lib/store";

type StadiumRisk = {
  id: string;
  name: string;
  city: string;
  wbgt: { mean: number } | null;
  heat_risk_level: string | null;
  percentile_within_year: number;
};

type SafestLot = { name: string; distance_m: number; adjusted_wbgt_c: number | null; sports_flag: string | null };

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
  black: "#1a1a1a",
};

export default function RankedComparison() {
  const { month, hour, setSelectedStadium } = useHeatDashboardStore();
  const [stadiums, setStadiums] = useState<StadiumRisk[]>([]);
  const [safestLots, setSafestLots] = useState<Record<string, SafestLot | null>>({});

  useEffect(() => {
    fetch(`/api/stadiums?month=${month}&hour=${hour}`)
      .then((r) => r.json())
      .then((data) => {
        const sorted = [...data.stadiums].sort(
          (a: StadiumRisk, b: StadiumRisk) => (b.wbgt?.mean ?? -999) - (a.wbgt?.mean ?? -999)
        );
        setStadiums(sorted);
      });
    fetch(`/api/parking-summary?month=${month}&hour=${hour}`)
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, SafestLot | null> = {};
        for (const [id, v] of Object.entries<{ safest: SafestLot | null }>(data.summary ?? {})) {
          map[id] = v.safest;
        }
        setSafestLots(map);
      })
      .catch(() => setSafestLots({}));
  }, [month, hour]);

  const maxWbgt = Math.max(...stadiums.map((s) => s.wbgt?.mean ?? 0), 1);

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded p-3 font-mono text-xs">
      <div className="text-zinc-400 mb-2">
        RANKED BY WBGT &mdash; all 11 host cities, this month/hour bucket
      </div>
      <div className="space-y-1.5">
        {stadiums.map((s) => {
          const safest = safestLots[s.id];
          return (
            <button
              key={s.id}
              onClick={() => setSelectedStadium(s.id)}
              className="w-full text-left hover:bg-zinc-800 rounded px-1 py-0.5"
            >
              <div className="flex items-center gap-2">
                <span className="w-40 truncate text-zinc-300">{s.name}</span>
                <div className="flex-1 bg-zinc-800 rounded h-4 relative overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${((s.wbgt?.mean ?? 0) / maxWbgt) * 100}%`,
                      backgroundColor: s.heat_risk_level ? RISK_HEX[s.heat_risk_level] : "#666",
                    }}
                  />
                </div>
                <span className="w-16 text-right text-zinc-300">{s.wbgt?.mean.toFixed(1) ?? "--"}&deg;C</span>
              </div>
              {safest && (
                <div className="flex items-center gap-1.5 pl-1 mt-0.5 text-[10px] text-zinc-500">
                  <span
                    className="w-1.5 h-1.5 rounded-full border border-zinc-700 shrink-0"
                    style={{ background: safest.sports_flag ? FLAG_HEX[safest.sports_flag] : "#666" }}
                  />
                  <span>
                    Safest walk: {safest.name} &middot; {safest.distance_m}m &middot; {safest.adjusted_wbgt_c}&deg;C
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
