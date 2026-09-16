import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

type Match = {
  match_number: number | null;
  stadium_id: string;
  city: string;
  round: string;
  stage: "group" | "knockout" | "nfl";
  local_kickoff: string;
  utc_offset: number;
  kickoff_utc_iso: string;
  matchup_raw: string;
  is_future?: boolean;
  // Present only once scripts/fetch_match_weather.py has run --
  // real weather from the same physical station as this stadium's
  // 20-year climatology, matched to this match's real kickoff time.
  // For a future event this stays null; the client fetches a live
  // real NWS forecast instead (see app/api/event-forecast).
  real_kickoff_temp_c?: number | null;
  real_kickoff_dewpoint_c?: number | null;
  real_kickoff_wbgt_c?: number | null;
  real_peak_wbgt_c?: number | null;
  weather_data_source?: string;
  weather_data_status?: "REAL" | "MISSING";
};

let cache: Match[] | null = null;
function loadMatches(): Match[] {
  if (!cache) {
    let worldCup: Match[] = [];
    for (const file of ["match_weather.json", "matches.json"]) {
      try {
        worldCup = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
        break;
      } catch {
        continue;
      }
    }
    let events: Match[] = [];
    try {
      events = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "stadium_events.json"), "utf-8"));
    } catch {
      events = [];
    }
    // Upcoming real events first (this is the "what's actually next at
    // this venue" answer, now that the World Cup itself is over), then
    // real World Cup matches (already sorted hottest-first by
    // scripts/fetch_match_weather.py), then any already-played NFL
    // games at the end for completeness.
    const upcoming = events.filter((e) => e.is_future).sort((a, b) => a.kickoff_utc_iso.localeCompare(b.kickoff_utc_iso));
    const played = events.filter((e) => !e.is_future).sort((a, b) => b.kickoff_utc_iso.localeCompare(a.kickoff_utc_iso));
    cache = [...upcoming, ...worldCup, ...played];
  }
  return cache!;
}

/**
 * GET /api/matches?stadium=<id>
 *
 * Real events at this stadium, in three tiers:
 * 1. Upcoming real NFL games (data/stadium_events.json --
 *    nflverse/nfldata, real 2026 schedule, not yet played) -- the
 *    World Cup itself is over, so this is the real "what's next here"
 *    answer, and the reason a "live" mode is possible at all.
 * 2. Real FIFA World Cup 2026 matches already played at this stadium,
 *    each with the REAL weather observed at kickoff (scripts/
 *    fetch_match_schedule.py + fetch_match_weather.py).
 * 3. Already-played real NFL games, for completeness.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stadiumId = searchParams.get("stadium");
  const all = loadMatches();
  const matches = stadiumId ? all.filter((m) => m.stadium_id === stadiumId) : all;
  return Response.json({ matches, data_status: matches.length > 0 ? "REAL" : "MISSING" });
}
