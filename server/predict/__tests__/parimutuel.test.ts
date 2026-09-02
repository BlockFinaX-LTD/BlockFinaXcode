import { test } from "node:test";
import assert from "node:assert/strict";
import {
  impliedProbability, resolve, payoutFor, quoteStake, didHappen, FEE_RATE,
} from "../parimutuel";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

/* ── the split is the price ──────────────────────────────────────────────── */

test("implied probability is the pool's share of the total", () => {
  close(impliedProbability({ yes: 4000, no: 1000 })!, 0.8);
  close(impliedProbability({ yes: 1000, no: 1000 })!, 0.5);
});

test("a market with one empty side has no price at all", () => {
  assert.equal(impliedProbability({ yes: 4000, no: 0 }), null);
  assert.equal(impliedProbability({ yes: 0, no: 4000 }), null);
  assert.equal(impliedProbability({ yes: 0, no: 0 }), null);
});

/* ── resolution ──────────────────────────────────────────────────────────── */

test("a market nobody took the other side of is void, not a win", () => {
  assert.equal(resolve({ yes: 4000, no: 0 }, true), "void");
  assert.equal(resolve({ yes: 4000, no: 0 }, false), "void");
  assert.equal(resolve({ yes: 0, no: 500 }, true), "void");
});

test("with both sides staked it resolves the way the rate went", () => {
  assert.equal(resolve({ yes: 4000, no: 1000 }, true), "yes");
  assert.equal(resolve({ yes: 4000, no: 1000 }, false), "no");
});

/* ── payouts ─────────────────────────────────────────────────────────────── */

test("a winner takes their stake back plus a pro-rata slice of the losers", () => {
  // $100 of a $4,000 Yes pool, against a $1,000 No pool.
  const p = payoutFor({ pools: { yes: 4000, no: 1000 }, side: "yes", stake: 100, outcome: "yes" });
  const gross = 1000 * (100 / 4000);            // $25
  close(p.winnings, gross * (1 - FEE_RATE));    // $24.50
  close(p.fee, gross * FEE_RATE);               // $0.50
  close(p.total, 100 + gross * (1 - FEE_RATE)); // $124.50
});

test("a loser receives nothing", () => {
  const p = payoutFor({ pools: { yes: 4000, no: 1000 }, side: "no", stake: 100, outcome: "yes" });
  assert.equal(p.total, 0);
});

test("a void refunds the stake whole and charges no fee", () => {
  const p = payoutFor({ pools: { yes: 4000, no: 0 }, side: "yes", stake: 100, outcome: "void" });
  assert.equal(p.total, 100);
  assert.equal(p.fee, 0);
});

/**
 * The fee is charged on winnings, never on stake.
 *
 * On stake, a thin losing pool would hand a winner back less than they put in.
 * A "win" that returns $98 on $100 is a loss, and no fee schedule should be
 * able to produce one.
 */
test("a winner never receives less than they staked, however thin the other side", () => {
  for (const no of [0.01, 1, 5, 50, 1000]) {
    const p = payoutFor({ pools: { yes: 100000, no }, side: "yes", stake: 100, outcome: "yes" });
    assert.ok(p.total >= 100, `returned ${p.total} on a 100 stake against a ${no} pool`);
  }
});

/* ── conservation ────────────────────────────────────────────────────────── */

test("the market never pays out more than it took in", () => {
  const pools = { yes: 4000, no: 1000 };
  // Four Yes stakers making up the whole Yes pool.
  const stakes = [2000, 1000, 700, 300];
  const paid = stakes.reduce(
    (acc, s) => acc + payoutFor({ pools, side: "yes", stake: s, outcome: "yes" }).total, 0);
  const takenIn = pools.yes + pools.no;
  assert.ok(paid <= takenIn + 1e-9, `paid ${paid} from ${takenIn}`);
  // Everything not paid out is the fee, and nothing is left unaccounted for.
  close(takenIn - paid, pools.no * FEE_RATE);
});

/* ── quoting ─────────────────────────────────────────────────────────────── */

/**
 * A quote has to price the stake into the pool it is about to join. Quoting the
 * odds as they stand beforehand overstates the return, badly on a thin market.
 */
test("a quote accounts for the stake's own effect on the pool", () => {
  const pools = { yes: 100, no: 100 };
  const q = quoteStake({ pools, side: "yes", stake: 100 });
  // After the stake the Yes pool is 200, so this stake owns half of a 100 No
  // pool, not all of it.
  close(q.winnings, 50 * (1 - FEE_RATE));
  close(q.multiple, (100 + 50 * (1 - FEE_RATE)) / 100);

  const naive = payoutFor({ pools, side: "yes", stake: 100, outcome: "yes" });
  assert.ok(naive.total > q.total, "pre-stake odds should overstate the return");
});

test("on a thin market the difference is not a rounding error", () => {
  const pools = { yes: 10, no: 90 };
  const q = quoteStake({ pools, side: "yes", stake: 90 });
  const naive = payoutFor({ pools, side: "yes", stake: 90, outcome: "yes" });
  // Quoting pre-stake would promise several times the real return.
  assert.ok(naive.total / q.total > 2, `overstatement was only ${naive.total / q.total}x`);
});

/* ── settlement ──────────────────────────────────────────────────────────── */

test("above means above, and a rate landing exactly on the line did not clear it", () => {
  assert.equal(didHappen({ settlementRate: 1700.01, threshold: 1700, direction: "above" }), true);
  assert.equal(didHappen({ settlementRate: 1700, threshold: 1700, direction: "above" }), false);
  assert.equal(didHappen({ settlementRate: 1699.99, threshold: 1700, direction: "above" }), false);
});

test("below is the mirror, ties still resolving No", () => {
  assert.equal(didHappen({ settlementRate: 1699.99, threshold: 1700, direction: "below" }), true);
  assert.equal(didHappen({ settlementRate: 1700, threshold: 1700, direction: "below" }), false);
});
