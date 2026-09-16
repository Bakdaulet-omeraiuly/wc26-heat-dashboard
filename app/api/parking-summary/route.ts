import { NextRequest } from "next/server";
import { listStadiums } from "@/lib/agentData";
import { rankLotsBySafety } from "@/lib/parkingData";

/**
 * GET /api/parking-summary?month=<1-12>&hour=<0-23>
 *
 * The safest and hottest real parking lot for EVERY stadium at once,
 * for the map view's ranked list (components/RankedComparison.tsx) --
 * so "which lot is safe to walk from" is visible without drilling into
 * a stadium's own detail panel. One request instead of 11 (a loop over
 * the same real per-stadium computation the detail panel already
 * uses, not a separate calculation).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const month = Number(searchParams.get("month") ?? 7);
  const hour = Number(searchParams.get("hour") ?? 15);

  const summary: Record<
    string,
    {
      safest: { name: string; distance_m: number; adjusted_wbgt_c: number | null; sports_flag: string | null } | null;
    }
  > = {};

  for (const stadium of listStadiums()) {
    const ranked = rankLotsBySafety(stadium.id, month, hour);
    summary[stadium.id] = {
      safest: ranked[0]
        ? {
            name: ranked[0].lot.name,
            distance_m: ranked[0].lot.distance_m,
            adjusted_wbgt_c: ranked[0].adjusted_wbgt_c,
            sports_flag: ranked[0].sports_flag,
          }
        : null,
    };
  }

  return Response.json({ month, hour, summary });
}
