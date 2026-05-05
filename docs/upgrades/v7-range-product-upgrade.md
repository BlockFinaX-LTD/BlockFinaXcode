# v7 Upgrade — Range Payouts (and Optional Single-Strike Compatibility)

This is the doc for the v7 upgrade that **adds** range-payout (call/put spread) events to BlockFinaX while keeping the original single-strike digital product as an opt-in mode. Same plumbing, both product shapes, no storage migration.

---

## 1. What Changed in One Sentence

A new `payoutCap` field on every event selects the product shape: `payoutCap > 0` enables a range/spread event where payout scales linearly between `strike` and `payoutCap`; `payoutCap == 0` keeps the legacy single-strike digital behaviour. Both shapes coexist in the same contract, the same pool model, the same storage layout.

---

## 2. Why

The v6 product paid the same fixed amount whether the strike was hit by a hair or by 50%. That created a cliff at the strike — economists call it gamma — and made the LP product un-investable for any institutional underwriter. A small price move near the strike could swing the pool from "owes nothing" to "owes the maximum" in a single oracle update.

Range payouts smooth that out:

- Payout = 0 below the strike
- Payout = `notional × (settlement - strike) / initialRate` between strike and cap
- Payout = `notional × (cap - strike) / initialRate` above the cap

LP loss is now **bounded and continuous** in the settlement price. Same maximum exposure as before (when settlement reaches the cap), but every realised settlement that lands inside the range produces a smaller-than-max loss.

The roadmap doc ([infrastructure-roadmap.md](infrastructure-roadmap.md) §1) framed this as the upstream change everything else depends on. This is that change.

### Why we kept single-strike too

The cliff product is bad for LPs in the general case, but the simpler product story ("if the rate hits X, you get $Y") is still the easier thing to explain to an SME hedger. Rather than killing it outright, v7 demotes it to opt-in: range is the default and recommended shape, single-strike remains available for events where the simpler payoff is the right product fit. The frontend defaults to range; single-strike is a one-toggle override.

Crucially, supporting both costs us nothing on-chain — see §4 — so the choice is reversible without another upgrade.

---

## 3. Files Changed

| File | What changed |
|---|---|
| [LibAppStorage.sol](../contracts/src/libraries/LibAppStorage.sol) | Appended `uint256 payoutCap` to `HedgeEvent` (storage-safe append). Updated docstring on `HedgePosition.payoutAmount` to reflect new "reservation at buy, actual at settlement" semantics. |
| [BlockFinaXHedgeFacet.sol](../contracts/src/facets/BlockFinaXHedgeFacet.sol) | Added `payoutCap` to `CreateEventParams`. Added range validation in `createEvent`. Replaced `priceDelta` cap with `rangeWidth` cap. Reworked `buyProtection` to reserve worst-case payout. Reworked `settleEvent` to compute actual per-position payouts and refresh `totalMaxPayout` to the realised aggregate. Added `getHedgeEventRange()` view and `quoteRangePayout()` what-if quote. |
| [BlockFinaXOracleFacet.sol](../contracts/src/facets/BlockFinaXOracleFacet.sol) | Mirrored the same range payout logic in `_settleEvent` so both settlement paths (single-key admin and multi-oracle consensus) produce identical position state. |

No facet was added or removed. The only Diamond cut required to deploy v7 is a `Replace` for the existing HedgeFacet and OracleFacet selector sets.

---

## 4. Storage Layout — Why This Is Safe

Diamond storage discipline:

- `LibAppStorage.AppStorage` itself was **not** modified. The mapping `hedgeEvents` is unchanged.
- The `HedgeEvent` struct gained one new field, **appended at the very end** after `premiumDust`. This is the EIP-2535 standard for evolving structs that live inside mappings — new slots after the existing tail are simply zero-initialised for any pre-existing entries.
- `HedgePosition`, `HedgeLpDeposit`, and `HedgeFeeConfig` were not modified at all.
- `LibDiamond` and `LibOracleStorage` were not touched.

`CreateEventParams` is a `memory` calldata struct, not storage. Adding a field to it changes the function ABI of `createEvent` (callers must pass the new param) but has no on-chain layout impact. Since no live events exist at v7 cut time, no caller needs to be migrated — only the frontend and any indexer scripts.

### How dual-mode coexistence works

The legacy fallback branches (`if (evt.payoutCap == 0)`) in `buyProtection` and both `_settleEvent` functions are **first-class supported behaviour**, not dead code. A creator who passes `payoutCap = 0` to `createEvent` opts into the v6 single-strike digital product:

- `buyProtection` reserves the full `notional × |strike − initialRate| / initialRate` predetermined payout.
- `settleEvent` either keeps that full reserved payout (if triggered) or zeroes it (if not). No partial payouts.
- Storage layout is identical — the `payoutCap` slot just sits at zero.
- Pool accounting (`totalMaxPayout`, `liquidityAtSettlement`, MasterChef accumulator, withdraw split) is identical.

A creator who passes `payoutCap > 0` opts into the v7 range product as described in the rest of this doc.

Both event types can exist in the same Diamond at the same time. There is no cross-contamination because all the math is per-event. An LP depositing into pool #42 reads pool #42's `payoutCap` to know what they're underwriting.

---

## 5. Contract Math — Before vs After

### `createEvent` validation

The 10× per-notional payout cap is preserved in **both** modes. What's being measured changes per shape:

| Mode | What's measured | Validation |
|---|---|---|
| Single-strike (`payoutCap == 0`) | `priceDelta = |strike − initialRate|` | `priceDelta ≤ initialRate × 10` |
| Range (`payoutCap > 0`) | `rangeWidth = |payoutCap − strike|` | `rangeWidth ≤ initialRate × 10` |

The strike-vs-initialRate direction check (strike above for upward hedges, below for downward) applies to both modes. The payoutCap-vs-strike direction check only applies in range mode (skipped when `payoutCap == 0`).

A creator can still set a deep-OTM strike (e.g. `strike = 2 × initialRate`) in either mode — they just can't make the range wider, or the strike-spot gap larger, than 10× initialRate. Same economic invariant, two different shapes for measuring it.

### `buyProtection` predetermined payout

| Before (v6) | After (v7) |
|---|---|
| `priceDelta = |strike - initialRate|` | `maxPriceMove = |payoutCap - strike|` |
| `predeterminedPayout = notional × priceDelta / initialRate` | `predeterminedPayout = notional × maxPriceMove / initialRate` |

The same formula, but the price move is now the **width of the range** (worst-case payout when settlement reaches the cap) instead of the **gap between strike and spot** (entire payout regardless of how far past strike the settlement lands).

This `predeterminedPayout` is the **reservation** sized at buy time so the pool keeps enough free liquidity to honour the worst case. The actual payout at settlement is ≤ this number.

### `settleEvent` payout per position

For an upward hedge (`strikeAbove = true`):

```
if (settlementPrice ≥ strike):                        // triggered
    effectiveRate    = min(settlementPrice, payoutCap)
    effectivePriceMove = effectiveRate - strike       // 0 .. (payoutCap - strike)
    actualPayout     = notional × effectivePriceMove / initialRate
else:
    actualPayout = 0
```

For a downward hedge (`strikeAbove = false`):

```
if (settlementPrice ≤ strike):                        // triggered
    effectiveRate    = max(settlementPrice, payoutCap)
    effectivePriceMove = strike - effectiveRate
    actualPayout     = notional × effectivePriceMove / initialRate
else:
    actualPayout = 0
```

Computed **once per event** and scaled by each position's notional inside the loop. Settlement gas cost is essentially the same as v6 — one extra branch and a couple of additions per position.

### `totalMaxPayout` is refreshed at settlement

In v6, `totalMaxPayout` was the running sum of `predeterminedPayout` set at buy time. After settlement it stayed at the buy-time value. LP loss share at withdrawal was computed against that.

In v7, settlement sums the **actual** payouts and overwrites `totalMaxPayout` with that aggregate. LPs withdrawing later see a loss share computed against the realised payout, not the worst-case reservation. This is the behaviour the roadmap doc described as "the actual loss the pool took."

The downstream invariants still hold:

- `claimPayout` decrements `totalMaxPayout` as hedgers claim — same as v6.
- `withdrawCapital` uses `totalMaxPayout × dep.amount / liquidityAtSettlement` — same formula, but `totalMaxPayout` now reflects realised loss.
- `recoverExpiredPayouts` still walks Claimable positions after the 90-day grace period and sweeps the unclaimed residual into platform fees.

---

## 6. The Numerical Example (the same baker, three settlement scenarios)

Setup:

- USD/GHS, `initialRate = 10`
- `strike = 11`, `payoutCap = 12`
- Baker buys with `notional = $1,000`

Buy-time reservation:

```
maxPriceMove        = 12 − 11 = 1
predeterminedPayout = 1000 × 1 / 10 = $100
```

The pool reserves $100 against `totalMaxPayout`. The baker pays her premium and any platform fees as before.

**Scenario A: settlement at 10.5** (rate didn't reach strike)
```
triggered = (10.5 ≥ 11) = false
actualPayout = 0
position.status = Expired
event.totalMaxPayout = 0   (refreshed)
```
LPs keep the premium and the entire deposit. Baker gets nothing.

**Scenario B: settlement at 11.5** (rate landed inside the range)
```
triggered = true
effectiveRate    = min(11.5, 12) = 11.5
effectivePriceMove = 11.5 - 11   = 0.5
actualPayout     = 1000 × 0.5 / 10 = $50
position.status = Claimable, payoutAmount = $50
```
Baker gets $50 (half of the worst case). LPs lose $50 collectively, not $100. Important: in v6 this same scenario would have paid the baker $100 because the digital trigger doesn't care how far past the strike settlement landed.

**Scenario C: settlement at 13** (rate blew through the cap)
```
triggered = true
effectiveRate    = min(13, 12)   = 12     // clipped at cap
effectivePriceMove = 12 - 11     = 1
actualPayout     = 1000 × 1 / 10 = $100
position.status = Claimable, payoutAmount = $100
```
Baker gets the full reserved $100. LPs lose $100. Same maximum loss as v6, but now **bounded** — settlement at 14, 15, or 100 still produces the same $100 payout, where in v6 the doc-cap of `priceDelta ≤ 10 × initialRate` was the only thing standing between LPs and an unbounded payout.

---

## 7. New View Functions

- `getHedgeEventRange(uint256 eventId) → (strike, payoutCap, initialRate, strikeAbove)` — frontends should use this to detect range vs legacy events. `payoutCap == 0` means render single-strike UI.
- `quoteRangePayout(uint256 eventId, uint256 hypoSettlement, uint256 notional) → uint256` — pure what-if quote for any settlement price. Used for the platform UI's "your payout if the rate ends at X" slider, and for underwriter risk dashboards plotting expected loss curves.

`getHedgeEventCore` and `getHedgeEventStats` are unchanged. Their ABI is preserved so existing indexer code keeps working — readers just don't see `payoutCap` from those calls and need to call the new getter to fetch it.

---

## 8. What Off-Chain Components Need to Update

- **Frontend (`client/src/pages/hedge.tsx`)**: event-creation form needs a `payoutCap` input. The "buy protection" panel should show the user a payout chart across the range, not a single number. Settlement-result display should show actual payout per position, not just "did it trigger." Use `quoteRangePayout` for the chart.
- **Indexer (`server/chain-sync.ts`, `server/hedge-reader.ts`)**: ingest the new field by calling `getHedgeEventRange` for each event. The `getHedgeEventCore` ABI still works untouched.
- **Off-chain pricing service (when built)**: switch from digital pricing to call/put spread pricing (long call at `strike`, short call at `payoutCap`, with the same direction logic mirrored for downward hedges).

---

## 8.5 Picking a Mode (for Creators)

| Use case | Recommended mode |
|---|---|
| Default for any new B2B FX hedge | **Range** — bounded gamma, LP-investable, fairer payout shape |
| Hedger explicitly asks for "fixed payout if X happens" simplicity | Single-strike (set `payoutCap = 0`) |
| Creator-only pool (no external LPs) where the creator is comfortable owning the gamma themselves | Either; range still recommended for hygiene |
| Binary-event style markets (devaluation by Friday yes/no) | Single-strike is the natural fit |

The default in any UI should be range. Single-strike should be a deliberate opt-in behind an "advanced" toggle.

---

## 9. What This Doesn't Fix

This change makes the LP product investable. It does **not** answer "what's the right premium for this range." The pricing problem is the subject of [../pricing/pricing-engine.md](../pricing/pricing-engine.md) — until v8 (signed-quote attestation) the creator still typed a number; range geometry just made that number map to bounded, continuous risk instead of cliff risk, which is the precondition for any pricing engine to be worth building.

---

## 10. Deployment Checklist

1. Run `npx hardhat compile` — confirms 18 files compile clean (already verified at v7 cut).
2. Write tests covering all three scenarios above plus the validation paths (no test directory exists today; this is the next gap).
3. Submit a `Replace` cut through the timelock cut facet (`BlockFinaXTimelockCutFacet.diamondCut`) for the `BlockFinaXHedgeFacet` and `BlockFinaXOracleFacet` selectors.
4. Wait 48 hours.
5. Execute the cut.
6. Update frontend and indexer to match (see §8).

No initialiser is required because the new struct field is zero-init and the only on-chain consumers (`buyProtection` and the two settlement paths) explicitly handle `payoutCap == 0` as a first-class single-strike event. Existing pre-v7 events on-chain (if any ever get created on a fork or replay environment) are interpreted as single-strike events automatically — no migration call needed.
