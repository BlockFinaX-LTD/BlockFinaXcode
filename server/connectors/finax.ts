/**
 * Finax in the connector portal.
 *
 * The brief is built here, on the server, from the member's own records and the programme
 * text, and handed to the agent as system context. The model has no tool that reads
 * connector data, so it cannot reach another member: everything it knows about this one
 * is in the brief. Training answers are never included (they live in course-answers.ts).
 */
import { AGREEMENTS, AREAS, MATERIALS, MODULES, PASS_MARK, agreementText, type DocumentKind } from "@shared/connector-programme";

export interface BriefInput {
  member: null | { kind: string; fullName: string; status: string; country: string; areas: string[] };
  document: DocumentKind;
  signed: boolean;
  passed: string[];
  missing: string[];
  counts: null | Record<string, number>;
  registrations: { organisation: string; area: string; status: string; rewardTerms: string | null; createdAt: string }[];
}

const MAX_REGISTRATIONS = 30;

export function connectorBrief(b: BriefInput): string {
  const doc = AGREEMENTS[b.document];
  const who = b.member
    ? [
        `- Name: ${b.member.fullName}`,
        `- Membership: ${b.member.kind}, status ${b.member.status}`,
        `- Country: ${b.member.country}`,
        `- Areas they chose: ${b.member.areas.map((k) => AREAS.find((a) => a.key === k)?.label ?? k).join(", ") || "none yet"}`,
        `- Agreement (${doc.title}, ${doc.version}): ${b.signed ? "signed" : "not signed yet"}`,
        `- Training passed: ${b.passed.length} of ${MODULES.length}${b.passed.length ? ` (${b.passed.map((id) => MODULES.find((m) => m.id === id)?.title ?? id).join(", ")})` : ""}`,
        `- Still to do before registering prospects: ${b.missing.length ? b.missing.join("; ") : "nothing, they are ready"}`,
      ].join("\n")
    : "- They have not applied yet. The next step is the application form on the portal home page.";

  const counts = b.counts
    ? `\n\n## Their activity\n- Prospects registered: ${b.counts.registrations}\n- Approved introductions: ${b.counts.approved}\n- Referred users: ${b.counts.referrals}\n- Open offers they have not answered: ${b.counts.new_offers}${b.member?.kind === "contractor" ? `\n- Engagements waiting for their answer: ${b.counts.offers}` : ""}`
    : "";

  const regs = b.registrations.length
    ? "\n\n## Their registered prospects (most recent first)\n" +
      b.registrations.slice(0, MAX_REGISTRATIONS).map((r) =>
        `- ${r.organisation}: ${AREAS.find((a) => a.key === r.area)?.label ?? r.area}, ${r.status}, registered ${r.createdAt.slice(0, 10)}${r.rewardTerms ? `, reward: ${r.rewardTerms}` : ""}`,
      ).join("\n")
    : "";

  const training = MODULES.map((m) =>
    `### ${m.title}${m.required ? " (required)" : ""}\n${m.body.join("\n")}`,
  ).join("\n\n");

  const areas = AREAS.map((a) => `- **${a.label}**: qualifies when ${a.qualifies} Reward: ${a.reward}`).join("\n");
  const materials = MATERIALS.map((m) => `- ${m.title}: ${m.url}`).join("\n");

  return [
    "# Programme brief from BlockFinaX (trusted)",
    `## This member\n${who}${counts}${regs}`,
    `## Contribution areas\n${areas}`,
    `## Training (pass mark ${Math.round(PASS_MARK * 100)}% per module)\n${training}`,
    `## Materials they may share\n${materials}`,
    `## The agreement they are under\n${agreementText(doc)}`,
  ].join("\n\n");
}
