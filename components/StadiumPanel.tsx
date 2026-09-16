"use client";

import { useEffect, useState } from "react";
import { useHeatDashboardStore } from "@/lib/store";
import Stadium3D from "./Stadium3D";
import ScenarioSimulator from "./ScenarioSimulator";

type StadiumDetail = {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  roof_type: string;
  field_orientation_deg: number | null;
  wbgt: { mean: number; p10: number; p50: number; p90: number; sample_size: number } | null;
  heat_risk_level: string | null;
  percentile_within_year: number;
};

type ParkingLotRow = {
  lot: { name: string; distance_m: number };
  walk_minutes: number;
  adjusted_wbgt_c: number | null;
  sports_flag: "white" | "green" | "yellow" | "red" | "black" | null;
  occupancy: { estimated_spaces: number } | null;
};

const FLAG_HEX: Record<string, string> = {
  white: "#e8e8e8",
  green: "#228b54",
  yellow: "#d4af28",
  red: "#c43c30",
  black: "#1a1a1a",
};

export default function StadiumPanel() {
  const { selectedStadiumId, setSelectedStadium, month, hour } = useHeatDashboardStore();
  const [stadium, setStadium] = useState<StadiumDetail | null>(null);
  const [parkingLots, setParkingLots] = useState<ParkingLotRow[]>([]);

  useEffect(() => {
    if (!selectedStadiumId) {
      setStadium(null);
      return;
    }
    fetch(`/api/stadiums?month=${month}&hour=${hour}`)
      .then((r) => r.json())
      .then((data) => {
        const found = data.stadiums.find((s: StadiumDetail) => s.id === selectedStadiumId);
        setStadium(found ?? null);
      });
    fetch(`/api/parking?stadium=${selectedStadiumId}&month=${month}&hour=${hour}&hours_from_kickoff=0`)
      .then((r) => r.json())
      .then((data) => setParkingLots(data.lots ?? []))
      .catch(() => setParkingLots([]));
  }, [selectedStadiumId, month, hour]);

  const parkingSummary = (() => {
    if (parkingLots.length === 0) return null;
    const withWbgt = parkingLots.filter((l) => l.adjusted_wbgt_c !== null);
    const totalSpaces = parkingLots.reduce((sum, l) => sum + (l.occupancy?.estimated_spaces ?? 0), 0);
    const sorted = [...withWbgt].sort((a, b) => (a.adjusted_wbgt_c ?? 0) - (b.adjusted_wbgt_c ?? 0));
    return {
      totalLots: parkingLots.length,
      totalSpaces,
      safest: sorted[0] ?? null,
      hottest: sorted[sorted.length - 1] ?? null,
    };
  })();

  if (!selectedStadiumId || !stadium) return null;

  return (
    <div className="absolute inset-y-0 right-0 w-[420px] bg-zinc-900 border-l border-zinc-700 flex flex-col z-10">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
        <div>
          <div className="font-mono text-sm font-bold">{stadium.name}</div>
          <div className="font-mono text-xs text-zinc-500">{stadium.city}</div>
        </div>
        <button
          onClick={() => setSelectedStadium(null)}
          className="font-mono text-xs text-zinc-400 hover:text-zinc-100 border border-zinc-700 rounded px-2 py-1"
        >
          ✕ CLOSE
        </button>
      </div>

      <div className="h-96 border-b border-zinc-700">
        <Stadium3D stadium={stadium} />
      </div>

      <div className="p-4 font-mono text-xs space-y-3 overflow-y-auto flex-1">
        <div>
          <div className="text-zinc-500 mb-1">WBGT (this bucket)</div>
          {stadium.wbgt ? (
            <div className="grid grid-cols-4 gap-2">
              <div>
                <div className="text-zinc-500">p10</div>
                <div>{stadium.wbgt.p10.toFixed(1)}&deg;C</div>
              </div>
              <div>
                <div className="text-zinc-500">mean</div>
                <div className="font-bold">{stadium.wbgt.mean.toFixed(1)}&deg;C</div>
              </div>
              <div>
                <div className="text-zinc-500">p50</div>
                <div>{stadium.wbgt.p50.toFixed(1)}&deg;C</div>
              </div>
              <div>
                <div className="text-zinc-500">p90</div>
                <div>{stadium.wbgt.p90.toFixed(1)}&deg;C</div>
              </div>
            </div>
          ) : (
            <div className="text-zinc-600">no data</div>
          )}
        </div>

        <div>
          <div className="text-zinc-500 mb-1">Heat risk (percentile within this stadium&apos;s own year)</div>
          <div className="uppercase font-bold">{stadium.heat_risk_level ?? "unknown"}</div>
          <div className="text-zinc-500">{Math.round(stadium.percentile_within_year * 100)}th percentile</div>
        </div>

        <div>
          <div className="text-zinc-500 mb-1">Roof</div>
          <div className="capitalize">{stadium.roof_type}</div>
        </div>

        {stadium.wbgt && <ScenarioSimulator baselineWbgt={stadium.wbgt.mean} roofType={stadium.roof_type} />}

        <div className="pt-2 border-t border-zinc-800">
          <div className="text-zinc-500 mb-1">Parking (real lots, this bucket)</div>
          {parkingSummary ? (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="text-zinc-100 font-bold text-sm">{parkingSummary.totalSpaces.toLocaleString()}</span>
                <span className="text-zinc-500">spaces across {parkingSummary.totalLots} real lots</span>
              </div>
              {parkingSummary.safest && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span
                    className="w-2 h-2 rounded-full border border-zinc-600 shrink-0"
                    style={{ background: parkingSummary.safest.sports_flag ? FLAG_HEX[parkingSummary.safest.sports_flag] : "#666" }}
                  />
                  <span>Safest: {parkingSummary.safest.lot.name}</span>
                  <span className="text-zinc-600 ml-auto">
                    {parkingSummary.safest.lot.distance_m}m &middot; {parkingSummary.safest.adjusted_wbgt_c}&deg;C
                  </span>
                </div>
              )}
              {parkingSummary.hottest && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className="w-2 h-2 rounded-full border border-zinc-600 shrink-0"
                    style={{ background: parkingSummary.hottest.sports_flag ? FLAG_HEX[parkingSummary.hottest.sports_flag] : "#666" }}
                  />
                  <span>Hottest: {parkingSummary.hottest.lot.name}</span>
                  <span className="text-zinc-600 ml-auto">
                    {parkingSummary.hottest.lot.distance_m}m &middot; {parkingSummary.hottest.adjusted_wbgt_c}&deg;C
                  </span>
                </div>
              )}
              <div className="text-zinc-600 mt-1.5">
                Capacity: real OSM geometry + real 9ft&times;18ft stall layout. Walk-in WBGT: real distance/WBGT +
                modeled pavement-sun surcharge (SEMI).
              </div>
            </>
          ) : (
            <div className="text-zinc-600">no parking data</div>
          )}
        </div>

        <div className="text-zinc-600 pt-2 border-t border-zinc-800">
          Sample size n={stadium.wbgt?.sample_size ?? 0} hourly readings, 2006-2025, from the nearest NOAA
          global-hourly station. DATA: REAL. WBGT: approximated from temperature + dew point (see lib/wbgt.ts).
        </div>
      </div>
    </div>
  );
}
