"use client";

import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useHeatDashboardStore } from "@/lib/store";

type Reading = { hour_utc: number; temp_c: number; dewpoint_c: number; wbgt: number };
type HistoryResponse = {
  date: string;
  reading_count: number;
  readings: Reading[];
  data_status: string;
  error?: string;
};

const STADIUM_OPTIONS = [
  { id: "att-stadium", name: "AT&T Stadium (Dallas)" },
  { id: "mercedes-benz-stadium", name: "Mercedes-Benz Stadium (Atlanta)" },
  { id: "gillette-stadium", name: "Gillette Stadium (Boston)" },
  { id: "nrg-stadium", name: "NRG Stadium (Houston)" },
  { id: "arrowhead-stadium", name: "Arrowhead Stadium (Kansas City)" },
  { id: "sofi-stadium", name: "SoFi Stadium (LA)" },
  { id: "hard-rock-stadium", name: "Hard Rock Stadium (Miami)" },
  { id: "metlife-stadium", name: "MetLife Stadium (NY/NJ)" },
  { id: "lincoln-financial-field", name: "Lincoln Financial Field (Philadelphia)" },
  { id: "levis-stadium", name: "Levi's Stadium (SF Bay Area)" },
  { id: "lumen-field", name: "Lumen Field (Seattle)" },
];

export default function HistoricalExplorer() {
  const { selectedStadiumId } = useHeatDashboardStore();
  const [stadiumId, setStadiumId] = useState(selectedStadiumId ?? "att-stadium");
  const [year, setYear] = useState(2019);
  const [month, setMonth] = useState(7);
  const [day, setDay] = useState(15);
  const [result, setResult] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const runQuery = () => {
    setLoading(true);
    fetch(`/api/history?stadium=${stadiumId}&year=${year}&month=${month}&day=${day}`)
      .then((r) => r.json())
      .then((data) => {
        setResult(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const exportCsv = () => {
    if (!result?.readings.length) return;
    const header = "hour_utc,temp_c,dewpoint_c,wbgt\n";
    const rows = result.readings.map((r) => `${r.hour_utc},${r.temp_c},${r.dewpoint_c},${r.wbgt}`).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${stadiumId}_${result.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded p-4 font-mono text-xs max-w-3xl">
      <div className="text-zinc-400 mb-3">
        20-YEAR HISTORICAL EXPLORER &mdash; any real recorded date/hour, 2006-2025
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Stadium</span>
          <select
            value={stadiumId}
            onChange={(e) => setStadiumId(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1"
          >
            {STADIUM_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Year</span>
          <input
            type="number"
            min={2006}
            max={2025}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 w-20"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Month</span>
          <input
            type="number"
            min={1}
            max={12}
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 w-16"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Day</span>
          <input
            type="number"
            min={1}
            max={31}
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 w-16"
          />
        </label>
        <button
          onClick={runQuery}
          className="bg-zinc-100 text-zinc-900 rounded px-3 py-1.5 font-bold hover:bg-white"
        >
          QUERY
        </button>
        {result?.readings.length ? (
          <button
            onClick={exportCsv}
            className="border border-zinc-600 rounded px-3 py-1.5 hover:bg-zinc-800"
          >
            EXPORT CSV
          </button>
        ) : null}
      </div>

      {loading && <div className="text-zinc-500">querying real NOAA data...</div>}

      {result && !loading && (
        <div>
          {result.error && <div className="text-red-400">{result.error}</div>}
          {!result.error && (
            <>
              <div className="text-zinc-500 mb-2">
                {result.date} &mdash; {result.reading_count} real hourly readings &mdash; DATA: {result.data_status}
              </div>
              {result.readings.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={result.readings}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                    <XAxis dataKey="hour_utc" stroke="#a1a1aa" fontSize={11} label={{ value: "hour (UTC)", position: "insideBottom", offset: -5, fill: "#a1a1aa", fontSize: 11 }} />
                    <YAxis stroke="#a1a1aa" fontSize={11} label={{ value: "°C", angle: -90, position: "insideLeft", fill: "#a1a1aa", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 11 }} />
                    <Line type="monotone" dataKey="temp_c" stroke="#f4a261" name="Temp" dot={false} />
                    <Line type="monotone" dataKey="dewpoint_c" stroke="#5aa9e6" name="Dew point" dot={false} />
                    <Line type="monotone" dataKey="wbgt" stroke="#e63946" name="WBGT" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-zinc-500">No real readings found for this exact date.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
