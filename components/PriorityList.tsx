"use client";

import { useEffect, useState } from "react";
import { useHeatDashboardStore } from "@/lib/store";

type StadiumRisk = {
  id: string;
  name: string;
  city: string;
  roof_type: string;
  wbgt: { mean: number } | null;
  heat_risk_level: string | null;
};

// Same modeled constants as ScenarioSimulator.tsx -- kept in sync
// manually for now (both files note these are assumptions, not
// measurements; see that component's docstring for sourcing).
const MAX_SHADE_EFFECT = 0.03 * 10; // 100% shade
const MAX_MISTING_EFFECT = 3; // capped
const ROOF_CLOSED_EFFECT = 3;

function projectedAfterFullMitigation(wbgt: number, roofType: string): number {
  let w = wbgt - MAX_SHADE_EFFECT - MAX_MISTING_EFFECT;
  if (roofType === "retractable") w -= ROOF_CLOSED_EFFECT;
  return Math.max(w, 0);
}

export default function PriorityList() {
  const { month, hour, setSelectedStadium } = useHeatDashboardStore();
  const [stadiums, setStadiums] = useState<StadiumRisk[]>([]);

  useEffect(() => {
    fetch(`/api/stadiums?month=${month}&hour=${hour}`)
      .then((r) => r.json())
      .then((data) => {
        const withProjection = data.stadiums.map((s: StadiumRisk) => ({
          ...s,
          projected: s.wbgt ? projectedAfterFullMitigation(s.wbgt.mean, s.roof_type) : null,
        }));
        // Priority = current WBGT (fix the worst places first) -- a
        // simple, defensible ordering. A true "attendee-hours at risk"
        // ranking would need real per-venue capacity data, which isn't
        // verified yet (see spec.md) -- not fabricated here.
        withProjection.sort((a: any, b: any) => (b.wbgt?.mean ?? -999) - (a.wbgt?.mean ?? -999));
        setStadiums(withProjection);
      });
  }, [month, hour]);

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded p-4 font-mono text-xs max-w-3xl">
      <div className="text-zinc-400 mb-1">
        PRIORITY LIST &mdash; invest in cooling infrastructure here first
      </div>
      <div className="text-zinc-600 mb-3">
        Ranked by current WBGT. &quot;Projected&quot; = full modeled mitigation bundle (100% shade + max
        misting + roof closed where applicable) -- a modeled ceiling on impact, not a promised outcome. A
        true attendee-hours-at-risk ranking would need per-venue capacity data, not yet verified -- not
        fabricated here.
      </div>
      <table className="w-full">
        <thead>
          <tr className="text-zinc-500 border-b border-zinc-800">
            <th className="text-left py-1">#</th>
            <th className="text-left py-1">Stadium</th>
            <th className="text-right py-1">Current WBGT</th>
            <th className="text-right py-1">Projected (full mitigation)</th>
            <th className="text-right py-1">Reduction</th>
          </tr>
        </thead>
        <tbody>
          {stadiums.map((s: any, i) => (
            <tr
              key={s.id}
              onClick={() => setSelectedStadium(s.id)}
              className="border-b border-zinc-800 hover:bg-zinc-800 cursor-pointer"
            >
              <td className="py-1.5">{i + 1}</td>
              <td className="py-1.5">{s.name}</td>
              <td className="text-right py-1.5">{s.wbgt?.mean.toFixed(1) ?? "--"}&deg;C</td>
              <td className="text-right py-1.5 text-zinc-400">{s.projected?.toFixed(1) ?? "--"}&deg;C</td>
              <td className="text-right py-1.5 text-emerald-400">
                {s.wbgt ? `-${(s.wbgt.mean - s.projected).toFixed(1)}°C` : "--"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
