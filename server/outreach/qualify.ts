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
 *   buyer     carries the exposure themselves. Sell to them.
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

export type Segment = "buyer" | "amplifier" | "partner" | "peer" | "investor" | "observer";

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

BlockFinaX is developing tools for foreign-exchange risk management and
cross-border payments. Do not assume a prospect's exposure, provider access,
eligibility or product fit from their country, industry or job title. Do not
claim automatic payouts, published rates or competitor limitations without
current, source-backed evidence.

Sort each account into one of five kinds. The kind matters more than the score,
because it decides what a good outcome even looks like.

buyer: they carry currency exposure themselves. An importer, an exporter, a
manufacturer paying suppliers abroad, a CFO or treasurer at one. These are the
people who might actually buy cover.

amplifier: they write, publish or broadcast about currency and trade. Business
titles, financial media, newsletter writers, analysts with an audience. They
will never buy cover. They are still valuable, often more so, because a good
comment on their post is read by hundreds of people who would. Do not score
these low for failing to be customers.

partner: a bank, broker, fintech, payments company or trade association that
could distribute or complement the product.

peer: building something adjacent, including other FX or trade finance startups.
Worth knowing about. Not worth selling to.

investor: backs companies rather than buying from them. A partner, principal or
angel at a fund. They are not a customer and never will be, and scoring them
against customer fit is meaningless. Judge them on whether they invest at
pre-seed, in Africa, and in fintech or adjacent infrastructure.

observer: interested in the subject without being exposed to it. Consultants,
academics, students, general commentators.

For "fit", write one or two sentences saying how BlockFinaX relates to this
specific person. Be concrete and be honest, including when the honest answer is
that there is no real connection. "Runs a Tema food importer paying suppliers in
dollars on 45 day terms, which is exactly the exposure the GHS pools cover" is
useful. "Interested in African fintech" is not. If you are inferring rather than
reading, say so: "headline suggests" is better than asserting.

For "fitScore", 0 to 100, judge how worth Anthony's time this account is,
measured against what is achievable for their kind. A business title with a
large audience and constant currency coverage can score 90 as an amplifier. A
consultant who mentioned FX once scores 15. Do not deduct points from an
amplifier for not being a buyer.

Never invent employment, location or business details that are not in what you
are given.

Write plainly. Anthony reads these, so no em dashes and no en dashes anywhere.
Use a comma or a full stop instead. No jargon and no marketing language.`;

const SCHEMA = {
  name: "qualify",
  description: "Sort this account and say how BlockFinaX relates to them.",
  input_schema: {
    type: "object" as const,
    properties: {
      segment: { type: "string", enum: ["buyer", "amplifier", "partner", "peer", "investor", "observer"] },
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
      ["buyer", "amplifier", "partner", "peer", "investor", "observer"].includes(out?.segment)
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
