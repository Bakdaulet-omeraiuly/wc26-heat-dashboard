import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

type Match = {
  match_number: number | null;
  stadium_id: string;
  city: string;
  round: string;
  stage: "group" | "knockout";
  local_kickoff: string;
  utc_offset: number;
  kickoff_utc_iso: string;
  matchup_raw: string;
  // Present only once scripts/fetch_match_weather.py has run --
  // real weather from the same physical station as this stadium's
  // 20-year climatology, matched to this match's real kickoff time.
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
    // Prefer match_weather.json (matches.json enriched with real
    // match-day WBGT) when it exists; fall back to the plain schedule.
    for (const file of ["match_weather.json", "matches.json"]) {
      try {
        cache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf-8"));
        break;
      } catch {
        continue;
      }
    }
    if (!cache) cache = [];
  }
  return cache!;
}

/**
 * GET /api/matches?stadium=<id>
 *
 * REAL FIFA World Cup 2026 matches played at this stadium (see
 * scripts/fetch_match_schedule.py -- sourced from the openfootball/
 * worldcup open dataset, includes real final scores since the
 * tournament already happened this year) plus, once fetched, the REAL
 * WBGT during that specific match (scripts/fetch_match_weather.py).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stadiumId = searchParams.get("stadium");
  const all = loadMatches();
  const matches = stadiumId ? all.filter((m) => m.stadium_id === stadiumId) : all;
  return Response.json({ matches, data_status: matches.length > 0 ? "REAL" : "MISSING" });
}
