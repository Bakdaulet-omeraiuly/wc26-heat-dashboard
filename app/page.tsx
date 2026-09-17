"use client";

import { useState } from "react";
import HeatMap from "@/components/HeatMap";
import StadiumPanel from "@/components/StadiumPanel";
import RankedComparison from "@/components/RankedComparison";
import HistoricalExplorer from "@/components/HistoricalExplorer";
import PriorityList from "@/components/PriorityList";
import AskAgent from "@/components/AskAgent";
import ForecastSidebar from "@/components/ForecastSidebar";
import UrbanLab from "@/components/UrbanLab";
import HomeStory from "@/components/HomeStory";

export default function Home() {
  const [tab, setTab] = useState<"home" | "map" | "history" | "priority" | "ask" | "lab">("home");

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      <header className="px-4 py-2 border-b border-zinc-800 flex items-center gap-4">
        <h1 className="font-mono text-sm font-bold tracking-wide">
          HCHIS <span className="font-normal text-zinc-500">&middot; Host-City Stadium Heat Intelligence System</span>
        </h1>
        <span className="font-mono text-xs text-zinc-500">
          Rice University Urban Sustainability Hackathon &middot; Track 3
        </span>
        <nav className="ml-auto flex gap-2 font-mono text-xs">
          <button
            onClick={() => setTab("home")}
            className={`px-3 py-1 rounded border ${tab === "home" ? "bg-zinc-100 text-zinc-900 border-zinc-100" : "border-zinc-700 text-zinc-400 hover:text-zinc-100"}`}
          >
            HOME
          </button>
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
          <button
            onClick={() => setTab("priority")}
            className={`px-3 py-1 rounded border ${tab === "priority" ? "bg-zinc-100 text-zinc-900 border-zinc-100" : "border-zinc-700 text-zinc-400 hover:text-zinc-100"}`}
          >
            PRIORITY ACTION
          </button>
          <button
            onClick={() => setTab("ask")}
            className={`px-3 py-1 rounded border ${tab === "ask" ? "bg-zinc-100 text-zinc-900 border-zinc-100" : "border-zinc-700 text-zinc-400 hover:text-zinc-100"}`}
          >
            ASK
          </button>
          <button
            onClick={() => setTab("lab")}
            className={`px-3 py-1 rounded border ${tab === "lab" ? "bg-zinc-100 text-zinc-900 border-zinc-100" : "border-zinc-700 text-zinc-400 hover:text-zinc-100"}`}
          >
            URBAN LAB
          </button>
        </nav>
      </header>
      <main className="flex-1 relative overflow-auto">
        {tab === "home" && (
          <div className="absolute inset-0">
            <HomeStory onNavigate={setTab} />
          </div>
        )}
        {tab === "map" && (
          <div className="absolute inset-0">
            <HeatMap />
            {/* Bounded + its own scroll: this list grows to fit all 11
                real stadiums (plus each one's real safest-walk line),
                and with no bottom bound it grew tall enough to cover
                the month/hour scrubber fixed at the bottom of the map
                (real reported bug, screenshot-confirmed) -- stopping
                short of the scrubber and scrolling internally instead. */}
            <div className="absolute top-20 left-3 w-96 bottom-36 overflow-y-auto">
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
        {tab === "priority" && (
          <div className="p-6">
            <PriorityList />
          </div>
        )}
        {tab === "ask" && (
          <div className="absolute inset-0 flex">
            <div className="flex-1 min-w-0 h-full">
              <AskAgent />
            </div>
            <ForecastSidebar />
          </div>
        )}
        {tab === "lab" && (
          <div className="absolute inset-0 overflow-auto">
            <UrbanLab />
          </div>
        )}
      </main>
    </div>
  );
}
