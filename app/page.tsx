import HeatMap from "@/components/HeatMap";
import StadiumPanel from "@/components/StadiumPanel";

export default function Home() {
  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      <header className="px-4 py-2 border-b border-zinc-800 flex items-baseline gap-3">
        <h1 className="font-mono text-sm font-bold tracking-wide">WC26 HEAT RISK DASHBOARD</h1>
        <span className="font-mono text-xs text-zinc-500">
          Rice University Urban Sustainability Hackathon &middot; Track 3
        </span>
      </header>
      <main className="flex-1 relative">
        <HeatMap />
        <StadiumPanel />
      </main>
    </div>
  );
}
