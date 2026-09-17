import { NextRequest } from "next/server";
import { listStadiums, getStadiumSnapshot, getStadiumTrend, simulateScenario } from "@/lib/agentData";
import { rankLotsBySafety } from "@/lib/parkingData";

/**
 * GET /api/priority?month=<1-12>&hour=<0-23>
 *
 * Backs the Priority Action view -- one real decision-support record
 * per stadium, assembled entirely from data this app already computes
 * elsewhere (no new numbers invented for this view):
 *   - heat risk: getStadiumSnapshot() -- REAL, data/climatology.json
 *   - 20-year trend: getStadiumTrend() -- REAL, data/discovery_trend.json
 *   - walking exposure: rankLotsBySafety() -- SEMI (real OSM lot
 *     geometry + real climatology + a modeled sun-exposure surcharge,
 *     see lib/parkingData.ts)
 *   - modeled mitigation impact: simulateScenario() at full bundle
 *     (100% shade + max misting + roof closed where applicable) --
 *     MOCK, the same modeled effect sizes as ScenarioSimulator.tsx
 * Ranked by current WBGT (a defensible, simple "fix the hottest place
 * first" ordering) -- a true attendee-hours-at-risk ranking would need
 * real per-venue capacity data this app doesn't have verified yet, so
 * it isn't fabricated here.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const month = Number(searchParams.get("month") ?? 7);
  const hour = Number(searchParams.get("hour") ?? 15);

  const rows = listStadiums()
    .map((stadium) => {
      const snapshot = getStadiumSnapshot(stadium.id, month, hour);
      if (!snapshot || snapshot.wbgt_mean_c === null) return null;

      const trend = getStadiumTrend(stadium.id);

      const lots = rankLotsBySafety(stadium.id, month, hour);
      const safest = lots[0] ?? null;
      const hottest = lots[lots.length - 1] ?? null;
      const walkExposure =
        safest && hottest
          ? {
              safest: { name: safest.lot.name, distance_m: safest.lot.distance_m, walk_minutes: safest.walk_minutes, adjusted_wbgt_c: safest.adjusted_wbgt_c, sports_flag: safest.sports_flag },
              hottest: { name: hottest.lot.name, distance_m: hottest.lot.distance_m, walk_minutes: hottest.walk_minutes, adjusted_wbgt_c: hottest.adjusted_wbgt_c, sports_flag: hottest.sports_flag },
              total_lots: lots.length,
              data_status: "SEMI" as const,
            }
          : null;

      const canCloseRoof = snapshot.roof_type === "retractable";
      const mitigation = simulateScenario(stadium.id, month, hour, { shadePct: 100, mistingStations: 6, roofClosed: canCloseRoof });

      // A real, non-fabricated explanation string -- built only from
      // the real/modeled numbers already computed above, not a
      // separate narrative source.
      const reasons: string[] = [];
      if (snapshot.percentile_within_stadium_year !== null) {
        reasons.push(`${Math.round(snapshot.percentile_within_stadium_year * 100)}th percentile of this stadium's own real annual heat cycle`);
      }
      if (trend && trend.direction === "warming") {
        reasons.push(`warming ${trend.trend_c_per_decade.toFixed(2)}°C/decade over ${trend.n_years} real years (${trend.first_year}-${trend.last_year})`);
      }
      if (walkExposure?.hottest.adjusted_wbgt_c != null && snapshot.wbgt_mean_c != null) {
        const delta = walkExposure.hottest.adjusted_wbgt_c - snapshot.wbgt_mean_c;
        if (delta > 0.05) reasons.push(`walking from its hottest real lot adds ~${delta.toFixed(1)}°C on top of that`);
      }

      return {
        id: stadium.id,
        name: stadium.name,
        city: stadium.city,
        roof_type: stadium.roof_type,
        heat_risk: {
          wbgt_mean_c: snapshot.wbgt_mean_c,
          wbgt_p10_c: snapshot.wbgt_p10_c,
          wbgt_p90_c: snapshot.wbgt_p90_c,
          heat_risk_level: snapshot.heat_risk_level,
          sports_flag: snapshot.sports_flag,
          percentile_within_stadium_year: snapshot.percentile_within_stadium_year,
          sample_size: snapshot.sample_size,
          data_status: "REAL" as const,
        },
        trend: trend
          ? {
              trend_c_per_decade: trend.trend_c_per_decade,
              direction: trend.direction,
              n_years: trend.n_years,
              first_year: trend.first_year,
              last_year: trend.last_year,
              data_status: "REAL" as const,
            }
          : null,
        walk_exposure: walkExposure,
        mitigation: mitigation
          ? {
              baseline_wbgt_c: mitigation.baseline_wbgt_c,
              projected_wbgt_c: mitigation.adjusted_wbgt_c,
              reduction_c: mitigation.reduction_c,
              roof_closed_applied: mitigation.roof_closed_applied,
              inputs: mitigation.inputs,
              data_status: "MOCK" as const,
              caveat: mitigation.caveat,
            }
          : null,
        why_priority: reasons,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.heat_risk.wbgt_mean_c! - a.heat_risk.wbgt_mean_c!);

  return Response.json({ month, hour, stadiums: rows });
}
