import { NextRequest } from "next/server";
import path from "node:path";
import Database from "better-sqlite3";
import { approximateWBGT } from "@/lib/wbgt";

const DB_PATH = path.join(process.cwd(), "data", "heat.db");

let db: Database.Database | null = null;
function getDb() {
  if (!db) db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return db;
}

/**
 * GET /api/history?stadium=att-stadium&year=2019&month=7&day=15
 *
 * Returns the full day's real hourly readings for that stadium (from
 * the 172MB local heat.db -- see scripts/fetch_noaa_data.py; this is
 * the ONE endpoint that reads the raw table directly instead of the
 * small committed climatology.json, because "any exact historical
 * date/hour" is a real per-reading lookup, not something a monthly/
 * hourly aggregate can answer).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const stadiumId = searchParams.get("stadium");
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  const day = Number(searchParams.get("day"));

  if (!stadiumId || !year || !month || !day) {
    return Response.json({ error: "stadium, year, month, day are all required" }, { status: 400 });
  }

  let database: Database.Database;
  try {
    database = getDb();
  } catch {
    return Response.json(
      {
        error:
          "heat.db not found locally. This 172MB file is a build-time artifact, not committed to git " +
          "(see scripts/fetch_noaa_data.py's docstring) -- run: python3 scripts/fetch_noaa_data.py",
      },
      { status: 503 }
    );
  }

  const dayStart = Math.floor(Date.UTC(year, month - 1, day, 0, 0, 0) / 1000);
  const dayEnd = dayStart + 24 * 3600;

  const rows = database
    .prepare(
      "SELECT observed_at, temp_c, dewpoint_c FROM hourly_readings " +
        "WHERE stadium_id = ? AND observed_at >= ? AND observed_at < ? ORDER BY observed_at"
    )
    .all(stadiumId, dayStart, dayEnd) as { observed_at: number; temp_c: number | null; dewpoint_c: number | null }[];

  const readings = rows
    .filter((r) => r.temp_c !== null && r.dewpoint_c !== null)
    .map((r) => ({
      observed_at: r.observed_at,
      hour_utc: new Date(r.observed_at * 1000).getUTCHours(),
      temp_c: r.temp_c,
      dewpoint_c: r.dewpoint_c,
      wbgt: Math.round(approximateWBGT(r.temp_c as number, r.dewpoint_c as number) * 10) / 10,
    }));

  return Response.json({
    stadium: stadiumId,
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    reading_count: readings.length,
    readings,
    data_status: readings.length > 0 ? "REAL" : "NO_DATA_FOR_THIS_DATE",
  });
}
