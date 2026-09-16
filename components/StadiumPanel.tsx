"use client";

import { useEffect, useState } from "react";
import { useHeatDashboardStore } from "@/lib/store";
import Stadium3D from "./Stadium3D";

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

export default function StadiumPanel() {
  const { selectedStadiumId, setSelectedStadium, month, hour } = useHeatDashboardStore();
  const [stadium, setStadium] = useState<StadiumDetail | null>(null);

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
  }, [selectedStadiumId, month, hour]);

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

      <div className="h-72 border-b border-zinc-700">
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

        <div className="text-zinc-600 pt-2 border-t border-zinc-800">
          Sample size n={stadium.wbgt?.sample_size ?? 0} hourly readings, 2006-2025, from the nearest NOAA
          global-hourly station. DATA: REAL. WBGT: approximated from temperature + dew point (see lib/wbgt.ts).
        </div>
      </div>
    </div>
  );
}
