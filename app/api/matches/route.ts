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
};

let cache: Match[] | null = null;
function loadMatches(): Match[] {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "matches.json"), "utf-8"));
    } catch {
      cache = [];
    }
  }
  return cache!;
}

/**
 * GET /api/matches?stadium=<id>
 *
 * REAL FIFA World Cup 2026 matches played at this stadium (see
 * scripts/fetch_match_schedule.py -- sourced from the openfootball/
 * worldcup open dataset, includes real final scores since the
 * tournament already happened this year).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stadiumId = searchParams.get("stadium");
  const all = loadMatches();
  const matches = stadiumId ? all.filter((m) => m.stadium_id === stadiumId) : all;
  return Response.json({ matches, data_status: matches.length > 0 ? "REAL" : "MISSING" });
}
