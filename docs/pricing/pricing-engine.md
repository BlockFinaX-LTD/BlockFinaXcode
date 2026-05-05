# The Pricing Engine: Data Sources and Formulas

A complete reference for what the pricing engine needs, where to get it, how to compute prices, and how to put it all together. Read end-to-end for the full picture or jump to specific sections.

---

## 1. What the Engine Does

The pricing engine takes event parameters (pair, range, expiry, notional) plus current market data (spot, rates, vol) and outputs a fair premium. The premium is what the hedger pays to buy protection.

**The basic question:** given these market conditions, what's the mathematically fair price for this protection?

**The basic formula:** for any option-like product,

```
fair premium = expected payout × (correction for time value of money)
```

Everything else in this document is the machinery to compute "expected payout" properly.

---

## 2. The Six Inputs

Every option pricing model needs the same building blocks. For G10 pairs you can get away with five (the textbook Garman-Kohlhagen list). For frontier EM pairs you need a sixth: an empirical drift estimate that replaces the broken interest-rate-parity assumption (see §3.5). There are no shortcuts.

| # | Symbol | Input | Source |
|---|---|---|---|
| 1 | S | Spot rate of the pair right now | Live oracle data |
| 2 | K | Strike (or both ends of a range) | Event parameter |
| 3 | T | Time to expiry, in years | Event parameter |
| 4 | r, q | Risk-free rates of both currencies | Rate oracle |
| 5 | σ | Volatility — annualized standard deviation of returns | Vol oracle |
| 6 | μ | Empirical drift — historical annualized log-return of S | Drift oracle (EM only) |

Inputs 2 and 3 come from the event itself — free.

Input 1 is partially solved by the existing oracle architecture.

Inputs 4, 5, and 6 are where real data sourcing work happens. Input 6 is computed from the same historical price feed used for realized vol (§6.4.5), so the marginal data cost is zero — the only work is the calculation.

For G10 / liquid-NDF pairs, input 6 is redundant: the rate differential (r − q) and the empirical drift agree to within noise, and you can pass either. **For frontier EM, the two diverge by tens of percent annualized**, and using the rate differential gives nonsensical premiums (see §3.5 for the proof and the fix).

---

## 3. The Pricing Formulas

### 3.1 Vanilla Black-Scholes for FX (Garman-Kohlhagen)

The FX adaptation of Black-Scholes is called **Garman-Kohlhagen** in the literature — same formula structure, two interest rates instead of one. Use that name when searching papers; "Black-Scholes for FX" is colloquial.

For a vanilla call option (right to buy base currency at K):

```
C = S × e^(-q·T) × N(d1) - K × e^(-r·T) × N(d2)
```

For a vanilla put option (right to sell base currency at K):

```
P = K × e^(-r·T) × N(-d2) - S × e^(-q·T) × N(-d1)
```

Where:

```
d1 = [ln(S/K) + (r - q + σ²/2)·T] / (σ·√T)
d2 = d1 - σ·√T
```

And `N()` is the standard normal cumulative distribution function (CDF).

These are the two building blocks. Every other product we price is built from combinations of vanilla calls and puts.

**The single most important thing to know about this formula:** the term `(r − q)` is the *drift* the model assumes for the underlying. It encodes interest-rate parity (IRP): the forward rate `F = S × e^((r−q)·T)`. **For G10 pairs IRP holds** because covered-interest arbitrage is liquid and freely tradable. **For most EM pairs IRP does not hold** because of capital controls, NDF dislocations, and the fact that high local rates are compensating expected currency depreciation rather than indicating future appreciation. Section 3.5 explains how to fix this. Read §3.5 before pricing any EM pair in production.

### 3.2 Digital Options

A digital call pays a fixed amount if the rate is above the strike at expiry. A digital put pays if below.

```
Digital call premium = payout × e^(-r·T) × N(d2)
Digital put premium  = payout × e^(-r·T) × N(-d2)
```

These are simpler than vanillas but have ugly gamma profiles, which is why we don't recommend them as the default product.

### 3.3 Call Spreads (the recommended default product)

A call spread buys protection in a range [K_lower, K_upper]. It pays out for the move within the range, capped at the top.

The fair premium is the difference between two vanilla calls:

```
Call spread premium = vanilla_call(S, K_lower, T, r, q, σ) - vanilla_call(S, K_upper, T, r, q, σ)
```

For downward protection (the hedger wants protection if the rate falls), use a put spread:

```
Put spread premium = vanilla_put(S, K_upper, T, r, q, σ) - vanilla_put(S, K_lower, T, r, q, σ)
```

These are the formulas for the bulk of products the protocol will price.

### 3.4 Why Call Spreads Are the Right Default

Three reasons, all from the math:

**1. Bounded payout.** Maximum payout is `(K_upper - K_lower)/S × notional` — a known, bounded number that the underwriter must collateralize. No tail risk.

**2. Smooth gamma.** Gamma peaks at K_lower and K_upper but is low everywhere else. Compare to a digital, which has infinite gamma at the strike.

**3. Forgiving to vol errors.** If your vol estimate is 20% off, the call-spread premium is wrong by a small amount. The same vol error on a digital can be catastrophic.

### 3.5 The EM Drift Correction (Required for Frontier FX)

This is the single most important correction in the entire document. Skipping it means systematically losing money on every EM event.

#### Why naïve Garman-Kohlhagen fails for EM

Plug typical USD/GHS values into the formula above:

- S = 11 GHS/USD (spot)
- r = 5% (USD rate)
- q = 26% (GHS rate)

The model's implied forward rate is `F = 11 × e^((0.05 − 0.26) × T)`. Over 90 days that's `F = 10.43` — i.e. the model says **USD will get cheaper relative to GHS over the next quarter**.

Empirically, the opposite has been true for most of the last decade. USD/GHS appreciates ~10–20% per year on average; high GHS rates aren't compensating you for holding GHS, they're compensating you for the expected depreciation. Black-Scholes treats the rate differential as an arbitrage-free drift signal, but the arbitrage isn't actually executable because of capital controls and NDF illiquidity. The economic interpretation is wrong even though the math is internally consistent.

The downstream effect: any upward-USD strike looks impossibly far away from the model's forward, and the premium collapses to near-zero. The working example in §3.6 shows this concretely — vanilla GK gives $1.80 for protection that empirically should command roughly **$25–30**.

This is not a vol problem. The risk-premium markups in §6.5 won't fix it because they scale a number that's already been suppressed by the wrong drift. **You have to fix the drift itself.**

#### The fix: substitute empirical drift for the rate differential

Replace `q` in the Garman-Kohlhagen formula with `q_effective = r − μ`, where μ is the **empirical historical drift** of S — the realized annualized log-return:

```
μ = ln(S_now / S_{N years ago}) / N
```

Then:

```
q_effective = r − μ          (instead of using the central-bank or NDF rate)
```

And the formula becomes:

```
d1 = [ln(S/K) + (r − q_effective + σ²/2)·T] / (σ·√T)
   = [ln(S/K) + (μ + σ²/2)·T]            / (σ·√T)
```

The `(r − q)` drift in the textbook formula gets replaced by `(r − q_effective) = μ` — the rate of change actually observed in the market.

The discount factors don't change: still `e^(-rT)` on the strike (USD rate, since premiums are paid in USDC) and still `e^(-q_effective·T)` on the spot leg. For pairs where historical drift is positive (USD appreciates against the local currency), `q_effective` will be negative, which makes the spot leg slightly larger — pushing premiums up to where they belong.

#### Estimating μ — the practical part

| Step | What to do | Why |
|---|---|---|
| Source | Pull daily close prices from a free API (Yahoo Finance, Alpha Vantage, central bank historical) | Same data feed used for realized vol — no new vendor needed |
| Window | Trailing **3 to 5 years** | Long enough that one regime change doesn't dominate; short enough that ancient history doesn't drown current behavior |
| Method | `μ = ln(S_t / S_{t−N}) / N`, `N` in years | Annualized log-return, robust to compounding |
| Floor | Cap |μ| at ±50% per year | A 50%/yr drift is already extreme. If your data says more, something is wrong (devaluation event in the window) — flag for governance review |
| Refresh | Daily | Same cadence as realized vol; both jobs read the same price feed |

For each pair, both `q` (the rate-curve value) and `μ` (the empirical drift) are computed and stored. The pricing engine picks which one to use based on the pair's classification:

```
For each tracked pair:

  IF pair is G10 or has liquid NDF (covered-interest parity holds):
    q_effective = q                   (textbook, IRP-derived)

  ELSE (frontier EM, capital controls, NDF illiquid or absent):
    q_effective = r − μ               (empirical drift correction)
```

The classification per pair is a governance decision, audited and publicly logged. It can be revisited as NDF markets develop or capital controls change.

#### Sanity: the consistency check

When both inputs are available (pair has both a rate curve AND a tradable NDF for the same tenor), they should agree:

```
q_NDF_implied = r − ln(NDF_forward / S) / T   (from §5.3)
q_empirical   = r − μ                         (from above)
|q_NDF_implied − q_empirical|  →  should be small for IRP-holding pairs
```

If the gap is more than ~5% annualized, the pair is **NOT** IRP-holding — flip the classification to use empirical drift even if the rate curve is technically available.

#### What this does NOT fix

The empirical-drift correction handles the systematic drift bias in the BS forward. It does not handle:

- **Skew / smile** — EM pairs typically have much higher implied vol on upward-USD strikes than downward ones (devaluation risk is asymmetric). Phase 3 work; meanwhile bias your vol input upward for upward-USD strikes on EM pairs.
- **Jump risk** — sudden devaluations are not lognormal; no diffusion model captures them. The realized-vol risk-premium markup in §6.5 (50–100% for frontier) is the band-aid.
- **Regime breaks** — if the historical drift window covers both a managed-rate period and a free-float period, μ will be the wrong number for either regime. Governance should freeze pricing on a pair when a regime change is detected and re-baseline μ from the new regime only.

These are all secondary to the drift correction. Without the drift fix, none of these matter because the base premium is already broken.

### 3.6 The Working Example

Concrete numbers, to make this tangible. We compute the same trade two ways — naïve GK first to show what's broken, then the EM-corrected version to show the right answer.

Trade parameters:

- Pair: USD/GHS
- Spot (S): 11.00 GHS per USD
- Lower strike (K_lower): 13.00
- Upper strike (K_upper): 14.00
- Time to expiry (T): 0.25 years (90 days)
- USD rate (r): 0.05 (5%)
- GHS rate (q): 0.26 (26%)
- Empirical drift (μ): 0.15 (USD has appreciated ~15%/yr against GHS over the last 5 years)
- Vol (σ): 0.18 (18%)
- Notional: $10,000

#### Pricing #1 — Naïve Garman-Kohlhagen (BROKEN for EM)

Using `q_effective = q = 0.26`. Forward rate implied by IRP: `F = 11 × e^(-0.21 × 0.25) = 10.43`. The model assumes the rate is *falling*.

Compute call at K=13:

```
d1 = [ln(11/13) + (0.05 - 0.26 + 0.18²/2) × 0.25] / (0.18 × √0.25)
   = [-0.1671 + (-0.1938) × 0.25] / 0.09
   = [-0.1671 - 0.0485] / 0.09
   = -2.395

d2 = -2.395 - 0.09 = -2.485

N(d1) ≈ 0.0083,  N(d2) ≈ 0.0065

C(K=13) = 11 × e^(-0.26 × 0.25) × 0.0083 - 13 × e^(-0.05 × 0.25) × 0.0065
       = 11 × 0.937 × 0.0083 - 13 × 0.988 × 0.0065
       = 0.0856 - 0.0834
       = 0.0022 GHS per USD of underlying
```

Per $10K notional: 10,000 × 0.0022 / 11 ≈ **$2.00**

Compute call at K=14:

```
d1 = [ln(11/14) + (-0.1938) × 0.25] / 0.09 = -3.219
d2 = -3.309
N(d1) ≈ 0.00064,  N(d2) ≈ 0.00047
C(K=14) ≈ 11 × 0.937 × 0.00064 - 14 × 0.988 × 0.00047
       ≈ 0.0066 - 0.0065 ≈ 0.0001 GHS per USD
```

Per $10K notional: ~**$0.09** (correcting an earlier-edition rounding error that put this at $0.20).

**Naïve call-spread premium = $2.00 − $0.09 ≈ $1.91 per $10K notional.**

This number is wrong. No baker in Ghana could buy USD-appreciation insurance for 0.02% of notional — the market would price this much higher because USD/GHS empirically rises year on year.

#### Pricing #2 — Empirical-Drift Correction (USE THIS for EM)

Substitute `q_effective = r − μ = 0.05 − 0.15 = −0.10`. Now the model treats the implied forward as `F = 11 × e^((0.05 − (−0.10)) × 0.25) = 11.42` — a slight rise, matching empirical reality.

Compute call at K=13:

```
d1 = [ln(11/13) + (0.05 − (−0.10) + 0.18²/2) × 0.25] / 0.09
   = [-0.1671 + (0.15 + 0.0162) × 0.25] / 0.09
   = [-0.1671 + 0.0416] / 0.09
   = -1.395

d2 = -1.395 - 0.09 = -1.485

N(d1) ≈ 0.0816,  N(d2) ≈ 0.0688

C(K=13) = 11 × e^(0.025) × 0.0816 - 13 × e^(-0.0125) × 0.0688
       = 11 × 1.0253 × 0.0816 - 13 × 0.9876 × 0.0688
       = 0.9203 - 0.8833
       = 0.0370 GHS per USD
```

Per $10K notional: 10,000 × 0.0370 / 11 ≈ **$33.6**

Compute call at K=14:

```
d1 = [ln(11/14) + (0.15 + 0.0162) × 0.25] / 0.09 = -2.218
d2 = -2.308
N(d1) ≈ 0.0133,  N(d2) ≈ 0.0105
C(K=14) = 11 × 1.0253 × 0.0133 - 14 × 0.9876 × 0.0105
       = 0.150 - 0.145
       = 0.0048 GHS per USD
```

Per $10K notional: 10,000 × 0.0048 / 11 ≈ **$4.40**

**Corrected call-spread premium = $33.6 − $4.40 ≈ $29 per $10K notional.**

#### The comparison

| Method | Premium per $10K | What it implies |
|---|---|---|
| Naïve GK (textbook (r−q) drift) | **~$2** | Underwriter is paid a microscopic amount to back the trade. Pool gets wiped out the first time the rate moves the way it always moves. |
| Empirical-drift correction | **~$29** | Sized to the realized historical risk. Hedger pays a price that reflects what's actually happening in this currency pair. Underwriter is compensated. |

The premium moved by **15×** from a single conceptual fix — replacing one assumption about market mechanics. This is why §3.5 isn't optional.

#### Vol sensitivity (still applies, both methods)

Holding the drift correction in place, raise vol from 18% to 30%:

```
At σ = 0.30 with empirical drift μ = 0.15:
C(K=13) ≈ $58 per $10K notional
C(K=14) ≈ $26 per $10K notional
Call spread ≈ $32 per $10K notional
```

So vol matters too — but it's no longer the only thing that matters. Once the drift is right, vol drives the *width* of the price distribution; drift drives where the distribution is centered. Both are first-order inputs.

### 3.7 On-Chain Implementation

Black-Scholes requires logarithms, exponentials, and the normal CDF — all expensive to compute in Solidity. Three approaches:

**Approach A: Off-chain computation, on-chain verification.**

Pricing service runs off-chain, computes premiums, publishes them with the inputs that produced them. Contract validates monotonicity properties (premiums decrease as K_lower increases, etc.) but doesn't recompute. Cheapest gas, requires trust in the off-chain pricer.

**Approach B: Lookup tables for N(x).**

Pre-compute N(x) for x in [-5, 5] at intervals of 0.01. Store on-chain. Use linear interpolation. Combined with fixed-point math libraries (PRBMath, ABDKMath64x64) for log/exp, this gets you full on-chain pricing at moderate gas cost (~200-400K gas per pricing).

**Approach C: Hybrid.**

Off-chain for primary pricing, on-chain for sanity checks and fallback. Most practical for production.

Recommendation: **Approach C.** Off-chain pricing service produces the primary premium; on-chain contract validates the result is within bounds and consistent with on-chain inputs.

---

## 4. Input 1: Spot Rate Data Sources

Current price of the FX pair, refreshed continuously.

### 4.1 Available Sources

| Source | Coverage | Cost | Update frequency | Notes |
|---|---|---|---|---|
| Pyth Network | Major + some EM | Free (gas only) | Sub-second | Crypto-native, on-chain ready |
| Chainlink | Major + some EM | Free (gas only) | ~1 minute | Most widely trusted in DeFi |
| RedStone | Wide, modular | Free (gas only) | On-demand | Pull only what you need |
| Bloomberg FX | Everything globally | $24K/user/year | Real-time | Institutional gold standard |
| Refinitiv (LSEG) Eikon | Everything globally | $22K/user/year | Real-time | Bloomberg alternative |
| Reuters direct | Everything | $15-30K/year | Real-time | Used by trading desks |
| TraderMade | Major + most EM | $300-3K/month | Real-time | Mid-tier API |
| OANDA API | Major + EM | $0-2K/month | Real-time | Retail-oriented but solid |
| Local central bank | Their currency | Free | Once daily | Slow, official reference |

### 4.2 Recommendation by Pair Tier

**G10 pairs (EUR/USD, USD/JPY, GBP/USD, etc.):** Pyth or Chainlink. Free, fast, sufficient.

**Major EM (USD/INR, USD/BRL, USD/MXN, USD/ZAR, USD/TRY, USD/IDR, USD/PHP):** Pyth or RedStone primary, plus TraderMade (~$1K/month tier) as cross-check.

**Frontier EM (USD/VND, USD/GHS, USD/NGN, USD/KES):** Bloomberg or Refinitiv subscription, plus regional aggregators, plus central bank reference rates. Combine multiple sources because no single one is reliable.

### 4.3 Cost Summary

- G10-only: $0
- + Major EM: ~$5-15K/year
- + Frontier EM: ~$25-40K/year (mostly because Bloomberg/Refinitiv is the practical solution)

---

## 5. Input 4: Risk-Free Rate Data Sources

You need r and q for every pair. The combined rate differential drives the FX forward price.

### 5.1 USD Rate (r in most pairs)

**Sources:**

| Source | What | Cost |
|---|---|---|
| Pyth | SOFR, Treasury yields | Free |
| Chainlink | Treasury rates | Free |
| RedStone | Various rate feeds | Free |
| Federal Reserve H.15 | Official Treasury curve | Free, daily |
| FRED | Historical + current | Free |

**Recommendation:** Pyth or RedStone for the on-chain feed, FRED as cross-check. Cost effectively zero.

### 5.2 G10 Rates (EUR, GBP, JPY, CHF, AUD, CAD, NZD)

**Sources:**

- ECB, BoE, BoJ publish official rates daily — free
- Eurex, ICE publish forward curves — bundled with data subscriptions
- Pyth/Chainlink starting to cover some

**Cost:** ~$5K/year for institutional curves; near-zero for daily reference rates.

### 5.3 EM Rates (the hard one)

For exotic currencies, the central bank's published policy rate often doesn't reflect what the FX market is actually pricing. The market-implied rate can differ by 5-10% from the policy rate. Two approaches:

**Approach A: Use central bank policy rate.** Free, easy, often inaccurate. Acceptable as a fallback only.

**Approach B: Derive from NDF (non-deliverable forward) market.** This is what professional FX desks do.

```
q = r - ln(NDF_forward / spot) / T
```

If you have spot, USD rate, and a 90-day NDF quote, you solve for the implied local rate. This is much more accurate because it reflects actual market pricing.

### 5.4 NDF Data Sources

| Source | Coverage | Cost |
|---|---|---|
| Bloomberg NDF curves | All major EM NDFs | Bundled in $24K terminal |
| Refinitiv NDF data | All major EM NDFs | Bundled in $22K Eikon |
| ICE Data Services | EM NDF curves | $30-50K/year for FX package |
| EM-focused providers (CMI, EM Capital) | EM-only, narrower | $20-50K/year |
| Bank counterparties direct | Specific corridors | Often free if you're a customer |
| Pyth/Chainlink | Limited, emerging | Free |

### 5.5 NDF Coverage by Currency

**Liquid offshore NDF markets:**
USD/INR, USD/BRL, USD/CNY (CNH), USD/KRW, USD/TWD, USD/IDR, USD/PHP, USD/MYR, USD/COP, USD/CLP, USD/PEN, USD/EGP

**Less liquid but quoted:**
USD/VND, USD/NGN, USD/KES, USD/UGX, USD/PKR, USD/BDT

**Essentially no NDF market:**
USD/GHS, USD/ETB, most frontier African currencies

For currencies without NDF markets, fall back to central bank rate plus a risk premium for inaccessibility. This is one of the reasons frontier currencies are hard to price.

### 5.6 Cost Summary

- USD only: $0
- + G10: ~$5K/year
- + Major EM with NDF: ~$25K/year (Bloomberg or Refinitiv)
- + Frontier EM: ~$40-80K/year total

---

## 6. Input 5: Volatility — The Biggest Piece of Work

Half the engineering and most of the data cost goes here. There are three sources, used in priority order.

### 6.1 Source 1: Implied Vol from Traded Options Markets

**What it is:** Vol derived from the prices of actual traded options. The market's forward-looking estimate. This is what you actually want to use.

**Where to get it:**

For G10 pairs (EUR/USD, USD/JPY, GBP/USD, USD/CHF, AUD/USD, NZD/USD, USD/CAD):

| Source | What | Cost |
|---|---|---|
| CME Group | FX options on all G10 | $5-15K/year |
| Deribit | FX options (small but growing) | Free |
| EUREX | EUR-denominated options | Bundled with European data |
| Bloomberg OVME | Full vol surfaces | Bundled in terminal |
| Refinitiv FX Volatility | Full vol surfaces | Bundled in Eikon |
| ICE Data Services | OTC vol surfaces | $20-40K/year |

For major EM with options (USD/INR, USD/BRL, USD/MXN, USD/ZAR):

- Bloomberg/Refinitiv carry these
- Local exchanges (B3 Brazil, BMV Mexico) publish their own
- **Cost:** Bundled with Bloomberg/Refinitiv

For less liquid EM with thin options (USD/IDR, USD/PHP, USD/COP, USD/CLP):

- Available from major vendors but with caveats — wider spreads, less reliable surfaces
- **Cost:** Bundled with above

For frontier EM (USD/VND, USD/GHS, USD/NGN, USD/KES):

- **Implied vol does not exist.** No traded options market. Skip to Source 2.

### 6.2 Source 2: Realized Vol from Historical Price Data

**What it is:** Compute vol yourself from observed daily price movements. Always available if you have price history.

**Computation methods:**

**Simple historical vol:**
```
returns = [ln(S_t / S_{t-1}) for each day t]
vol = stdev(returns) × √252
```

Use last 30, 60, or 90 days of returns. Annualize by √252 (trading days per year).

**EWMA (exponentially weighted moving average):**

```
σ²_t = λ × σ²_{t-1} + (1-λ) × r²_{t-1}
```

Where λ is typically 0.94 (RiskMetrics standard). Recent observations weight more. Adapts faster to changing conditions than simple historical.

**GARCH(1,1):**

```
σ²_t = ω + α × r²_{t-1} + β × σ²_{t-1}
```

Captures vol clustering — the empirical fact that volatile periods cluster together. More accurate but much more complex.

**Recommendation:** EWMA with λ = 0.94 and 60-day window. Good balance of responsiveness and stability.

### 6.2.5 Empirical Drift from the Same Historical Series

The realized-vol pipeline reads daily closes for every supported pair. The same series, queried over a longer window, gives you the empirical drift μ that the EM correction in §3.5 needs.

```
μ = ln(S_now / S_{N years ago}) / N      // annualized log-return
```

**Window:** 3-5 years. Long enough that one outlier event (e.g. a single devaluation) doesn't dominate; short enough that ancient history doesn't drown current behavior.

**Same data feed as realized vol** (Yahoo / Alpha Vantage / FRED / central banks — see §6.3). Marginal cost is zero. The only new code is the drift computation itself, which is one line.

**Sanity floor:** cap |μ| at ±50% per year. A drift larger than that means the window contains a regime change and governance should re-baseline from the post-change period only.

**Refresh cadence:** daily, alongside realized vol.

For pairs where covered-interest parity actually holds (G10, liquid NDF), μ should approximate (r − q) within a few percent. If it doesn't, the pair is misclassified — flip it to the EM branch in §3.5's classifier and use μ as the primary drift input.

### 6.3 Historical Price Data Sources

| Source | Coverage | Cost |
|---|---|---|
| Yahoo Finance / Investing.com | Major + most EM | Free |
| FRED | USD pairs and major EM | Free |
| Quandl/Nasdaq Data Link | Wide, including EM | $50-500/month |
| Bloomberg/Refinitiv historical | Everything | Bundled |
| Central bank historical | Their currency | Free |
| TradingView API | Major + EM | $15-60/month |
| Alpha Vantage | Major + many EM | Free tier + $50/month |

### 6.4 The Critical Catch: Realized Vol Underestimates Future Vol

Realized vol systematically underestimates future vol. This is a well-documented phenomenon. Implied vols trade above realized vols by 15-30% on average for major pairs and much more for EM.

**You must add a markup before using realized vol as a pricing input.** Otherwise the protocol systematically underprices and underwriters lose money over time.

### 6.5 Risk Premium Markup by Pair Tier

| Pair tier | Markup | Reasoning |
|---|---|---|
| G10 majors | +10-15% | Mature market, well-understood vol risk premium |
| Major EM (BRL, MXN, ZAR, INR) | +20-30% | Wider tails, more regime risk |
| Less liquid EM (IDR, PHP, COP, PEN) | +30-50% | Thinner markets, less hedgeable |
| Frontier EM (VND, GHS, NGN) | +50-100% | Fat tails, devaluation risk, capital control risk |
| Pegged or managed (HKD, GCC pegs) | +100-200% | Devaluation tail dominates |

These markups are governance-set parameters, adjustable as real loss data accumulates. Start conservative, ratchet down if data supports it.

### 6.6 Source 3: Governance-Set Vol

For brand-new pairs, regime breaks, or when other methods produce nonsense. Conservative vol set by the protocol team or governance with documented reasoning.

Used as a fallback, not a primary source.

### 6.7 The Hybrid Vol Oracle Logic

```
For each tracked pair:
  
  IF pair has liquid traded options market (G10, major EM):
    σ = implied_vol from CME / Bloomberg / Deribit
  
  ELSE IF pair has reliable spot price history (most EM):
    σ_realized = EWMA(returns, λ=0.94, window=60d) × √252
    σ = σ_realized × (1 + markup_for_pair_tier)
  
  ELSE (brand-new pairs, regime breaks):
    σ = governance_set_value
```

### 6.8 Cost Summary

- G10 implied vol only: $5-15K/year
- + Major EM implied vol: $25-40K/year (mostly Bloomberg/Refinitiv)
- + Realized vol pipeline for frontier: ~$5K/year additional (data is mostly free, computation is free)
- + Specialized EM data providers: $20-50K/year if needed

---

## 7. Total Data Cost by Coverage Scope

### Tier A: G10 Only (EUR, JPY, GBP, CHF, AUD, CAD, NZD vs USD)

| Component | Cost |
|---|---|
| Spot rates | Free (Pyth/Chainlink) |
| USD rates | Free (Pyth) |
| G10 rates | Free or near-free |
| G10 implied vol | $5-15K/year (CME) |
| **Total** | **$5-15K/year** |

This market segment is well-served by traditional finance. Limited commercial opportunity unless you're competing on UX/distribution.

### Tier B: G10 + Major EM (Adds BRL, MXN, ZAR, INR, KRW, IDR, PHP)

| Component | Cost |
|---|---|
| Spot rates | $1-3K/year (TraderMade tier) |
| Rates curves with NDF | $25K/year (Bloomberg or Refinitiv) |
| Major EM implied vol | Bundled |
| **Total** | **$25-40K/year** |

This covers the EM pairs where institutional infrastructure exists. Real but contested market.

### Tier C: G10 + Major EM + Frontier (Adds VND, GHS, NGN, KES)

| Component | Cost |
|---|---|
| Spot rates | $10-20K/year (multiple sources) |
| Rates curves | $40-70K/year (Bloomberg + EM specialist) |
| Implied where available, realized + markup elsewhere | Bundled |
| Specialized frontier data | $20-30K/year additional |
| **Total** | **$70-120K/year** |

Genuinely underserved market. Highest opportunity. Also where pricing accuracy is hardest and risk premium markups matter most.

### Recommendation

Start with **Tier B for production launch.** It covers the EM pairs where stablecoin B2B flow is concentrated (USD/INR, USD/IDR, USD/PHP especially) and where reasonably accurate pricing is achievable. Add Tier C pairs selectively as you commit to specific corridors and have time to calibrate risk premiums.

---

## 8. The Engine Architecture

### 8.1 Components

**On-chain:**
- Pricing function (Black-Scholes, fixed-point math, callable from event creation)
- Storage for current values: spot, USD rate, local rate, vol (per pair, per tenor)
- Update functions called by oracle services
- Validation logic (sanity-checks computed prices against bounds)

**Off-chain (the oracle service):**
- Data ingestion from Bloomberg, Refinitiv, Pyth, etc.
- Realized vol computation pipeline
- NDF-implied rate computation
- Publication service that writes updated values on-chain at appropriate frequency

**Governance layer:**
- Approval process for new pair listings
- Setting risk premium markups per pair tier
- Emergency override for stale or anomalous inputs
- Bounds on allowable strikes/expiries per pair

### 8.2 Data Flow at Event Creation

```
1. Platform creates event: pair, range [K_lower, K_upper], expiry, notional
2. Contract reads from on-chain storage:
   - S        = current spot for pair
   - r        = current USD rate
   - q        = current local rate (or NDF-derived)
   - μ        = current empirical drift for pair (3-5y rolling log-return)
   - σ        = current vol for pair (from hybrid vol oracle)
   - useEmpiricalDrift = governance flag per pair (true for EM, false for G10)
3. Contract computes q_effective:
   q_effective = useEmpiricalDrift ? (r - μ) : q
4. Contract computes T = (expiry - now) / 365.25 days
5. Contract computes premium:
   premium = call_spread(S, K_lower, K_upper, T, r, q_effective, σ) × notional
6. Premium is locked for the event
7. Hedger pays premium; underwriter posts collateral = max payout
```

The `useEmpiricalDrift` flag is set per pair by governance based on the §3.5 consistency check. For any pair where rate-curve-implied q and empirical-drift-implied q_effective differ by more than ~5% annualized, set the flag to true.

### 8.3 Update Frequencies

| Input | Update frequency | Justification |
|---|---|---|
| Spot rate | Continuous (block-level) | Already do this |
| USD rate | Daily | Slow-moving |
| Local rate (NDF-derived) | Daily | NDF curves update daily |
| Empirical drift μ | Daily | Computed from same series as realized vol (§6.2.5) |
| Implied vol | Daily or twice-daily | Updates with options market |
| Realized vol | Daily | Computed from previous day's close |
| Pair classification (use empirical drift?) | Quarterly governance review | Slow-moving — only flips when an NDF market opens or capital controls change |
| Risk premium markups | Quarterly governance review | Slow-moving parameter |

### 8.4 Validation and Safety

The on-chain contract should validate:

- Spot rate within reasonable bounds (~0.5× to 2× of last week's value, with anomaly alert at 1.3×). The earlier draft's 0.1×–10× window was way too loose — a 10× weekly move is sovereign-default territory, not noise to silently accept.
- Time to expiry positive and within allowed range
- Strikes within allowed range relative to spot
- Vol within configured bounds per pair tier
- Empirical drift μ within ±50% per year (cap from §6.2.5)
- For IRP-classified pairs: rate-curve-implied q and empirical drift μ should agree within ~5% annualized — otherwise the pair is misclassified, alert governance
- Premium output within sanity bounds (not zero, not greater than max payout)

If any check fails, event creation reverts. Better to refuse a trade than to settle one at a corrupt price.

### 8.5 Phased Rollout

**Phase 1 (3-4 months):** Major pairs only. Realized vol with risk premium. One vendor for rates. Launch with ~10 pairs.

**Phase 2 (6-9 months total):** Add implied vol integration for G10 and major EM. Add NDF-derived rates. Expand to ~25 pairs.

**Phase 3 (12+ months):** Term structure of vol (different vols for different expiries). Vol smile (different vols for different strikes). Backtesting framework. Automated regime detection.

---

## 9. What Could Go Wrong

Worth being explicit about failure modes.

**Vol input is wrong.** Most likely failure mode. Consequences range from underwriters losing money (if underestimated) to no buyers (if overestimated). Mitigation: conservative markups for less-understood pairs, ongoing review of realized vs. expected loss ratios.

**Rate input is wrong.** Less catastrophic than vol but still bad. NDF data goes stale, central bank rates diverge from market reality. Mitigation: cross-checks between sources, fallback to alternative rates if primary feed stale.

**Spot rate manipulation.** The oracle layer guards against this, but for thin EM pairs, oracle sources themselves may be manipulable. Mitigation: multiple independent sources, cooldown/tolerance mechanics, governance pause.

**Frontier pair has no good data.** Sometimes there's just no way to price a pair accurately. The honest answer: don't list those pairs. Better to refuse than to ship a product that systematically loses money.

**Pricing vendor change.** Bloomberg/Refinitiv contracts have lock-in. If a vendor changes terms or pricing, you have to migrate. Mitigation: design the data layer so vendors are swappable.

---

## 10. Quick Reference: The Pricing Function

For implementation, the engine takes these inputs and returns a premium:

```
function priceEvent(
    pair,           // e.g., "USD/GHS"
    K_lower,        // lower strike
    K_upper,        // upper strike
    T,              // time to expiry in years
    notional        // size of the hedge
) returns premium:

    S        = oracle.getSpot(pair)
    r        = oracle.getRate(pair.quoteCurrency)        // USD rate
    q        = oracle.getRate(pair.baseCurrency)          // local rate (may be unusable for EM)
    μ        = driftOracle.getEmpiricalDrift(pair)        // 3-5y rolling log-return
    σ        = volOracle.getVol(pair, T)
    useEmp   = governance.useEmpiricalDrift(pair)         // §3.5 classifier flag

    // §3.5 EM drift correction: substitute (r - μ) for q on EM pairs.
    q_eff    = useEmp ? (r - μ) : q

    call_lower = garmanKohlhagenCall(S, K_lower, T, r, q_eff, σ)
    call_upper = garmanKohlhagenCall(S, K_upper, T, r, q_eff, σ)

    premium_per_unit = call_lower - call_upper
    premium = premium_per_unit × notional / S

    return premium
```

That's the entire engine. Everything else in this document is either the data sources that feed `oracle.getSpot()`, `oracle.getRate()`, `driftOracle.getEmpiricalDrift()`, and `volOracle.getVol()`, or the formulas for computing `garmanKohlhagenCall()`.

The single-line trick is `q_eff = useEmp ? (r - μ) : q`. Get that right and the rest is textbook math.

---

## 11. Summary

**The six inputs:** spot, strikes, time, rates, vol, **and empirical drift μ for EM pairs**.

**Three are easy** (strikes and time from the event; spot from the existing oracle).

**Three are real work** — rates, vol, and the EM drift correction.

**For rates:** USD is free, G10 is cheap, EM requires NDF data which means $25-50K/year for Bloomberg or Refinitiv access.

**For vol:** Major pairs have implied vol available for $5-25K/year. Frontier EM has no implied vol; you compute realized vol (free data) and add a risk premium markup based on pair tier.

**For empirical drift μ:** Same free historical price feed used for realized vol. Compute the trailing 3-5 year annualized log-return per pair. Marginal cost is zero. Skip this and the engine systematically underprices every EM pair by a factor of 10-20× (see §3.5 and §3.6). Don't skip this.

**The pricing math** is Garman-Kohlhagen for vanilla FX options (the FX adaptation of Black-Scholes). Range/spread products are computed as the difference between two vanilla options. No research breakthroughs required.

**The single most important conceptual fix** is in §3.5: substitute `q_effective = r − μ` for the rate-curve `q` whenever interest-rate parity doesn't hold (most EM pairs). This is one line of code (`q_eff = useEmpiricalDrift ? (r - μ) : q`) and one governance flag per pair, but it's the difference between a pricing engine that works and one that quietly drains the underwriter pool.

**The hard parts** are not the formulas. They're:
1. Getting good vol estimates for exotic pairs
2. **Classifying which pairs need the empirical drift correction (most EM) vs which can use textbook GK (G10)**
3. Setting risk premium markups that compensate underwriters fairly
4. Building the oracle infrastructure to keep all this data fresh and on-chain
5. Governance over which pairs to support and how to handle regime breaks

**Total cost** to build a working pricing engine for the markets the protocol cares about: **$200-400K in year-one engineering and data, $100-200K/year ongoing.** The empirical drift correction adds essentially nothing to this total — it reuses data already paid for.

That's the complete picture.
