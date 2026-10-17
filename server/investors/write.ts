/**
 * write.ts, the first email to an investor.
 *
 * ## Why the traction rules are the strictest in the codebase
 *
 * Every other draft this system writes can be wrong and cost a reply. An
 * investor email that overstates traction costs the raise, and it costs it
 * later rather than immediately: the number goes unchallenged in the first
 * email, gets repeated in the deck, and is found in diligence. A founder caught
 * inflating one figure has every other figure re-examined.
 *
 * Only use figures supplied to this request. Their source, time window, and
 * meaning must be checked before sending; this module does not prove that a
 * figure is current or that a transaction settled customer funds.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface InvestorFacts {
  firm: string;
  website?: string | null;
  country?: string | null;
  focus?: string | null;
  evidence?: string | null;
  contactName?: string | null;
  contactTitle?: string | null;
  addressKind?: string | null;
}

export interface Traction {
  poolsSettled: number;
  pairs: number;
  closes: number;
  historyFrom: string;
}

export interface InvestorDraft {
  fit: string;
  fitScore: number;
  subject: string;
  body: string;
}

const SYSTEM = `You write the first email to an investor, as Anthony Kumako,
founder of BlockFinaX. Do not assume a fundraising round or stage.

## What BlockFinaX is

BlockFinaX is developing blockchain-based tools for foreign-exchange risk
management and cross-border payments. Do not claim that a market, corridor,
settlement flow, token, fee or feature is currently available unless that fact
is supplied with current verification for this email. Do not make claims about
competitors' minimums or access to hedging.

## The only numbers you may use

You are given the real figures below. Use those or none.

Do not round up. Do not annualise. Do not project. Do not describe a number as
"over" or "nearly" something it is not. Do not invent users, revenue, volume,
partnerships, letters of intent, pipeline or funding. If you want to say
something you have not been given, leave it out.

This rule is stricter here than anywhere else because the cost lands later. A
figure that goes unchallenged in a first email gets repeated into a deck and
found in diligence, and a founder caught inflating one number has every other
number re-examined.

## Say the stage plainly

Use only current figures and operating evidence provided with the request.
Do not state customer counts, markets, revenue, settlements, corporate status
or funding stage from memory or from this prompt. If the request has no current
evidence for a claim, omit it or say it is unverified.

## The email

Aim for 130 words and treat 160 as the ceiling. Given a limit you will write to
it, and a first email to an investor is read in ten seconds or not at all.

Four things, in this order:

One line on why them specifically. Their stage, their geography, something they
have backed or written, but only from what you were actually given.

If no focus was supplied, you do not know their thesis and must not state one.
"You invest at pre-seed in African fintech" written to a fund that does neither
reads as a mail merge, which is worse than saying nothing. Open on the problem
instead, or say plainly that you are writing on the chance it fits. Never invent
admiration for a portfolio company you have not been told about.

Two or three lines on the problem and what exists today. Do not generalize
about bank access or competitor coverage without evidence for the specific
market and prospect.

One or two lines describing only what current evidence in the request supports.

One clear ask. A short call, or an offer to send the deck. One ask, no
alternatives, no calendar link, no attachment.

Sign as:

Anthony Kumako
Founder, BlockFinaX

## Voice

Plain and direct, a founder rather than a fundraiser. British spelling. No em
dashes and no en dashes.

Banned outright: "excited to share", "reaching out", "quick call", "circle
back", "game changer", "disrupting", "massive market", "no brainer", "TAM",
"10x", "unicorn", "revolutionary". Also banned: parametric, protocol,
infrastructure play, on-chain as an adjective. Describe what it does.

Never claim regulatory status unless the current status and supporting official
evidence are supplied with the request.

Never promise a return.

For "fit", one or two sentences on why this investor specifically, honest about
what you are assuming. For "fitScore", 0 to 100, how well they match a pre-seed
African fintech raise.`;

const SCHEMA = {
  name: "write_investor_email",
  description: "Assess the fit and write the first email.",
  input_schema: {
    type: "object" as const,
    properties: {
      fit: { type: "string" },
      fitScore: { type: "integer", minimum: 0, maximum: 100 },
      subject: { type: "string" },
      body: { type: "string" },
    },
    required: ["fit", "fitScore", "subject", "body"],
  },
};

export async function writeInvestorEmail(
  apiKey: string,
  model: string,
  f: InvestorFacts,
  t: Traction,
): Promise<InvestorDraft | null> {
  const facts = [
    `Firm: ${f.firm}`,
    f.website ? `Website: ${f.website}` : null,
    f.country ? `Based: ${f.country}` : null,
    f.focus ? `Focus, as far as we know: ${f.focus}` : null,
    f.evidence ? `Other: ${f.evidence}` : null,
    f.contactName ? `Contact: ${f.contactName}${f.contactTitle ? `, ${f.contactTitle}` : ""}` : null,
    f.addressKind === "role"
      ? "The address is a shared firm inbox, so write to the firm rather than a person."
      : null,
  ].filter(Boolean).join("\n");

  const numbers = [
    `Pools created and settled: ${t.poolsSettled} (include only if this input is current, verified, and its meaning is clear)`,
    `Currency pairs: ${t.pairs} (include only if this input is current and verified)`,
    `Price observations: ${t.closes}; history start: ${t.historyFrom} (include only if current and verified)`,
    `No revenue, user, partnership, funding, or settlement claim is supplied here. Do not infer that any are zero or nonzero.`,
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model,
      max_tokens: 1100,
      system: SYSTEM,
      tools: [SCHEMA],
      tool_choice: { type: "tool", name: "write_investor_email" },
      messages: [{
        role: "user",
        content: `Who you are writing to:\n${facts}\n\nThe only figures you may use:\n${numbers}`,
      }],
    });

    const call = msg.content.find(b => b.type === "tool_use");
    if (!call || call.type !== "tool_use") return null;
    const o = call.input as any;

    const subject = typeof o?.subject === "string" ? o.subject.trim() : "";
    const body = typeof o?.body === "string" ? o.body.trim() : "";
    if (!subject || !body) return null;

    return {
      fit: typeof o?.fit === "string" ? o.fit.trim() : "",
      fitScore: Math.max(0, Math.min(100, Math.round(Number(o?.fitScore) || 0))),
      subject,
      body,
    };
  } catch {
    return null;
  }
}

/**
 * The real numbers, read rather than remembered.
 *
 * Computed per draft so a figure cannot go stale in a constant. The pool count
 * comes from the mirror, which the chain sync keeps current; the price history
 * is counted directly.
 */
export async function currentTraction(): Promise<Traction> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const fallback: Traction = { poolsSettled: 0, pairs: 0, closes: 0, historyFrom: "" };
  try {
    const r = (await db.execute(sql`
      select
        (select count(*) filter (where status = 'settled')::int from hedge_events) as settled,
        (select count(distinct underlying)::int from hedge_events) as pairs,
        (select count(*)::int from historical_fx_closes) as closes,
        (select min(date)::text from historical_fx_closes) as from_date
    `)).rows?.[0] as any;
    return {
      poolsSettled: Number(r?.settled) || 0,
      pairs: Number(r?.pairs) || 0,
      closes: Number(r?.closes) || 0,
      historyFrom: (r?.from_date ?? "").slice(0, 4),
    };
  } catch {
    return fallback;
  }
}
