/**
 * prompt.ts, how one message is assembled before it is written.
 *
 * Separate from the routes so it can be tested without starting a database
 * connection or the admin session sweeper, whose module-level timer would keep
 * a test process alive forever.
 */

import { type Intent, INTENT_RULES } from "./persona";

export interface Candidate {
  text: string;
  url: string | null;
  name: string | null;
  headline: string | null;
  score: number;
}

/**
 * Assemble the prompt for one message.
 *
 * Pure and exported so the invariant that matters can be tested: the live book
 * must never reach a public comment. That rule was broken once already, by a
 * prompt line reading "Live BlockFinaX figures you may quote", and the result
 * was a comment that opened with the analysis and closed with a credential.
 *
 * The defence is structural rather than instructional. An instruction not to
 * sell competes with tempting material sitting in the same context window, and
 * loses often enough to matter. Withholding the material wins every time, and a
 * test can prove the material was withheld in a way it can never prove a model
 * resisted temptation.
 */
export function buildPrompt(
  c: Candidate,
  kind: Intent,
  brief: string,
  recalled: string,
  context: string,
): string {
  const who = [c.name, c.headline].filter(Boolean).join(", ") || "unknown";
  const sections = [
    `They wrote:\n"""\n${c.text.slice(0, 4000)}\n"""`,
    `Who they are: ${who}`,
  ];

  if (brief) {
    sections.push(
      `Market data, computed from our own daily close history just now. These are\n` +
      `the only figures you may quote about the currency. Where a statistic names\n` +
      `its own window, quote that window and not a longer one:\n${brief}`,
    );
  }
  if (recalled) {
    sections.push(
      `What we know about why. Each carries its age. Quote it with that age,\n` +
      `never in the present tense:\n${recalled}`,
    );
  }
  if (!brief && !recalled) {
    sections.push(
      `No market data matched this post. Write from mechanism alone and quote\n` +
      `no figures. A comment with a good argument and no numbers is fine.`,
    );
  }

  const isPrivate = kind === "dm" || kind === "connect";
  if (isPrivate && context) {
    sections.push(
      `Background on the live book, for your own grounding. Quote a figure only\n` +
      `if it answers something they actually raised:\n${context}`,
    );
  }
  if (!isPrivate) {
    sections.push(
      `This is public writing. Do not name BlockFinaX and do not cite anything it\n` +
      `has built or settled. The point has to stand on the mechanism and the\n` +
      `numbers above, exactly as it would under a stranger's name.`,
    );
  }

  sections.push(`Draft a ${kind}. ${INTENT_RULES[kind]}`);
  return sections.join("\n\n");
}
