/**
 * content.ts — drafting posts worth reading.
 *
 * `linkedin_draft` has been a declared proposal kind with nothing producing it.
 * This fills that slot, and it lands in the same approval queue as everything
 * else: a post goes out because a person pressed approve, not because a job ran.
 *
 * ## The whole problem with executive content
 *
 * Almost all of it is unfalsifiable. "Trust is the currency of trade finance."
 * Nobody can disagree, nobody learns anything, and the post could have been
 * written by any of ten thousand companies. It is cheap to produce, which is
 * exactly why it is worthless: the reader can tell.
 *
 * What BlockFinaX has, and almost nobody writing about African FX has, is
 * 483,000 daily closes going back to 1996 already sitting in the database for
 * pricing. A realised-volatility percentile on the cedi is not an opinion. It
 * is a fact somebody would have to go and compute, and it cannot be written by
 * a competitor with a content calendar.
 *
 * So every draft is built on a computed brief. The numbers come from
 * market-brief.ts at request time, which means they cannot be stale and cannot
 * be invented, and the model is told plainly that a post with no number in it
 * has failed.
 *
 * ## Why nothing here posts
 *
 * The token that can post exists in linkedin.ts, and this file does not touch
 * it. Drafting and publishing are separated by a human on purpose: an agent
 * that both writes and publishes is one prompt away from saying something in
 * the founder's name that the founder never saw.
 */

import { db } from "../db";
import { agentProposals } from "@shared/agent-schema";
import { runAgent, fence } from "./runtime";
import { briefFor, renderBrief, type PairBrief } from "../outreach/market-brief";

/**
 * The angles a post can take.
 *
 * Named rather than left to the model, because "write something insightful"
 * produces the average of everything ever posted, which is the problem. Each
 * one asks for a different shape of argument, and each is answerable from data
 * this company actually holds.
 */
export const ANGLES = {
  volatility_reality: {
    label: "What the numbers actually say",
    brief:
      "Take one currency and say something concrete and slightly counterintuitive about how it has " +
      "actually behaved, using the realised volatility and percentile figures. Correct a belief that " +
      "people in the trade hold loosely. End on what it means for someone pricing a shipment.",
  },
  hedging_cost: {
    label: "What protection really costs",
    brief:
      "Explain what covering a currency move actually costs against what people assume it costs, " +
      "in money on a concrete shipment size. Most people have never priced it and imagine it is " +
      "prohibitive. Use the real figures.",
  },
  jump_risk: {
    label: "Why the averages mislead",
    brief:
      "Frontier currencies do not drift, they sit still and then gap. Show why an average or a " +
      "standard deviation understates what an importer is exposed to, using the actual distribution " +
      "of moves. This is the single most useful thing this company knows.",
  },
  market_structure: {
    label: "Why this market works the way it does",
    brief:
      "Explain a structural fact about African FX risk that outsiders get wrong: why cover is scarce, " +
      "who currently carries the risk, or why a bank quote looks the way it does. Ground it in what " +
      "the data shows rather than in opinion.",
  },
  operator_lesson: {
    label: "Something learned building it",
    brief:
      "A specific thing learned building this, with the detail intact. Not a lesson about " +
      "perseverance. A decision, what it cost, and what it changed. If there is a number, use it.",
  },
} as const;

export type Angle = keyof typeof ANGLES;

const VOICE = `
You are drafting a LinkedIn post for Anthony Kumako, founder of BlockFinaX,
which builds FX risk infrastructure for African trade.

Voice: an operator who works with this data daily. Plain, specific, unhurried.
He is Ghanaian, writing partly for Ghanaian and Nigerian business owners and
partly for investors and fintech people abroad.

Hard rules, because breaking any of them makes the post worse than not posting:

- Lead with the specific thing. No throat-clearing about how the world is
  changing, no rhetorical question opener.
- Every claim about a currency must come from the brief you are given. If it is
  not in the brief, you do not know it.
- At least one real number, stated exactly as the brief gives it.
- No hashtags. No emoji. No "thoughts?" at the end. No "I've been thinking a lot
  about lately".
- Do not describe BlockFinaX unless the post is genuinely about it. A post that
  is an advert reads as an advert.
- Short paragraphs, one idea each. 120 to 220 words.
- If the brief does not support anything worth saying, say so instead of padding.
  An honest refusal is a better outcome than a filler post.
`.trim();

export interface DraftedPost {
  angle: Angle;
  pair: string | null;
  body: string;
  /** The computed facts the draft was built on, kept so a reviewer can check it. */
  brief: string | null;
  runId: number | null;
}

/**
 * Draft one post.
 *
 * A pair is resolved to a computed brief first. Where there is no brief the
 * draft is still attempted for the angles that do not need one, and refused for
 * the ones that do, rather than letting the model fill the gap from memory.
 */
export async function draftPost(args: {
  angle: Angle;
  pair?: string;
  extra?: string;
}): Promise<DraftedPost | { error: string }> {
  const angle = ANGLES[args.angle];
  if (!angle) return { error: `Unknown angle ${args.angle}.` };

  const needsData: Angle[] = ["volatility_reality", "hedging_cost", "jump_risk"];
  let brief: PairBrief | null = null;
  if (args.pair) brief = await briefFor(args.pair).catch(() => null);

  if (needsData.includes(args.angle) && !brief) {
    return {
      error:
        `The "${angle.label}" angle is built on computed figures, and there are none for ` +
        `${args.pair ?? "no pair given"}. Pick a pair with history, or an angle that does not need one.`,
    };
  }

  const res = await runAgent({
    scope: "internal",
    trigger: "schedule",
    maxTokens: 900,
    messages: [{
      role: "user",
      content:
        `Write one LinkedIn post.\n\nANGLE: ${angle.brief}\n\n` +
        (brief
          ? `${fence("computed-market-brief", renderBrief(brief))}\n\n` +
            `Every currency figure in your post must come from that brief, exactly as stated.\n\n`
          : `You have no market data for this one, so do not state currency figures at all.\n\n`) +
        (args.extra ? `Anthony has added: ${args.extra}\n\n` : "") +
        `Reply with the post body only. No preamble, no title, no quotation marks.`,
    }],
    systemExtra: VOICE,
  });

  const body = res.text.trim();
  if (!body) return { error: "The model returned nothing." };

  return {
    angle: args.angle,
    pair: args.pair ?? null,
    body,
    brief: brief ? renderBrief(brief) : null,
    runId: res.runId,
  };
}

/**
 * Draft and file for approval.
 *
 * The brief goes into the payload beside the body, so whoever reviews it can
 * check a number against the thing it came from without leaving the queue.
 * A draft whose figures cannot be checked is a draft that gets approved on
 * vibes.
 */
export async function proposePost(args: {
  angle: Angle; pair?: string; extra?: string;
}): Promise<{ ok: true; id: number; body: string } | { ok: false; error: string }> {
  const drafted = await draftPost(args);
  if ("error" in drafted) return { ok: false, error: drafted.error };

  const [row] = await db.insert(agentProposals).values({
    kind: "linkedin_draft",
    title: `${ANGLES[drafted.angle].label}${drafted.pair ? ` · ${drafted.pair}` : ""}`,
    rationale:
      drafted.brief
        ? `Built on a market brief computed at drafting time, included in the payload so every figure can be checked.`
        : `No market data used, so the post makes no currency claims.`,
    payload: {
      body: drafted.body,
      angle: drafted.angle,
      pair: drafted.pair,
      brief: drafted.brief,
    },
    priority: "normal",
    sourceType: "content",
    // sourceId is an integer column for rows that point at a record. A post
    // points at an angle, not a row, so it stays null and the angle lives in
    // the payload where a reviewer can see it.
    sourceId: null,
    runId: drafted.runId,
  }).returning({ id: agentProposals.id });

  return { ok: true, id: row.id, body: drafted.body };
}
