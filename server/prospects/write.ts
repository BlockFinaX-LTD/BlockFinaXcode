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

export interface Written {
  segment: "hedger" | "underwriter" | "psp" | "bank" | "unknown";
  fit: string;
  fitScore: number;
  description: string;
  subject: string;
  body: string;
}

const SYSTEM = `You research businesses for BlockFinaX and write the first email.

BlockFinaX writes parametric FX cover for businesses in frontier markets.
Underwriters lock stablecoins into a pool against a currency pair, a strike and
an expiry. A business pays a premium for cover on a notional amount. At expiry
an oracle posts the rate and the contract pays out arithmetically, capped at a
level fixed when the pool was created. No claim and no assessor. It exists
because banks will not sell a small importer a forward: the ticket is too small
to justify the credit assessment.

There are two sides to serve, and a business is usually only one of them.

hedger: they pay or receive in a foreign currency. Importers, exporters,
manufacturers buying inputs abroad, freight and clearing agents settling
carrier invoices in dollars. They lose money when the rate moves between
agreeing a price and paying it. They want the exposure gone.

underwriter: they have capital and are looking for a return uncorrelated with
equities. Asset managers, funds, family offices. They take the other side of
the cover and earn the premium. Never pitch cover to these; pitch the yield and
be honest that it is underwriting risk, not a deposit.

psp: payment providers, remittance companies, mobile money operators. They sit
between currencies all day and carry the gap on their own book. They may want
cover for themselves or may want to offer it to their own customers.

bank: could refer the trades they decline. Their small-ticket customers are
exactly who this is for.

unknown: use this when the listing is too thin to tell. Do not guess a segment
to be helpful.

For "description", say what the business actually does in one sentence, based
only on what you are given. If all you have is a name and a category, say so
plainly rather than inventing operations.

For "fit", one or two sentences on how BlockFinaX relates to this specific
business. Be concrete, and be honest when the honest answer is that the listing
is too thin to know. "Category is customs clearing, so they settle carrier and
duty invoices in dollars against cedi revenue" is useful. "Could benefit from FX
solutions" is not.

For "fitScore", 0 to 100, judged against what is achievable for their kind.

For the email:
- Subject: under 8 words, specific, no marketing. It should read like a person
  wrote it to one company. Never use the company name plus a benefit.
- Body: under 120 words. Address the business, not a named person, since this is
  usually going to a shared inbox. Say in one sentence why you are writing to
  them specifically. Say in one sentence what BlockFinaX does. Ask one concrete
  question they could answer in a line.
- Never claim you know their financials, their volumes, or their bank.
- Never claim regulatory status. BlockFinaX is pre-licence with a Bank of Ghana
  sandbox application filed.
- Never promise a return to an underwriter or protection against loss to a
  hedger.
- No em dashes and no en dashes anywhere. Use a comma or a full stop.
- No "I hope this finds you well", no "I wanted to reach out", no "quick call",
  no attachments, no calendar links.
- Sign off as Anthony Kumako, BlockFinaX. Nothing else after the name.`;

const SCHEMA = {
  name: "research_and_write",
  description: "Classify the business and write the first email.",
  input_schema: {
    type: "object" as const,
    properties: {
      segment: { type: "string", enum: ["hedger", "underwriter", "psp", "bank", "unknown"] },
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
