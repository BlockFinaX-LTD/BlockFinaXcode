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
 * So the numbers are computed from the chain and the database at send time and
 * handed to the writer as the only figures it may use. It may not round them
 * up, project from them, annualise them, or describe them as more than they
 * are. Eleven settled pools is eleven settled pools.
 *
 * ## Why being small is said out loud
 *
 * The real position is eleven pools on two pairs and no revenue worth naming.
 * A pre-seed investor knows what pre-seed looks like and is not deceived by
 * omission, only irritated by it. The thing that distinguishes this from the
 * other twenty emails in their inbox is not scale, it is that the contract has
 * settled real money to real people on mainnet, which most pre-seed pitches
 * cannot say at all.
 *
 * The price history is the other genuine asset. Nearly half a million daily
 * closes back to 1996 is why the engine can price a pair that no bank quotes,
 * and it is the sort of thing that is hard to acquire and easy to verify.
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
founder of BlockFinaX. He is raising pre-seed.

## What BlockFinaX is

It helps businesses protect themselves against currency volatility. A business
in Ghana or Nigeria pays for protection against a move past an agreed level by
an agreed date. Other people put up capital, take the other side, and earn that
payment. If the move happens the business is paid the difference automatically
against a published rate, with no claim and no assessor. It settles in
stablecoins on Base.

It exists because a bank will not sell a $50,000 forward to a small importer:
the credit assessment costs more than the bank earns on the trade. So the
businesses most exposed to a currency move are the ones with no way to cover it.

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

The honest position is early: a small number of pools, two currency pairs, and
no revenue worth naming. Say so. A pre-seed investor knows what pre-seed looks
like and is not fooled by omission, only irritated by it.

What actually distinguishes this from the rest of their inbox is that the
contract has settled real money to real people on mainnet, which most pre-seed
pitches cannot claim at all, and that the pricing runs on a long daily price
history that is hard to acquire and easy to verify.

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

Two or three lines on the problem and what exists today. The problem is the
interesting part: the businesses with the most currency exposure are the ones
banks will not quote.

One or two lines of what is actually built and settled, using the given figures.

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

Never claim regulatory status. BlockFinaX is pre-licence with a Bank of Ghana
sandbox application filed. If it is relevant, say exactly that.

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
    `Cover pools created and settled on Base mainnet: ${t.poolsSettled}`,
    `Currency pairs covered so far: ${t.pairs}`,
    `Daily closing prices held for pricing: ${t.closes.toLocaleString()}, going back to ${t.historyFrom}`,
    `Revenue: none worth naming yet. Do not imply otherwise.`,
    `Users: not a figure you have been given. Do not state one.`,
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
