# Interest-Rate Pricing Integration v1.0

| Field | Value |
| --- | --- |
| Title | Interest-rate pricing integration |
| Version | 1.0 |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related documents | [Oracle architecture](oracle-architecture-v1.0.md), [Settlement rules](settlement-rules-v1.0.md), [Benchmark research](benchmark-research-v1.0.md) |
| Supersedes | None |

The oracle says what happened. The pricing engine estimates what may happen. Nothing in this document runs inside the oracle.

## 1. "Interest rates are not volatile": true for some benchmarks, false for others

| Benchmark | Typical behaviour | What drives the risk |
| --- | --- | --- |
| Policy rates (CBR, MPR, repo) | Flat for weeks, then a jump of 25 to 500bp at a decision | The **probability and size of a move at each scheduled meeting**, not daily volatility |
| SOFR, SONIA | Track the policy rate closely, with small daily noise | Mostly policy moves |
| KESONIA | Tracks CBR within a band; liquidity spikes | Policy moves plus liquidity |
| NOFR, Ghana interbank | Can move many percentage points in a liquidity squeeze | Liquidity and policy |
| Ghana 91-day T-bill | Large swings across regimes (about 25% in Feb 2025, 5.87% in Jul 2026) | Fiscal and policy regime |

So the FX model (continuous volatility) is the wrong tool. The rate model is a **jump process tied to the decision calendar**:
- For each scheduled meeting before expiry, estimate the probabilities of hold, hike or cut and their sizes, from history, current inflation and FX pressure, and market pricing where it exists (SOFR and SONIA futures; T-bill curves locally).
- Add a small daily noise term for overnight benchmarks.
- Compounded-in-arrears settlement averages the path, which lowers the effective volatility compared with one fixing.

## 2. What low volatility means for the product
1. **Premiums are small per dollar protected.** A protection pays `amount × rate move × time`, so cover is cheap for short tenors. That is good for buyers, but the fixed costs (fees, operations) take a bigger share. Minimum tenors of 30 days, and up to 12 months, keep the product meaningful.
2. **Capital per dollar protected is small.** The maximum payout is `amount × (cap − strike) × τ`. With a 3-point cap over 90 days that is 0.75% of the amount, versus up to 30% for FX Open cover. Underwriter capital goes much further, so pools can support large protected amounts.
3. **Most of the value is in the tail:** emergency hikes, currency crises and fiscal stress. The pricing must not underprice those just because quiet periods look calm. Stress scenarios from 2022 to 2024 (Nigeria MPR from 11.5% to 27.5%; Ghana from 14.5% to 30%) belong in calibration and backtests.
4. **Correlation with FX:** central banks often hike to defend a currency. Underwriters holding both naira depreciation cover and naira rate-rise cover carry correlated risk. The underwriter risk view must show combined exposure.

## 3. Inputs (pricing side only)
- Current official benchmark (from the oracle store), history and the decision calendar.
- Inflation releases, FX moves and reserve data, as drivers of decision probabilities.
- Futures, swaps or T-bill curves where they exist.
- Pre-launch proxy history, labelled as proxy and never presented as official.

## 4. Pricing outputs
- A fair rate per tenor for a reference strike, as the FX pools have today. Underwriters still set the offer as a markup on fair.
- Prices quoted in basis points of the protected amount, which readers grasp more easily than tiny percentages.
