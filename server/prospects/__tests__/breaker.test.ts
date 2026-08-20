import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_COMPLAINT_RATE, MAX_BOUNCE_RATE, MIN_SAMPLE } from "../health";

/**
 * The thresholds are the whole safety argument for sending cold mail from the
 * same domain as the magic links, so they are pinned here. Someone loosening
 * one later should have to change a test that says why it is set where it is.
 */

test("the complaint threshold sits under the level Gmail acts on", () => {
  // Gmail's bulk sender rules: stay under 0.30%, aim for 0.10%. Stopping at or
  // above their limit means stopping after they have already reacted.
  assert.ok(MAX_COMPLAINT_RATE < 0.003, `${MAX_COMPLAINT_RATE} is not below Gmail's 0.30%`);
  assert.ok(MAX_COMPLAINT_RATE >= 0.001, "below 0.10% would trip on ordinary noise");
});

test("the bounce threshold marks a scraped list before providers do", () => {
  assert.ok(MAX_BOUNCE_RATE <= 0.05, `${MAX_BOUNCE_RATE} is too permissive`);
  assert.ok(MAX_BOUNCE_RATE >= 0.02, "below 2% would trip on normal list decay");
});

/**
 * Rates on tiny samples are meaningless. One bounce out of five is 20% and
 * says nothing, and halting on it would make the breaker fire constantly at
 * the start of every campaign, which is how a safety feature gets disabled.
 */
test("a minimum sample is required before any rate is acted on", () => {
  assert.ok(MIN_SAMPLE >= 25, `${MIN_SAMPLE} is too small for a rate to mean anything`);

  // The sample gate and the bounce threshold have to agree, or the breaker
  // fires on the first dead address of every campaign and gets switched off.
  // At the minimum sample one bounce must still sit under the limit.
  assert.ok(
    1 / MIN_SAMPLE <= MAX_BOUNCE_RATE,
    `one bounce in ${MIN_SAMPLE} is ${(100 / MIN_SAMPLE).toFixed(1)}%, which exceeds the ` +
    `${(MAX_BOUNCE_RATE * 100).toFixed(0)}% limit. Raise MIN_SAMPLE or the threshold.`,
  );

  // A complaint is rarer and far more expensive, so one at the minimum sample
  // is meant to trip it. That asymmetry is deliberate.
  assert.ok(1 / MIN_SAMPLE > MAX_COMPLAINT_RATE,
    "a single spam complaint should be enough to stop and look");
});

/** The arithmetic the breaker runs, checked against the numbers it will see. */
test("the breaker fires where it should and not before", () => {
  const trips = (bad: number, sent: number, max: number) =>
    sent >= MIN_SAMPLE && bad / sent > max;

  // 200 sent, one complaint is 0.5%, which is past Gmail's limit.
  assert.equal(trips(1, 200, MAX_COMPLAINT_RATE), true);
  // 1000 sent, one complaint is 0.1%, which is the level to aim for.
  assert.equal(trips(1, 1000, MAX_COMPLAINT_RATE), false);
  // 100 sent, ten bounced is 10%, a scraped list.
  assert.equal(trips(10, 100, MAX_BOUNCE_RATE), true);
  // 100 sent, two bounced is 2%, ordinary decay.
  assert.equal(trips(2, 100, MAX_BOUNCE_RATE), false);
  // Below the sample gate nothing fires, however bad it looks.
  assert.equal(trips(5, 10, MAX_BOUNCE_RATE), false);
});
