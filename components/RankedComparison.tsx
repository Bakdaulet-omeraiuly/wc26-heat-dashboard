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

const RISK_HEX: Record<string, string> = {
  green: "#228b54",
  yellow: "#d4af28",
  orange: "#db8226",
  red: "#c43c30",
  magenta: "#a22a82",
};

export default function RankedComparison() {
  const { month, hour, setSelectedStadium } = useHeatDashboardStore();
  const [stadiums, setStadiums] = useState<StadiumRisk[]>([]);

  useEffect(() => {
    fetch(`/api/stadiums?month=${month}&hour=${hour}`)
      .then((r) => r.json())
      .then((data) => {
        const sorted = [...data.stadiums].sort(
          (a: StadiumRisk, b: StadiumRisk) => (b.wbgt?.mean ?? -999) - (a.wbgt?.mean ?? -999)
        );
        setStadiums(sorted);
      });
  }, [month, hour]);

  const maxWbgt = Math.max(...stadiums.map((s) => s.wbgt?.mean ?? 0), 1);

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded p-3 font-mono text-xs">
      <div className="text-zinc-400 mb-2">
        RANKED BY WBGT &mdash; all 11 host cities, this month/hour bucket
      </div>
      <div className="space-y-1.5">
        {stadiums.map((s) => (
          <button
            key={s.id}
            onClick={() => setSelectedStadium(s.id)}
            className="w-full flex items-center gap-2 text-left hover:bg-zinc-800 rounded px-1 py-0.5"
          >
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
          </button>
        ))}
      </div>
    </div>
  );
}
