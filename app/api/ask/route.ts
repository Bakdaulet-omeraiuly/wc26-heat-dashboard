import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  findStadium,
  listStadiums,
  getStadiumSnapshot,
  rankStadiums,
  getStadiumTrend,
  getAllTrends,
  simulateScenario,
  projectFutureWBGT,
} from "@/lib/agentData";
import { getStadiumForecast } from "@/lib/nwsForecast";
import { rankLotsBySafety } from "@/lib/parkingData";

/**
 * POST /api/ask -- the research-question agent.
 *
 * Design principle (see spec.md / README "Honest Limitations"): the
 * LLM never invents a number. It can only call the tools below, each
 * of which is a thin wrapper around lib/agentData.ts's real-data
 * lookups (2.46M real NOAA readings via climatology.json, the real
 * 20-year regression in discovery_trend.json, or the explicitly-
 * MOCK-tagged scenario formula). The system prompt requires every
 * numeric claim in the final answer to have come from a tool result,
 * and requires citing each fact's data_status (REAL/MOCK/MISSING).
 *
 * This mirrors Caspian Watch's "AI doesn't measure, formulas measure"
 * convention -- here the LLM's only job is retrieval + narration, not
 * computation.
 */

const SYSTEM_PROMPT = `You are the research assistant for the WC26 Heat Risk Dashboard, a tool built for city planners, team medical staff, and sports-science researchers evaluating heat risk at the 11 FIFA World Cup 2026 US stadiums.

Hard rules, no exceptions:
1. You may state a number ONLY if it came from a tool result in this conversation. Never compute, estimate, round further, or recall a number from your own training data.
2. Every factual claim must carry its data_status as returned by the tool: REAL (from 2.46 million real NOAA hourly weather readings, 2006-2025), MOCK (a modeled assumption, not measured at that venue), or MISSING (data not available -- say so plainly, do not guess).
3. If a tool returns null / not-found / MISSING for something the question needs, say exactly that ("field orientation for X is not yet verified" / "no data for that stadium/time"). Never fill the gap with a plausible-sounding guess.
4. Always name the specific stadium(s) and month/hour (or year range) your answer refers to -- never speak in vague generalities when a specific number is available.
5. Keep answers tight: 2-5 sentences for a simple question, a short list for a comparison. Cite units (°C) and sample size (n=... real hourly readings) when giving a WBGT figure.
6. Scenario/mitigation numbers (shade, misting, roof) are always MOCK -- say "modeled effect, not measured at this venue" every time you give one.
7. WBGT (Wet-Bulb Globe Temperature) is the real metric US sports medicine uses for outdoor heat-safety decisions; explain it in one clause only if the user seems unfamiliar with it, don't over-explain to a repeat user.
8. There are TWO different kinds of "future" number, never confuse them: get_weather_forecast returns data_status REAL-FORECAST -- a real NOAA National Weather Service prediction, only available for the next ~7 days from today, genuinely uncertain the further out it goes. project_future_wbgt returns data_status EXTRAPOLATION -- a naive straight-line projection of the real 2006-2025 historical trend, with NO forecast skill and NO knowledge of actual future weather; frame it explicitly as "if the past 20-year trend continued" and never as a prediction of what will actually happen. If a user asks about a specific date within the next week, prefer get_weather_forecast. If they ask about a year like 2030 or 2035, use project_future_wbgt and lead with the "if the trend continues" framing.
9. get_parking_exposure returns data_status SEMI: real OpenStreetMap lot distance/area and real climatology WBGT, but the "walk-in" heat number adds a MODELED +3C pavement-sun surcharge from published heat-island field studies (not measured at this venue, not a full globe-temperature WBGT calculation). Always mention that surcharge is modeled when citing an adjusted_wbgt_c figure.

You have tools to look up real per-stadium climatology, rank all 11 venues, fetch the real 20-year warming trend, extrapolate that trend, fetch a real short-term NWS forecast, estimate parking-lot walk-in heat exposure, and run the modeled mitigation scenario. Use them; do not answer from memory.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_stadiums",
    description: "List all 11 FIFA World Cup 2026 US host stadiums with their id, name, city, roof type, and data-provenance status. Use this to resolve which stadium the user means, or to enumerate all venues.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "find_stadium",
    description: "Resolve a free-text stadium reference (partial name, city, or id) to the exact stadium record. Use before other tools if you're not certain of the exact stadium id.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "e.g. 'MetLife', 'the one in Miami', 'sofi-stadium'" } },
      required: ["query"],
    },
  },
  {
    name: "get_stadium_snapshot",
    description: "Get the REAL climatological WBGT (mean/p10/p90, sample size) for one stadium at a given month (1-12) and hour of day (0-23, local-ish/UTC as stored), plus its heat-risk percentile, sports-safety flag color, and roof type. Backed by 2.46M real NOAA hourly readings 2006-2025.",
    input_schema: {
      type: "object",
      properties: {
        stadium_id: { type: "string", description: "exact stadium id, e.g. 'att-stadium' -- use find_stadium first if unsure" },
        month: { type: "integer", minimum: 1, maximum: 12 },
        hour: { type: "integer", minimum: 0, maximum: 23 },
      },
      required: ["stadium_id", "month", "hour"],
    },
  },
  {
    name: "rank_stadiums",
    description: "Rank all 11 stadiums by REAL mean WBGT for a given month/hour, hottest first. Use for 'which stadium is hottest/safest at X time' questions.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "integer", minimum: 1, maximum: 12 },
        hour: { type: "integer", minimum: 0, maximum: 23 },
      },
      required: ["month", "hour"],
    },
  },
  {
    name: "get_stadium_trend",
    description: "Get the REAL 20-year (2006-2025) linear-regression warming/cooling trend for one stadium's July WBGT -- the dashboard's 'Discovery' finding. Returns trend_c_per_decade and direction.",
    input_schema: {
      type: "object",
      properties: { stadium_id: { type: "string" } },
      required: ["stadium_id"],
    },
  },
  {
    name: "get_all_trends",
    description: "Get the REAL 20-year warming/cooling trend for all 11 stadiums, sorted fastest-warming first. Use for 'which stadiums are warming fastest' or 'is anywhere cooling' questions.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "simulate_scenario",
    description: "Apply the MODELED (not measured) mitigation formula: shade coverage %, number of misting stations, and roof-closed (only if the venue has a retractable roof) to see the adjusted WBGT. ALWAYS present this as a modeled estimate, never as measured fact.",
    input_schema: {
      type: "object",
      properties: {
        stadium_id: { type: "string" },
        month: { type: "integer", minimum: 1, maximum: 12 },
        hour: { type: "integer", minimum: 0, maximum: 23 },
        shade_pct: { type: "integer", minimum: 0, maximum: 100, description: "default 0" },
        misting_stations: { type: "integer", minimum: 0, description: "default 0" },
        roof_closed: { type: "boolean", description: "default false; only has an effect at retractable-roof venues" },
      },
      required: ["stadium_id", "month", "hour"],
    },
  },
  {
    name: "project_future_wbgt",
    description: "Naive linear extrapolation of the real 20-year (2006-2025) July WBGT trend to a future year. data_status: EXTRAPOLATION, not a validated climate forecast -- refuses (returns an error) more than 15 years past the last real data year. Use only for 'if this trend continues' framing, e.g. year 2030-2040 questions.",
    input_schema: {
      type: "object",
      properties: {
        stadium_id: { type: "string" },
        target_year: { type: "integer", description: "e.g. 2030 -- must be after 2025" },
      },
      required: ["stadium_id", "target_year"],
    },
  },
  {
    name: "get_weather_forecast",
    description: "Real short-term weather forecast (NOAA National Weather Service, api.weather.gov) for the next ~7 days at a stadium's location, with WBGT computed from the forecast temp/dewpoint. data_status: REAL-FORECAST -- a genuine prediction, not historical climatology, only available a few days out from today. Use for 'what will it be like this week / this weekend / tomorrow' questions.",
    input_schema: {
      type: "object",
      properties: {
        stadium_id: { type: "string" },
        target_date: { type: "string", description: "optional, YYYY-MM-DD, must be within ~7 days of today; omit to get the next 48 hours" },
        hours_ahead: { type: "integer", description: "optional, used only if target_date is omitted; default 48, max ~168" },
      },
      required: ["stadium_id"],
    },
  },
  {
    name: "get_parking_exposure",
    description: "Real parking-lot geometry (OpenStreetMap: distance, area) at a stadium, ranked by estimated walk-in heat exposure for a given month/hour. data_status: SEMI (real distance + real climatology WBGT, plus a modeled +3C sun-exposure surcharge for crossing open pavement -- not a rigorous globe-temperature calculation). Use for 'which parking lot is safest/hottest' or 'how bad is the walk from parking' questions.",
    input_schema: {
      type: "object",
      properties: {
        stadium_id: { type: "string" },
        month: { type: "integer", minimum: 1, maximum: 12 },
        hour: { type: "integer", minimum: 0, maximum: 23 },
      },
      required: ["stadium_id", "month", "hour"],
    },
  },
];

async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "list_stadiums":
      return listStadiums();
    case "find_stadium":
      return findStadium(String(input.query ?? "")) ?? { error: "no matching stadium" };
    case "get_stadium_snapshot":
      return (
        getStadiumSnapshot(String(input.stadium_id), Number(input.month), Number(input.hour)) ?? {
          error: "unknown stadium_id -- call find_stadium or list_stadiums first",
        }
      );
    case "rank_stadiums":
      return rankStadiums(Number(input.month), Number(input.hour));
    case "get_stadium_trend":
      return getStadiumTrend(String(input.stadium_id)) ?? { error: "unknown stadium_id or no trend data" };
    case "get_all_trends":
      return getAllTrends();
    case "simulate_scenario":
      return (
        simulateScenario(String(input.stadium_id), Number(input.month), Number(input.hour), {
          shadePct: input.shade_pct !== undefined ? Number(input.shade_pct) : undefined,
          mistingStations: input.misting_stations !== undefined ? Number(input.misting_stations) : undefined,
          roofClosed: Boolean(input.roof_closed),
        }) ?? { error: "unknown stadium_id or no baseline data for that month/hour" }
      );
    case "project_future_wbgt":
      return projectFutureWBGT(String(input.stadium_id), Number(input.target_year)) ?? { error: "unknown stadium_id or no trend data" };
    case "get_weather_forecast": {
      const stadium = findStadium(String(input.stadium_id));
      if (!stadium) return { error: "unknown stadium_id -- call find_stadium or list_stadiums first" };
      return getStadiumForecast(stadium, {
        targetDate: typeof input.target_date === "string" ? input.target_date : undefined,
        hoursAhead: input.hours_ahead !== undefined ? Number(input.hours_ahead) : undefined,
      });
    }
    case "get_parking_exposure": {
      const ranked = rankLotsBySafety(String(input.stadium_id), Number(input.month), Number(input.hour));
      if (ranked.length === 0) return { error: "no parking-lot data for this stadium (not yet fetched, or unknown stadium_id)" };
      const slim = (le: (typeof ranked)[number]) => ({
        name: le.lot.name,
        name_status: le.lot.name_status,
        distance_m: le.lot.distance_m,
        area_m2: le.lot.area_m2,
        walk_minutes: le.walk_minutes,
        adjusted_wbgt_c: le.adjusted_wbgt_c,
        sports_flag: le.sports_flag,
      });
      return {
        total_lots_found: ranked.length,
        data_status: "SEMI",
        caveat: ranked[0].caveat,
        safest_5: ranked.slice(0, 5).map(slim),
        most_exposed_5: ranked.slice(-5).reverse().map(slim),
      };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server. Set it in .env.local (local) or the Vercel project's env vars (deployed)." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const question = body?.question;
  if (typeof question !== "string" || !question.trim()) {
    return Response.json({ error: "question (string) is required" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  const toolCallLog: { tool: string; input: unknown; result: unknown }[] = [];

  // Bounded agentic loop: the model calls tools, we execute them
  // against real local data, feed results back, repeat until it
  // returns a final text answer -- capped so a malfunctioning loop
  // can't run away.
  for (let turn = 0; turn < 6; turn++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    if (toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return Response.json({ answer: text, tool_calls: toolCallLog });
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (tu) => {
        const result = await runTool(tu.name, (tu.input as Record<string, unknown>) ?? {});
        toolCallLog.push({ tool: tu.name, input: tu.input, result });
        return { type: "tool_result" as const, tool_use_id: tu.id, content: JSON.stringify(result) };
      })
    );
    messages.push({ role: "user", content: toolResults });
  }

  return Response.json({ error: "agent did not converge to an answer in time" }, { status: 504 });
}
