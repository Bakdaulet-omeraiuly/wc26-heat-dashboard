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
  roof_type_status: string;
  field_orientation_deg: number | null;
  field_orientation_status: string;
  noaa_station_id: string;
  noaa_station_distance_km: number;
  wbgt: { mean: number; p10: number; p50: number; p90: number; sample_size: number } | null;
  heat_risk_level: string | null;
  percentile_within_year: number;
};

type ParkingLotRow = {
  lot: { osm_id: number; name: string; distance_m: number };
  walk_minutes: number;
  adjusted_wbgt_c: number | null;
  sports_flag: "white" | "green" | "yellow" | "red" | "black" | null;
  occupancy: { estimated_spaces: number; estimated_cars_now: number; occupancy_fraction: number } | null;
};

type Match = {
  kickoff_utc_iso: string;
  local_kickoff: string;
  utc_offset: number;
  round: string;
  is_future?: boolean;
  matchup_raw: string;
  real_kickoff_wbgt_c?: number | null;
  real_peak_wbgt_c?: number | null;
};

type LiveForecast = { wbgt_c: number; sports_flag: string } | { error: string } | null;

const FLAG_HEX: Record<string, string> = {
  white: "#e8e8e8",
  green: "#228b54",
  yellow: "#d4af28",
  red: "#c43c30",
  black: "#1a1a1a",
};

const RISK_HEX: Record<string, string> = {
  green: "#228b54",
  yellow: "#d4af28",
  orange: "#db8226",
  red: "#c43c30",
  magenta: "#a22a82",
};

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

export default function StadiumPanel() {
  const { selectedStadiumId, setSelectedStadium, month, hour, matchIndex, hoursFromKickoffOverride } = useHeatDashboardStore();
  const [stadium, setStadium] = useState<StadiumDetail | null>(null);
  const [parkingLots, setParkingLots] = useState<ParkingLotRow[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [focusLotOsmId, setFocusLotOsmId] = useState<number | null>(null);
  const [liveForecast, setLiveForecast] = useState<LiveForecast>(null);

  const selectedMatch = matches[matchIndex] ?? null;

  useEffect(() => {
    if (!selectedMatch?.is_future || !selectedStadiumId) {
      setLiveForecast(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/event-forecast?stadium=${selectedStadiumId}&kickoff_utc_iso=${encodeURIComponent(selectedMatch.kickoff_utc_iso)}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setLiveForecast(d))
      .catch((e) => !cancelled && setLiveForecast({ error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [selectedMatch, selectedStadiumId]);
  // Must match Stadium3D's own computation exactly (same formula, same
  // shared store fields) -- see lib/store.ts's comment on
  // hoursFromKickoffOverride for why this can't just derive from the
  // hour scrubber alone: Stadium3D's standalone preview slider can
  // override it independently of the scrubber.
  const scrubberHoursFromKickoff = (() => {
    if (!selectedMatch) return null;
    const kickoffHour = new Date(selectedMatch.kickoff_utc_iso).getUTCHours();
    let diff = hour - kickoffHour;
    if (diff > 12) diff -= 24;
    if (diff < -12) diff += 24;
    return diff;
  })();
  const hoursFromKickoff = scrubberHoursFromKickoff === null ? null : (hoursFromKickoffOverride ?? scrubberHoursFromKickoff);

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
    fetch(`/api/matches?stadium=${selectedStadiumId}`)
      .then((r) => r.json())
      .then((data) => setMatches(data.matches ?? []))
      .catch(() => setMatches([]));
  }, [selectedStadiumId, month, hour]);

  // Re-fetch parking whenever the scrubber-derived hoursFromKickoff
  // changes -- same signal Stadium3D's cars respond to, so the numbers
  // in this panel and the cars above never disagree.
  useEffect(() => {
    if (!selectedStadiumId) return;
    const occParam = hoursFromKickoff !== null ? `&hours_from_kickoff=${hoursFromKickoff}` : "";
    fetch(`/api/parking?stadium=${selectedStadiumId}&month=${month}&hour=${hour}${occParam}`)
      .then((r) => r.json())
      .then((data) => setParkingLots(data.lots ?? []))
      .catch(() => setParkingLots([]));
  }, [selectedStadiumId, month, hour, hoursFromKickoff]);

  const parkingSummary = (() => {
    if (parkingLots.length === 0) return null;
    const withWbgt = parkingLots.filter((l) => l.adjusted_wbgt_c !== null);
    const totalSpaces = parkingLots.reduce((sum, l) => sum + (l.occupancy?.estimated_spaces ?? 0), 0);
    const totalCarsNow = parkingLots.reduce((sum, l) => sum + (l.occupancy?.estimated_cars_now ?? 0), 0);
    const sorted = [...withWbgt].sort((a, b) => (a.adjusted_wbgt_c ?? 0) - (b.adjusted_wbgt_c ?? 0));
    return {
      totalLots: parkingLots.length,
      totalSpaces,
      totalCarsNow,
      fillPct: totalSpaces > 0 ? Math.round((totalCarsNow / totalSpaces) * 100) : 0,
      safest: sorted[0] ?? null,
      hottest: sorted[sorted.length - 1] ?? null,
    };
  })();

  if (!selectedStadiumId || !stadium) return null;

  const riskColor = stadium.heat_risk_level ? RISK_HEX[stadium.heat_risk_level] : undefined;

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

      {/* Back to the original order: 3D model first, stats below it in
          the scrollable area -- reverted per feedback (the earlier
          move-it-above attempt traded one problem for a layout the
          user didn't want). */}
      <div className="h-96 border-b border-zinc-700 shrink-0">
        <Stadium3D stadium={stadium} focusLotOsmId={focusLotOsmId} />
      </div>

      <div className="p-4 font-mono text-xs space-y-3 overflow-y-auto flex-1">
        {/* Headline card: the one number + risk pill a researcher scans for first */}
        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-zinc-500 uppercase tracking-wide text-[10px]">WBGT &middot; this bucket</span>
            {stadium.heat_risk_level && <Pill color={riskColor}>{stadium.heat_risk_level}</Pill>}
          </div>
          {stadium.wbgt ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-zinc-100 tabular-nums">{stadium.wbgt.mean.toFixed(1)}&deg;C</span>
                <span className="text-zinc-500">mean &middot; {Math.round(stadium.percentile_within_year * 100)}th percentile</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-zinc-800 tabular-nums">
                <div>
                  <div className="text-zinc-600">p10</div>
                  <div>{stadium.wbgt.p10.toFixed(1)}&deg;C</div>
                </div>
                <div>
                  <div className="text-zinc-600">p50</div>
                  <div>{stadium.wbgt.p50.toFixed(1)}&deg;C</div>
                </div>
                <div>
                  <div className="text-zinc-600">p90</div>
                  <div>{stadium.wbgt.p90.toFixed(1)}&deg;C</div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-zinc-600">no data</div>
          )}
        </div>

        {/* Venue facts card */}
        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="text-zinc-500 uppercase tracking-wide text-[10px] mb-2">Venue</div>
          <div className="grid grid-cols-2 gap-y-2 gap-x-3">
            <div>
              <div className="text-zinc-600">Roof</div>
              <div className="capitalize flex items-center gap-1.5">
                {stadium.roof_type}
                {stadium.roof_type_status !== "REAL" && <Pill>unverified</Pill>}
              </div>
            </div>
            <div>
              <div className="text-zinc-600">Field orientation</div>
              <div className="flex items-center gap-1.5">
                {stadium.field_orientation_deg !== null ? `${stadium.field_orientation_deg}°` : "—"}
                {stadium.field_orientation_status !== "REAL" && <Pill>unverified</Pill>}
              </div>
            </div>
            <div>
              <div className="text-zinc-600">Weather station</div>
              <div>{stadium.noaa_station_distance_km.toFixed(1)} km away</div>
            </div>
            <div>
              <div className="text-zinc-600">Sample size</div>
              <div>n={stadium.wbgt?.sample_size ?? 0}</div>
            </div>
          </div>
        </div>

        {/* Real match card */}
        {selectedMatch && (
          <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-zinc-500 uppercase tracking-wide text-[10px]">
                {selectedMatch.is_future ? "Upcoming Event" : "Real Match"} &middot; {selectedMatch.round}
              </span>
              {selectedMatch.is_future && <Pill color="#228b54">live</Pill>}
            </div>
            <div className="text-zinc-100">{selectedMatch.matchup_raw.replace(/\s+/g, " ")}</div>
            <div className="text-zinc-600 mt-0.5">
              {selectedMatch.kickoff_utc_iso.slice(0, 10)} &middot; kickoff {selectedMatch.local_kickoff} UTC
              {selectedMatch.utc_offset}
            </div>
            {selectedMatch.real_peak_wbgt_c != null && (
              <div className="mt-1.5 pt-1.5 border-t border-zinc-800">
                REAL weather that day: {selectedMatch.real_kickoff_wbgt_c}&deg;C at kickoff, peaked{" "}
                <span className="text-zinc-100 font-bold">{selectedMatch.real_peak_wbgt_c}&deg;C</span>
              </div>
            )}
            {selectedMatch.is_future && (
              <div className="mt-1.5 pt-1.5 border-t border-zinc-800">
                {liveForecast === null && <span className="text-zinc-600">loading live forecast&hellip;</span>}
                {liveForecast && "error" in liveForecast && <span className="text-zinc-600">{liveForecast.error}</span>}
                {liveForecast && "wbgt_c" in liveForecast && (
                  <>
                    LIVE forecast: <span className="text-zinc-100 font-bold">{liveForecast.wbgt_c}&deg;C</span> WBGT (
                    {liveForecast.sports_flag} flag) &mdash; fetched live, not stored
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {stadium.wbgt && <ScenarioSimulator baselineWbgt={stadium.wbgt.mean} roofType={stadium.roof_type} />}

        {/* Parking card */}
        <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-zinc-500 uppercase tracking-wide text-[10px]">Parking &middot; real lots</span>
            {hoursFromKickoff !== null && (
              <Pill>{hoursFromKickoff === 0 ? "at kickoff" : `${Math.abs(hoursFromKickoff)}h ${hoursFromKickoff < 0 ? "before" : "after"}`}</Pill>
            )}
          </div>
          {parkingSummary ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-zinc-100 tabular-nums">
                  {parkingSummary.totalCarsNow.toLocaleString()}
                </span>
                <span className="text-zinc-500">
                  / {parkingSummary.totalSpaces.toLocaleString()} spaces ({parkingSummary.fillPct}%) &middot;{" "}
                  {parkingSummary.totalLots} real lots
                </span>
              </div>
              <div className="h-1.5 rounded bg-zinc-800 mt-1.5 overflow-hidden">
                <div
                  className="h-full rounded transition-all"
                  style={{ width: `${parkingSummary.fillPct}%`, background: parkingSummary.fillPct > 70 ? "#c43c30" : "#228b54" }}
                />
              </div>

              {[
                { label: "Safest", row: parkingSummary.safest },
                { label: "Hottest", row: parkingSummary.hottest },
              ].map(
                ({ label, row }) =>
                  row && (
                    <button
                      key={label}
                      onClick={() => setFocusLotOsmId(row.lot.osm_id)}
                      className="w-full flex items-center gap-1.5 mt-2 pt-2 border-t border-zinc-800 text-left hover:bg-zinc-900/60 rounded transition-colors"
                      title="Click to fly the 3D view to this lot"
                    >
                      <span
                        className="w-2 h-2 rounded-full border border-zinc-600 shrink-0"
                        style={{ background: row.sports_flag ? FLAG_HEX[row.sports_flag] : "#666" }}
                      />
                      <span className="text-zinc-300">
                        {label}: {row.lot.name}
                      </span>
                      <span className="text-zinc-600 ml-auto">
                        {row.lot.distance_m}m &middot; {row.adjusted_wbgt_c}&deg;C
                      </span>
                    </button>
                  )
              )}
              <div className="text-zinc-600 mt-2 pt-2 border-t border-zinc-800 leading-snug">
                Capacity: real OSM geometry + real 9ft&times;18ft stall layout (SEMI). Fill curve: modeled,
                keyed to the real match kickoff above (MOCK). Click a lot above to view it in 3D.
              </div>
            </>
          ) : (
            <div className="text-zinc-600">no parking data</div>
          )}
        </div>

        <div className="text-zinc-600 pt-2 border-t border-zinc-800">
          From the nearest NOAA global-hourly station. DATA: REAL. WBGT: approximated from temperature + dew
          point (see lib/wbgt.ts).
        </div>
      </div>
    </div>
  );
}
