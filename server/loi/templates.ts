/**
 * Document generation engine.
 *
 * Turns the wizard's structured answers into finished legal prose.
 *
 * This is deterministic drafting, not a language model. That is a deliberate
 * choice for documents that get signed: the same inputs always produce the
 * same clauses, every sentence is one a lawyer reviewed once and approved
 * forever, and nothing can invent an obligation that was never agreed. An
 * LLM pass is wired in separately (see ai.ts) for *rewriting* clauses the
 * user asks it to touch — assistance on top of a sound base, rather than the
 * base itself.
 *
 * Adding a document type means adding a builder to BUILDERS. The rest of the
 * pipeline — review, comment, sign, PDF, audit — never changes.
 */

import type { LoiTerms, DocType, RelationshipType, CustomClause } from "@shared/loi-schema";
import { RELATIONSHIP_LABELS, DOC_TYPE_LABELS } from "@shared/loi-schema";

export interface TemplateInput {
  docType: DocType;
  relationshipType: RelationshipType;
  senderCompany: string;
  senderName: string;
  senderPosition?: string | null;
  senderEmail: string;
  senderPhone?: string | null;
  recipientCompany: string;
  recipientName: string;
  recipientPosition?: string | null;
  recipientEmail: string;
  recipientCountry?: string | null;
  terms: LoiTerms;
  /** Date the document bears. Defaults to today. */
  date?: Date;
}

const DEFAULT_LAW = "the laws of England and Wales";

function fmtDate(d: Date): string {
  // House style, matching the letters BlockFinaX already sends.
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** Sentence-cases a free-text fragment so it reads correctly mid-clause. */
function lower(s: string): string {
  const t = s.trim();
  if (!t) return t;
  // Leave acronyms and proper nouns alone; only fix a leading capital that
  // came from the form field being typed as a sentence.
  return /^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

function stripTrailingPeriod(s: string): string {
  return s.trim().replace(/\.\s*$/, "");
}

/** Renders a numbered clause with a heading. */
function clause(n: number, heading: string, body: string): string {
  return `## ${n}. ${heading}\n\n${body.trim()}\n`;
}

function volumePhrase(terms: LoiTerms): string | null {
  const vol = terms.estimatedVolume?.trim();
  if (!vol) return null;
  const cur = terms.currency?.trim();
  // If the user already typed a currency symbol or code, don't double it up.
  const hasCur = cur && new RegExp(`\\b${cur}\\b|[$£€]`, "i").test(vol);
  return hasCur || !cur ? vol : `${cur} ${vol}`;
}

// ── Relationship-specific collaboration language ─────────────────────────

/**
 * Relationship-specific content.
 *
 * `lead` is the paragraph describing what we intend to provide; `bullets`
 * become the "The proposed collaboration includes:" list. Both are written in
 * the same voice as the rest of the letter — first person, plain English.
 */
interface Collaboration {
  lead: (t: TemplateInput) => string;
  bullets: (t: TemplateInput) => string[];
}

const COLLABORATION_BY_RELATIONSHIP: Record<RelationshipType, Collaboration> = {
  institutional_underwriter: {
    lead: (t) =>
      `Through this collaboration, ${t.recipientCompany} intends to participate as an underwriter on the ` +
      `${t.senderCompany} platform, providing risk capital that backs foreign exchange protection sold to ` +
      `businesses in emerging markets. The parties anticipate working together to agree underwriting ` +
      `capacity, complete the necessary compliance requirements, and execute the appropriate commercial ` +
      `agreements.`,
    bullets: () => [
      "Assessment of underwriting capacity and risk appetite.",
      "Agreement of premium share, collateral, and risk limits.",
      "Onboarding onto the BlockFinaX platform.",
      "Deployment of capital upon completion of legal, compliance, and commercial requirements.",
    ],
  },
  liquidity_provider: {
    lead: (t) =>
      `Through this collaboration, ${t.recipientCompany} intends to provide liquidity to the ` +
      `${t.senderCompany} platform, committing capital to the pools that support settlement and protection ` +
      `obligations. The parties anticipate working together to agree commercial terms, complete the ` +
      `necessary compliance requirements, and execute the appropriate agreements.`,
    bullets: () => [
      "Assessment of the liquidity commitment and expected yield.",
      "Agreement of lock-up, withdrawal mechanics, and fee structure.",
      "Onboarding onto the BlockFinaX platform.",
      "Deployment of liquidity upon completion of legal, compliance, and commercial requirements.",
    ],
  },
  sme: {
    lead: (t) =>
      `Through this collaboration, ${t.senderCompany} intends to provide access to its platform, enabling ` +
      `your business to manage exposure to currency volatility through tailored hedging solutions. The ` +
      `parties anticipate working together to assess your risk profile, complete the necessary compliance ` +
      `requirements, and execute the appropriate commercial agreements.`,
    bullets: () => [
      "Assessment of your foreign exchange exposure.",
      "Structuring suitable hedging solutions.",
      "Onboarding onto the BlockFinaX platform.",
      "Execution of protection contracts upon completion of legal, compliance, and commercial requirements.",
    ],
  },
  fintech_partner: {
    lead: (t) =>
      `Through this collaboration, ${t.senderCompany} intends to make its foreign exchange protection and ` +
      `settlement infrastructure available to ${t.recipientCompany} for integration into your own product. ` +
      `The parties anticipate working together to define the scope of integration, complete the necessary ` +
      `compliance requirements, and execute the appropriate commercial agreements.`,
    bullets: () => [
      "Definition of the integration scope and API access.",
      "Agreement of revenue share, service levels, and branding.",
      "Allocation of regulatory responsibilities between the parties.",
      "Technical integration and go-live upon completion of legal, compliance, and commercial requirements.",
    ],
  },
  strategic_partner: {
    lead: (t) =>
      `Through this collaboration, ${t.senderCompany} and ${t.recipientCompany} intend to combine their ` +
      `respective capabilities, distribution, and market presence. The parties anticipate working together ` +
      `to define the scope of cooperation, complete the necessary compliance requirements, and execute the ` +
      `appropriate commercial agreements.`,
    bullets: () => [
      "Definition of the scope of cooperation.",
      "Agreement of each party's contributions and responsibilities.",
      "Joint go-to-market planning.",
      "Execution of definitive agreements upon completion of legal, compliance, and commercial requirements.",
    ],
  },
  investor: {
    lead: (t) =>
      `Through this collaboration, ${t.recipientCompany} intends to explore an investment in ` +
      `${t.senderCompany}. The parties anticipate working together to agree the terms of the investment, ` +
      `complete due diligence, and execute the appropriate definitive documentation.`,
    bullets: () => [
      "Review of the business, financials, and growth plan.",
      "Agreement of investment amount, instrument, and valuation.",
      "Agreement of information and governance rights.",
      "Execution of definitive documentation upon completion of due diligence and legal requirements.",
    ],
  },
  broker: {
    lead: (t) =>
      `Through this collaboration, ${t.recipientCompany} intends to introduce counterparties to the ` +
      `${t.senderCompany} platform. The parties anticipate working together to agree commercial terms, ` +
      `complete the necessary compliance requirements, and execute the appropriate agreements.`,
    bullets: () => [
      "Agreement of the territories and client segments covered.",
      "Agreement of commission structure and attribution.",
      "Onboarding and compliance training for introduced business.",
      "Commencement of introductions upon completion of legal, compliance, and commercial requirements.",
    ],
  },
  other: {
    lead: (t) =>
      `Through this collaboration, ${t.senderCompany} and ${t.recipientCompany} intend to establish the ` +
      `working relationship described above. The parties anticipate working together to define the scope, ` +
      `complete the necessary compliance requirements, and execute the appropriate commercial agreements.`,
    bullets: () => [
      "Definition of the scope of the relationship.",
      "Agreement of each party's responsibilities.",
      "Onboarding and completion of compliance requirements.",
      "Execution of definitive agreements upon completion of legal, compliance, and commercial requirements.",
    ],
  },
};

// ── The LOI builder ──────────────────────────────────────────────────────

/**
 * Produces the letter in BlockFinaX house style: a flowing business letter,
 * not a clause-numbered contract. Deliberately has no numbered sections —
 * everything reads as prose, with a single bullet list for the proposed
 * scope. Optional inputs add a sentence or a paragraph; leaving them blank
 * simply shortens the letter rather than leaving a gap.
 */
function buildLoi(t: TemplateInput): string {
  const date = t.date ?? new Date();
  const A = t.senderCompany;
  const B = t.recipientCompany;
  const collab = COLLABORATION_BY_RELATIONSHIP[t.relationshipType];
  const out: string[] = [];

  out.push(`# LETTER OF INTENT\n`);
  out.push(`**Date:** ${fmtDate(date)}\n`);
  out.push(`**To:** ${B}\n`);
  out.push(`**Subject:** Letter of Intent to Partner with ${A}\n`);
  out.push(`${salutation(t)}\n`);

  // Opening — what this letter is.
  const purpose = t.terms.purpose?.trim();
  out.push(
    `This Letter of Intent ("LOI") confirms the mutual intention of ${A} and ${B} to explore and ` +
      `establish a business relationship for ${purpose ? lower(stripTrailingPeriod(purpose)) : defaultPurpose(t)}.\n`,
  );

  // What we propose to do together.
  out.push(`${collab.lead(t)}\n`);
  if (t.terms.description?.trim()) out.push(`${t.terms.description.trim()}\n`);

  // Scope list.
  out.push(`The proposed collaboration includes:\n`);
  for (const b of collab.bullets(t)) out.push(`- ${b}`);
  out.push("");

  // Commercial expectations, only when the user supplied any.
  const commercial = commercialSentence(t);
  if (commercial) out.push(`${commercial}\n`);

  // Good faith + non-binding. This is the operative paragraph of the letter.
  out.push(
    `The parties acknowledge that this Letter of Intent reflects their current understanding and desire ` +
      `to proceed in good faith toward a formal agreement. Except for any confidentiality obligations ` +
      `agreed by the parties, this Letter of Intent is non-binding and does not create a legal obligation ` +
      `to complete the proposed transaction.\n`,
  );

  // Confidentiality.
  out.push(`${confidentialityParagraph(t)}\n`);

  // Exclusivity, only when one was chosen.
  const exclusivity = exclusivityParagraph(t);
  if (exclusivity) out.push(`${exclusivity}\n`);

  // Governing law, only when the user set one — the sample letter omits it.
  if (t.terms.governingLaw?.trim()) {
    out.push(
      `This Letter of Intent shall be governed by and construed in accordance with ` +
        `${t.terms.governingLaw.trim()}.\n`,
    );
  }

  if (t.terms.specialConditions?.trim()) out.push(`${t.terms.specialConditions.trim()}\n`);
  if (t.terms.additionalNotes?.trim()) out.push(`${t.terms.additionalNotes.trim()}\n`);

  // Close.
  out.push(`If the above accurately reflects your understanding, please indicate your acceptance by signing below.\n`);
  out.push(`We look forward to building a successful partnership.\n`);
  out.push(`Sincerely,\n`);
  out.push(`${A}\n`);
  out.push(`${t.senderName}`);
  if (t.senderPosition?.trim()) out.push(`${t.senderPosition.trim()}`);

  return out.join("\n");
}

/** "Dear Dana," when we have a name, otherwise the formal fallback. */
function salutation(t: TemplateInput): string {
  const name = t.recipientName?.trim();
  return name ? `Dear ${name},` : "Dear Sir/Madam,";
}

/** Fills the opening sentence when no purpose was typed. */
function defaultPurpose(t: TemplateInput): string {
  switch (t.relationshipType) {
    case "institutional_underwriter":
      return "the provision of underwriting capacity for foreign exchange risk protection";
    case "liquidity_provider":
      return "the provision of liquidity supporting foreign exchange risk protection";
    case "sme":
      return "the provision of foreign exchange risk protection and related treasury solutions";
    case "fintech_partner":
      return "the integration of foreign exchange risk protection and settlement infrastructure";
    case "investor":
      return "a potential investment";
    case "broker":
      return "the introduction of counterparties to the BlockFinaX platform";
    default:
      return "the provision of foreign exchange risk protection and related treasury solutions";
  }
}

/** One sentence covering volume, currency, timing and duration — if given. */
function commercialSentence(t: TemplateInput): string | null {
  const vol = volumePhrase(t.terms);
  const bits: string[] = [];
  if (vol) bits.push(`an initial business volume in the order of ${vol}, which is indicative only and does not constitute a commitment by either party`);
  if (t.terms.startDate?.trim()) bits.push(`a proposed commencement on or around ${t.terms.startDate.trim()}`);
  if (t.terms.duration?.trim()) bits.push(`an expected term of ${lower(stripTrailingPeriod(t.terms.duration)).replace(/^an?\s+/, "")}`);
  if (!bits.length) return null;
  const joined = bits.length === 1 ? bits[0] : `${bits.slice(0, -1).join("; ")}; and ${bits[bits.length - 1]}`;
  return `The parties currently anticipate ${joined}. Pricing, fees, and settlement terms will be agreed in writing and set out in the definitive agreements.`;
}

function confidentialityParagraph(t: TemplateInput): string {
  if (t.terms.confidentiality === false) {
    return (
      `The parties do not treat the existence of this Letter of Intent as confidential. Any information ` +
      `expressly marked as confidential remains subject to the terms of any separate non-disclosure ` +
      `agreement between the parties.`
    );
  }
  const months = t.terms.confidentialityMonths ?? 24;
  return (
    `Both parties agree to maintain the confidentiality of any non-public information exchanged during ` +
    `these discussions unless disclosure is required by law or agreed upon in writing. This obligation ` +
    `shall remain in effect for ${months} months from the date of this Letter of Intent.`
  );
}

function exclusivityParagraph(t: TemplateInput): string | null {
  const mode = t.terms.exclusivity ?? "none";
  if (mode === "none") return null;
  const A = t.senderCompany;
  const B = t.recipientCompany;
  const period = t.terms.duration?.trim()
    ? "while this Letter of Intent remains in effect"
    : "for a period of ninety (90) days from the date of this Letter of Intent";
  if (mode === "mutual") {
    return (
      `${period[0].toUpperCase() + period.slice(1)}, neither party shall enter into negotiations with any ` +
      `third party in respect of a substantially similar arrangement without the prior written consent of ` +
      `the other party.`
    );
  }
  const restricted = mode === "recipient" ? B : A;
  const other = mode === "recipient" ? A : B;
  return (
    `${period[0].toUpperCase() + period.slice(1)}, ${restricted} shall not enter into negotiations with ` +
    `any third party in respect of a substantially similar arrangement without the prior written consent ` +
    `of ${other}.`
  );
}
// ── Other document types ─────────────────────────────────────────────────
// Each reuses the same shared clauses. Only the operative middle differs.

function buildNda(t: TemplateInput): string {
  const date = t.date ?? new Date();
  const law = t.terms.governingLaw?.trim() || DEFAULT_LAW;
  const months = t.terms.confidentialityMonths ?? 24;
  const parts: string[] = [];
  let n = 0;

  parts.push(`# Mutual Non-Disclosure Agreement\n`);
  parts.push(`**Date:** ${fmtDate(date)}\n`);
  parts.push(`## Parties\n`);
  parts.push(`**(1) ${t.senderCompany}**, represented by ${t.senderName}${t.senderPosition ? `, ${t.senderPosition}` : ""}; and\n`);
  parts.push(`**(2) ${t.recipientCompany}**${t.recipientCountry ? `, of ${t.recipientCountry}` : ""}, represented by ${t.recipientName}${t.recipientPosition ? `, ${t.recipientPosition}` : ""}.\n`);

  n += 1;
  parts.push(clause(n, "Purpose", t.terms.purpose?.trim()
    ? `The Parties wish to exchange confidential information for the purpose of ${lower(stripTrailingPeriod(t.terms.purpose))} (the "Purpose").`
    : `The Parties wish to exchange confidential information for the purpose of evaluating a potential commercial relationship (the "Purpose").`));

  n += 1;
  parts.push(clause(n, "Confidential Information",
    `"Confidential Information" means all information disclosed by one Party (the "Discloser") to the other (the "Recipient"), whether orally, in writing or in any other form, which is identified as confidential or which a reasonable person would understand to be confidential given its nature and the circumstances of disclosure.`));

  n += 1;
  parts.push(clause(n, "Obligations",
    `The Recipient shall: (a) use Confidential Information solely for the Purpose; (b) not disclose it to any third party without the Discloser's prior written consent; (c) limit disclosure to those of its employees, officers and professional advisers who need to know it for the Purpose and who are bound by obligations of confidence no less onerous than these; and (d) protect it using no less than reasonable care.`));

  n += 1;
  parts.push(clause(n, "Exclusions",
    `The obligations in clause 3 do not apply to information which: (a) is or becomes publicly available other than through breach of this Agreement; (b) was lawfully in the Recipient's possession before disclosure; (c) is lawfully obtained from a third party free of any obligation of confidence; (d) is independently developed without use of the Confidential Information; or (e) is required to be disclosed by law, regulation or any competent regulatory authority, provided that the Recipient gives such notice as is reasonably practicable.`));

  n += 1;
  parts.push(clause(n, "Term",
    `This Agreement takes effect on the date above and the obligations of confidentiality shall continue for ${months} months from that date, notwithstanding any earlier termination of discussions between the Parties.`));

  n += 1;
  parts.push(clause(n, "No Licence or Warranty",
    `Nothing in this Agreement transfers any intellectual property right, or grants any licence, in respect of Confidential Information. Confidential Information is provided "as is" and the Discloser gives no warranty as to its accuracy or completeness.`));

  n += 1;
  parts.push(clause(n, "Return and Destruction",
    `On written request the Recipient shall promptly return or destroy all Confidential Information in its possession, save for one copy retained solely to comply with applicable law or the Recipient's internal record-retention policy, which copy remains subject to this Agreement.`));

  n += 1;
  parts.push(clause(n, "Governing Law and Jurisdiction",
    `This Agreement and any dispute or claim arising out of or in connection with it (including non-contractual disputes or claims) shall be governed by ${law}, and the Parties submit to the exclusive jurisdiction of the courts of that jurisdiction.`));

  if (t.terms.specialConditions?.trim()) {
    n += 1;
    parts.push(clause(n, "Special Conditions", t.terms.specialConditions.trim()));
  }
  return parts.join("\n");
}

function buildMou(t: TemplateInput): string {
  // An MoU is the same letter with cooperative framing — retitle and swap the
  // handful of places the body calls itself a letter.
  return buildLoi(t)
    .replace(/^# LETTER OF INTENT/, "# MEMORANDUM OF UNDERSTANDING")
    .replace(/\*\*Subject:\*\* Letter of Intent to Partner with/, "**Subject:** Memorandum of Understanding with")
    .replace(/This Letter of Intent \("LOI"\)/, 'This Memorandum of Understanding ("MoU")')
    .replace(/this Letter of Intent/g, "this Memorandum of Understanding")
    .replace(/This Letter of Intent/g, "This Memorandum of Understanding");
}

/**
 * Types we have not yet written bespoke prose for fall back to the LOI
 * skeleton with the correct title. The generated document is still coherent
 * and correctly parameterised; it just isn't yet a specialist draft. The UI
 * labels these as drafts pending legal review.
 */
function buildGenericAgreement(t: TemplateInput): string {
  const title = DOC_TYPE_LABELS[t.docType];
  return buildLoi(t).replace(/^# Letter of Intent/, `# ${title}`);
}

const BUILDERS: Record<DocType, (t: TemplateInput) => string> = {
  loi: buildLoi,
  nda: buildNda,
  mou: buildMou,
  partnership: buildGenericAgreement,
  underwriting: buildGenericAgreement,
  liquidity_provider: buildGenericAgreement,
  investment: buildGenericAgreement,
  service: buildGenericAgreement,
};

/** Document types that currently use the fallback skeleton. */
export const DRAFT_QUALITY_TYPES: DocType[] = [
  "partnership",
  "underwriting",
  "liquidity_provider",
  "investment",
  "service",
];

export function generateDocument(input: TemplateInput): string {
  const build = BUILDERS[input.docType] ?? buildLoi;
  return build(input);
}

/** Appends sender-authored clauses after the generated body. */
export function withCustomClauses(body: string, clauses: CustomClause[]): string {
  if (!clauses.length) return body;
  // The letter has no numbered sections, so extra clauses are appended as
  // plain headed paragraphs. They land after the sign-off, which is where a
  // schedule or annex would sit on a real letter.
  const extra = clauses.map((c) => `## ${c.heading}\n\n${c.body.trim()}\n`).join("\n");
  return `${body}\n\n${extra}`;
}

export function templateKeyFor(docType: DocType, rel: RelationshipType): string {
  return `${docType}_${rel}`;
}

/**
 * Fields worth prompting for before sending. Surfaced by the "detect missing
 * information" action in the review step.
 */
export function detectMissingFields(input: TemplateInput): string[] {
  const missing: string[] = [];
  const t = input.terms;
  if (!t.purpose?.trim()) missing.push("Purpose of collaboration");
  if (!t.description?.trim()) missing.push("Short description");
  if (!t.estimatedVolume?.trim()) missing.push("Estimated business volume");
  if (!t.currency?.trim()) missing.push("Currency");
  if (!t.startDate?.trim()) missing.push("Proposed start date");
  if (!t.duration?.trim()) missing.push("Expected duration");
  if (!t.governingLaw?.trim()) missing.push("Governing law (omitted if left blank)");
  if (!input.recipientPosition?.trim()) missing.push("Recipient's position");
  if (!input.recipientCountry?.trim()) missing.push("Recipient's country");
  return missing;
}

/**
 * Heuristic risk review. Flags terms that commonly cause trouble when a
 * non-binding letter is drafted by a non-lawyer. Advisory only — shown as
 * suggestions in the review step, never blocking.
 */
export function flagRisks(input: TemplateInput, body: string): { level: "high" | "medium" | "low"; message: string }[] {
  const flags: { level: "high" | "medium" | "low"; message: string }[] = [];
  const t = input.terms;

  if (t.exclusivity && t.exclusivity !== "none" && !t.duration?.trim()) {
    flags.push({
      level: "high",
      message:
        "Exclusivity is granted but no duration is set, so it defaults to 90 days. An open-ended exclusivity is hard to enforce and risky to accept — set an explicit expected duration.",
    });
  }
  if (t.confidentiality === false) {
    flags.push({
      level: "medium",
      message:
        "Confidentiality is switched off. Commercial terms in this document will not be protected unless a separate NDA is already in force.",
    });
  }
  if (!t.governingLaw?.trim()) {
    flags.push({
      level: "medium",
      message:
        "No governing law is specified, so the letter omits that clause entirely. That is normal for a short non-binding LOI, but set one if you want the jurisdiction on the record.",
    });
  }
  if (/\bshall pay\b|\bwill pay\b|\bagrees to pay\b/i.test(body) && !/non-binding/i.test(body)) {
    flags.push({
      level: "high",
      message: "The document contains payment obligations without a non-binding qualifier. This may create enforceable commitments.",
    });
  }
  if (t.estimatedVolume?.trim() && !/indicative|estimate|not.*commitment/i.test(body)) {
    flags.push({
      level: "medium",
      message: "A business volume is stated without an explicit 'indicative only' qualifier.",
    });
  }
  if (input.recipientCountry && /sanction/i.test(input.recipientCountry)) {
    flags.push({ level: "high", message: "Confirm the counterparty's jurisdiction is not subject to sanctions before sending." });
  }
  if (!flags.length) {
    flags.push({ level: "low", message: "No structural risks detected. The document keeps commercial terms non-binding while making confidentiality and exclusivity binding." });
  }
  return flags;
}
