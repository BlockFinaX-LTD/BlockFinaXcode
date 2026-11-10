/**
 * qualify.ts, working out what a lead actually is and how we relate to them.
 *
 * ## Why a segment rather than a score alone
 *
 * A single "how good is this lead" number treats everyone as a failed customer.
 * Most of the accounts that surface in these threads are not customers and were
 * never going to be, and the useful question is not how close they are to
 * buying but what a good outcome with them looks like:
 *
 *   buyer     a hedger: carries the exposure themselves. Sell to them.
 *   underwriter supplies USDC to back cover. The other side of the market.
 *   amplifier writes about it. Never buys cover, but a comment on their post is
 *             read by hundreds who might. A Nigerian business title has more
 *             reach than any single importer, and scoring it low because it
 *             will not buy is how you miss the best distribution you have.
 *   partner   a bank, broker or association that could carry the product.
 *   peer      building something adjacent. Worth knowing, not worth selling to.
 *   observer  interested, not exposed.
 *
 * Getting this wrong in either direction is expensive. Pitching an amplifier
 * reads as spam to an audience; ignoring one wastes the widest reach available.
 *
 * ## Why the model may not mark anything verified
 *
 * It is guessing about a stranger's business from a headline and a few posts,
 * and it will guess confidently either way. Anthony confirming is what turns a
 * guess into a lead, which is why `verified` is set by a person and by nothing
 * else.
 */

import Anthropic from "@anthropic-ai/sdk";

export type Segment = "buyer" | "underwriter" | "amplifier" | "partner" | "peer" | "investor" | "observer";

export interface Qualification {
  segment: Segment;
  fit: string;
  fitScore: number;
}

export interface PersonInput {
  name?: string | null;
  headline?: string | null;
  company?: string | null;
  about?: string | null;
  topics?: string | null;
  posts: string[];
}

const SYSTEM = `You qualify LinkedIn accounts as leads for BlockFinaX.

BlockFinaX sells FX protection to businesses in emerging markets and is backed by
underwriters who supply USDC to the pools that pay out. Both sides are targets.

## The two targets

buyer (a hedger): a business in an emerging market that earns in local currency
and has foreign-currency bills coming due. It prices a sale, approves a purchase
or signs a contract weeks before it pays, and loses margin if the local currency
weakens in that gap. Look for:
- importers, distributors and wholesalers buying from overseas suppliers
- manufacturers sourcing raw materials, machinery or spare parts abroad
- service businesses paying for foreign software, equipment or contractors
- a foreign payment big enough to matter, recurring or one-off
- signs that bank FX cover is hard to get (minimums, credit lines, collateral,
  pricing, or the currency is not covered)
The person who decides is the owner or managing director of an owner-led
business, or the CFO, finance manager or treasury lead of a larger one. Ghana and
Nigeria come first; other emerging markets still count.

underwriter: a professional capital provider that could supply USDC to back
cover, earning a share of premiums and taking the payout risk. Look for:
- FX trading firms and market makers, especially with emerging-market FX desks
- digital-asset funds and professional onchain liquidity providers that already
  deploy USDC or other stablecoins
- trade finance and emerging-market credit funds
The person who decides is a head of FX, portfolio manager, CIO or investment
lead who can approve a capital allocation. A retail crypto trader or a DeFi yield
hobbyist is not an underwriter; mark them observer.

## The other kinds

amplifier: writes, publishes or broadcasts about currency and trade to an
audience. Never buys cover, but a good comment on their post reaches many who
would. Do not score them low for not being a customer.

partner: a bank, broker, fintech, payments company or trade association that
could distribute or complement the product.

peer: building something adjacent, including other FX or trade finance startups.

investor: backs companies (venture, angel). Judge them on whether they invest at
pre-seed, in Africa, and in fintech or infrastructure. A fund that would deploy
capital into the pools is an underwriter, not an investor.

observer: interested in the subject without being exposed to it or able to
supply capital. Consultants, academics, students, general commentators, junior
staff with no say over payments or capital.

## Scoring

For "fit", one or two sentences on how BlockFinaX relates to this person. Be
concrete: "Finance manager at a Kumasi building materials importer paying
Chinese suppliers in dollars" is useful; "interested in African fintech" is not.
If you are inferring, say so ("headline suggests").

For "fitScore", 0 to 100, how worth Anthony's time this account is for its kind.
For buyers and underwriters, score high (70 or more) only when all three show:
the right kind of business, a person who can decide, and some evidence of the
exposure or the mandate. Drop well below 50 when the person cannot decide (an
analyst, an intern, sales staff) or when the company type is a guess. For
buyers, Ghana or Nigeria adds weight; country alone never proves exposure.
A business title with a big audience can score 90 as an amplifier.

Never invent employment, location or business details that are not given.

Write plainly. Anthony reads these, so no em dashes and no en dashes anywhere.
Use a comma or a full stop instead. No jargon and no marketing language.`;

const SCHEMA = {
  name: "qualify",
  description: "Sort this account and say how BlockFinaX relates to them.",
  input_schema: {
    type: "object" as const,
    properties: {
      segment: { type: "string", enum: ["buyer", "underwriter", "amplifier", "partner", "peer", "investor", "observer"] },
      fit: { type: "string", description: "one or two concrete sentences" },
      fitScore: { type: "integer", minimum: 0, maximum: 100 },
    },
    required: ["segment", "fit", "fitScore"],
  },
};

export async function qualifyPerson(
  apiKey: string,
  model: string,
  p: PersonInput,
): Promise<Qualification | null> {
  const facts = [
    p.name ? `Name: ${p.name}` : null,
    p.headline ? `Headline: ${p.headline}` : null,
    p.company ? `Company: ${p.company}` : null,
    p.about ? `Their own profile summary:\n${p.about.slice(0, 2000)}` : null,
    p.topics ? `Subjects their posts matched: ${p.topics}` : null,
    p.posts.length
      ? `What they have posted:\n${p.posts.slice(0, 3).map(t => `- ${t.slice(0, 700)}`).join("\n")}`
      : null,
  ].filter(Boolean).join("\n\n");

  if (!facts.trim()) return null;

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model,
      max_tokens: 700,
      system: SYSTEM,
      tools: [SCHEMA],
      tool_choice: { type: "tool", name: "qualify" },
      messages: [{ role: "user", content: facts }],
    });
    const call = msg.content.find(b => b.type === "tool_use");
    if (!call || call.type !== "tool_use") return null;
    const out = call.input as any;

    const segment: Segment =
      ["buyer", "underwriter", "amplifier", "partner", "peer", "investor", "observer"].includes(out?.segment)
        ? out.segment
        : "observer";
    const fit = typeof out?.fit === "string" ? out.fit.trim() : "";
    // Clamped rather than trusted. The schema states a range; a range in a
    // schema is a request, and this value sorts the list Anthony works from.
    const fitScore = Math.max(0, Math.min(100, Math.round(Number(out?.fitScore) || 0)));

    return fit ? { segment, fit, fitScore } : null;
  } catch {
    return null;
  }
}
