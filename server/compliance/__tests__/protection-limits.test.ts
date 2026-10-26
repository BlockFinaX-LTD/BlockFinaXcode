import { test } from "node:test";
import assert from "node:assert/strict";
import { checkProtectionLimits, verificationRequired } from "../protection-limits";

const NOW = 1_800_000_000;
const pos = (daysAgo: number, premium: number, maxPayout: number, status: "active" | "settled" = "active") =>
  ({ createdAt: NOW - daysAgo * 86_400, premium: String(premium), fee: String(premium * 0.05), maxPayout: String(maxPayout), status }) as any;

test("verification is enforced on mainnet only, unless set explicitly", () => {
  assert.equal(verificationRequired({}, "mainnet"), true);
  assert.equal(verificationRequired({}, "testnet"), false);
  assert.equal(verificationRequired({ REQUIRE_VERIFICATION: "true" }, "testnet"), true);
  assert.equal(verificationRequired({ REQUIRE_VERIFICATION: "false" }, "mainnet"), false);
});

test("an unverified user cannot buy or deposit, and is told which tier is needed", () => {
  const d = checkProtectionLimits({ tier: 0, positions: [], addsCashUsd: 40, addsExposureUsd: 500, nowSec: NOW });
  assert.equal(d.allowed, false);
  assert.equal(d.requiredTier, 1);
});

test("Basic verification allows up to $1,000 moved and $1,000 of possible payout", () => {
  assert.equal(checkProtectionLimits({ tier: 1, positions: [], addsCashUsd: 40, addsExposureUsd: 900, nowSec: NOW }).allowed, true);
  const tooMuchPayout = checkProtectionLimits({ tier: 1, positions: [pos(3, 30, 600)], addsCashUsd: 40, addsExposureUsd: 500, nowSec: NOW });
  assert.equal(tooMuchPayout.allowed, false);
  assert.equal(tooMuchPayout.requiredTier, 2);
});

test("money moved counts the last 30 days only; payout exposure counts active cover only", () => {
  const old = [pos(45, 900, 5000, "settled"), pos(40, 900, 500)];
  const d = checkProtectionLimits({ tier: 1, positions: old, addsCashUsd: 100, addsExposureUsd: 100, nowSec: NOW });
  assert.equal(d.cashMovedUsd, 0);
  assert.equal(d.payoutExposureUsd, 500);
  assert.equal(d.allowed, true);
});
