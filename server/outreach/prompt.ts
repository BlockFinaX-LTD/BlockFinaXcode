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
  /** When the post was published, ISO string, when the provider told us. */
  postedAt?: string | null;
  /** The author's own page, distinct from the post link. */
  profileUrl?: string | null;
}

/**
 * How long ago, in words.
 *
 * Shared by the prompt and the console so a draft cannot say one thing while
 * the card beside it says another.
 */
export function howLongAgo(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 0) return "just now";
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
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
  recentDrafts: string[] = [],
): string {
  const who = [c.name, c.headline].filter(Boolean).join(", ") || "unknown";
  const age = howLongAgo(c.postedAt);
  const sections = [
    `They wrote:\n"""\n${c.text.slice(0, 4000)}\n"""`,
    `Who they are: ${who}`,
  ];

  // Age changes what is worth writing, not just whether to send. A comment on a
  // post from an hour ago can speak to a live thread. One on a post from last
  // month is arriving after the conversation ended, so it has to stand entirely
  // on its own rather than answering what others have said.
  if (age) {
    sections.push(
      `Posted ${age}.` +
      (/(week|month|year)/.test(age)
        ? ` The thread is cold, so write something that stands on its own rather\n` +
          `than replying to a live discussion. Do not refer to the post as recent.`
        : ""),
    );
  }

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

  // What was written recently, so the same shape is not produced again.
  //
  // Telling a model not to repeat itself does not work when it cannot see what
  // it said. Two live drafts came back with the identical skeleton, percentile
  // then sigma then worst move, because each was written in isolation and that
  // skeleton is the obvious one. Showing the previous openings turns an
  // abstract instruction into a concrete constraint.
  if (recentDrafts.length) {
    sections.push(
      `You recently wrote the comments below. Do not reuse their opening words,\n` +
      `their running order, their closing turn, or any distinctive phrase from\n` +
      `them. If one of them already used a figure, either lead somewhere else\n` +
      `entirely or leave that figure out:\n` +
      recentDrafts.map(d => `- "${d.slice(0, 220)}"`).join("\n"),
    );
  }

  sections.push(`Draft a ${kind}. ${INTENT_RULES[kind]}`);
  return sections.join("\n\n");
}
