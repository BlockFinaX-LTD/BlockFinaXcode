import { test } from "node:test";
import assert from "node:assert/strict";
import { relevanceScore } from "../outreach-relevance";

/**
 * The filter that decides whether a LinkedIn post earns a drafting call.
 *
 * The skips matter more than the hits. A scorer that drafts a reply to a
 * birthday post produces exactly the message that reads as a bot — which is
 * the thing the outreach tool exists to avoid.
 */
const THRESHOLD = 2;

const DRAFT = [
  "Our Ghana importers keep getting hit by cedi depreciation between order and payment.",
  "USD/GHS moved 4% this month. Treasury teams in Accra are struggling to plan.",
  "CFO at a Nigerian manufacturer — dollar shortage is our biggest problem right now.",
  "Thoughts on stablecoin settlement for cross-border supplier payments in Africa?",
  "Head of finance role open at our Kenya office, working capital focus.",
];

const SKIP = [
  "Excited to announce I've joined Acme as VP of Engineering!",
  "We're hiring three backend engineers. DM me.",
  "Great conference in Lagos last week. Met so many inspiring founders.",
  "Happy birthday to my wonderful colleague!",
];

test("drafts for posts about currency risk", () => {
  for (const text of DRAFT) {
    assert.ok(
      relevanceScore(text) >= THRESHOLD,
      `scored ${relevanceScore(text)}, expected >= ${THRESHOLD}: ${text}`,
    );
  }
});

test("skips posts that are not about currency risk", () => {
  for (const text of SKIP) {
    assert.ok(
      relevanceScore(text) < THRESHOLD,
      `scored ${relevanceScore(text)}, expected < ${THRESHOLD}: ${text}`,
    );
  }
});

// A weak signal alone must not clear the bar. "Inflation is up again" is about
// money and about nobody; pitching hedging at it is the failure this threshold
// exists to prevent.
test("a single weak signal is not enough", () => {
  assert.ok(relevanceScore("Inflation is up again.") < THRESHOLD);
  assert.ok(relevanceScore("Interesting piece on volatility.") < THRESHOLD);
});

test("naming the pair outranks naming the region", () => {
  assert.ok(
    relevanceScore("USD/GHS is at 11.2 and our margins are gone") >
      relevanceScore("Doing business in Africa is rewarding"),
  );
});
