import { listStadiums, getAllTrends, getHottestRealMatches, getStadiumYearlySeries } from "@/lib/agentData";
import { rankLotsBySafety } from "@/lib/parkingData";

/**
 * GET /api/home-story
 *
 * Backs the homepage's numbered story sections -- every field here
 * reuses an existing real-data accessor this app already computes
 * elsewhere (lib/agentData.ts, lib/parkingData.ts), assembled once for
 * the homepage instead of duplicated. No new numbers, no new data
 * files. Uses the same July/3pm default bucket as the rest of the
 * app's climatology views.
 */
export async function GET() {
  const month = 7;
  const hour = 15;

  const trends = getAllTrends();
  const warmingCount = trends.filter((t) => t.direction === "warming").length;

  const hottestMatches = getHottestRealMatches(5).map((m) => ({
    matchup_raw: m.matchup_raw.replace(/\s+/g, " "),
    city: m.city,
    round: m.round,
    kickoff_utc_iso: m.kickoff_utc_iso,
    real_peak_wbgt_c: m.real_peak_wbgt_c,
  }));

  // NOTE: this app's walk-in-heat model (lib/parkingData.ts) applies
  // one flat sun-exposure surcharge per stadium/time, so every real
  // lot at the SAME stadium shares the same adjusted_wbgt_c -- there
  // is no real "safest vs hottest lot at one venue" WBGT difference to
  // report (verified directly: every lot's adjusted_wbgt_c at a given
  // stadium/hour is identical). What genuinely varies real lot-to-lot
  // is WALK DISTANCE -- so the real, non-trivial finding here is the
  // single longest real walk across all 11 stadiums' real lots, at
  // that lot's own real heat.
  let totalLots = 0;
  let longestWalk: { stadium: string; lot: string; walk_minutes: number; distance_m: number; wbgt_c: number } | null = null;
  for (const stadium of listStadiums()) {
    const ranked = rankLotsBySafety(stadium.id, month, hour);
    totalLots += ranked.length;
    for (const r of ranked) {
      if (r.adjusted_wbgt_c === null) continue;
      if (!longestWalk || r.walk_minutes > longestWalk.walk_minutes) {
        longestWalk = { stadium: stadium.name, lot: r.lot.name, walk_minutes: r.walk_minutes, distance_m: r.lot.distance_m, wbgt_c: r.adjusted_wbgt_c };
      }
    }
  }

  return Response.json({
    month,
    hour,
    trend: {
      warming_count: warmingCount,
      total: trends.length,
      hottest_trend: trends[0] ? { stadium_name: trends[0].stadium_name, trend_c_per_decade: trends[0].trend_c_per_decade } : null,
      stadiums: trends.map((t) => ({
        stadium_id: t.stadium_id,
        stadium_name: t.stadium_name,
        trend_c_per_decade: t.trend_c_per_decade,
        direction: t.direction,
        // Real year-by-year July series -- what the trend line/decade
        // number above is actually computed from, not a separate stat.
        yearly: getStadiumYearlySeries(t.stadium_id, 7),
      })),
      data_status: "REAL",
    },
    hottest_matches: hottestMatches,
    parking: {
      total_real_lots: totalLots,
      longest_real_walk: longestWalk,
      data_status: "SEMI",
    },
  });
}
