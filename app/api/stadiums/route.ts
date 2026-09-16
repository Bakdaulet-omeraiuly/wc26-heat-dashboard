import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { percentileToHeatRiskLevel } from "@/lib/wbgt";

const DATA_DIR = path.join(process.cwd(), "data");

type Stadium = {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  noaa_station_id: string;
  roof_type: string;
  roof_type_status: string;
  field_orientation_deg: number | null;
  field_orientation_status: string;
};

type ClimatologyBucket = { n: number; mean: number; p10: number; p50: number; p90: number };

let stadiumsCache: Stadium[] | null = null;
let climatologyCache: Record<string, Record<string, ClimatologyBucket>> | null = null;

function loadStadiums(): Stadium[] {
  if (!stadiumsCache) {
    stadiumsCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "stadiums.json"), "utf-8"));
  }
  return stadiumsCache!;
}

function loadClimatology(): Record<string, Record<string, ClimatologyBucket>> {
  if (!climatologyCache) {
    climatologyCache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "climatology.json"), "utf-8"));
  }
  return climatologyCache!;
}

/** Where THIS bucket's mean WBGT falls among ALL of this stadium's
 * hourly buckets across the year -- our own percentile-relative scale
 * (see lib/wbgt.ts's long comment on why this isn't a borrowed "NWS
 * HeatRisk" number). Computed from climatology.json's already-
 * aggregated per-bucket means, not the raw 2.46M-row table -- cheap
 * enough to do per-request. */
function percentileWithinStadiumYear(
  stadiumBuckets: Record<string, ClimatologyBucket>,
  month: number,
  hour: number
): number {
  const key = `${String(month).padStart(2, "0")}-${String(hour).padStart(2, "0")}`;
  const target = stadiumBuckets[key];
  if (!target) return 0.5; // fails open to a middling value if this bucket is somehow missing
  const allMeans = Object.values(stadiumBuckets).map((b) => b.mean);
  const below = allMeans.filter((m) => m <= target.mean).length;
  return below / allMeans.length;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const month = Number(searchParams.get("month") ?? 7);
  const hour = Number(searchParams.get("hour") ?? 15);

  const stadiums = loadStadiums();
  const climatology = loadClimatology();

  const key = `${String(month).padStart(2, "0")}-${String(hour).padStart(2, "0")}`;

  const results = stadiums.map((stadium) => {
    const buckets = climatology[stadium.id] ?? {};
    const bucket = buckets[key];
    const pct = percentileWithinStadiumYear(buckets, month, hour);
    return {
      ...stadium,
      selected_month: month,
      selected_hour: hour,
      wbgt: bucket ? { mean: bucket.mean, p10: bucket.p10, p50: bucket.p50, p90: bucket.p90, sample_size: bucket.n } : null,
      percentile_within_year: Math.round(pct * 100) / 100,
      heat_risk_level: bucket ? percentileToHeatRiskLevel(pct) : null,
      data_status: bucket ? "REAL" : "MISSING",
    };
  });

  return Response.json({ month, hour, stadiums: results });
}
