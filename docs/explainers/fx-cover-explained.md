# FX Cover, explained simply

*A friendlier walkthrough of the COVER / RESERVE design — same idea, less notation.
Read this in 15 minutes; share with someone smart who doesn't think in options.*

---

## The two-line version

You lock $1. It splits into two tokens that **always add back to $1**: one is the
insurance (COVER), one is what the seller keeps (RESERVE). The hedger buys
COVER. The price is set by a market. At the expiry date, COVER pays out from
the dollar that was locked — no buyer required.

That's the whole thing. The rest of this doc is unpacking that into the
specifics.

---

## 1. Why this exists

A trader in Lagos earns naira and pays a supplier in USDC at the end of the
quarter. If the naira drops 20% between now and then, they take a 20% margin
hit. They want insurance.

In TradFi, the bank sells them an **FX option**: pay a small premium now, get a
payout if the rate moves past a strike price. Banks rarely offer this to small
businesses in emerging markets — the regulatory and KYC overhead kills the
trade. Even when they do, the spreads are 12–25%.

The goal of FX Cover is to build that same instrument on-chain:

- Anyone can buy protection. No KYC tier check, no minimum size.
- Anyone with USDC can sell protection and collect the premium.
- The contract holds the collateral. No counterparty risk.
- The market sets the price. No off-chain pricing engine to trust.

The price/structure target is **a fully-funded cash-settled FX cap**. If that
phrase means nothing to you, ignore it — the design is its own thing and we'll
build the intuition from scratch.

---

## 2. The setup

Five moving pieces:

| | What it is |
|---|---|
| **vUSD** | Wrapped USDC, 1-for-1. Just "a dollar inside the protocol." |
| **Oracle** | Publishes the exchange rate `e` on-chain — how many naira (or shillings, or cedis) one dollar costs. This decides payouts. |
| **COVER** | The insurance token. Hedger buys this. |
| **RESERVE** | The mirror token. Underwriter (seller) keeps this. |
| **AMM** | Where COVER trades against vUSD. The market sets the premium. |

One piece of notation everyone needs: `e` = local currency units per dollar.
If today $1 = ₦1,500 then `e = 1,500`. If naira weakens to $1 = ₦1,800 then
`e = 1,800` (the number went **up**, the naira got **weaker**).

---

## 3. The split

For each (currency pair, strike `K`, expiry `T`):

```
1 vUSD  →  1 COVER(K, T)  +  1 RESERVE(K, T)
```

And it's reversible at any time before expiry:

```
1 COVER(K, T)  +  1 RESERVE(K, T)  →  1 vUSD
```

The strike `K` is the line in the sand — the rate where protection kicks in.
The expiry `T` is when we settle. Both are fixed when you mint.

So far this is just "split a dollar into two tokens." The magic is in **how
they pay at expiry**.

---

## 4. The payoff (the math, in plain numbers)

On the expiry date, oracle reads the rate `e`. The two tokens redeem for:

```
COVER pays   = max(0, 1 − K/e)    dollars
RESERVE pays = min(1, K/e)        dollars
```

The two **always sum to exactly 1 dollar**. That's the property that makes the
system safe by construction — every claim is already funded.

Let's just walk through this with K = 1,500 (a USD/NGN strike):

| Rate at expiry | What naira did | COVER pays | RESERVE pays | Sum |
|---|---|---|---|---|
| `e = 1,400` | Naira *strengthened* | $0.000 | $1.000 | 1.000 |
| `e = 1,500` | Exactly at the strike | $0.000 | $1.000 | 1.000 |
| `e = 1,650` | Naira weakened 10% past strike | $0.091 | $0.909 | 1.000 |
| `e = 1,800` | Weakened 20% past strike | $0.167 | $0.833 | 1.000 |
| `e = 2,250` | Weakened 50% past strike | $0.333 | $0.667 | 1.000 |
| `e = 3,000` | Naira halved vs strike | $0.500 | $0.500 | 1.000 |
| `e = ∞` | Naira went to zero | $1.000 | $0.000 | 1.000 |

Two things to notice:

1. **COVER caps at $1.** It can never pay more than the dollar that was
   originally locked. That cap is the whole reason the system can be
   fully-funded with no margin calls.
2. **Below the strike, COVER pays zero.** The naira didn't weaken past the
   line. The insurance wasn't needed. The seller keeps everything.

### The intuition behind the formula

One COVER token protects the dollar value of **K shillings** (or naira, or
cedis — same idea for any pair).

- At rate `K`, K shillings = exactly $1.
- At a worse rate `e > K`, K shillings = `K/e` dollars. That's *less* than $1.
- The loss is `1 − K/e`.
- That's exactly what COVER pays.

So buying 1,000 COVER hedges `K × 1,000` shillings of exposure (relative to
the strike). For our K = 1,500 example, 1,000 COVER hedges 1,500,000 NGN of
exposure (about $1,000 at the strike rate).

This is the entire conceptual basis. The complicated-looking formula is just
"compensate the holder for the dollar value lost when their local currency
weakens past a defined line."

---

## 5. How the price is set

COVER is just an ERC-20 trading against vUSD on an AMM. Whatever people pay
for it is the premium. When fear of currency depreciation rises, demand for
COVER rises, and the premium moves up. That's the "market sets the price"
behaviour.

But the price can't go anywhere crazy. The split puts hard fences around it:

```
max(0, 1 − K/e_now)  ≤  premium  ≤  1
        intrinsic                cap
```

**Premium can never go above $1.** Nobody pays $1.05 for a token that pays at
most $1. If the AMM price tried to drift above $1, an underwriter would just
mint a fresh pair (which costs them $1) and sell COVER into the bubble.
Arbitrage closes the gap immediately.

**Premium can never fall below intrinsic.** If COVER is already in the money
(`e_now > K`), it's already worth at least `1 − K/e_now`. If the AMM tried to
sell it cheaper, someone would buy it, hold to expiry, and pocket the
guaranteed profit. Arbitrage closes that gap too.

So:

```
premium  =  intrinsic value  +  time value
              ───────                ───────
              how in-the-money       fear, vol, time remaining
              it already is          (the bit the AMM discovers)
```

This is exactly how every option you've ever heard of works. The clever part
of the design is that the split mechanically enforces the bounds — you don't
need an oracle, you don't need a price model, the arbitrage is automatic.

---

## 6. The roles

There are three economic actors:

### Hedger (insurance buyer)
- Has FX exposure they want to protect
- Buys COVER on the AMM
- Either holds to expiry (gets paid by oracle) or sells back early (gets paid by AMM)
- Maximum loss: the premium paid
- Maximum gain: $1 per COVER (in the limit)

### Underwriter (insurance seller)
- Has USDC they're willing to put at risk for yield
- Locks vUSD → gets COVER + RESERVE
- Sells COVER on the AMM, collects the premium
- Keeps RESERVE
- At expiry: profit = premium collected − payout
- Maximum gain: the full premium (if COVER expires worthless)
- Maximum loss: $1 per RESERVE minus what they collected (currency goes to zero)

### LP (market-maker for the COVER/vUSD pool)
- Provides liquidity to the AMM so trades can happen
- Earns swap fees (~0.3% per swap, like Uniswap V2)
- Takes impermanent loss as COVER's price moves
- Often the same person as the underwriter — they LP both legs

---

## 7. A worked example

Setup:

- Pair: USD/NGN
- Strike: K = 1,500
- Expiry: 30 days from today
- Today's rate: e₀ = 1,400 (naira is currently stronger than the strike, so
  COVER is "out of the money")
- AMM premium for COVER(1500, 30d): **$0.04** (4%)

A hedger has 1,500,000 NGN of exposure (about $1,071 at today's rate) and
wants to protect against further weakness. They buy **1,000 COVER for $40**
(`1,000 × $0.04`).

An underwriter has put up $1,000 of collateral, minted (1,000 COVER + 1,000
RESERVE), and sold their 1,000 COVER for $40. They now hold:
- $40 in vUSD (the premium)
- 1,000 RESERVE (waiting for expiry)

### What happens at expiry

**Scenario A — naira weakens to e = 1,800**

```
COVER pays each = 1 − 1,500/1,800 = 1 − 0.833 = $0.167
RESERVE pays each =                                $0.833
```

| Actor | Inflow | Outflow | Net |
|---|---|---|---|
| Hedger | +$167 (1,000 × $0.167) | −$40 premium | **+$127** |
| Underwriter | +$40 premium, +$833 (1,000 × $0.833) RESERVE | −$1,000 collateral | **−$127** |

The hedger's 1.5M NGN dropped in dollar value from $1,071 to $833 — a $238
loss. COVER paid out $127. They're not made whole, but they're better off
than the $238 they'd have eaten unhedged.

The underwriter loses $127 net — exactly equal to the hedger's gain (it's a
zero-sum trade between them, with the collateral fully covering both sides).

**Scenario B — naira holds at e = 1,400**

```
COVER pays each = max(0, 1 − 1,500/1,400) = max(0, −0.071) = $0.000
RESERVE pays each =     min(1, 1,500/1,400) = min(1, 1.071) = $1.000
```

| Actor | Inflow | Outflow | Net |
|---|---|---|---|
| Hedger | $0 | −$40 premium | **−$40** |
| Underwriter | +$40 premium, +$1,000 RESERVE | −$1,000 collateral | **+$40** |

Hedger lost the premium — like car insurance they didn't end up needing.
Underwriter pocketed it as profit, like an insurer with no claim.

Notice in both scenarios: **`COVER payout + RESERVE payout = $1 always`**.
The locked dollar covered everything by construction.

---

## 8. Why this is safe — formally

Three invariants the contract enforces:

```
1. Total COVER outstanding  =  Total RESERVE outstanding
   (they're minted and burned in pairs)

2. For every COVER outstanding, exactly 1 vUSD is locked in the vault.

3. At expiry, for every (COVER, RESERVE) pair:
   payout(COVER) + payout(RESERVE) = 1 vUSD   ← always
```

So at any moment in time, total claims on the protocol ≤ total vUSD locked.
There is no scenario in which the protocol owes more than it holds. This is
not a "trust the model" property — it's a property of the arithmetic.

**Consequence: no liquidations, ever.** No margin calls, no oracle-induced
cascades, no "the protocol went insolvent." The worst case for the protocol
is that the oracle gives a bad number — and even then, the *total* paid out
is still exactly 1 vUSD per pair. The bad oracle just redistributes between
COVER holders and RESERVE holders. The collateral is safe.

---

## 9. The most important property: no buyer needed for the payout

This is the bit that's easy to miss but is the actual breakthrough vs naive
designs.

Imagine a simpler design where "the hedger profits if they can sell COVER
later for more than they paid." That sounds fine in calm markets. But the
moment there's actual stress — the moment the hedger needs the payout —
buyers vanish. AMMs dry up. Liquidity providers pull out. The token is
"worth a lot" on paper but no one wants to be the bagholder at $1. The
hedger is left holding an "in-the-money" token they can't liquidate.

In **FX Cover, the payout doesn't come from a buyer.** It comes directly
from the locked vUSD, triggered by the oracle at expiry. The hedger doesn't
need to find a counterparty — the protocol pays them from the collateral
that was set aside on day 1.

The AMM exists for *entry and early exit*. The *payoff* is independent of it.

This is what makes the design work as actual insurance instead of a
speculation token dressed up as insurance.

---

## 10. The oracle question (this matters more than you'd think)

What rate does the oracle publish? This isn't a footnote — it defines what
product you're actually selling.

For each pair you support, you have to pick a rate source:

### Floating, liberalised pairs (USD/EUR, USD/ZAR, USD/MXN)

The official market rate ≈ the real economic rate. Standard FX oracle is
fine. Use ExchangeRate-API, CoinGecko, Yahoo Finance, or aggregate
several. COVER buyers and sellers get sensible protection.

### Capital-controlled pairs (USD/NGN, USD/EGP, USD/GHS pre-2024)

**Do not settle on the official peg.** This is the most important rule in
the whole design.

Imagine settling USD/EGP cover against the Egyptian central bank rate. For
years, that rate was frozen at ~30.9 EGP/USD by decree. Meanwhile the real
parallel-market price was 50–60 EGP/USD. A hedger who bought COVER would
have seen `e` stay frozen at 30.9, COVER expire worthless every month,
and lose every premium they paid — even though the real cost of dollars in
Egypt had doubled.

That's not insurance. That's a Ponzi for the underwriter.

For capital-controlled pairs, use one of:

- **A robust parallel-market feed** — aggregate Binance P2P, AbokiFX,
  Yellowcard, NoOnes etc. Take a TWAP. This is "hard, unglamorous work" but
  reflects reality.
- **The protocol's own market rate μ** — if you've also built a vFiat
  market (Virtual-Finance-style), settle against the μ that market
  discovers. This is on-ethos, but it creates **reflexivity**: stress in
  the FX market makes cover more expensive, which can feed back into
  vFiat. Use a 7-day TWAP of μ, not the spot, to break the loop.

The trade-off: settling on the official rate sells insurance against
**discrete devaluations** (Nigeria's 2023 unification, Egypt's March 2024
step) — lumpy but real. Settling on a market rate sells insurance against
**continuous depreciation** — the right product economically, but the
on-chain feed is the hard part.

There's no one right answer. Decide per pair. Be honest with users about
what they're getting.

---

## 11. The underwriting side, in detail

When an underwriter shows up with USDC, what do they actually do?

### Single-strike underwriting (the simple version)

```
1. Underwriter deposits N vUSD into the FX Cover contract for strike K, expiry T.
2. Contract mints N COVER(K, T) + N RESERVE(K, T) to the underwriter.
3. Underwriter sells COVER on the AMM at the going premium P.
4. Underwriter now holds: N × P vUSD (premium) + N RESERVE.
5. At expiry, oracle reads e. Underwriter redeems RESERVE for
   N × min(1, K/e) vUSD.
6. Final position = (N × P) + (N × min(1, K/e))
                  =  premium + RESERVE redemption
```

If COVER expires worthless (`e ≤ K`), their final position is `N × (P + 1)`
— they got the premium *and* their full collateral back. The premium is
pure profit on idle capital.

If COVER expires in the money, the underwriter takes the loss equal to
`N × max(0, 1 − K/e)`, partially offset by the premium they collected.

### Multi-strike vault (the realistic version)

A sophisticated underwriter doesn't want to babysit one strike. They want
to deposit once and have their capital spread across a band of strikes.

```
Vault contract:
  takes N vUSD, expiry T, range [K_low, K_high]
  for each strike K in {K_low, K_low+step, ..., K_high}:
    mint (N/k) COVER(K, T) + (N/k) RESERVE(K, T)   ← k = number of strikes
    sell COVER on AMM at going premium
    keep RESERVE
  issues 1 vault token to LP = pro-rata claim on:
    - every premium collected
    - every RESERVE redemption at expiry
```

This is a **basket of cover-writing positions**, not Uniswap V3
concentrated liquidity. The earlier v3 framing in some design notes was
misleading. The cleaner mental model: **it's a diversified insurance
book**. The LP earns a blended yield across all strikes in their band.

---

## 12. Underwriter economics — is the premium enough?

This is the question every potential underwriter will ask. Numbers.

**Required return =  expected payout  +  capital cost  +  risk premium**

| Pair class | Realised σ | Premium % (1m, ATM) | Expected payout % | Net edge | Annualised return |
|---|---|---|---|---|---|
| USD/EUR | 7% | 0.4% | 0.3% | 0.1% | ~1–5% |
| USD/ZAR, USD/KES | 12–18% | 1.5–2.5% | 1.0–1.8% | 0.5–0.7% | ~10–20% |
| USD/NGN, USD/EGP | 25–45% | 4–8% | 2.5–6% | 1.5–2% | **~30–80%** |

Two clear conclusions:

1. **Don't launch with USD/EUR.** The premium is too thin to compensate
   anyone. Banks already arbitrage these efficiently.
2. **Frontier EM is where the protocol earns its keep.** Premium income of
   30–80% APY is multiples of any stablecoin yield (5–10%), tokenised
   T-bills (4–5%), or LP positions (5–15%). The risk is real — lumpy P&L,
   capital lockup — but the compensation matches.

The right mental model for the underwriter is **a global insurance pool
underwriting frontier-currency risk**. The premium isn't payment for
providing liquidity; it's payment for taking on a specific tail risk that
banks won't touch.

---

## 13. Strike and expiry choices

### Strikes

Don't offer a dense grid. Offer **3–5 deep strikes per pair**:

- One ATM (today's rate)
- 1–2 slightly OTM (5%, 10% above today)
- 1–2 deep OTM (20%, 30% above today)

Reasons:
- **Liquidity quality.** Each strike has its own AMM pool. A dense grid
  splits the same vUSD across 20 shallow pools — manipulable, noisy
  premiums. Few deep pools give real price discovery.
- **Gas.** Each pool costs gas to bootstrap and trade in. Don't be wasteful.
- **Roll with the market.** When today's rate moves significantly, retire
  the now-deep-ITM strike and add a new one above. Hedgers should always
  have a near-the-money option available.

### Expiries

Start with **monthly fixed expiries**. They're simple:
- Settlement is a discrete event with a clear oracle read
- The "intrinsic floor" converges automatically as expiry approaches
- No funding rate to manipulate
- Easy to UX ("when does this expire?" has a clear answer)

**Perpetual cover** is the better product long-term — no roll-over
friction, no token sprawl. But it needs a funding stream (longs pay shorts
based on the time-value of the option) and the funding mark is
manipulable on thin liquidity. Ship monthlies first. Move to perpetual
only when:
- The funding mark uses a TWAP of an external feed (not the COVER pool's own spot)
- You've simulated the funding flow under stress
- You have enough TVL that manipulation costs more than the funding it could skim

---

## 14. How this differs from BlockFinaX's existing cover

Quick comparison so the cofounder can place it:

| | Existing BlockFinaX | FX Cover (this design) |
|---|---|---|
| Position type | NFTs (illiquid, single-use) | ERC-20s (composable, tradeable) |
| Payoff shape | Binary — pays a capped amount when strike is touched | Continuous — `max(0, 1 − K/e)`, more loss = more payout |
| Premium pricing | Off-chain Garman-Kohlhagen + EWMA vol, signed attestation | AMM-discovered, no off-chain engine |
| LP risk profile | Bounded by per-position payout cap | Bounded by $1 per COVER, but more complex P&L |
| Settlement | Oracle check at expiry against published rate | Same — oracle check at expiry against chosen feed |
| Token surface | One pool per event | One pair per (currency, strike, expiry) |

They're **complementary, not competing**. The existing product is right
for "hedge my specific Q3 NGN invoice" use cases. FX Cover is right for
"sell ongoing depreciation insurance" and "build an FX cap structure."

Both can live in the same Diamond as separate facets, share the same
vUSD/USDC collateral pipeline, and share the same oracle infrastructure.

---

## 15. Implementation, at a glance

Three things you'd build:

### 1. The mint/burn vault (one facet)

```solidity
function mintPair(bytes32 seriesId, uint256 vusdAmount) external {
    _transferIn(vUSD, msg.sender, vusdAmount);
    _mint(COVER, seriesId, msg.sender, vusdAmount);
    _mint(RESERVE, seriesId, msg.sender, vusdAmount);
}

function recombine(bytes32 seriesId, uint256 amount) external {
    _burn(COVER, seriesId, msg.sender, amount);
    _burn(RESERVE, seriesId, msg.sender, amount);
    _transferOut(vUSD, msg.sender, amount);
}

function redeem(bytes32 seriesId, uint256 amount) external onlyAfterExpiry(seriesId) {
    uint256 e = oracle.settlementRate(seriesId);
    uint256 K = series[seriesId].strike;
    uint256 coverShare = amount * max(0, 1e18 - (K * 1e18 / e));
    uint256 reserveShare = amount * min(1e18, K * 1e18 / e);
    // Pay COVER and RESERVE holders their share
}
```

### 2. The token store

One ERC-1155 contract holding all (pair, K, T) balances, with thin ERC-20
wrappers deployed lazily for series that get an AMM market. The ERC-1155
approach saves you from deploying hundreds of contracts.

### 3. The AMM (off the shelf)

Don't build it. List each `(COVER/vUSD)` pair on an existing AMM —
Aerodrome on Base, PancakeSwap on BSC, Velodrome on Optimism. You get:
- Battle-tested code
- Existing LP user base
- Liquidity mining programmes
- Aggregator routing for free

You only need to build a custom AMM if you want to capture the swap fees
yourself or do something weird with the bonding curve. v1 should just plug
into existing rails.

---

## 16. Open questions worth pressing on

A short list of things this doc doesn't fully solve:

- **Roll mechanics.** Who triggers retirement of stale strikes? Permissionless
  with an X% spot-movement threshold, or governance-gated?
- **Oracle circuit breakers.** If the oracle prints a 50%+ move in one update,
  do we settle immediately or pause for 24h? Cheap insurance against
  catastrophic bad prints.
- **Bootstrap liquidity.** Who provides initial COVER/vUSD AMM liquidity?
  Probably the protocol itself with treasury USDC, gradually transitioned to
  organic LPs.
- **Underwriter onboarding.** How do early underwriters get comfortable with
  the lumpy P&L? Maybe start with a small whitelisted pool of sophisticated
  underwriters for the first 6 months, then open up.

None of these are blockers — they're knobs to set during build.

---

## TL;DR for the cofounder

- One dollar locks → splits into COVER (insurance) + RESERVE (the seller's
  share). They always sum to a dollar. By construction, fully collateralised.
- Payoff at expiry: `COVER = max(0, 1 − K/e)`, `RESERVE = min(1, K/e)`,
  with `e` = local currency per dollar at expiry.
- AMM sets the premium. Bounded above by $1 (the cap) and below by intrinsic
  value (the arbitrage floor).
- The breakthrough: at expiry the oracle pays out from locked collateral.
  The hedger does **not** need a buyer. The AMM is for entry/exit only.
- The oracle choice defines what product you sell. Never settle on the
  official peg for capital-controlled currencies — it produces fake insurance.
- Ship monthly expiries first, perpetual later (needs careful funding mark).
- Underwriter economics: yields of 30–80% APY on frontier EM pairs, well
  above any passive yield benchmark. The compensation is real because the
  risk is real and banks won't write it.
- Sits cleanly alongside the existing BlockFinaX cover product as a separate
  facet, not a replacement.

If we ship this, BlockFinaX stops being a niche options marketplace and
becomes **the on-chain infrastructure for FX depreciation risk in markets
banks won't touch.** That's a bigger thesis than "options for crypto traders"
and the design is engineered to be safe enough to ship.

Read this once, push back on whatever feels weak, then we move to a build
spec.

---

*Draft. Concept only. Not financial advice.*
