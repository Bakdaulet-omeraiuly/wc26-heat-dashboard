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
} from "@/lib/agentData";

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

You have tools to look up real per-stadium climatology, rank all 11 venues, fetch the real 20-year warming trend, and run the modeled mitigation scenario. Use them; do not answer from memory.`;

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
];

function runTool(name: string, input: Record<string, unknown>): unknown {
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
    const toolResults: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => {
      const result = runTool(tu.name, (tu.input as Record<string, unknown>) ?? {});
      toolCallLog.push({ tool: tu.name, input: tu.input, result });
      return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) };
    });
    messages.push({ role: "user", content: toolResults });
  }

  return Response.json({ error: "agent did not converge to an answer in time" }, { status: 504 });
}
