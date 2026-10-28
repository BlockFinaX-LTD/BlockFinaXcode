/**
 * The Connector Programme: what connectors and independent contractors read, sign and
 * learn in the portal (connector.blockfinax.com).
 *
 * Shared by the portal and the server. The server hashes the agreement text at signing,
 * so any edit here must come with a new version number. Quiz answers are not here: they
 * live in server/connectors/course-answers.ts so the browser never receives them.
 */

export type MemberKind = "connector" | "contractor";
export type DocumentKind = "connector" | "contractor";

export interface Clause {
  n: string;
  title: string;
  items: [string, string][];
}

export interface AgreementDoc {
  kind: DocumentKind;
  title: string;
  version: string;
  issued: string;
  intro: string;
  clauses: Clause[];
  schedule?: { title: string; rows: [string, string, string][] };
}

export const COMPANY = {
  name: "BlockFinaX Inc.",
  description: "a Delaware corporation",
  address: "1007 N Orange St, 4th Floor, Ste 1382, Wilmington, Delaware 19801, United States",
};

// ── Contribution areas ──────────────────────────────────────────────────────

export type AreaKey =
  | "hedgers" | "underwriters" | "distribution" | "institutions"
  | "regulatory" | "local_partners" | "market_data" | "new_country"
  | "fundraising" | "grants" | "talent";

export interface Area {
  key: AreaKey;
  group: "Revenue" | "Market access" | "Capital" | "People";
  label: string;
  qualifies: string;
  measured: string;
  reward: string;
  /** Earns 25% of collected revenue for the reward period. */
  revenueShare: boolean;
}

export const AREAS: Area[] = [
  { key: "hedgers", group: "Revenue", label: "Hedgers", revenueShare: true,
    qualifies: "Importers, exporters, lenders and other businesses that buy protection",
    measured: "Revenue BlockFinaX collects from their contracts",
    reward: "25% of collected revenue for 12 months" },
  { key: "underwriters", group: "Revenue", label: "Underwriters", revenueShare: true,
    qualifies: "Funds, treasuries, banks and individuals who provide cover or run a pool",
    measured: "Protocol fees BlockFinaX earns on contracts their capital backs",
    reward: "25% of those fees for 12 months" },
  { key: "distribution", group: "Revenue", label: "Distribution partners", revenueShare: true,
    qualifies: "Fintechs, payment apps, trade platforms and lenders that offer BlockFinaX protection to their customers",
    measured: "Revenue BlockFinaX collects through the partner's integration",
    reward: "25% of collected revenue for 12 months" },
  { key: "institutions", group: "Revenue", label: "Banks and trade associations", revenueShare: true,
    qualifies: "Banks, chambers of commerce, exporter and importer associations that refer members or clients",
    measured: "Revenue from the businesses they bring",
    reward: "25% of collected revenue for 12 months" },
  { key: "regulatory", group: "Market access", label: "Regulatory", revenueShare: false,
    qualifies: "Introductions to regulators, sandbox entry, licences, approvals and legal opinions",
    measured: "The approval, sandbox place or formal engagement, confirmed in writing",
    reward: "Milestone bonus; counts towards advisory review" },
  { key: "local_partners", group: "Market access", label: "Local currency partners", revenueShare: true,
    qualifies: "Exchanges, payment providers and on and off ramps between USDC and local currency",
    measured: "The partner live on BlockFinaX, plus revenue where it earns any",
    reward: "Milestone bonus, plus 25% of any collected revenue" },
  { key: "market_data", group: "Market access", label: "Market data and fixing sources", revenueShare: false,
    qualifies: "Official exchange rate publishers, data vendors and independent oracle operators",
    measured: "A signed data agreement or an operator running in production",
    reward: "Milestone bonus" },
  { key: "new_country", group: "Market access", label: "New country launch", revenueShare: false,
    qualifies: "Opening a country BlockFinaX does not serve yet, with its first customers and underwriters",
    measured: "The first paid contracts in that country",
    reward: "First in market bonus, plus revenue share on relationships introduced" },
  { key: "fundraising", group: "Capital", label: "Fundraising", revenueShare: false,
    qualifies: "Investors who invest in a BlockFinaX funding round",
    measured: "Funds BlockFinaX actually receives from those investors",
    reward: "Up to 5% of funds received, only under a separate fundraising agreement" },
  { key: "grants", group: "Capital", label: "Grants and development finance", revenueShare: false,
    qualifies: "Grants, ecosystem funds, development finance institutions and currency risk programmes",
    measured: "A grant or programme awarded to BlockFinaX",
    reward: "Milestone bonus, paid from BlockFinaX's own funds" },
  { key: "talent", group: "People", label: "Talent", revenueShare: false,
    qualifies: "Engineers, risk specialists and market leads who join BlockFinaX",
    measured: "The hire still in role after 6 months",
    reward: "Referral bonus" },
];

export const areaByKey = (k: string) => AREAS.find((a) => a.key === k);

// ── Agreements ──────────────────────────────────────────────────────────────

export const CONNECTOR_AGREEMENT: AgreementDoc = {
  kind: "connector",
  title: "Connector Agreement",
  version: "CA 1.0",
  issued: "28 October 2026",
  intro: "BlockFinaX operates an onchain FX hedging protocol. The Connector has relationships that may help BlockFinaX grow. The parties agree as follows.",
  clauses: [
    { n: "1", title: "Definitions", items: [
      ["1.1", "Approval Notice means a written notice from BlockFinaX, which may be sent by email or shown in the connector portal, that approves a Prospect or Opportunity and records the organisation, the opportunity, the Connector, the reward that applies and its period."],
      ["1.2", "Approved Relationship means a Prospect named in an Approval Notice."],
      ["1.3", "Collected Revenue means fees BlockFinaX actually receives from an Approved Relationship, less refunds, chargebacks, taxes and the Excluded Amounts."],
      ["1.4", "Excluded Amounts means amounts belonging to customers, underwriters, partners or other third parties, including premiums owed to underwriters, investment capital, liquidity deposits, the amount a customer protects, and settlement funds."],
      ["1.5", "Opportunity means a contribution in an area listed in Schedule 1 that does not by itself produce Collected Revenue, such as a regulatory approval or a new market launch."],
      ["1.6", "Prospect means an organisation or person the Connector proposes to introduce to BlockFinaX, including a user who signs up through the Connector's referral link."],
      ["1.7", "Qualifying Partnership has the meaning in clause 6.2."],
      ["1.8", "Reward Period means 12 months starting on the date BlockFinaX first receives Collected Revenue from an Approved Relationship."],
    ] },
    { n: "2", title: "Appointment", items: [
      ["2.1", "BlockFinaX appoints the Connector, on a non-exclusive basis, to identify and introduce Prospects and Opportunities."],
      ["2.2", "The Connector acts as an independent contractor. Nothing in this agreement creates employment, partnership, agency or a joint venture."],
      ["2.3", "The Connector has no authority to bind BlockFinaX, to agree prices, contracts, investment terms or guarantees, or to accept money on its behalf."],
      ["2.4", "BlockFinaX may work with other connectors and may deal directly with any organisation."],
    ] },
    { n: "3", title: "Registering introductions", items: [
      ["3.1", "Before making an introduction, the Connector registers the Prospect or Opportunity in the connector portal, describing the organisation, the contact and the expected business."],
      ["3.2", "BlockFinaX may approve or decline a registration at its discretion. Only an Approved Relationship or an approved Opportunity earns a reward."],
      ["3.3", "A Prospect that BlockFinaX is already in active discussions with, or has had a commercial relationship with in the previous 12 months, does not qualify unless BlockFinaX agrees otherwise in writing."],
      ["3.4", "A further contact at an organisation that is already registered does not create a separate Approved Relationship."],
      ["3.5", "Where more than one connector contributes to the same relationship, they share one reward in the proportions agreed in writing before the introduction. Without that agreement, BlockFinaX decides the split fairly based on each connector's contribution."],
      ["3.6", "Users who create a BlockFinaX account through the Connector's referral link are credited to the Connector automatically. They create and verify their own accounts; the Connector does not open accounts or handle money for them."],
    ] },
    { n: "4", title: "Rewards", items: [
      ["4.1", "Revenue share. For each Approved Relationship, BlockFinaX pays the Connector 25% of the Collected Revenue it receives during the Reward Period."],
      ["4.2", "Milestone bonuses. For an approved Opportunity, BlockFinaX pays the fixed bonus stated in its Approval Notice once the milestone it describes is met and confirmed in writing."],
      ["4.3", "Fundraising. The Connector does not solicit investors for BlockFinaX under this agreement. Any reward for introducing investors, including a fee of up to 5% of funds BlockFinaX actually receives from them, is payable only under a separate written fundraising agreement, only where the law of the relevant countries permits it, and only after the investors have been told about it."],
      ["4.4", "Talent referrals. For a person the Connector refers who joins BlockFinaX, the bonus stated in the Approval Notice is payable once that person has been in role for 6 months."],
      ["4.5", "Grants and development finance bonuses are paid from BlockFinaX's own funds, never from the grant or programme itself."],
      ["4.6", "Rewards are paid on one level only: on the Connector's own introductions, never on business introduced by other connectors."],
      ["4.7", "No reward is payable on Excluded Amounts, on revenue received after the Reward Period, or for any introduction made in breach of clause 7."],
    ] },
    { n: "5", title: "Payment and tax", items: [
      ["5.1", "BlockFinaX pays rewards quarterly, within 30 days after the end of each calendar quarter, with a statement in the connector portal showing the Collected Revenue received and the Connector's share."],
      ["5.2", "Rewards are calculated in US dollars and paid in US dollars or in USDC of equal value, to an account or wallet in the Connector's own name. Amounts under US$100 roll forward to the next quarter."],
      ["5.3", "The Connector is responsible for their own taxes and provides any tax forms BlockFinaX reasonably requests. BlockFinaX may withhold tax where the law requires it."],
      ["5.4", "If Collected Revenue is later refunded or reversed, BlockFinaX may deduct the related reward from future payments."],
      ["5.5", "The Connector may dispute a statement within 60 days of receiving it. The parties will review the records together in good faith."],
    ] },
    { n: "6", title: "Advisory review", items: [
      ["6.1", "A Connector who introduces four Qualifying Partnerships becomes eligible for consideration for the BlockFinaX advisory board. An approved regulatory milestone, new country launch or completed funding round may count as one of the four, as stated in its Approval Notice."],
      ["6.2", "A Qualifying Partnership is an Approved Relationship that is credited to the Connector, has an active commercial relationship with BlockFinaX, has produced Collected Revenue in at least three separate months, and is active and in good standing when reviewed."],
      ["6.3", "Eligibility gives a right to be considered, not a right to appointment. BlockFinaX considers expertise, conduct, availability and willingness to take on ongoing duties."],
      ["6.4", "Any advisory shares are granted only under a separate advisory agreement and share option documents, with approval of the BlockFinaX board. That agreement sets the tier, the goals and the vesting. This agreement grants no shares, options or other equity."],
      ["6.5", "Advisory shares are never granted for introducing investors."],
    ] },
    { n: "7", title: "Conduct", items: [
      ["7.1", "The Connector makes warm introductions only with the contact's permission, explains the Prospect's needs honestly, and supports first meetings and the handover to BlockFinaX."],
      ["7.2", "Introductions only. The Connector does not give financial, investment, legal or tax advice, does not recommend any specific protection, and uses only product information BlockFinaX has approved."],
      ["7.3", "Disclosure. The Connector tells each Prospect that the Connector may be rewarded by BlockFinaX, and discloses to BlockFinaX any conflict of interest and any payment the Connector receives from the Prospect."],
      ["7.4", "Anti-bribery. The Connector complies with all anti-bribery laws that apply, including the US Foreign Corrupt Practices Act, the UK Bribery Act 2010 and local law. The Connector does not offer, give or promise anything of value to any public official, or to any employee, officer or relative of a Prospect, to obtain business or an approval, and does not pass any part of a reward to them. Regulatory engagement takes place through official channels only."],
      ["7.5", "Sanctions and law. The Connector is not a sanctioned person, does not introduce sanctioned persons, and complies with all laws on financial promotion, securities, data protection and anti-money laundering that apply to their activities."],
      ["7.6", "Employees of Prospects. A person who is employed by, or an officer of, a Prospect does not earn a reward for introducing that Prospect."],
      ["7.7", "If the Connector breaches this clause, BlockFinaX may end this agreement at once, stop all unpaid rewards and recover rewards already paid that relate to the breach."],
    ] },
    { n: "8", title: "Confidentiality and data", items: [
      ["8.1", "Each party keeps confidential the other's non-public business, technical, financial and customer information, uses it only for this agreement, and shares it only with people who need it and are bound by similar duties."],
      ["8.2", "This duty does not cover information that is public through no fault of the receiving party, already known to it, or required to be disclosed by law."],
      ["8.3", "The portal shows the Connector each referral's progress but not their balances, contracts or personal documents. The Connector uses contact details of Prospects only to make the introduction."],
      ["8.4", "This clause continues for 3 years after this agreement ends."],
    ] },
    { n: "9", title: "Brand and materials", items: [
      ["9.1", "BlockFinaX grants the Connector a limited, revocable licence to use its name and the materials in the connector portal only to make introductions under this agreement."],
      ["9.2", "The Connector does not describe themselves as an employee, agent, partner or representative of BlockFinaX, and does not create websites, social accounts or materials in BlockFinaX's name without written approval."],
    ] },
    { n: "10", title: "Term and termination", items: [
      ["10.1", "This agreement starts when the Connector signs it and continues until ended under this clause."],
      ["10.2", "Either party may end it by giving 30 days' written notice, including by email."],
      ["10.3", "BlockFinaX may end it at once if the Connector materially breaches it, including clause 7."],
      ["10.4", "Unless this agreement ends under clause 10.3, rewards already earned on Approved Relationships continue to be paid until the end of their Reward Period."],
      ["10.5", "BlockFinaX reviews connector activity quarterly and may pause new approvals for an inactive Connector."],
      ["10.6", "Clauses 5, 7.7, 8, 10.4, 11 and 12 continue after this agreement ends."],
    ] },
    { n: "11", title: "Liability", items: [
      ["11.1", "Neither party is liable for indirect or consequential loss, or for loss of profit, revenue or opportunity."],
      ["11.2", "BlockFinaX's total liability under this agreement is limited to the rewards payable to the Connector in the 12 months before the claim."],
      ["11.3", "The Connector indemnifies BlockFinaX against losses arising from the Connector's breach of clause 7 or 8."],
      ["11.4", "Nothing in this agreement limits liability for fraud or any liability that cannot be limited by law."],
    ] },
    { n: "12", title: "General", items: [
      ["12.1", "Whole agreement. This agreement, its Schedule and any Approval Notices form the whole agreement on its subject and replace earlier discussions."],
      ["12.2", "Changes. BlockFinaX may update the programme terms for future introductions by giving 30 days' written notice. Changes do not reduce rewards on relationships already approved."],
      ["12.3", "Assignment. The Connector may not transfer this agreement or any reward without BlockFinaX's written consent."],
      ["12.4", "Notices. Notices may be given by email to the address in the signature block or through the connector portal."],
      ["12.5", "Electronic signature. The parties agree to sign electronically. Typing a full name in the signature block, with the confirmation ticked, is a signature with the same effect as a handwritten one, under the US Electronic Signatures in Global and National Commerce Act and other applicable law."],
      ["12.6", "Governing law and disputes. This agreement is governed by the laws of the State of Delaware. The parties will first try to settle any dispute in good faith within 30 days. Any dispute not settled is resolved by binding arbitration administered by the International Centre for Dispute Resolution under its International Arbitration Rules, by one arbitrator, conducted online in English."],
      ["12.7", "Severability. If any part of this agreement is unenforceable, the rest continues in effect."],
    ] },
  ],
  schedule: {
    title: "Schedule 1: Contribution areas and rewards",
    rows: AREAS.map((a) => [a.label, a.qualifies, a.reward] as [string, string, string]),
  },
};

export const CONTRACTOR_AGREEMENT: AgreementDoc = {
  kind: "contractor",
  title: "Independent Contractor Agreement",
  version: "ICA 1.0",
  issued: "28 October 2026",
  intro: "BlockFinaX operates an onchain FX hedging protocol and engages independent contractors for defined pieces of work, such as market research, events, client education and onboarding support. These terms apply to every engagement BlockFinaX offers the Contractor in the connector portal.",
  clauses: [
    { n: "1", title: "Engagements", items: [
      ["1.1", "BlockFinaX may offer the Contractor engagements in the connector portal. Each engagement states its title, scope of work, fees and dates."],
      ["1.2", "An engagement starts only when the Contractor accepts it in the portal. Accepted engagements form part of this agreement. If an engagement and these terms conflict, the engagement prevails for that work."],
      ["1.3", "The Contractor may decline any engagement. BlockFinaX is not obliged to offer any minimum amount of work."],
    ] },
    { n: "2", title: "Status", items: [
      ["2.1", "The Contractor is an independent contractor, not an employee, agent or partner of BlockFinaX, and is free to work for others provided there is no conflict with the engagement."],
      ["2.2", "The Contractor decides how to perform the work, provides their own equipment, and is responsible for their own taxes, social contributions, insurance and permits."],
      ["2.3", "The Contractor has no authority to bind BlockFinaX or to make commitments on its behalf."],
    ] },
    { n: "3", title: "Fees and payment", items: [
      ["3.1", "BlockFinaX pays the fees stated in each engagement. Unless the engagement says otherwise, the Contractor invoices on completion and BlockFinaX pays within 30 days of a correct invoice."],
      ["3.2", "Fees are paid in US dollars or in USDC of equal value, to an account or wallet in the Contractor's own name."],
      ["3.3", "Expenses are reimbursed only if approved in writing in advance and supported by receipts."],
    ] },
    { n: "4", title: "Standard of work and conduct", items: [
      ["4.1", "The Contractor performs the work with reasonable skill and care, on time, and in line with the scope."],
      ["4.2", "Onboarding support means helping people understand how to sign up and use BlockFinaX. Users create, verify and fund their own accounts. The Contractor never opens accounts for others, never asks for or holds anyone's passkey, password or funds, and never gives financial, investment, legal or tax advice."],
      ["4.3", "The Contractor uses only materials BlockFinaX has approved and complies with all anti-bribery, sanctions, data protection and financial promotion laws that apply, including the US Foreign Corrupt Practices Act and the UK Bribery Act 2010. The Contractor never offers anything of value to a public official or to an employee of a client or prospect."],
      ["4.4", "The Contractor discloses any conflict of interest before accepting an engagement."],
    ] },
    { n: "5", title: "Intellectual property", items: [
      ["5.1", "Everything the Contractor creates for BlockFinaX under an engagement, including research, content, recordings and code, belongs to BlockFinaX on payment of the related fees. The Contractor assigns all rights in it to BlockFinaX and waives moral rights to the extent the law allows."],
      ["5.2", "The Contractor keeps rights in anything they owned before the engagement and grants BlockFinaX a perpetual, free licence to use it as part of the work delivered."],
    ] },
    { n: "6", title: "Confidentiality and data", items: [
      ["6.1", "The Contractor keeps BlockFinaX's non-public information and any personal data received confidential, uses it only for the engagement, and returns or deletes it when the engagement ends."],
      ["6.2", "This clause continues for 3 years after this agreement ends, and indefinitely for personal data."],
    ] },
    { n: "7", title: "Term and termination", items: [
      ["7.1", "This agreement starts when the Contractor signs it and continues until ended by either party with 14 days' written notice."],
      ["7.2", "BlockFinaX may end it, or any engagement, at once for a material breach, including clause 4."],
      ["7.3", "On termination BlockFinaX pays for work properly performed up to the termination date."],
    ] },
    { n: "8", title: "Liability", items: [
      ["8.1", "Neither party is liable for indirect or consequential loss. BlockFinaX's total liability under an engagement is limited to the fees for that engagement."],
      ["8.2", "The Contractor indemnifies BlockFinaX against losses arising from the Contractor's breach of clauses 4 or 6."],
      ["8.3", "Nothing limits liability for fraud or any liability that cannot be limited by law."],
    ] },
    { n: "9", title: "General", items: [
      ["9.1", "Electronic signature. Typing a full name in the signature block, with the confirmation ticked, is a signature with the same effect as a handwritten one, under the US Electronic Signatures in Global and National Commerce Act and other applicable law. Accepting an engagement in the portal by typing a full name has the same effect."],
      ["9.2", "Governing law and disputes. This agreement is governed by the laws of the State of Delaware. Disputes not settled in good faith within 30 days are resolved by binding arbitration administered by the International Centre for Dispute Resolution under its International Arbitration Rules, by one arbitrator, conducted online in English."],
      ["9.3", "This agreement and accepted engagements form the whole agreement on their subject. The Contractor may not subcontract or transfer it without written consent. If any part is unenforceable, the rest continues."],
    ] },
  ],
};

export const AGREEMENTS: Record<DocumentKind, AgreementDoc> = {
  connector: CONNECTOR_AGREEMENT,
  contractor: CONTRACTOR_AGREEMENT,
};

/** The exact text that is hashed and stored with each signature. */
export function agreementText(doc: AgreementDoc): string {
  const lines = [
    `${doc.title}, version ${doc.version}, issued ${doc.issued}`,
    `${COMPANY.name}, ${COMPANY.description}, registered office ${COMPANY.address}`,
    doc.intro,
    ...doc.clauses.flatMap((c) => [`${c.n}. ${c.title}`, ...c.items.map(([k, t]) => `${k} ${t}`)]),
    ...(doc.schedule ? [doc.schedule.title, ...doc.schedule.rows.map((r) => r.join(" | "))] : []),
  ];
  return lines.join("\n");
}

// ── Training ────────────────────────────────────────────────────────────────

export interface Question {
  id: string;
  q: string;
  options: string[];
}

export interface Module {
  id: string;
  title: string;
  minutes: number;
  /** Paragraphs; a line starting with "- " is a bullet. */
  body: string[];
  questions: Question[];
  /** Required before registering prospects. */
  required: boolean;
}

export const PASS_MARK = 0.8;

export const MODULES: Module[] = [
  {
    id: "programme", title: "How the programme works", minutes: 5, required: true,
    body: [
      "Connectors open doors for BlockFinaX and are rewarded for results. You register each introduction in this portal before you make it. BlockFinaX reviews it and, if it fits, approves it with the reward that applies.",
      "Revenue relationships earn 25% of the revenue BlockFinaX collects from them for 12 months. The 12 months start when the first revenue arrives, not when you register.",
      "- Revenue means fees BlockFinaX keeps. Premiums owed to underwriters, deposits, the amount a business protects and settlement money are never revenue.",
      "- Rewards are paid every quarter, within 30 days of quarter end, with a statement in the Rewards tab.",
      "- Milestones such as a regulatory approval or a first bank partner earn a fixed bonus set when BlockFinaX approves them.",
      "Introduce four relationships that keep producing revenue and you become eligible for an advisory review. Advisors can earn shares in BlockFinaX through a separate advisory agreement with measurable goals.",
      "Users who sign up through your personal referral link are credited to you automatically. You can follow their progress, never their balances or contracts.",
    ],
    questions: [
      { id: "p1", q: "When should you register a prospect?", options: ["After their first purchase", "Before you introduce them", "At the end of the quarter", "Only if they ask you to"] },
      { id: "p2", q: "What does the 25% revenue share apply to?", options: ["The amount the business protects", "Premiums paid to underwriters", "Revenue BlockFinaX actually collects from the relationship", "Deposits made by underwriters"] },
      { id: "p3", q: "When does the 12 month reward period start?", options: ["The day you register the prospect", "The day BlockFinaX approves it", "The day BlockFinaX first receives revenue from it", "1 January each year"] },
      { id: "p4", q: "How often are rewards paid?", options: ["Every week", "Every quarter, within 30 days of quarter end", "Once a year", "Only when you ask"] },
    ],
  },
  {
    id: "product", title: "What BlockFinaX does", minutes: 6, required: true,
    body: [
      "BlockFinaX is an onchain FX hedging protocol. Businesses protect payments and receipts against currency volatility, underwriters provide the cover, and every contract is fully collateralised.",
      "A business that owes dollars and earns naira worries that the naira will weaken. It buys a USD/NGN Cap: if the dollar rises above the strike by the end date, the contract pays the difference, up to a limit. A business that receives dollars and worries the dollar will fall buys a Floor.",
      "- The business pays a premium once, in USDC, when it buys the protection.",
      "- The most a contract can pay is locked in full when it is sold, so a payout never depends on anyone paying later.",
      "- Underwriters deposit USDC into pools and earn the premiums on contracts their money backs. They can lose up to what they put behind a contract.",
      "BlockFinaX is a protocol. It provides the infrastructure; underwriters provide the cover. Never describe BlockFinaX as an insurer or say that BlockFinaX guarantees a payout.",
      "Users sign in with a passkey, the network fees are paid for them, and they only ever need USDC.",
    ],
    questions: [
      { id: "d1", q: "A Nigerian importer pays a dollar invoice in 60 days. Which protection fits?", options: ["A USD/NGN Floor", "A USD/NGN Cap", "A savings account", "No protection exists for this"] },
      { id: "d2", q: "How is the payout of a contract secured?", options: ["BlockFinaX promises to pay", "The most it can pay is locked in full when it is sold", "Underwriters pay later if they can", "It is insured by a bank"] },
      { id: "d3", q: "Who provides the cover?", options: ["BlockFinaX", "The central bank", "Underwriters who deposit USDC", "The connector"] },
      { id: "d4", q: "Which description is correct?", options: ["BlockFinaX is an insurance company", "BlockFinaX guarantees every payout", "BlockFinaX is a protocol; underwriters provide the cover", "BlockFinaX lends money to importers"] },
    ],
  },
  {
    id: "rules", title: "The rules", minutes: 7, required: true,
    body: [
      "You introduce. BlockFinaX sells, prices and contracts. Keeping to that line protects you, the people you introduce and BlockFinaX.",
      "- Do not give financial, investment, legal or tax advice, and do not recommend a specific strike, amount or contract.",
      "- Use only the materials in the Materials tab. Do not make your own claims about returns or payouts.",
      "- Tell every prospect that BlockFinaX may reward you for the introduction.",
      "- Never offer, give or promise anything of value to a public official, or to an employee or relative of a prospect, and never pass any part of your reward to them. Regulatory engagement goes through official channels only.",
      "- If you work for a prospect, you cannot earn a reward for introducing it.",
      "- Do not introduce anyone you know or suspect is under sanctions.",
      "- Do not ask people to invest in BlockFinaX. Investor introductions need a separate written fundraising agreement first.",
      "- Users open, verify and fund their own accounts. Never open an account for someone, never ask for their passkey or recovery details, and never handle their money.",
      "Breaking these rules ends the agreement and lets BlockFinaX recover rewards already paid.",
    ],
    questions: [
      { id: "r1", q: "A prospect asks which strike they should choose. What do you do?", options: ["Recommend the cheapest one", "Recommend the one you would choose", "Explain you cannot advise and connect them with BlockFinaX", "Tell them to protect their whole invoice"] },
      { id: "r2", q: "A finance manager at a prospect asks for 10% of your reward to sign the deal. What do you do?", options: ["Agree, it is your money", "Agree if it is under $500", "Refuse and tell BlockFinaX", "Pay it in USDC so it is private"] },
      { id: "r3", q: "Must you tell a prospect that BlockFinaX rewards you?", options: ["Yes, always", "Only if they ask", "Only for large clients", "No"] },
      { id: "r4", q: "A friend wants to invest in BlockFinaX's next round. What do you do?", options: ["Collect their money and send it to BlockFinaX", "Promise them a discount", "Pass on their interest to BlockFinaX without soliciting them; fees need a separate fundraising agreement", "Tell them the shares will double"] },
      { id: "r5", q: "A new user struggles to sign up and offers you their phone to finish it. What do you do?", options: ["Finish the sign-up for them", "Create the passkey on your own phone", "Guide them through it on their own device, without handling their passkey", "Tell them to share their recovery details"] },
    ],
  },
  {
    id: "prospects", title: "Finding good prospects", minutes: 5, required: true,
    body: [
      "The best prospects have a real, regular currency exposure in a market BlockFinaX serves: Nigeria, Ghana, Kenya, South Africa and Egypt today.",
      "- Importers paying dollar invoices, and exporters receiving dollars.",
      "- Lenders with loans in a currency their borrowers do not earn.",
      "- Fintechs, payment apps and trade platforms whose customers make cross-border payments.",
      "- Funds, treasuries and banks looking for dollar yield, as underwriters.",
      "- Exchanges and payment providers that convert between USDC and local currency.",
      "A good registration names the organisation, its website, the person you know there and their role, the country, and what they need. Say whether you have their permission to introduce them. Registrations without that permission are declined.",
      "If someone at the organisation is already registered by you or another connector, the portal will tell you. One organisation counts once.",
    ],
    questions: [
      { id: "f1", q: "Which is the strongest hedger prospect?", options: ["A local shop paid only in naira", "A Ghanaian importer paying monthly dollar invoices", "A student", "A company with no foreign currency payments"] },
      { id: "f2", q: "What must you have before you register a prospect?", options: ["Their bank statements", "Their permission to be introduced", "Their passkey", "A signed contract with them"] },
      { id: "f3", q: "You introduce a second contact at an organisation already registered. What happens?", options: ["It counts as a new partnership", "It doubles your reward", "It stays one relationship", "The first registration is cancelled"] },
    ],
  },
];

export const moduleById = (id: string) => MODULES.find((m) => m.id === id);

// ── Materials ───────────────────────────────────────────────────────────────

export interface Material {
  title: string;
  description: string;
  url: string;
  audience: "Businesses" | "Underwriters" | "Partners" | "Everyone";
}

export const MATERIALS: Material[] = [
  { title: "What is BlockFinaX", description: "The introduction to share with anyone new to BlockFinaX.", url: "https://docs.blockfinax.com/intro", audience: "Everyone" },
  { title: "For hedgers", description: "How businesses protect payments and receipts.", url: "https://docs.blockfinax.com/hedgers", audience: "Businesses" },
  { title: "For underwriters", description: "How underwriters provide cover and earn premiums.", url: "https://docs.blockfinax.com/underwriters", audience: "Underwriters" },
  { title: "For developers and partners", description: "How fintechs and platforms build BlockFinaX into their product.", url: "https://docs.blockfinax.com/developers/start", audience: "Partners" },
  { title: "Understanding pricing", description: "How a premium is calculated, in plain language.", url: "https://docs.blockfinax.com/pricing", audience: "Everyone" },
  { title: "Questions and answers", description: "Answers to the questions prospects ask most.", url: "https://www.blockfinax.com/faq", audience: "Everyone" },
];

// ── Statuses ────────────────────────────────────────────────────────────────

export type MemberStatus = "applied" | "active" | "paused" | "ended" | "declined";
export type RegistrationStatus = "pending" | "approved" | "declined" | "live" | "closed";
export type EngagementStatus = "offered" | "accepted" | "declined" | "completed" | "cancelled";
export type LedgerKind = "revenue_share" | "bonus" | "fundraising" | "engagement_fee" | "adjustment" | "payment";

export const LEDGER_LABELS: Record<LedgerKind, string> = {
  revenue_share: "Revenue share",
  bonus: "Milestone bonus",
  fundraising: "Fundraising fee",
  engagement_fee: "Engagement fee",
  adjustment: "Adjustment",
  payment: "Payment",
};

export const REVENUE_SHARE = 0.25;
export const REWARD_MONTHS = 12;
export const MIN_PAYOUT_USD = 100;
