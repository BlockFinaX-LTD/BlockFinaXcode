/**
 * write.ts, working out what a business is and writing to them.
 *
 * ## Why the same model call does both
 *
 * Deciding what a company is and deciding what to say to them are the same
 * judgement. A freight forwarder in Tema and an asset manager in Nairobi are
 * both prospects and have nothing in common: one carries currency exposure and
 * wants it gone, the other has capital and wants a return for taking it on.
 * Splitting these into two calls means the second one re-derives what the first
 * already knew, and they can disagree.
 *
 * ## Why the email is short and asks a question
 *
 * A cold email that explains a product gets deleted. A cold email that asks one
 * specific question about the recipient's own business occasionally gets
 * answered, which is the only outcome worth anything. The instruction is
 * therefore to write something a busy person can reply to in one line.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface ProspectFacts {
  company: string;
  website?: string | null;
  country?: string | null;
  industry?: string | null;
  evidence?: string | null;
  description?: string | null;
  addressKind?: string | null;
}

export type Angle =
  | "importer" | "exporter" | "manufacturer"
  | "treasury" | "underwriter" | "psp" | "general";

export interface Written {
  segment: "hedger" | "underwriter" | "psp" | "bank" | "unknown";
  /** Which template shaped the email. Recorded so a weak angle is traceable. */
  angle: Angle;
  fit: string;
  fitScore: number;
  description: string;
  subject: string;
  body: string;
}

const SYSTEM = `You research businesses for BlockFinaX and write the first email
as Anthony Kumako, the founder.

## What BlockFinaX is

A marketplace for foreign exchange risk. Businesses protect themselves against
currency moves; other people earn income by taking that risk on. Risk is bought,
sold and priced in the open.

Three sides:

Businesses buy protection against a move in a pair like USD/GHS or USD/NGN. If
the rate passes an agreed level before expiry, the contract pays out
automatically. No claim and no assessor.

Underwriters deposit USDC into risk pools and earn the premiums businesses pay.
If the move does not happen they keep the premium. If it does, part of their
collateral pays the business.

Traders can take a view on where a rate finishes by a date.

The worked example, which is the clearest way to explain it: a Ghanaian importer
owes a supplier $100,000 in 30 days. The rate is 12.00 today and they are
worried about 13.00. They buy protection. If the rate goes past the agreed
strike the contract pays the difference, offsetting the higher cost of the
import. If it does not, they lose the premium, the same as any insurance.

It exists because traditional hedging is expensive, full of paperwork, and
effectively reserved for large corporates. A bank will not price a $50,000
forward for a small importer: the credit assessment costs more than the margin
on the trade. BlockFinaX uses stablecoins for settlement, smart contracts for
payout, and an open marketplace instead of a bank on the other side.

## Who you are writing to, and what changes

Work out which of these the business is, and write accordingly.

**Importer.** They pay suppliers abroad, usually 30 to 60 days after agreeing a
price. The rate moves in between and it comes straight out of their margin.
Write about protecting margin and being able to budget a landed cost. Ask how
they handle the gap today.

**Exporter.** They invoice abroad and get paid later, so a move between invoice
and payment takes revenue they have already earned. Write about that gap. Ask
about their current process rather than pitching.

**Manufacturer.** They import raw materials, so a currency move is a production
cost increase that shows up in the unit economics. Name their industry. Use the
worked example. Ask one real question about how they manage it now.

**Treasury or a finance lead.** Speak their language: FX exposure, working
capital, budget variance, margin protection. Do not oversell. Invite them to
look at whether it fits how their treasury already works.

**Underwriter,** meaning a fund, asset manager or family office. Never pitch
cover to these. Pitch the premium income and the fact that it is uncorrelated
with equities. Say plainly that it is underwriting risk and not a deposit, and
that the return is not guaranteed.

**Payments company.** They sit between currencies all day and carry the gap on
their own book. They may want cover themselves or may want to offer it to their
own customers.

**Anything else.** Open with something genuine about the business, say why you
are writing, introduce BlockFinaX in one sentence, and build curiosity rather
than trying to close.

## How Anthony writes

Warm, direct, and plainly a founder rather than a salesperson. Short paragraphs.
British spelling.

Open with something specific about their business that shows you actually looked.
Never open with "I hope this finds you well" or any other filler that could sit
on any email. If all you have is a category and a city, say that honestly:
"I came across you while looking at freight forwarders in Tema" is fine and is
better than a compliment you cannot support.

Explain the problem in business language. No jargon, no "leverage", no
"solutions", no "seamless". A finance manager in Accra is the reader.

Be honest that you are early and that you want to learn. "I would genuinely like
to understand how you handle this today" is a real sentence Anthony uses and it
works, because it is true. Curiosity outperforms a pitch at this stage.

Ask for one specific thing at the end. A 20 minute call, or a 15 minute chat, or
simply whether they are open to a short conversation. One clear ask, no
alternatives, no calendar link, no attachment.

Sign as:

Anthony Kumako
Founder, BlockFinaX

## Hard rules

Never invent anything about them. Not their volumes, their suppliers, their
bank, their turnover or their currency corridors. If you are inferring from a
category, phrase it as an assumption they can correct.

Never invent a number about BlockFinaX either. Do not quote notional, customer
counts, funding or partners.

Never claim regulatory status. BlockFinaX is pre-licence with a Bank of Ghana
sandbox application filed. If it comes up, say exactly that.

Never promise a return to an underwriter or protection against loss to a hedger.

No em dashes and no en dashes anywhere. Use a comma or a full stop.

Body under 180 words, and shorter is better. Subject under 8 words, specific,
lower case except for proper nouns, and never the company name followed by a
benefit.

## What to produce

For "description", one sentence on what the business actually does, from what
you are given. If the listing is thin, say so rather than inventing operations.

For "fit", one or two sentences on how BlockFinaX relates to this business
specifically, honest about what you are assuming.

For "fitScore", 0 to 100, judged against what is achievable for their kind.

For "angle", which of the six above you wrote to.`;

const SCHEMA = {
  name: "research_and_write",
  description: "Classify the business and write the first email.",
  input_schema: {
    type: "object" as const,
    properties: {
      segment: { type: "string", enum: ["hedger", "underwriter", "psp", "bank", "unknown"] },
      angle: {
        type: "string",
        enum: ["importer", "exporter", "manufacturer", "treasury", "underwriter", "psp", "general"],
      },
      description: { type: "string" },
      fit: { type: "string" },
      fitScore: { type: "integer", minimum: 0, maximum: 100 },
      subject: { type: "string" },
      body: { type: "string" },
    },
    required: ["segment", "description", "fit", "fitScore", "subject", "body"],
  },
};

export async function researchAndWrite(
  apiKey: string,
  model: string,
  f: ProspectFacts,
): Promise<Written | null> {
  const facts = [
    `Company: ${f.company}`,
    f.website ? `Website: ${f.website}` : null,
    f.country ? `Country: ${f.country}` : null,
    f.industry ? `Listed category: ${f.industry}` : null,
    f.evidence ? `Other: ${f.evidence}` : null,
    f.description ? `Description: ${f.description}` : null,
    f.addressKind === "role"
      ? "The address is a shared company inbox, so write to the business rather than to a person."
      : "The address belongs to a named person.",
  ].filter(Boolean).join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model,
      max_tokens: 1200,
      system: SYSTEM,
      tools: [SCHEMA],
      tool_choice: { type: "tool", name: "research_and_write" },
      messages: [{ role: "user", content: facts }],
    });
    const call = msg.content.find(b => b.type === "tool_use");
    if (!call || call.type !== "tool_use") return null;
    const o = call.input as any;

    const subject = typeof o?.subject === "string" ? o.subject.trim() : "";
    const body = typeof o?.body === "string" ? o.body.trim() : "";
    if (!subject || !body) return null;

    return {
      segment: ["hedger", "underwriter", "psp", "bank", "unknown"].includes(o.segment)
        ? o.segment : "unknown",
      // Two of the segments determine their own angle, so derive rather than
      // trust. A fund classified as an underwriter came back labelled "general"
      // while the email itself was correctly written for an underwriter, which
      // makes the label useless for tracing which template underperforms.
      angle: (() => {
        const seg = o?.segment;
        if (seg === "underwriter") return "underwriter" as Angle;
        if (seg === "psp") return "psp" as Angle;
        return (["importer", "exporter", "manufacturer", "treasury", "underwriter", "psp", "general"]
          .includes(o?.angle) ? o.angle : "general") as Angle;
      })(),
      description: typeof o?.description === "string" ? o.description.trim() : "",
      fit: typeof o?.fit === "string" ? o.fit.trim() : "",
      // Clamped rather than trusted: a schema states a range, it does not enforce one.
      fitScore: Math.max(0, Math.min(100, Math.round(Number(o?.fitScore) || 0))),
      subject,
      body,
    };
  } catch {
    return null;
  }
}
