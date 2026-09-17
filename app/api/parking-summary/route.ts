import { NextRequest } from "next/server";
import { listStadiums } from "@/lib/agentData";
import { rankLotsBySafety } from "@/lib/parkingData";

/**
 * GET /api/parking-summary?month=<1-12>&hour=<0-23>
 *
 * The safest and hottest real parking lot for EVERY stadium at once,
 * for the map view's ranked list (components/RankedComparison.tsx) and
 * the Priority Action view (components/PriorityList.tsx) -- so "which
 * lot is safe/risky to walk from" is visible without drilling into a
 * stadium's own detail panel. One request instead of 11 (a loop over
 * the same real per-stadium computation the detail panel already
 * uses, not a separate calculation).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const month = Number(searchParams.get("month") ?? 7);
  const hour = Number(searchParams.get("hour") ?? 15);

  type LotSummary = { name: string; distance_m: number; adjusted_wbgt_c: number | null; sports_flag: string | null } | null;
  const summary: Record<string, { safest: LotSummary; hottest: LotSummary; total_lots: number }> = {};

  for (const stadium of listStadiums()) {
    const ranked = rankLotsBySafety(stadium.id, month, hour);
    const toLotSummary = (r: (typeof ranked)[number] | undefined): LotSummary =>
      r ? { name: r.lot.name, distance_m: r.lot.distance_m, adjusted_wbgt_c: r.adjusted_wbgt_c, sports_flag: r.sports_flag } : null;
    summary[stadium.id] = {
      safest: toLotSummary(ranked[0]),
      hottest: toLotSummary(ranked[ranked.length - 1]),
      total_lots: ranked.length,
    };
  }

  return Response.json({ month, hour, summary });
}
