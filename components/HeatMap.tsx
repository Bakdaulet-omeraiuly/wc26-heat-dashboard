"use client";

import { useEffect, useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { MapViewState } from "@deck.gl/core";
import { useHeatDashboardStore } from "@/lib/store";

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -97,
  latitude: 38,
  zoom: 3.4,
  pitch: 0,
  bearing: 0,
};

// Our own percentile-based heat-risk scale (see lib/wbgt.ts) --
// consistent colors used everywhere in the app, not just here.
const RISK_COLORS: Record<string, [number, number, number]> = {
  green: [34, 139, 84],
  yellow: [212, 175, 40],
  orange: [219, 130, 38],
  red: [196, 60, 48],
  magenta: [162, 42, 130],
};

type StadiumWithRisk = {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  heat_risk_level: keyof typeof RISK_COLORS | null;
  wbgt: { mean: number; p10: number; p50: number; p90: number; sample_size: number } | null;
  percentile_within_year: number;
  roof_type: string;
};

export default function HeatMap() {
  const { month, hour, setMonth, setHour, selectedStadiumId, setSelectedStadium } = useHeatDashboardStore();
  const [stadiums, setStadiums] = useState<StadiumWithRisk[]>([]);
  const [usStates, setUsStates] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/us-states.json")
      .then((r) => r.json())
      .then(setUsStates)
      .catch((e) => console.error("failed to load basemap", e));
  }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stadiums?month=${month}&hour=${hour}`)
      .then((r) => r.json())
      .then((data) => {
        setStadiums(data.stadiums);
        setLoading(false);
      })
      .catch((e) => {
        console.error("failed to load stadium risk data", e);
        setLoading(false);
      });
  }, [month, hour]);

  const layers = useMemo(() => {
    const result = [];
    if (usStates) {
      result.push(
        new GeoJsonLayer({
          id: "us-states",
          data: usStates,
          filled: true,
          stroked: true,
          getFillColor: [30, 32, 38],
          getLineColor: [70, 74, 84],
          lineWidthMinPixels: 1,
        })
      );
    }
    result.push(
      new ScatterplotLayer<StadiumWithRisk>({
        id: "stadiums",
        data: stadiums,
        getPosition: (d) => [d.lon, d.lat],
        getFillColor: (d) => (d.heat_risk_level ? RISK_COLORS[d.heat_risk_level] : [120, 120, 120]),
        getRadius: (d) => (d.id === selectedStadiumId ? 28000 : 20000),
        radiusMinPixels: 8,
        radiusMaxPixels: 40,
        stroked: true,
        getLineColor: [255, 255, 255],
        lineWidthMinPixels: 2,
        pickable: true,
        onClick: (info) => info.object && setSelectedStadium((info.object as StadiumWithRisk).id),
        updateTriggers: {
          getFillColor: [stadiums],
          getRadius: [selectedStadiumId],
        },
        transitions: {
          getFillColor: 400,
        },
      })
    );
    return result;
  }, [usStates, stadiums, selectedStadiumId, setSelectedStadium]);

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  return (
    <div className="relative w-full h-full">
      <DeckGL initialViewState={INITIAL_VIEW_STATE} controller layers={layers} style={{ background: "#0b0d10" }} />

      {/* Instrument-panel data strip, not a decorative overlay */}
      <div className="absolute top-3 left-3 bg-black/70 text-zinc-100 font-mono text-xs px-3 py-2 rounded border border-zinc-700">
        <div>DATA: NOAA global-hourly, 2006-2025 (REAL)</div>
        <div>{loading ? "loading..." : `${stadiums.length} stadiums loaded`}</div>
      </div>

      {/* Time scrubber -- dragging this recolors the map live, same
          interaction pattern as the team's earlier Caspian Watch year
          slider (see spec.md Section 3, View A). */}
      <div className="absolute bottom-3 left-3 right-3 bg-black/80 border border-zinc-700 rounded px-4 py-3 text-zinc-100 font-mono text-xs">
        <div className="flex items-center gap-4 mb-2">
          <span className="w-24">MONTH: {monthNames[month - 1]}</span>
          <input
            type="range"
            min={1}
            max={12}
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="flex-1"
          />
        </div>
        <div className="flex items-center gap-4">
          <span className="w-24">HOUR: {String(hour).padStart(2, "0")}:00 UTC</span>
          <input
            type="range"
            min={0}
            max={23}
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            className="flex-1"
          />
        </div>
      </div>

      {/* Legend */}
      <div className="absolute top-3 right-3 bg-black/70 text-zinc-100 font-mono text-xs px-3 py-2 rounded border border-zinc-700">
        <div className="mb-1 text-zinc-400">HEAT RISK (percentile-relative)</div>
        {Object.entries(RISK_COLORS).map(([level, [r, g, b]]) => (
          <div key={level} className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: `rgb(${r},${g},${b})` }}
            />
            <span className="uppercase">{level}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
