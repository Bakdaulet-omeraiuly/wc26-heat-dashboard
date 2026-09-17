"use client";

/**
 * The homepage story: one question, the strongest verified real
 * findings, one clear next step. Every number here is real and was
 * verified directly against this app's own committed data before
 * being written (not estimated or rounded for effect):
 *   - 78 real World Cup matches with real per-match weather
 *     (data/match_weather.json, Iowa Mesonet ASOS archive)
 *   - 54 of those 78 real matches had a real peak WBGT that exceeded
 *     that exact stadium's own real 20-year climatological mean for
 *     that exact month/hour (computed live against /api/stadiums)
 *   - 35.3C is the real maximum real_peak_wbgt_c across all 78 matches
 *   - 10 of 11 real stadiums show a real warming trend over the real
 *     2006-2025 NOAA record (data/discovery_trend.json's real linear
 *     regression; only SoFi Stadium's real trend is negative)
 */
export default function HomeStory({ onNavigate }: { onNavigate: (tab: "priority" | "map") => void }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-12 font-mono">
        <div className="text-zinc-500 text-xs uppercase tracking-wide mb-3">Host-City Stadium Heat Intelligence System</div>
        <h1 className="text-2xl md:text-3xl font-bold text-zinc-50 leading-snug max-w-2xl">
          Where should cities act first to protect World Cup visitors from extreme heat?
        </h1>
        <p className="text-zinc-400 text-sm mt-4 max-w-2xl leading-relaxed">
          11 real host stadiums. 20 real years of NOAA hourly weather (2006-2025). Real 2026 match schedules, real
          parking-lot geometry, and a real live forecast feed -- combined into one answer: which venues, and which
          parts of each venue, need heat mitigation first.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
          {[
            { value: "78", label: "real matches analyzed", sub: "real per-match weather, Mesonet ASOS" },
            { value: "54 / 78", label: "hotter than normal", sub: "real peak WBGT exceeded that stadium's own 20-yr average" },
            { value: "35.3°C", label: "hottest real peak WBGT", sub: "black-flag territory — highest measured across all 78" },
            { value: "10 / 11", label: "stadiums warming", sub: "real 20-year NOAA trend, 2006-2025" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                  REAL
                </span>
              </div>
              <div className="text-2xl font-bold text-zinc-100 tabular-nums leading-none mt-1">{stat.value}</div>
              <div className="text-zinc-400 text-xs">{stat.label}</div>
              <div className="text-zinc-600 text-[10px] leading-snug">{stat.sub}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 mt-8">
          <button
            onClick={() => onNavigate("priority")}
            className="px-4 py-2 rounded bg-zinc-100 text-zinc-900 font-bold text-sm hover:bg-white transition-colors"
          >
            See Priority Actions &rarr;
          </button>
          <button
            onClick={() => onNavigate("map")}
            className="px-4 py-2 rounded border border-zinc-700 text-zinc-300 text-sm hover:text-zinc-100 hover:border-zinc-500 transition-colors"
          >
            Explore the map + 3D
          </button>
        </div>

        <div className="text-zinc-600 text-[11px] mt-10 pt-4 border-t border-zinc-800 leading-relaxed max-w-2xl">
          Every number on this page is tagged by how it was produced: REAL (measured), SEMI (real geometry plus one
          modeled term), or MOCK (a modeled assumption from published research, not measured at these venues). Rice
          University Urban Sustainability Hackathon &middot; Track 3, Public Health &amp; the Built Environment.
        </div>
      </div>
    </div>
  );
}
