"use client";

import { useState } from "react";
import HeatMap from "@/components/HeatMap";
import StadiumPanel from "@/components/StadiumPanel";
import RankedComparison from "@/components/RankedComparison";
import HistoricalExplorer from "@/components/HistoricalExplorer";

export default function Home() {
  const [tab, setTab] = useState<"map" | "history">("map");

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      <header className="px-4 py-2 border-b border-zinc-800 flex items-center gap-4">
        <h1 className="font-mono text-sm font-bold tracking-wide">WC26 HEAT RISK DASHBOARD</h1>
        <span className="font-mono text-xs text-zinc-500">
          Rice University Urban Sustainability Hackathon &middot; Track 3
        </span>
        <nav className="ml-auto flex gap-2 font-mono text-xs">
          <button
            onClick={() => setTab("map")}
            className={`px-3 py-1 rounded border ${tab === "map" ? "bg-zinc-100 text-zinc-900 border-zinc-100" : "border-zinc-700 text-zinc-400 hover:text-zinc-100"}`}
          >
            MAP + 3D
          </button>
          <button
            onClick={() => setTab("history")}
            className={`px-3 py-1 rounded border ${tab === "history" ? "bg-zinc-100 text-zinc-900 border-zinc-100" : "border-zinc-700 text-zinc-400 hover:text-zinc-100"}`}
          >
            20-YEAR EXPLORER
          </button>
        </nav>
      </header>
      <main className="flex-1 relative overflow-auto">
        {tab === "map" && (
          <div className="absolute inset-0">
            <HeatMap />
            <div className="absolute top-20 left-3 w-96">
              <RankedComparison />
            </div>
            <StadiumPanel />
          </div>
        )}
        {tab === "history" && (
          <div className="p-6">
            <HistoricalExplorer />
          </div>
        )}
      </main>
    </div>
  );
}
