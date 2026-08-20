/**
 * planner.ts, deciding what to go looking for without being told.
 *
 * The search box worked, but it put the hardest judgement on Anthony: knowing
 * which angle is worth hunting this week. That is the job a senior marketer
 * actually does, and it is not keyword invention. It is timing.
 *
 * ## Why the plan starts from the rate data
 *
 * A fixed keyword list goes stale in a fortnight and hunts the same ground
 * forever. The interesting angle changes with the market, and the market is
 * already in the database:
 *
 *   A currency in the 5th percentile of its own volatility history means the
 *   feed is full of people declaring the crisis over. That is the moment worth
 *   commenting into, because the claim is checkable and mostly wrong.
 *
 *   A currency that just moved 5% in a month means the feed is full of
 *   importers describing the damage. Different search, different register.
 *
 *   A currency doing nothing at all is not worth a campaign, and a planner that
 *   cannot say so will invent a reason to run one.
 *
 * So the briefs go in first and the queries come out of them. The plan is a
 * read of the market, not a list of nouns.
 *
 * ## Why a model writes the queries
 *
 * Turning "USD/NGN sits at the 7th percentile since 2003" into the phrase
 * someone would actually type on LinkedIn is a language problem, and the
 * pattern differs per angle. People do not post "low realised volatility". They
 * post "the naira has finally stabilised". Hard-coding that mapping is how you
 * end up searching for words only an analyst would use.
 */

import Anthropic from "@anthropic-ai/sdk";
import { briefFor, renderBrief } from "./market-brief";
import { listMemory } from "./memory";

/** The pairs the business actually writes cover on. */
const CORE_PAIRS = ["USD/GHS", "USD/NGN", "USD/KES", "USD/ZAR"];

export interface PlannedSearch {
  /** What to type into LinkedIn search. */
  query: string;
  /** The angle in a few words, shown to Anthony so the plan is auditable. */
  angle: string;
  /** Why now. This is the part that justifies spending a search on it. */
  why: string;
}

const PLANNER_SYSTEM = `You are the senior marketer for BlockFinaX, planning where to
spend attention on LinkedIn this week.

BlockFinaX writes parametric FX cover for businesses in frontier markets. The
buyers are importers, exporters, CFOs, treasurers and trade finance people in
Ghana, Nigeria, Kenya and South Africa, whose banks will not sell them a forward
because the ticket is too small to justify the credit assessment. The people
worth reaching are the ones already talking in public about currency risk,
working capital, supplier payments or dollar access.

Your job is to decide what to go looking for, and the answer changes with the
market. You are given what each currency has actually done, computed this
minute. Read it like a trader, then think like a marketer about who is posting
because of it.

The mapping that matters:

Unusually low volatility means people are declaring the crisis over. Those posts
are confident, checkable and often wrong, which makes them the best threads to
be in. Search the language of relief and stability.

A large recent move means people are describing damage in operational terms.
Search the language of margins, landed cost, budgets and supplier terms.

Frequent jumps mean people are complaining that forecasting does not work.
Search the language of planning and unpredictability.

A currency doing nothing unusual does not deserve a search. Say so by leaving it
out. You are not required to cover every pair, and a plan with three good angles
beats one with six weak ones.

Write queries the way a person writes a LinkedIn post, not the way an analyst
writes a note. Nobody posts "elevated realised volatility". They post "the cedi
is killing our margins". Two to five words, no boolean operators, no quotes, no
hashtags.

Return between 3 and 5 searches. Make each one hunt different ground; two
queries that would return the same posts are one wasted search.`;

const SCHEMA = {
  name: "plan_searches",
  description: "Return the searches worth running now.",
  input_schema: {
    type: "object" as const,
    properties: {
      searches: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            query: { type: "string", description: "2 to 5 words, as a person would write it" },
            angle: { type: "string", description: "the angle in a few words" },
            why: { type: "string", description: "one sentence, citing the figure that justifies it now" },
          },
          required: ["query", "angle", "why"],
        },
      },
    },
    required: ["searches"],
  },
};

/**
 * Clean the model's plan before any of it is paid for.
 *
 * Each query becomes a provider call that costs money, so two queries differing
 * only by case or spacing would be charged twice for the same posts. The cap at
 * five is the spend limit, and it is enforced here rather than trusted to the
 * tool schema, because a schema describes an intention and this decides a bill.
 */
export function normalisePlan(raw: unknown): PlannedSearch[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PlannedSearch[] = [];
  for (const r of raw as any[]) {
    const query = typeof r?.query === "string" ? r.query.trim().replace(/\s+/g, " ") : "";
    if (query.length < 3) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      query,
      angle: typeof r?.angle === "string" ? r.angle.trim() : "",
      why: typeof r?.why === "string" ? r.why.trim() : "",
    });
    if (out.length === 5) break;
  }
  return out;
}

/**
 * Build this week's plan.
 *
 * Falls back to a small fixed set if the model call fails, because a scan that
 * returns nothing because the planner errored is indistinguishable, from the
 * outside, from a LinkedIn search that found nothing. The fallback is
 * deliberately labelled so Anthony can see the difference in the console.
 */
export async function planSearches(apiKey: string, model: string): Promise<{
  searches: PlannedSearch[];
  market: string;
  fallback: boolean;
}> {
  const briefs: string[] = [];
  for (const p of CORE_PAIRS) {
    try {
      const b = await briefFor(p);
      if (b) briefs.push(renderBrief(b));
    } catch {
      /* a missing pair must not stop the plan */
    }
  }
  const market = briefs.join("\n\n");

  let topical = "";
  try {
    const mem = (await listMemory()).slice(0, 6);
    if (mem.length) {
      topical = mem
        .map(m => `- [${m.kind}] ${m.title} (as of ${new Date(m.asOf).toISOString().slice(0, 10)})`)
        .join("\n");
    }
  } catch {
    /* memory is optional context */
  }

  const fallbackPlan: PlannedSearch[] = [
    { query: "cedi importers margins", angle: "operational damage", why: "Standing angle, used because the planner could not run." },
    { query: "naira stability planning", angle: "relief posts", why: "Standing angle, used because the planner could not run." },
    { query: "trade finance gap africa", angle: "structural", why: "Standing angle, used because the planner could not run." },
  ];

  if (!market) return { searches: fallbackPlan, market: "", fallback: true };

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model,
      max_tokens: 1200,
      system: PLANNER_SYSTEM,
      tools: [SCHEMA],
      tool_choice: { type: "tool", name: "plan_searches" },
      messages: [{
        role: "user",
        content:
          `What the currencies have done, computed just now:\n\n${market}\n\n` +
          (topical ? `Recent things we have recorded:\n${topical}\n\n` : "") +
          `Plan the searches worth running today.`,
      }],
    });

    const call = msg.content.find(b => b.type === "tool_use");
    const raw = call && call.type === "tool_use" ? (call.input as any)?.searches : null;
    if (!Array.isArray(raw) || !raw.length) return { searches: fallbackPlan, market, fallback: true };

    const searches = normalisePlan(raw);
    return searches.length
      ? { searches, market, fallback: false }
      : { searches: fallbackPlan, market, fallback: true };
  } catch {
    return { searches: fallbackPlan, market, fallback: true };
  }
}
