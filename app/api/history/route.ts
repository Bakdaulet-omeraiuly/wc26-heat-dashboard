import { NextRequest } from "next/server";
import { createClient, type Client } from "@libsql/client";
import { approximateWBGT } from "@/lib/wbgt";

// The 172MB, 2.46M-row real hourly table used to live only as a local
// SQLite file (data/heat.db) -- too big for a normal git push (GitHub
// rejects files over 100MB) and so never present in Vercel's build,
// which meant the 20-Year Explorer (View B) only worked on someone's
// own machine. Migrated to Turso (libSQL: a real hosted SQLite-
// compatible database) via `turso db create --from-file data/heat.db`
// -- verified live: 2,466,251 rows, matching the local file exactly.
// Same schema, same query, just queried over the network instead of a
// local file handle.
let client: Client | null = null;
function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not configured");
    client = createClient({ url, authToken });
  }
  return client;
}

/**
 * GET /api/history?stadium=att-stadium&year=2019&month=7&day=15
 *
 * Returns the full day's real hourly readings for that stadium --
 * this is the ONE endpoint that reads the raw 2.46M-row table
 * directly instead of the small committed climatology.json, because
 * "any exact historical date/hour" is a real per-reading lookup, not
 * something a monthly/hourly aggregate can answer.
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

  let db: Client;
  try {
    db = getClient();
  } catch {
    return Response.json(
      { error: "TURSO_DATABASE_URL / TURSO_AUTH_TOKEN not configured on the server -- see README's 20-Year Explorer setup." },
      { status: 503 }
    );
  }

  const dayStart = Math.floor(Date.UTC(year, month - 1, day, 0, 0, 0) / 1000);
  const dayEnd = dayStart + 24 * 3600;

  let rows: { observed_at: number; temp_c: number | null; dewpoint_c: number | null }[];
  try {
    const result = await db.execute({
      sql:
        "SELECT observed_at, temp_c, dewpoint_c FROM hourly_readings " +
        "WHERE stadium_id = ? AND observed_at >= ? AND observed_at < ? ORDER BY observed_at",
      args: [stadiumId, dayStart, dayEnd],
    });
    rows = result.rows.map((r) => ({
      observed_at: Number(r.observed_at),
      temp_c: r.temp_c === null ? null : Number(r.temp_c),
      dewpoint_c: r.dewpoint_c === null ? null : Number(r.dewpoint_c),
    }));
  } catch (e) {
    return Response.json({ error: `Turso query failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

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
