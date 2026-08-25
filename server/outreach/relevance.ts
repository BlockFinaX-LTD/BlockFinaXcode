/**
 * relevance.ts, stage one: decide whether this post is an opportunity at all.
 *
 * ## Why this is a separate call
 *
 * When one call judges and writes at the same time, the judgement is made by a
 * model that has already begun composing, and a half-written comment is a
 * reason to conclude the post was relevant. Deciding cold, before any text
 * exists to justify, is structurally harder to fool. It also costs one cheap
 * call to skip an expensive one on the posts that were never worth answering.
 *
 * ## Why a score and a quote, rather than either alone
 *
 * A confidence number on its own is not evidence. Asked how sure it is, a model
 * says ninety for things it is right about six times in ten, and nothing about
 * that can be checked afterwards.
 *
 * So the score has to be accompanied by the exact words from the post that
 * justify it. A quote can be read back against the original by anyone. It also
 * changes the judgement itself: having to produce the sentence before claiming
 * the problem is theirs is what surfaces that no such sentence exists.
 *
 * ## Why the exclusions are a hard list
 *
 * Fundraising, hiring, milestones and motivational posts are where a product
 * mention reads worst, and they are also where a model most wants to find a
 * connection, because there is always some thread back to money. Naming them
 * removes the judgement rather than testing it.
 */

import Anthropic from "@anthropic-ai/sdk";

export type CommentStrategy = "insight" | "insight_experience" | "insight_blockfinax";

export interface Relevance {
  mainTopic: string;
  problem: string;
  industry: string;
  painPointDetected: boolean;
  isProblemWeSolve: boolean;
  relevanceScore: number;
  confidenceScore: number;
  reason: string;
  /** The words from the post that justify the score. Empty when there are none. */
  evidence: string;
  strategy: CommentStrategy;
  shouldMention: boolean;
}

const SYSTEM = `You are a B2B strategist for BlockFinaX. You are not writing
anything yet. Your only job is to decide whether a LinkedIn post is a genuine
opportunity to mention BlockFinaX naturally, or whether it is not.

## What BlockFinaX does

Helps businesses manage foreign exchange and commodity price risk using
programmable protection that settles onchain.

The areas it genuinely covers:
FX risk and currency volatility. Commodity price volatility. Cross-border trade.
Treasury management. Trade finance. Stablecoin settlement. Programmable risk.
Emerging market finance. Importers and exporters. Treasury automation. Business
payments where financial risk is involved.

## The bar

A relevance score above 90 means all four of these are true:

The post discusses a real problem, not an observation about the market.
BlockFinaX genuinely addresses that problem, not something adjacent to it.
Mentioning BlockFinaX would feel natural to someone reading the thread.
The comment would give the reader something, rather than reading as an advert.

If you cannot quote the words in the post that make all four true, the score is
not above 90. Produce the quote before you produce the number, and if there is
no sentence to quote, say so and score accordingly.

## Never recommend mentioning BlockFinaX when the post is about

Fundraising. Hiring. Leadership. Company milestones. AI. Motivation. General
crypto news. Politics. Personal stories. Anything unrelated to treasury, FX,
commodities, payments or trade.

These are where a product mention reads worst, and they are also where you will
most want to find a connection, because everything eventually connects back to
money. Do not follow that thread.

## The three strategies

insight: write something worth reading and say nothing about BlockFinaX. This is
the right answer for most posts, including many that are about currency.

insight_experience: the post is squarely in our area and there is something
worth saying from having talked to importers and treasurers, but the person is
not describing a problem of their own. Speak from what those conversations
showed, still without naming the company.

insight_blockfinax: the post describes a problem BlockFinaX addresses, in the
author's own words, and a mention would genuinely strengthen the discussion.

## When uncertain, choose no

An unnecessary mention costs more than a missed one. A comment that reads as
selling is remembered as selling, and the account carries a founder's name.`;

const SCHEMA = {
  name: "assess",
  description: "Judge whether this post is an opportunity.",
  input_schema: {
    type: "object" as const,
    properties: {
      mainTopic: { type: "string" },
      problem: { type: "string", description: "the problem being discussed, or none" },
      industry: { type: "string" },
      painPointDetected: { type: "boolean" },
      isProblemWeSolve: { type: "boolean" },
      relevanceScore: { type: "integer", minimum: 0, maximum: 100 },
      confidenceScore: { type: "integer", minimum: 0, maximum: 100 },
      reason: { type: "string" },
      evidence: {
        type: "string",
        description: "exact words from the post justifying the score, or empty if none exist",
      },
      strategy: { type: "string", enum: ["insight", "insight_experience", "insight_blockfinax"] },
      shouldMention: { type: "boolean" },
    },
    required: [
      "mainTopic", "problem", "industry", "painPointDetected", "isProblemWeSolve",
      "relevanceScore", "confidenceScore", "reason", "evidence", "strategy", "shouldMention",
    ],
  },
};

/**
 * The verdict, with the model's own inconsistencies resolved in code.
 *
 * A model that returns shouldMention true alongside a relevance score of 60, or
 * alongside no evidence at all, has contradicted itself. Trusting the flag over
 * the reasoning is how a gate stops being a gate, so the flag is derived here
 * rather than believed.
 */
export async function assessRelevance(
  apiKey: string,
  model: string,
  post: string,
  author?: string | null,
): Promise<Relevance | null> {
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model,
      max_tokens: 900,
      system: SYSTEM,
      tools: [SCHEMA],
      tool_choice: { type: "tool", name: "assess" },
      messages: [{
        role: "user",
        content: `Post by ${author || "unknown"}:\n"""\n${post.slice(0, 4000)}\n"""`,
      }],
    });

    const call = msg.content.find(b => b.type === "tool_use");
    if (!call || call.type !== "tool_use") return null;
    const o = call.input as any;

    const clamp = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    const relevanceScore = clamp(o?.relevanceScore);
    const confidenceScore = clamp(o?.confidenceScore);
    const evidence = typeof o?.evidence === "string" ? o.evidence.trim() : "";

    const strategy: CommentStrategy =
      ["insight", "insight_experience", "insight_blockfinax"].includes(o?.strategy)
        ? o.strategy : "insight";

    // Three conditions, all required. The model's own flag is the weakest of
    // them, so it is the one overruled: a mention needs a score above the bar,
    // a strategy that asks for it, and a quote that can be checked.
    const shouldMention =
      o?.shouldMention === true &&
      strategy === "insight_blockfinax" &&
      relevanceScore > 90 &&
      evidence.length > 15;

    return {
      mainTopic: String(o?.mainTopic ?? "").trim(),
      problem: String(o?.problem ?? "").trim(),
      industry: String(o?.industry ?? "").trim(),
      painPointDetected: !!o?.painPointDetected,
      isProblemWeSolve: !!o?.isProblemWeSolve,
      relevanceScore,
      confidenceScore,
      reason: String(o?.reason ?? "").trim(),
      evidence,
      // Keep the strategy honest with the gate: claiming a mention it did not
      // earn would show the wrong label beside a comment that never made one.
      strategy: shouldMention ? "insight_blockfinax"
        : strategy === "insight_blockfinax" ? "insight_experience" : strategy,
      shouldMention,
    };
  } catch {
    return null;
  }
}
