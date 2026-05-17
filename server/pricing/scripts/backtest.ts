/**
 * backtest.ts — walk-forward simulation of the pricing engine against history.
 *
 * For each pair, we simulate writing the LP side of an upward-spread hedge
 * starting at many historical dates, then compare what the engine *would have*
 * charged vs what the LP *would have* paid out.
 *
 * Walk-forward invariant: at every quote date t0, the engine sees ONLY
 * historical data prior to t0. No look-ahead bias. The realized payoff at
 * t0+T uses ONLY the close on that future date.
 *
 * Output per pair:
 *   - Contracts quoted: total + how many ever paid out
 *   - Total premium collected (the LP's revenue)
 *   - Total payouts disbursed (the LP's cost)
 *   - Loss ratio = payouts / premium       (LP underwriter loses money if > 1.0)
 *   - Mean / stdev / 95p of per-contract P&L
 *   - Sharpe-like ratio: mean PnL per contract / stdev PnL per contract
 *
 * For the engine to be sensibly calibrated for an LP-friendly market, we want:
 *   - Loss ratio < 1.0 (LP profits on average — they bear tail risk so this
 *     should sit around 0.75–0.90 in a healthy market)
 *   - Mean PnL > 0 per contract
 *   - 95p loss bounded (no contract should wipe out a year's premiums)
 *
 * Run:
 *   npm run pricing:backtest                          # all pairs, default scenario
 *   npm run pricing:backtest -- --only=USD/KES        # single pair
 *   npm run pricing:backtest -- --tier=frontierEM
 *   npm run pricing:backtest -- --tenor-days=30 --otm=3 --cap=9  # custom scenario
 *   npm run pricing:backtest -- --csv > out.csv        # machine-readable
 *
 * Default scenario: 30-day upward hedge, strike +3% OTM, cap +9% OTM, $1000
 *   notional, weekly walk-forward (every 7 calendar days).
 */

import { db } from "../../db";
import { historicalFxCloses } from "../../../shared/schema";
import { eq, asc } from "drizzle-orm";
import { SUPPORTED_PAIRS, getPairSpec, type PairTier } from "../data/pairs";
import {
  mertonCallSpread,
  premiumInBaseCurrency,
} from "../kernel";
import {
  integratedVariance,
  longRunVolFromCloses,
  persistenceForTier,
} from "../data/garch";
import { computeRealizedVol } from "../data/vol-math";
import { TIER_JUMP_PARAMS } from "../data/jump-params";

const DEFAULT_TENOR_DAYS = 30;
const DEFAULT_OTM_PCT = 3;        // strike at +3%
const DEFAULT_CAP_PCT = 9;        // cap at +9%
const DEFAULT_NOTIONAL = 1000;    // USDC
const DEFAULT_STEP_DAYS = 7;      // walk-forward in 7-day steps
const USD_RISK_FREE = 0.045;
const MIN_LOOKBACK_CLOSES = 252;  // need ≥1y of history before t0 to quote

interface BacktestParams {
  tenorDays: number;
  otmPct: number;            // strike OTM as %
  capPct: number;            // cap OTM as %
  notional: number;
  stepDays: number;
}

interface BacktestContract {
  t0Date: string;
  t0Spot: number;
  strike: number;
  cap: number;
  premiumUsd: number;
  tT: string;
  tTSpot: number;
  payoutUsd: number;
  pnl: number;            // premium - payout
  triggered: boolean;
}

interface BacktestResult {
  pair: string;
  tier: PairTier;
  contracts: number;
  totalPremium: number;
  totalPayouts: number;
  lossRatio: number;       // payouts / premium
  meanPnl: number;
  stdevPnl: number;
  sharpe: number;
  hitRate: number;         // fraction triggered
  p95Loss: number;         // 95th percentile worst-case PnL (signed; negative = loss)
  maxLoss: number;
  meanPremiumPct: number;  // mean premium / notional
}

function parseArgs(): { only?: string[]; tier?: PairTier; params: BacktestParams; csv: boolean; verbose: boolean } {
  const argv = process.argv.slice(2);
  const get = (key: string): string | undefined =>
    argv.find(a => a.startsWith(`--${key}=`))?.split("=")[1];
  const only = get("only")?.split(",").map(s => s.trim());
  const tier = get("tier") as PairTier | undefined;
  return {
    only,
    tier,
    params: {
      tenorDays: Number(get("tenor-days") ?? DEFAULT_TENOR_DAYS),
      otmPct:    Number(get("otm") ?? DEFAULT_OTM_PCT),
      capPct:    Number(get("cap") ?? DEFAULT_CAP_PCT),
      notional:  Number(get("notional") ?? DEFAULT_NOTIONAL),
      stepDays:  Number(get("step-days") ?? DEFAULT_STEP_DAYS),
    },
    csv: argv.includes("--csv"),
    verbose: argv.includes("--verbose"),
  };
}

/**
 * Price one hypothetical hedge using ONLY data prior to t0Idx.
 * No look-ahead.
 */
function priceAtT0(args: {
  closes: number[];
  t0Idx: number;
  tier: PairTier;
  tenorDays: number;
  otmPct: number;
  capPct: number;
  notional: number;
}): { spot: number; strike: number; cap: number; premiumUsd: number } | null {
  const { closes, t0Idx, tier, tenorDays, otmPct, capPct, notional } = args;
  if (t0Idx < MIN_LOOKBACK_CLOSES) return null;

  const history = closes.slice(0, t0Idx);   // exclusive of t0Idx
  const spot = closes[t0Idx];
  if (!Number.isFinite(spot) || spot <= 0) return null;

  // σ_LR — equally-weighted long-run vol
  let sigmaLR: number;
  try { sigmaLR = longRunVolFromCloses(history); }
  catch { return null; }

  // σ_0 — EWMA over last 60 returns
  let sigma0: number;
  try { sigma0 = computeRealizedVol(history.slice(-61)); }
  catch { return null; }
  if (!Number.isFinite(sigma0) || sigma0 <= 0) return null;

  // μ — empirical drift over the full window
  const oldest = history[0];
  const newest = history[history.length - 1];
  const yearsCovered = history.length / 252;
  let mu = Math.log(newest / oldest) / yearsCovered;
  mu = Math.max(-0.5, Math.min(0.5, mu));   // safety bound

  // GARCH integrated variance over [0, T]
  const T_years = tenorDays / 365.25;
  const integ = integratedVariance({
    sigma0,
    sigmaLongRun: sigmaLR,
    TYears: T_years,
    persistence: persistenceForTier(tier),
  });

  const strike = spot * (1 + otmPct / 100);
  const cap    = spot * (1 + capPct / 100);
  const qEffective = USD_RISK_FREE - mu;
  const jump = TIER_JUMP_PARAMS[tier];

  const perUnit = mertonCallSpread({
    S: spot,
    K_lower: strike,
    K_upper: cap,
    T: T_years,
    r: USD_RISK_FREE,
    q: qEffective,
    sigma: integ.sigmaIntegrated,
    lambda: jump.lambda,
    jumpMean: jump.jumpMean,
    jumpStd: jump.jumpStd,
  });
  const premiumUsd = premiumInBaseCurrency(perUnit, notional, spot);
  return { spot, strike, cap, premiumUsd };
}

/** Compute the realized payoff on a single contract given the spot at expiry. */
function realizedPayout(args: { tTSpot: number; strike: number; cap: number; spot: number; notional: number }): number {
  const { tTSpot, strike, cap, spot, notional } = args;
  if (!Number.isFinite(tTSpot) || tTSpot <= 0) return 0;
  // Call-spread payoff per unit: max(0, min(S_T, cap) − strike)
  const perUnit = Math.max(0, Math.min(tTSpot, cap) - strike);
  // Convert to USD: perUnit × notional / spot
  return (perUnit * notional) / spot;
}

async function backtestPair(pair: string, params: BacktestParams, verbose: boolean): Promise<BacktestResult | null> {
  const spec = getPairSpec(pair);
  if (!spec) throw new Error(`Pair ${pair} not in registry`);

  const rows = await db
    .select({ date: historicalFxCloses.date, close: historicalFxCloses.close })
    .from(historicalFxCloses)
    .where(eq(historicalFxCloses.pair, pair))
    .orderBy(asc(historicalFxCloses.date));

  if (rows.length < MIN_LOOKBACK_CLOSES + params.tenorDays + 30) {
    console.log(`  ${pair.padEnd(11)} skipped — only ${rows.length} closes`);
    return null;
  }

  const closes = rows.map(r => Number(r.close));
  const dates = rows.map(r => r.date);

  const contracts: BacktestContract[] = [];

  // Walk-forward: step every `stepDays` calendar days.
  // We assume ~5 closes per 7 calendar days (weekdays).
  const stepClosesEst = Math.max(1, Math.round((params.stepDays * 5) / 7));
  const expiryOffset = Math.max(1, Math.round((params.tenorDays * 5) / 7));

  for (let i = MIN_LOOKBACK_CLOSES; i + expiryOffset < closes.length; i += stepClosesEst) {
    const quote = priceAtT0({
      closes,
      t0Idx: i,
      tier: spec.tier,
      tenorDays: params.tenorDays,
      otmPct: params.otmPct,
      capPct: params.capPct,
      notional: params.notional,
    });
    if (!quote) continue;

    const tTIdx = i + expiryOffset;
    const tTSpot = closes[tTIdx];

    const payoutUsd = realizedPayout({
      tTSpot,
      strike: quote.strike,
      cap: quote.cap,
      spot: quote.spot,
      notional: params.notional,
    });

    contracts.push({
      t0Date: dates[i],
      t0Spot: quote.spot,
      strike: quote.strike,
      cap: quote.cap,
      premiumUsd: quote.premiumUsd,
      tT: dates[tTIdx],
      tTSpot,
      payoutUsd,
      pnl: quote.premiumUsd - payoutUsd,
      triggered: payoutUsd > 0,
    });

    if (verbose && contracts.length <= 5) {
      console.log(
        `    ${dates[i]} → ${dates[tTIdx]}  ` +
        `spot ${quote.spot.toFixed(3)} → ${tTSpot.toFixed(3)}  ` +
        `prem $${quote.premiumUsd.toFixed(2)}  payout $${payoutUsd.toFixed(2)}  ` +
        `pnl $${(quote.premiumUsd - payoutUsd).toFixed(2)}`,
      );
    }
  }

  if (contracts.length === 0) return null;

  const totalPremium = contracts.reduce((s, c) => s + c.premiumUsd, 0);
  const totalPayouts = contracts.reduce((s, c) => s + c.payoutUsd, 0);
  const pnls = contracts.map(c => c.pnl);
  const meanPnl = pnls.reduce((s, x) => s + x, 0) / pnls.length;
  const sqDev = pnls.reduce((s, x) => s + (x - meanPnl) * (x - meanPnl), 0);
  const stdevPnl = Math.sqrt(sqDev / pnls.length);
  const sorted = [...pnls].sort((a, b) => a - b);
  const p95Loss = sorted[Math.max(0, Math.floor(sorted.length * 0.05))];   // 5th percentile = worst-5%
  const maxLoss = sorted[0];
  const meanPremiumPct = contracts.reduce((s, c) => s + c.premiumUsd / params.notional, 0) / contracts.length;

  return {
    pair,
    tier: spec.tier,
    contracts: contracts.length,
    totalPremium,
    totalPayouts,
    lossRatio: totalPremium > 0 ? totalPayouts / totalPremium : 0,
    meanPnl,
    stdevPnl,
    sharpe: stdevPnl > 0 ? meanPnl / stdevPnl : 0,
    hitRate: contracts.filter(c => c.triggered).length / contracts.length,
    p95Loss,
    maxLoss,
    meanPremiumPct,
  };
}

function printHumanResults(results: BacktestResult[], params: BacktestParams): void {
  console.log();
  console.log(`Scenario: ${params.tenorDays}-day upward hedge, strike +${params.otmPct}% OTM, cap +${params.capPct}% OTM, $${params.notional} notional`);
  console.log(`Walk-forward step: every ${params.stepDays} calendar days`);
  console.log();
  console.log(`  Pair        │  tier         │  N    │  prem%  │ loss% │  loss/prem │ hit% │  mean PnL │ stdev PnL │ Sharpe │ 5% worst PnL`);
  console.log(`  ───────────┼───────────────┼───────┼─────────┼───────┼────────────┼──────┼───────────┼───────────┼────────┼─────────────`);

  // Sort by loss ratio (best at bottom)
  const sorted = [...results].sort((a, b) => a.lossRatio - b.lossRatio);
  for (const r of sorted) {
    const lossPct = r.totalPremium > 0 ? (r.totalPayouts / r.totalPremium) * 100 : 0;
    const profitable = r.lossRatio < 1.0 && r.meanPnl > 0;
    const flag = profitable ? "✓" : r.lossRatio < 1.5 ? " " : "!";
    console.log(
      ` ${flag} ${r.pair.padEnd(11)} │ ${r.tier.padEnd(13)} │ ${String(r.contracts).padStart(4)}  │ ` +
      `${(r.meanPremiumPct * 100).toFixed(2).padStart(5)}%  │ ` +
      `${(r.lossRatio * 100).toFixed(0).padStart(4)}% │ ` +
      `${r.lossRatio.toFixed(2).padStart(7)}    │ ` +
      `${(r.hitRate * 100).toFixed(0).padStart(3)}% │ ` +
      `${r.meanPnl >= 0 ? "+" : ""}$${r.meanPnl.toFixed(2).padStart(6)}  │ ` +
      `$${r.stdevPnl.toFixed(2).padStart(7)}  │ ` +
      `${r.sharpe >= 0 ? "+" : ""}${r.sharpe.toFixed(2).padStart(5)}  │ ` +
      `$${r.p95Loss.toFixed(2).padStart(8)}`,
    );
  }
  console.log();
  const profitable = sorted.filter(r => r.lossRatio < 1.0 && r.meanPnl > 0);
  const breakingEven = sorted.filter(r => r.lossRatio >= 1.0 && r.lossRatio < 1.5);
  const losing = sorted.filter(r => r.lossRatio >= 1.5);
  console.log(`  ✓  profitable (loss-ratio < 1.0): ${profitable.length}/${sorted.length}`);
  console.log(`     break-even-ish (1.0–1.5):     ${breakingEven.length}/${sorted.length}`);
  console.log(`  !  losing > 1.5×:                 ${losing.length}/${sorted.length}`);
  console.log();
  console.log("Interpretation:");
  console.log("  - 'prem%'    = avg premium as % of notional (what the LP charges per hedge)");
  console.log("  - 'loss%'    = total payouts as % of total premium across all backtested contracts");
  console.log("  - 'loss/prem'= 1.0 means the engine breaks even; < 1.0 means the LP profits on net.");
  console.log("  - 'hit%'     = fraction of contracts that triggered any payout");
  console.log("  - 'Sharpe'   = mean PnL / stdev PnL per contract. > 0.5 is solid.");
  console.log("  - '5% worst' = the 5th-percentile worst contract PnL — the tail loss the LP faces");
  console.log();
}

function printCsv(results: BacktestResult[]): void {
  console.log("pair,tier,contracts,total_premium,total_payouts,loss_ratio,mean_pnl,stdev_pnl,sharpe,hit_rate,p95_loss,max_loss,mean_premium_pct");
  for (const r of results) {
    console.log([
      r.pair, r.tier, r.contracts, r.totalPremium.toFixed(2), r.totalPayouts.toFixed(2),
      r.lossRatio.toFixed(4), r.meanPnl.toFixed(4), r.stdevPnl.toFixed(4),
      r.sharpe.toFixed(4), r.hitRate.toFixed(4), r.p95Loss.toFixed(4),
      r.maxLoss.toFixed(4), r.meanPremiumPct.toFixed(6),
    ].join(","));
  }
}

async function main() {
  const { only, tier, params, csv, verbose } = parseArgs();

  if (!csv) {
    console.log(`\n=== Pricing-engine backtest ===\n`);
  }

  let pairs = SUPPORTED_PAIRS;
  if (only) pairs = pairs.filter(p => only.includes(p.displayPair));
  if (tier) pairs = pairs.filter(p => p.tier === tier);

  const results: BacktestResult[] = [];
  for (const p of pairs) {
    try {
      if (verbose) console.log(`  ${p.displayPair}:`);
      const r = await backtestPair(p.displayPair, params, verbose);
      if (r) results.push(r);
    } catch (err: any) {
      if (!csv) console.log(`  ${p.displayPair.padEnd(11)} FAILED — ${err?.message ?? err}`);
    }
  }

  if (csv) printCsv(results);
  else printHumanResults(results, params);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error("Backtest failed:", err); process.exit(1); });
