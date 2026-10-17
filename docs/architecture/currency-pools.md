# Currency pools

A currency pool is one shared pot of underwriting capital for one currency pair. The underwriter decides which protection durations it sells, how its prices compare to the BlockFinaX fair price, and which protection structures it offers. Hedgers pick their own amount, duration, strike and structure, and every hedge they buy draws on the same pot.

This replaces the idea of a pool as a fixed product. Under the existing `HedgeEvent` model, a pool has one strike, one cap, one expiry and one premium, and everyone in it settles together. Those pools keep working exactly as before. Currency pools are a new, separate path built alongside them.

Contracts live in `v1protocol` (`src/libraries/LibPoolStorage.sol`, `src/facets/pool/`). Pricing, quoting and the shared maths live in this repo. File-by-file changes are listed under [Contract and backend changes](#13-contract-and-backend-changes).

## 1. Pool model

An underwriter creates a pool for one pair, for example `USD/GHS`, and funds it. The pool records:

| Set by the underwriter | Notes |
| --- | --- |
| Pair and payment token | Fixed at creation. |
| Tenors | Up to 16. Each has a length in days, an on/off switch and an offer markup. |
| Structures | Open, Capped or both. |
| Cap boundaries | Capped only, optional. Minimum and maximum distance from strike to cap. |
| Open max payout | Open only. The most a hedge can pay per $1 hedged. |
| Accepting hedges, external LPs | Two switches the underwriter can flip at any time. |

The protocol fee rates (hedger fee, payout fee, LP profit fee, creator loyalty) are copied from the global fee config when the pool is created, the same way `createEvent` snapshots them today. A later change to the global config does not reach an existing pool.

Other LPs can add capital if the underwriter allows it. Everyone holds shares in the same pot.

## 2. Shared liquidity logic

There is one balance per pool. Tenors do not get their own buckets.

```
available = pool value - capital reserved for active hedges
```

The pool reserves each hedge's **maximum possible payout**. An at-the-money Open hedge with a 100% max payout reserves its full notional, so with those settings a GHS pool holding $500,000, with 3, 4, 7, 14, 30 and 45 day tenors, looks like this:

| Hedge | Tenor | Reserved | Available to every tenor afterwards |
| --- | --- | --- | --- |
| A, $100,000 | 4 days | $100,000 | $400,000 |
| B, $75,000 | 14 days | $75,000 | $325,000 |
| C, $50,000 | 30 days | $50,000 | $275,000 |

Capped cover reserves much less: `notional x (cap - strike) / spot`. On spot 11.20, strike 11.60 and cap 12.50, a $100,000 hedge reserves $8,035.71.

Every tenor sees the same remaining capacity. When a hedge settles, its reservation is released and the capital is available to every tenor again.

The contract tracks five numbers per pool:

| Field | Meaning |
| --- | --- |
| `cash` | Tokens held for the pool: deposits plus premiums, less payouts, LP profit fees and withdrawals. |
| `deferredPremium` | Premiums of hedges that have not settled yet. |
| `reserved` | Sum of the maximum payouts of active hedges. |
| `totalShares` | LP shares in issue. |
| `pendingWithdrawShares` | Shares under a withdrawal notice. |

From these:

```
NAV       = cash - deferredPremium
free      = NAV - reserved
holdback  = pendingWithdrawShares x NAV / totalShares
capacity  = free - holdback        (the largest maximum payout a new hedge can have)
```

A premium joins the pool's value when its hedge settles, not when it is paid. Someone who deposits today does not buy into premium for risk the pool took on before they arrived. Someone who leaves does not take premium for risk they no longer carry.

**Why the pool stays solvent.** The contract keeps `cash - reserved >= deferredPremium` after every operation. A sale needs `maxPayout <= capacity`, which keeps the invariant. Settlement removes at most `maxPayout + premium` from both sides. A withdrawal can only take free capital. So every active hedge's worst case is covered by money in the pool, and premiums are never counted twice.

## 3. Tenor configuration

The underwriter can offer any whole number of days from 1 to 365, up to 16 per pool. `DEFAULT_TENOR_DAYS` in `shared/currency-pool.ts` holds the common defaults for the creation form (3, 7, 14, 30 and 45). Custom values such as 4, 9, 21, 37 or 60 work the same way.

Each tenor has:

| Field | Meaning |
| --- | --- |
| `tenorDays` | Length of cover, counted from the moment of purchase. |
| `active` | Whether new hedges can be sold at this tenor. |
| `markupBps` | The offer as a multiple of fair. 10,000 is fair, 11,600 is fair x 1.16. |

Fair price is not stored. It changes with spot and volatility, so it is calculated live (see [Pricing flow](#7-pricing-flow)).

Turning a tenor off stops new sales at that duration straight away. Hedges already sold at that tenor run to expiry unchanged.

## 4. Fair price and offer price

**Fair price** is the model value of the exact protection the hedger asked for. BlockFinaX calculates it.

**Offer price** is what the hedger pays before the BlockFinaX fee: `fair x markup` for the chosen tenor. The underwriter sets the markup.

```
Fair price:   1.55%
Markup:       1.1613x
Offer price:  1.80%
Difference:   +0.25%
```

The underwriter can sell at fair (1.0x), above it (up to 5x), or below it down to 0.9x. The 0.9x floor stops a pool selling risk far below its modelled cost.

The markup is a multiplier rather than a fixed spread. Hedgers choose their own strike and cap, so fair prices vary widely between quotes, and a multiplier keeps the underwriter's margin proportionate across all of them. An underwriter screen can still let them type a percentage: convert it at the reference strike with `markup = offer / fair`. The fair-vs-offer table comes from `POST /api/pricing/pool-tenor-prices` (reference strike 2% from spot, reference cap 10% from strike, both adjustable).

The underwriter always sees the fair price next to their offer.

## 5. Open Protection

Open Protection has no customer-selected cap, but remains subject to the pool's maximum payout limit. It pays more the further the rate moves past the strike, up to the pool's **Open max payout**: the most a hedge can pay per $1 hedged, set by the underwriter (for example 30%).

The contract has to reserve a finite amount for every hedge, so the payout stops growing at that limit. Open cover is priced and reserved as a spread whose far end sits there:

```
open cap   = strike + spot x openMaxPayout       (upward cover)
open value = option(strike) - option(open cap)
```

As the max payout grows, this approaches a plain vanilla option. The cap is also kept inside the settlement band (0.5x to 2x spot), since no settlement price outside it is accepted.

With spot 11.20, strike 11.60 and a 30% max payout, the open cap is 14.96, and a $100,000 hedge reserves and can pay up to $30,000.

The open cap is worked out at purchase and stored on the hedge. If the underwriter later changes the max payout, existing Open hedges keep their own cap.

## 6. Capped Protection

Capped Protection pays only between the strike and a cap the hedger picks.

```
Spot 11.20, strike 11.60, cap 12.50
Pays from 11.60 up to 12.50, nothing more above 12.50.

capped value = option(11.60) - option(12.50)
e.g. 2.40% - 0.65% = 1.75%
```

It costs less than Open because the hedger gives up protection above the cap. Payout is linear in between:

```
payout = notional x (min(settlement, cap) - strike) / spot
```

Downward cover mirrors this (strike below spot, cap below strike).

If the underwriter set cap boundaries, the cap's distance from the strike must fall inside them, for example 3% to 20%. These are risk limits, not prices: the engine still prices whatever cap the hedger picks within them. With no boundaries set, any cap inside the settlement band is allowed.

## 7. Pricing flow

```
Hedger terms
  -> server reads the pool on-chain (tenor, structures, fees, capacity, token decimals)
  -> engine prices the fair value of those exact terms
  -> server checks the terms against the pool's rules
  -> server signs the FAIR rate, bound to this buyer and these terms
  -> app shows fair, offer, fee and maximum payout
  -> hedger accepts; contract verifies the signature, applies the tenor's markup
     from its own storage, checks capacity and takes payment
```

```
final premium = model fair value x underwriter markup
hedger pays   = final premium + BlockFinaX hedger fee (a share of the premium)
```

The engine signs only the fair rate. The contract applies the markup itself, read at the moment of purchase. That means the server cannot undercut the underwriter's price, and a markup change takes effect on the next quote without anything being re-signed.

The fair value comes from the existing engine in `server/pricing/quote.ts`, the same one that prices `createEvent`. It values the spread with Garman-Kohlhagen extended with Merton jumps (which reduces to plain Garman-Kohlhagen when the jump intensity is zero), using live spot, the USD rate, empirical drift for emerging-market pairs and GARCH-blended volatility. `pool-quote.ts` calls it and adds nothing to the maths. Changing or replacing the model later is a change to `quote.ts` and its kernel only.

The signed quote is valid for 120 seconds, can be used once, and only by the wallet it was issued to.

## 8. Hedger flow

The hedger never chooses a pool.

| Step | What happens |
| --- | --- |
| Choose exposure | Pair and direction (protection against the rate rising or falling). |
| Enter amount | Notional in the payment token. |
| Choose duration | From `GET /api/pricing/pool-options`, which lists only the tenors some pool is selling. |
| Choose strike | At or beyond spot in the protected direction. |
| Choose Open or Capped | Only the structures on sale for that tenor are offered. |
| Choose cap | Capped only. |
| Receive quote | `POST /api/pricing/pool-quote` with the pair. The engine tries every pool selling that tenor and structure, cheapest markup first, and quotes the first one with room. |
| Review | Fair price, offer price, fee, total cost, maximum payout, expiry date. |
| Accept | `hedgeContract.buyPoolProtection(signer, quote)`: approve, then `buyPoolProtection`. |
| Active | Capital is reserved and the hedge runs to its own expiry. |

`maxCost` is set to the quoted total exactly. If the underwriter changes the tenor's offer between quote and purchase, the transaction reverts and the hedger requests a new quote, so they never pay a price they did not see.

## 9. Underwriter flow

| Step | Call |
| --- | --- |
| Create the pool: pair, structures, cap boundaries, open max payout, tenors with markups, first deposit | `createCurrencyPool` (charges the existing $25 creation fee) |
| See fair vs offer per tenor | `POST /api/pricing/pool-tenor-prices` |
| Add a tenor, change an offer, switch a tenor on or off | `setPoolTenor` |
| Change structures, cap boundaries or open max payout | `setPoolStructures` |
| Pause sales, open or close to outside LPs | `setCurrencyPoolSettings` |
| Add capital | `poolDeposit` |
| Withdraw capital | `requestPoolWithdrawal`, then `executePoolWithdrawal` (see below) |
| Collect creator loyalty earnings | `withdrawPoolCreatorEarnings` |

Every setting change affects future quotes only.

## 10. Liquidity reservation and release

**On purchase:** the hedge's maximum payout moves into `reserved`, its premium into `cash` and `deferredPremium`.

**On settlement:** the reservation is released, the premium is recognised in NAV, the LP profit fee on that premium goes to the protocol, and any payout leaves pool cash and waits for the hedger to claim it. A hedger who never claims cannot hold the pool up.

**Maturity schedule:** `getPoolPositions(poolId, offset, limit)` returns every hedge with its `expiry` and `maxPayout`. Filtering for active ones and sorting by expiry gives the schedule of when reserved capital comes back. The pool also stores `latestExpiry`, the furthest-out expiry of any hedge sold.

**LP withdrawals use a notice period:**

1. `requestPoolWithdrawal(poolId, shares)` sets the unlock time to `latestExpiry`. The LP stays exposed to every hedge that was running when they asked.
2. From that moment, the value of those shares is held back from new sales, so the money is there when the notice ends.
3. `executePoolWithdrawal(requestId)` works once the unlock time has passed and every hedge expiring by then has settled. It pays shares x NAV at that moment, so gains and losses from hedges settled during the notice are shared like everyone else's.
4. `cancelPoolWithdrawal` returns the shares to the LP.

If nothing is running, the unlock time is now and the LP can withdraw immediately. Withdrawals and claims still work while the protocol is paused, matching `withdrawCapital` today. New hedges and deposits do not.

The settled check uses a per-pool cursor over UTC days, so it costs the same however many hedges a pool has sold. A pool idle for more than 400 days needs one extra call to `advancePoolSettlementCursor` before a withdrawal. When the unlock falls on the current UTC day, the withdrawal becomes available from the next day.

## 11. Active hedge immutability

At purchase, each hedge stores its own notional, spot, strike, cap, structure, direction, tenor, expiry, fair rate, premium rate, premium, fee and maximum payout. Settlement and claims read only those stored values and the fee rates fixed on the pool at creation.

None of the underwriter's controls write to a hedge. If the 30-day offer moves from 1.8% to 2.1%, hedges already sold at 1.8% are untouched, and only new quotes see 2.1%. The test suite checks this directly ("applies a price change to new quotes only").

## 12. Settlement implications

Every hedge settles on its own, at its own expiry, against the rate at that time.

- **Oracle consensus:** registered oracles call `submitPositionRate(positionId, price)` once the hedge has expired. When enough of them agree within tolerance, the hedge settles in the same transaction. This reuses the oracle registry, the required-signer count, the tolerance, the 15-minute staleness rule and the 5-minute resubmit cooldown from `BlockFinaXOracleFacet`.
- **Single-key fallback:** `settlePoolPositionByAdmin` works only while the protocol has not switched to oracle consensus, the same rule as `settleEvent`. As of 17 October 2026, `oracleV2Active` is false on both the Base and BSC Diamonds, so this path, and `settleEvent` for legacy events, is open to the oracle admin key and the owner. Calling `activateOracleV2` through the Safe closes it for good. Stellar has no such path.
- **Plausibility check:** prices outside 0.5x to 2x of the hedge's spot are rejected.
- **Oracle node:** `server/multi-oracle/oracle-node.ts` now also submits the current rate for every expired pool hedge, every poll cycle (5 minutes by default). The rate used is therefore the one observed within one poll of expiry, the same approach existing events use. It remembers its own submissions and skips a hedge inside the 5-minute cooldown rather than sending a transaction that would revert.
- **Volume:** one consensus round per hedge rather than per pool. Each oracle sends one transaction per hedge, so oracle gas grows with the number of hedges sold.
- **Claims:** `claimPoolPayout` pays the payout less the payout fee. Unclaimed payouts stay owed to the hedger indefinitely; there is no sweep for pool hedges.

## 13. Contract and backend changes

### New

| File | Purpose |
| --- | --- |
| `v1protocol/src/libraries/LibPoolStorage.sol` | Pool, tenor, hedge and withdrawal storage in its own slot. |
| `v1protocol/src/facets/pool/PoolBase.sol` | Shared modifiers and the NAV, free, holdback and capacity formulas. |
| `v1protocol/src/facets/pool/BlockFinaXPoolFacet.sol` | Pool creation, underwriter settings, LP deposits and withdrawals (10.9 KB). |
| `v1protocol/src/facets/pool/BlockFinaXPoolTradeFacet.sol` | Purchase, settlement, claims (11.3 KB). |
| `v1protocol/src/facets/pool/BlockFinaXPoolViewFacet.sol` | Reads (5.4 KB). |
| `v1protocol/test/unit/currencyPool.test.js` | 29 tests covering everything in this document. |
| `v1protocol/parity/vectors/currency-pool.v1.json` | Shared economic vectors, identical in the Stellar repo. |
| `v1protocol/test/parity/currencyPool.parity.test.js` | Runs the shared vectors against the Diamond. |
| `parity/vectors/normalized.v1.json`, `server/pricing/__tests__/normalize.test.ts` | Checks the Base backend view against the shared shape. |
| `server/multi-oracle/__tests__/oracle-node-pools.test.ts` | The oracle node's pool settlement loop. |
| `v1protocol/scripts/propose-currency-pools.js` | Deploys the facets and writes the Safe proposal. |
| `shared/currency-pool.ts` | ABI and the contract's integer maths, shared by the app and the server. |
| `server/pricing/pool-quote.ts` | Pool quotes, pool selection, tenor price tables, hedger options. |
| `server/pricing/__tests__/pool-quote.test.ts` | Shared maths and signature encoding against the contract. |

### Changed

| File | Change |
| --- | --- |
| `server/pricing/signer.ts` | `signPoolBuyQuote` and `buildPoolBuyHash`, a new payload with its own tag so it cannot be replayed as a `createEvent` or `buyProtectionQuoted` quote. |
| `server/routes/pricing.ts` | `POST /pool-quote`, `GET /pool-options`, `POST /pool-tenor-prices`. |
| `server/pricing/quote-purchase.ts` | `provider()` exported for reuse. No behaviour change. |
| `server/multi-oracle/oracle-node.ts` | Settles expired pool hedges each cycle; skips quietly where the facets are not installed; honours the cooldown. |
| `shared/currency-pool.ts`, `server/pricing/pool-quote.ts`, `server/routes/pricing.ts` | Normalized pool and hedge views, served at `GET /api/pools/:chainId/pool/:poolId` and `GET /api/pools/:chainId/positions/:hedger`. |
| `client/src/lib/hedge-contract.ts` | Methods for every pool action, reusing the existing approval, gas and smart-wallet transaction helpers. |

### Reused rather than rebuilt

- Fee config, fee snapshot at creation, the platform fee ledger and `withdrawPlatformFeesByToken`. Pool fees land in the same ledger.
- `tokenReserves` accounting, the short-delivery check on deposits, the payment token whitelist.
- The pricing engine signer key and the single-use nonce set.
- The global pause switch and the cross-facet reentrancy lock.
- The oracle registry and consensus settings.
- The fair value engine (`quote.ts`) and the oracle node.

### Not built yet

| Missing | Where it goes |
| --- | --- |
| Hedger screens for the flow in section 8 | A new page, e.g. `client/src/pages/pool-hedge.tsx`, routed in `client/src/App.tsx`, using `hedgeContract.poolOptions`, `quotePoolProtection` and `buyPoolProtection`. |
| Underwriter screens: create pool, tenor table with fair vs offer, structures, LP withdrawals, maturity schedule | A new page, e.g. `client/src/pages/pool-underwrite.tsx`, using the `pool-tenor-prices` endpoint and the pool methods on `hedgeContract`. |
| Database mirror and indexing of pools and hedges | `shared/schema.ts` plus chain sync. Today every read goes to the chain, and pool selection reads every pool on each quote, which is fine for a handful of pools but should be indexed before there are dozens. |
| Exact-second fixing rates | The oracle node submits the live rate within one poll of expiry. A historical rate lookup at the exact expiry second would need a tick-level data source. |
| End-to-end run of the server endpoints against a chain with the facets installed | The maths and signature encoding are tested on both sides, and the contracts are tested in Hardhat, but the HTTP endpoints have not been called against a deployed pool. Do this on Base Sepolia first. |

## Fees

| Fee | Basis | When | Paid to |
| --- | --- | --- | --- |
| Pool creation | Flat amount from the global config ($25 live) | When the pool is created | Treasury |
| Hedger fee | Share of the premium, paid on top | At purchase | Creator share, rest to treasury |
| LP profit fee | Share of the premium, taken from pool cash | When the hedge settles | Creator share, rest to treasury |
| Payout fee | Share of the gross payout | When the hedger claims | Creator share, rest to treasury |
| Creator share (loyalty) | Share of each fee above, at most 50% | With each fee | The pool's creator |

Rates are copied onto the pool at creation. Live values on the Base Diamond: 5% hedger, 2% LP profit, 2% payout, 5% creator share.

## Cross-chain behaviour

The Stellar implementation (`blockfinax-stellar/contracts/currency-pool`) targets the same economic outcome with chain-native internals: separate immutable Soroban contracts instead of facets, `require_auth` instead of `msg.sender`, ed25519 quotes instead of ECDSA, 7-decimal USDC instead of 6, an oracle policy enforced by the pool contract against its oracle instance instead of fixed in the facet, and storage renewed by a keeper.

What keeps them in step is `parity/vectors/currency-pool.v1.json`, an identical file in both repos with eleven scenarios and their expected economic results. Both chains run it. Amounts must agree within $0.00001; the decimal difference allows less than $0.000001 per rounding step, and both round down in the same order. Any change to pool economics on one chain should start by changing the vectors.

## 14. Migration considerations

- **Additive only.** The upgrade adds three facets with new function names. No existing selector is replaced or removed. The test fixture installs them next to every existing facet in one cut, which would fail on any name clash.
- **Storage.** All new state lives at `keccak256("blockfinax.currency.pools.v1.storage")`. `AppStorage` and `OracleStorage` are not modified, so existing events, deposits, positions and balances are untouched. New fields must be appended at the end of the `LibPoolStorage` structs.
- **Existing pools.** `HedgeEvent` pools keep working as they are. There is no automatic conversion. An underwriter who wants a currency pool withdraws from their old event after it settles and funds a new pool.
- **Shared token balance.** Pool money sits in the same Diamond balance as event money, kept apart by the existing `tokenReserves` ledger and each pool's own `cash`. The solvency test checks that the Diamond's balance equals pool cash plus creator earnings plus platform fees after a full cycle.
- **Rollout.** Run `scripts/propose-currency-pools.js` against Base Sepolia, install, and run the hedger and underwriter flows end to end. Then on Base: run the script, load the generated file in the Safe Transaction Builder, sign, wait the 48-hour timelock and call `executeCut`. BSC follows the same steps.
- **Token decimals.** BSC's payment token has 18 decimals. The contract is decimal-agnostic and the server reads decimals from the token. The 10-unit minimum on deposits and notional is in raw units, as it is for existing events, so it is effectively no minimum on BSC.
- **Rollback.** Removing the three facets' selectors stops new activity. Any funds already in pools would then be stuck until the facets are re-added, so pause sales with `setCurrencyPoolSettings` and let hedges settle and LPs withdraw before any removal.
