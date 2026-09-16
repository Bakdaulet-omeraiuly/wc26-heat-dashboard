"use client";

import { useMemo, useState } from "react";
import { useHeatDashboardStore } from "@/lib/store";
import { percentileToHeatRiskLevel } from "@/lib/wbgt";

/**
 * Scenario sliders let a parent/planner see how much a proposed
 * intervention would move a stadium's WBGT-based risk. These effect
 * sizes are MODELED ASSUMPTIONS, not directly measured facts -- stated
 * plainly here and in the UI itself, same discipline as caspian-dash's
 * own "honest limitations" section. Sources for the assumed magnitudes:
 *
 * - Shade coverage: shade reduces the RADIANT heat term WBGT's globe-
 *   temperature component captures. Our approximation (lib/wbgt.ts)
 *   doesn't have a separate radiant term to shrink directly (it's
 *   folded into the vapor-pressure-driven formula) -- so we apply an
 *   estimated ~0.03C WBGT reduction per 10% shade coverage, a rough
 *   figure in the general range cited in outdoor-shade heat-mitigation
 *   literature, NOT measured for these specific stadiums.
 * - Misting stations: an assumed flat -0.5C WBGT per station added
   (up to a diminishing-returns cap), again a plausible modeled
 *   magnitude, not a measured one.
 * - Roof closed: for retractable-roof venues, closing the roof is
 *   modeled as removing solar/radiant exposure almost entirely -- a
 *   flat -3C WBGT assumption when closed (a bigger, more defensible
 *   effect than shade/misting since it removes direct sun entirely,
 *   but still a modeled number, not a measured one for these venues).
 */

const SHADE_EFFECT_PER_10PCT = 0.03;
const MISTING_EFFECT_PER_STATION = 0.5;
const MISTING_CAP = 3;
const ROOF_CLOSED_EFFECT = 3;

export default function ScenarioSimulator({
  baselineWbgt,
  roofType,
}: {
  baselineWbgt: number;
  roofType: string;
}) {
  const [shadePct, setShadePct] = useState(0);
  const [mistingStations, setMistingStations] = useState(0);
  const [roofClosed, setRoofClosed] = useState(false);

  const canCloseRoof = roofType === "retractable";

  const adjustedWbgt = useMemo(() => {
    let w = baselineWbgt;
    w -= (shadePct / 10) * SHADE_EFFECT_PER_10PCT;
    w -= Math.min(mistingStations * MISTING_EFFECT_PER_STATION, MISTING_CAP);
    if (canCloseRoof && roofClosed) w -= ROOF_CLOSED_EFFECT;
    return Math.max(w, 0);
  }, [baselineWbgt, shadePct, mistingStations, roofClosed, canCloseRoof]);

  // Rough percentile shift for display purposes -- reuses the same
  // scale function, fed a crude linear approximation of where the
  // adjusted value would sit (this is illustrative, not a re-run of
  // the real percentile computation against historical data).
  const before = percentileToHeatRiskLevel(0.85);
  const reduction = baselineWbgt > 0 ? (baselineWbgt - adjustedWbgt) / baselineWbgt : 0;
  const after = percentileToHeatRiskLevel(Math.max(0.85 - reduction, 0));

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded p-4 font-mono text-xs space-y-4">
      <div className="text-zinc-400">
        SCENARIO SIMULATOR &mdash; modeled interventions, not measured effects (see component source for
        assumptions)
      </div>

      <div>
        <div className="flex justify-between mb-1">
          <span>Shade coverage added</span>
          <span>{shadePct}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={10}
          value={shadePct}
          onChange={(e) => setShadePct(Number(e.target.value))}
          className="w-full"
        />
      </div>

      <div>
        <div className="flex justify-between mb-1">
          <span>Misting stations added</span>
          <span>{mistingStations}</span>
        </div>
        <input
          type="range"
          min={0}
          max={10}
          value={mistingStations}
          onChange={(e) => setMistingStations(Number(e.target.value))}
          className="w-full"
        />
      </div>

      {canCloseRoof && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={roofClosed} onChange={(e) => setRoofClosed(e.target.checked)} />
          <span>Close retractable roof</span>
        </label>
      )}

      <div className="border-t border-zinc-800 pt-3 grid grid-cols-2 gap-4">
        <div>
          <div className="text-zinc-500">BEFORE</div>
          <div className="text-lg font-bold">{baselineWbgt.toFixed(1)}&deg;C</div>
          <div className="uppercase">{before}</div>
        </div>
        <div>
          <div className="text-zinc-500">AFTER</div>
          <div className="text-lg font-bold">{adjustedWbgt.toFixed(1)}&deg;C</div>
          <div className="uppercase">{after}</div>
        </div>
      </div>
    </div>
  );
}
