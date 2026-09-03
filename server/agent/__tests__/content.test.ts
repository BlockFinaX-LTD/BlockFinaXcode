import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * The voice rules are the product here.
 *
 * A drafting feature is easy to ship and hard to keep good: the failure is not
 * a crash, it is a post that reads like every other post and quietly costs the
 * founder credibility. These pin the instructions that stop that, so a later
 * edit that softens them fails a test rather than passing unnoticed.
 *
 * Imported lazily inside each test because content.ts reaches the database at
 * import time through the runtime.
 */
async function mod() { return import("../content"); }

test("every angle is answerable from data this company actually holds", async () => {
  const { ANGLES } = await mod();
  const keys = Object.keys(ANGLES);
  assert.ok(keys.length >= 4, "too few angles to avoid repetition");
  // None of them may be a generic prompt. Each has to ask for a specific shape
  // of argument, which is what stops "write something insightful" producing the
  // average of everything ever posted.
  Object.values(ANGLES).forEach((a: any) => {
    assert.ok(a.brief.length > 120, `${a.label} is too vague to constrain the model`);
    assert.ok(a.label.length > 0);
  });
});

test("the angles that make currency claims are the ones that require data", async () => {
  const { ANGLES } = await mod();
  // These three name figures, so a draft without a computed brief would be the
  // model recalling numbers, which is the one thing that must not happen.
  ["volatility_reality", "hedging_cost", "jump_risk"].forEach((k) =>
    assert.ok(k in ANGLES, `${k} is missing`));
  // These two are about judgement rather than figures, so they can run without.
  ["market_structure", "operator_lesson"].forEach((k) =>
    assert.ok(k in ANGLES, `${k} is missing`));
});

test("a data angle with no brief is refused rather than drafted", async () => {
  const { draftPost } = await mod();
  const out = await draftPost({ angle: "jump_risk", pair: "NOT/APAIR" });
  assert.ok("error" in out, "should refuse without figures");
  if ("error" in out) {
    assert.match(out.error, /computed figures|does not need one/i);
  }
});

test("an unknown angle is refused", async () => {
  const { draftPost } = await mod();
  const out = await draftPost({ angle: "hot_takes" as any });
  assert.ok("error" in out);
});
