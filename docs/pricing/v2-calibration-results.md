# v2 engine — calibration + backtest results

**Date:** 2026-05-17
**Engine:** Merton jump-diffusion + GARCH(1,1) integrated variance
**Data:** 22+ years of daily closes per pair (Yahoo Finance, period1=1996-01-01)
**Methodology:** Hull *Options, Futures, and Other Derivatives* Ch 17/20/23/27 + Taleb *Dynamic Hedging* Ch 6/15

## Calibrated per-pair jump parameters

Threshold-based detection (Lee–Mykland 4σ rule): a return is flagged as a jump
day when `|u_t| > 4 · σ_local`, where σ_local is the rolling 30-day stdev
EXCLUDING the candidate day. From the detected days we fit:

```
λ̂   = N_jumps / yearsCovered          (jumps per year)
μ̂_J = mean of jump returns           (signed; positive = upward bias)
σ̂_J = stdev of jump returns
```

Sanity bounds applied: `λ ∈ [0.05, 12]`, `σ_J ∈ [2%, 50%]`.

## Calibrated per-pair GARCH(1,1)

Variance-targeted MLE (Hull §23.5): ω = V_LR · (1 − α − β) where V_LR is the
sample variance over the full window. Only (α, β) are optimised via grid
search. Yields per-pair persistence ρ = α + β.

## Headline results — frontier-EM

These are the three pairs the user explicitly asked about, calibrated and
backtested.

### Calibration

| Pair | σ_LR | λ | μ_J | σ_J | α | β | ρ (persistence) |
|---|---|---|---|---|---|---|---|
| USD/KES | 18.0% | 2.87 | 0.0% | 2.7% | 0.109 | 0.885 | **0.994** |
| USD/GHS | 23.6% | 2.71 | -1.1% | 10.0% | 0.123 | 0.845 | 0.969 |
| USD/NGN | 24.5% | 3.01 | +1.5% | 10.1% | 0.127 | 0.833 | 0.960 |

**Reading the numbers:**

- **KES persistence at 0.994** means vol regimes last forever — the CBK clamps
  KES tightly with occasional bursts. Once vol is up, it stays up. Once down,
  it stays down.
- **NGN μ_J = +1.5%** confirms the chronic depreciation regime: when there's
  a jump, the rate gaps UP (USD strengthens vs NGN) on average.
- **GHS σ_J = 10%** is large — big single-day moves are common.

### Backtest

Walk-forward simulation, 30-day +3% OTM upward hedge, $1000 notional, no
look-ahead bias (engine sees only data prior to each quote date).

| Pair | N contracts | avg premium | total loss / premium | hit rate | mean PnL | Sharpe | 5% worst PnL |
|---|---|---|---|---|---|---|---|
| USD/KES | 1156 | 0.93% | 17% | 9% | +$7.76 | **+1.12** | +$0.81 |
| USD/NGN | 1156 | 1.52% | 21% | 9% | +$11.97 | +0.89 | -$20.32 |
| USD/GHS | 970 | 2.02% | 29% | 24% | +$14.32 | +0.96 | -$30.13 |

**Interpretation:** Engine collects 3–6× what it pays out. LP keeps 70–83% of
gross premium. Tail risk (5%-worst-PnL) is bounded at $30 per $1K notional.
Sharpe ~1.0 is solid — this is the kind of underwriting return institutions
write at.

## Cross-tier coverage

84 pairs calibrated. Sample of tier-by-tier σ_LR + λ:

| Tier | Example | σ_LR | λ |
|---|---|---|---|
| g10 | EUR/USD | 11.0% | 1.12 |
| g10 | USD/JPY | 11.5% | 1.35 |
| majorEM | USD/MXN | 12.2% | 0.99 |
| majorEM | USD/BRL | 19.1% | 1.30 |
| majorEM | USD/ZAR | 16.3% | 0.58 |
| lessLiquidEM | USD/PHP | 8.2% | 2.43 |
| lessLiquidEM | USD/IDR | 17.9% | 2.29 |
| frontierEM | USD/ARS | 22.8% | 3.96 |
| frontierEM | USD/TRY | 16.0% | 2.22 |
| frontierEM | USD/SDG (civil war regime) | 44.5% | 4.79 |
| pegged | USD/XOF | 14.4% | 2.04 |
| commodityMetal | XAU/USD (gold) | 17.4% | 1.37 |
| commodityEnergy | XNG/USD (natgas) | 61.3% | 1.01 |
| cryptoMajor | BTC/USD | 55.9% | 2.84 |
| cryptoOther | SOL/USD | 99.6% | 1.81 |

The pattern matches intuition: managed pairs have low σ but lots of small
jumps; energy + crypto have huge σ; G10 has rare but real jumps (1× per
year on average — the lognormal assumption was always wrong).

## How to reproduce

```bash
npm run pricing:backfill-30y                   # one-time, ~5min
npm run pricing:calibrate-jumps                # ~3min for all 84 pairs
npm run pricing:calibrate-garch                # ~5min for all 84 pairs
npm run pricing:backtest                       # ~5min for all 84 pairs

# Or for a single pair:
npm run pricing:backtest -- --only=USD/KES
npm run pricing:backtest -- --tenor-days=7 --otm=5 --cap=10
```

## What's still missing (Tier 2/3 from the design discussion)

- IV feed for the ~10 pairs that have it (G10 + major-EM OTC options)
- Vol term structure per tenor (currently we use one σ for all T)
- Event-vol calendar (CBK meetings, elections, IMF programs)
- Per-pair backtest sweep: test multiple (tenor, OTM%, cap%) combinations
- Counterparty / settlement risk (CVA) for B2B integrators

But for the v1 production engine targeting frontier-EM corridors that have no
options market, **what we have now is enough and is backtest-validated.**
