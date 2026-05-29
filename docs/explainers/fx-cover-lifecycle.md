# FX Cover, step by step

*A walkthrough of exactly what happens in a COVER / RESERVE position — from
mint to claim. Read this after [fx-cover-explained.md](./fx-cover-explained.md);
this one focuses on the mechanics, not the theory.*

---

## The mental model

A series of cover is one specific (pair, strike, expiry) — say USD/NGN at
strike K=1,500 expiring on June 30. For each series there is a **vault**
that holds vUSD collateral and tracks two ERC-1155 token IDs: COVER and
RESERVE.

The whole protocol is four functions on that vault:

```
mintPair        → put vUSD in, get COVER + RESERVE out
recombine       → put COVER + RESERVE in, get vUSD out (only before expiry)
settle          → freeze the oracle rate at expiry (one-time)
claim           → put COVER or RESERVE in (independently), get vUSD out
```

Everything else — the AMM, the underwriting vaults, the hedger UX — sits
on top of these four primitives.

---

## The lifecycle, on a timeline

```
T-30 ──────────────────── T-1 │ T │ T+1 ──────────── T+5min ──── forever
                              │   │
   ─────  PHASE 1  ─────      │   │   PHASE 3        PHASE 4
   Live: mint, recombine,     │   │   Settled        Claims trickle in
   AMM trades freely          │   │   Oracle rate    COVER & RESERVE
                              │   │   locked         redeem independently
                              │   │
                          PHASE 2 │
                          Frozen │
                          mint &  │
                          recomb. │
                          locked  │
                          AMM     │
                          still   │
                          trades  │
```

Four phases, three state transitions. Let me walk each one with a worked
example.

---

## Phase 1 — Live (T−30d → T)

A series has just been created. The vault is empty. Anyone can mint.

### The mint

> An underwriter, Amina, decides to write USD/NGN cover for the upcoming
> 30 days at strike 1,500. She has 1,000 USDC.

**Step 1.1 — Wrap USDC → vUSD** (one-time, optional if she already holds vUSD):

```
Amina:  1,000 USDC  →  Virtualizer
Vault:  +1,000 USDC stored
Amina:  +1,000 vUSD minted
```

**Step 1.2 — Mint the pair:**

```solidity
fxCover.mintPair(seriesId = "USD/NGN-1500-Jun30", amount = 1_000e18)
```

What the contract does:

```
1. Pulls 1,000 vUSD from Amina into the series vault.
2. Mints 1,000 COVER(series) to Amina.
3. Mints 1,000 RESERVE(series) to Amina.
4. Updates: vault.collateral += 1,000
            vault.supply     += 1,000
```

Vault state after:

| Field | Before | After |
|---|---|---|
| collateral | 0 | **1,000 vUSD** |
| COVER supply | 0 | **1,000** |
| RESERVE supply | 0 | **1,000** |

Amina's wallet:

| Token | Δ | Final |
|---|---|---|
| vUSD | −1,000 | 0 |
| COVER(series) | +1,000 | 1,000 |
| RESERVE(series) | +1,000 | 1,000 |

**Invariant check:** `COVER supply == RESERVE supply == collateral` ✓

### The sale

Amina is here to write insurance, not hold both legs. She sells COVER on
the AMM:

> Amina sells 1,000 COVER on the COVER/vUSD AMM for $0.04 each = $40 total.

```
Amina → AMM:  1,000 COVER
AMM → Amina:    40 vUSD

After:
  Amina:   40 vUSD + 1,000 RESERVE       (= the premium + the leftover)
  AMM:     pool inventory shifts toward COVER and away from vUSD
  Hedger:  bought the 1,000 COVER for $40 of vUSD
```

The vault is untouched by this trade — the AMM is a separate contract.
The vault just sees that COVER and RESERVE tokens moved between addresses.

### The trade

> Time passes. The naira drifts. The AMM price for COVER goes up and down
> as fear of depreciation changes. New underwriters mint and dump COVER;
> new hedgers buy.

The vault sees nothing during this phase unless someone mints or recombines.
Token balances change between wallets and the AMM; the vault's
`collateral` and `supply` only change at mint/recombine calls.

### Recombining early

> Day 12: Amina wants out. She buys 1,000 COVER back on the AMM (cheap, premium
> has dropped to $0.02), recombines, and walks away.

```
Amina → AMM:    20 vUSD
AMM → Amina:  1,000 COVER

Amina now holds: 20 vUSD (from her premium) + 1,000 COVER + 1,000 RESERVE
                 = $40 sold − $20 to buy back + paired position

Amina calls fxCover.recombine(seriesId, 1_000)

The contract:
  1. Burns 1,000 COVER from Amina.
  2. Burns 1,000 RESERVE from Amina.
  3. Transfers 1,000 vUSD from vault to Amina.
  4. Updates: vault.collateral −= 1,000
              vault.supply     −= 1,000
```

Net for Amina: collected $40, paid $20 to close, walked away with $20 profit
+ her 1,000 vUSD back. She wrote insurance for 12 days and exited.

**Invariant after recombine:** vault back to 0 collateral, 0 supply, all in
balance. ✓

---

## Phase 2 — Frozen (the expiry timestamp T)

At exactly `block.timestamp >= T`:

- `mintPair()` reverts. No new pairs.
- `recombine()` reverts. No undoing.
- `settle()` becomes callable.
- `claimCover()` and `claimReserve()` are still locked (need settle first).
- The AMM is **unaware** of expiry and keeps trading.

This is a one-block transition. The vault state itself doesn't change at T —
only the set of legal operations changes.

The AMM price for COVER at this moment converges sharply toward fair value.
If `e > K`, COVER is worth `1 − K/e` at expiry; arbitrageurs push the AMM
price to that. If `e ≤ K`, COVER is worth $0; price collapses.

This is also why you want settlement on a TWAP, not the spot at T: the spot
right at T can be wiggled by anyone willing to spend gas.

---

## Phase 3 — Settle (T+δ, usually within seconds)

> Day 30, time T+30 seconds: a bot calls `settle()`.

```solidity
fxCover.settle(seriesId)
```

What the contract does:

```
1. Checks block.timestamp >= series.expiry.    (must be past T)
2. Checks !series.settled.                      (only once)
3. Reads e from the oracle.                     (TWAP or spot)
4. Stores: series.settlementRate = e
            series.settled       = true
```

Let's say `e = 1,800`. The naira weakened from 1,400 → 1,800 over the month
(it crossed the 1,500 strike).

Vault state after settle:

| Field | Before | After |
|---|---|---|
| collateral | (some amount, depends on mint/recombine activity) | unchanged |
| COVER supply | (some amount) | unchanged |
| RESERVE supply | (some amount) | unchanged |
| settled | false | **true** |
| settlementRate | — | **1,800** |

**No money has moved yet.** Settle just locks in `e`.

From this moment, every outstanding COVER is worth exactly:

```
COVER per-token payout = max(0, 1 − K/e)
                       = max(0, 1 − 1,500/1,800)
                       = max(0, 0.167)
                       = 0.167 vUSD
```

And every outstanding RESERVE is worth exactly:

```
RESERVE per-token payout = min(1, K/e)
                         = min(1, 1,500/1,800)
                         = min(1, 0.833)
                         = 0.833 vUSD
```

Per-token payouts sum to **exactly 1 vUSD**. Every (COVER, RESERVE) pair has
exactly 1 vUSD waiting for it in the vault.

> ⚠ Important: settle is a **one-way** transition. Once settled, the rate
> can never change. There is no "re-settle" or "oracle correction." This is
> deliberate — it makes the contract trivially audit-able.

---

## Phase 4 — Claims (any time after settle)

Now COVER holders and RESERVE holders show up to redeem. Independently.
Whenever they want. In any order.

### The hedger claims COVER

> Day 30, T+5 minutes: the hedger calls `claimCover(seriesId, 1_000)`.

```solidity
fxCover.claimCover(seriesId, 1_000e18)
```

What the contract does:

```
1. Checks series.settled.                       (must be settled)
2. Computes payout:
   payout = amount × cover_per_token
          = 1,000 × 0.167
          = 166.67 vUSD
3. Burns 1,000 COVER from hedger.
4. Transfers 166.67 vUSD from vault to hedger.
5. Updates: vault.collateral −= 166.67
            vault.COVER supply −= 1,000
```

Vault state:

| Field | Before claim | After claim |
|---|---|---|
| collateral | 1,000 | **833.33** |
| COVER supply | 1,000 | **0** |
| RESERVE supply | 1,000 | 1,000 |

Hedger:

| Token | Δ | Final |
|---|---|---|
| COVER(series) | −1,000 | 0 |
| vUSD | +166.67 | (their pre-claim balance + 166.67) |

The hedger paid $40 for the COVER and just got back $166.67. They net
+$126.67 on a $40 investment — a 3.2× return on the protection.

### Amina (the underwriter) claims RESERVE

> Day 30, T+12 minutes: Amina sees the naira moved and braces for impact.
> She calls `claimReserve(seriesId, 1_000)`.
>
> (Wait — earlier Amina recombined on day 12. For the sake of this example
> let's pretend she didn't, and she still holds 1,000 RESERVE.)

```solidity
fxCover.claimReserve(seriesId, 1_000e18)
```

What the contract does:

```
1. Checks series.settled.
2. Computes payout:
   payout = amount × reserve_per_token
          = 1,000 × 0.833
          = 833.33 vUSD
3. Burns 1,000 RESERVE from Amina.
4. Transfers 833.33 vUSD from vault to Amina.
5. Updates: vault.collateral −= 833.33
            vault.RESERVE supply −= 1,000
```

Vault state:

| Field | Before claim | After claim |
|---|---|---|
| collateral | 833.33 | **0** |
| COVER supply | 0 | 0 |
| RESERVE supply | 1,000 | **0** |

Amina:

| Token | Δ | Final |
|---|---|---|
| RESERVE(series) | −1,000 | 0 |
| vUSD | +833.33 | (her balance + 833.33) |

Amina's full position:

| Source | Amount |
|---|---|
| Initial collateral | −1,000 |
| Premium from selling COVER | +40 |
| RESERVE redemption | +833.33 |
| **Net P&L** | **−126.67** |

Net `−126.67` exactly equals the hedger's net `+126.67`. The collateral
was redistributed perfectly between them via the strike rule, with the
premium being the side-payment for who-bears-which-risk.

---

## The invariant in motion

Watch the math work across all four phases. Track the vault's three
numbers: `collateral`, `COVER supply`, `RESERVE supply`.

| Event | collateral | COVER | RESERVE | Notes |
|---|---|---|---|---|
| Series created | 0 | 0 | 0 | empty |
| Amina mints 1,000 | 1,000 | 1,000 | 1,000 | invariant holds |
| Amina sells 1,000 COVER to AMM | 1,000 | 1,000 | 1,000 | (vault unaware of AMM trade) |
| Hedger buys 1,000 COVER from AMM | 1,000 | 1,000 | 1,000 | still unaware |
| Day 12: Amina recombines 0 (didn't recombine) | 1,000 | 1,000 | 1,000 | |
| **Settle at e=1,800** | 1,000 | 1,000 | 1,000 | rate locked |
| Hedger claims 1,000 COVER | 833.33 | 0 | 1,000 | hedger paid 0.167 × 1,000 |
| Amina claims 1,000 RESERVE | 0 | 0 | 0 | Amina paid 0.833 × 1,000 |

Notice: **`collateral` was always ≥ remaining liability**, never less.
After every event the invariant `collateral ≥ outstanding_cover_payout +
outstanding_reserve_payout` holds.

That's the property that means the protocol is mathematically solvent
without coordination. It can never run out of vUSD to satisfy claims, no
matter who claims first, who never claims, or who exits early.

---

## Edge cases

### What if a holder never claims?

Their tokens sit in their wallet forever. The vault keeps holding the
corresponding vUSD. Unclaimed COVER and RESERVE are permanent claim
tickets — the contract never expires them.

(Optionally: after a long time — say 1 year — a governance call can sweep
the unclaimed balance to a treasury. This is a policy choice, not a
mechanism requirement. The math works either way.)

### What if someone sells COVER on the AMM after settle but before claiming?

Totally fine. COVER is still a normal ERC-20 (via the lazy wrapper).
Anyone holding it can claim. The AMM price for COVER post-settle should be
exactly equal to the per-token payout (0.167 vUSD in our example) — any
gap creates a free arbitrage that closes in one block.

This is actually useful: if a hedger doesn't want to wait for the claim
process or doesn't want to pay gas, they can just sell to an arbitrageur
who'll do the claim for them.

### What if `settle()` is never called?

Then `claimCover()` and `claimReserve()` revert. Funds are stuck. To
prevent this, the protocol can:

- Pay a small bounty (10 bps) to the first `settle()` caller — makes it a
  permissionless action with positive incentive
- Run a backup keeper bot that calls `settle()` on every series at T+δ
- Allow anyone to call settle for any series past expiry, with no
  permission check

In practice, settle bounties are the cleanest solution. The bounty comes
from a small slice of the vault collateral.

### What if the oracle is wrong at settle?

This is the most important risk. Mitigations stack:

1. **Use a TWAP, not spot.** Settle against the average of the oracle over
   the last hour ending at T. A single bad print can't move a 60-block
   average meaningfully.
2. **Settlement window.** Make settle callable any time in `[T, T+24h]`
   rather than only at exactly T. This means an attacker can't predict the
   single block at which to manipulate.
3. **Circuit breaker.** If the oracle prints a >50% move from the last
   read, pause settlement for 24h to let governance intervene.
4. **Multiple oracles.** Aggregate Chainlink, your own pricing engine, and
   a parallel-market source. Settle against the median.

None of these are exotic. All have been done before in other DeFi
primitives. Pick the right combination per pair.

### What if `recombine()` is called with mismatched amounts?

Reverts. The contract enforces "burn equal amounts of COVER and RESERVE
for each unit of vUSD returned." There is no way to recombine 100 COVER
with 80 RESERVE and get $90 back — the function signature takes one
`amount` and burns that many of each.

This is a key safety property. If recombine accepted mismatched amounts,
the supply invariant would break.

---

## Closing the loop

Putting it all together for one series with one hedger and one underwriter:

```
Day -30  Series USD/NGN-1500-Jun30 created (collateral: $0)

Day 0    Amina deposits 1,000 USDC → mints (1,000 COVER + 1,000 RESERVE)
         Vault: collateral $1,000, supply 1,000

Day 0    Amina sells 1,000 COVER on AMM → receives $40 vUSD
         (Vault state unchanged — AMM trade)

Day 0    Hedger buys 1,000 COVER from AMM → pays $40 vUSD
         (Vault state unchanged — AMM trade)

Day 1-29 Naira drifts from 1,400 → 1,800. AMM premium ebbs and flows.
         (Vault state unchanged)

Day 30   Expiry (T). Mint/recombine close. AMM still trading.

Day 30   Settle bot calls settle(). Oracle reports e=1,800.
+30s     settlementRate = 1,800, settled = true.
         Per-token payouts now fixed: COVER=$0.167, RESERVE=$0.833.

Day 30   Hedger calls claimCover(1,000). Burns 1,000 COVER.
+5min    Hedger receives $166.67 vUSD.
         Vault: collateral $833.33, COVER supply 0, RESERVE supply 1,000.

Day 30   Amina calls claimReserve(1,000). Burns 1,000 RESERVE.
+12min   Amina receives $833.33 vUSD.
         Vault: collateral 0, COVER supply 0, RESERVE supply 0.

End state:
  Vault: empty. All collateral redistributed.
  Hedger PnL:  −$40 (premium) + $166.67 (claim)  = +$126.67
  Amina PnL:   +$40 (premium) + $833.33 (claim) − $1,000 (collateral) = −$126.67
  System total: $0. Zero-sum trade, fully collateralised, no leftover.
```

That's the entire mechanic. The four primitives — `mintPair`, `recombine`,
`settle`, `claim` — compose into a robust, solvent, oracle-settled
insurance market with no liquidations and no margin calls.

---

## Why this design choice matters

A common alternative is **"strike-touched binary payout"** — at expiry, if
`e > K`, the position pays a fixed amount; if not, zero. This is what
today's BlockFinaX does.

The COVER/RESERVE design is structurally better in four ways:

1. **Continuous payoff.** A binary trigger has a sharp cliff at the
   strike. A hedger who picked K=1,500 gets nothing if the rate ended at
   1,499 and the full payout if it ended at 1,501. The COVER design pays
   smoothly with no cliff — `max(0, 1 − K/e)` is continuous in `e`.

2. **No oracle gaming at the trigger.** A binary trigger creates strong
   incentives to nudge `e` across the strike at exactly T. The COVER
   design has the same incentive in principle, but the payoff is so much
   smaller near the strike that the manipulation isn't profitable.

3. **No buyer needed at expiry.** A binary trigger has the same property,
   but the COVER design extends it: even in early-exit cases, the AMM
   prices COVER off its known terminal payoff, so prices are bounded and
   sane. Binary triggers don't have an obvious arbitrage anchor before
   expiry — premium can drift far from "fair value."

4. **Independent claims.** With a binary trigger, you typically need both
   sides to participate in settlement at the same time. With COVER /
   RESERVE the two sides redeem independently.

The COVER design is more code and more concepts to understand. But it's
also more financially correct, easier to audit, and easier to integrate
with the rest of DeFi.

---

## TL;DR (for the cofounder)

- **Mint:** deposit vUSD, get equal amounts of COVER and RESERVE
- **Recombine:** burn equal amounts of both, get vUSD back (only before expiry)
- **Settle:** one-time call after expiry that locks the oracle rate
- **Claim:** independently redeem COVER or RESERVE for their per-token payout

The vault always has exactly enough vUSD to satisfy outstanding claims —
this is provable from the invariant `COVER supply == RESERVE supply ==
collateral` plus the math `cover_payout + reserve_payout = 1`.

No coordination required. No liquidations. No margin calls. No "the
protocol went insolvent." The worst case is a bad oracle print, mitigated
by TWAP + circuit breakers + settlement windows.

This is the entire mechanic in 4 functions and 1 invariant. Everything
else — UX, vaults, AMM integrations, multi-pair support — is layered on
top of these primitives.

---

*Draft. Concept only. Not financial advice.*
