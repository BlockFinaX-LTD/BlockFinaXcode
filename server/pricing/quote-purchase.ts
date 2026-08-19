/**
 * quote-purchase.ts — price an existing pool for a hedger buying into it now.
 *
 * ## How this differs from quote.ts
 *
 * quote.ts prices a pool that does not exist yet: the caller supplies a strike,
 * a cap and an expiry, and the engine returns what the market says that costs.
 * It is consulted once, on the create-pool form.
 *
 * This prices a pool that already exists, for a buyer arriving mid-life. The
 * terms come from the chain rather than a form, the tenor is what remains
 * rather than the whole thing, and the volatility is the LP's own — recovered
 * from the premium they set — rather than the market's.
 *
 * ## Why the LP's volatility and not the market's
 *
 * Re-pricing from live market vol would quietly replace the LP's judgement with
 * the model's, and the LP is the one with capital at risk. Their premium *is* a
 * volatility view; invert it once at creation and quote against it thereafter.
 * The premium then moves with time and moneyness — which is the whole point —
 * while the level stays theirs. On event 9 that anchor is σ* = 44.45%, against
 * a 32% market: a margin the LP chose, and one a market-vol re-quote would have
 * silently deleted on day two.
 *
 * ## What moves the price
 *
 *   time remaining   less protection left, so less to pay for
 *   spot vs strike   nearer the strike, more likely to pay, so dearer
 *   pool utilisation as free capacity disappears the marginal risk rises
 *
 * The first two pull against each other, which is why a time-based discount was
 * never the right shape: on event 9 with three days left, spot at 11.73 prices
 * at $74.50 per $10,000 and spot at 11.95 prices at $122.66. A pro-rate would
 * have charged $43 for the second one.
 */

import { ethers } from "ethers";
import { getRate } from "../fx-oracle";
import { mertonCallSpread, mertonPutSpread } from "./kernel";
import { impliedVolFromPremiumRate } from "./implied-vol";
import { getPairJumpParams } from "./data/jump-params";
import { MAX_LEVERAGE_RATIO, MIN_LEVERAGE_RATIO } from "./quote";

const CHAINS: Record<number, { diamond: string; rpcs: string[] }> = {
  8453: {
    diamond: process.env.BASE_DIAMOND_ADDRESS || "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
    rpcs: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
  },
  56: {
    diamond: process.env.BSC_DIAMOND_ADDRESS || "0xaC939C0897981Abc0711ec4e37527F13106180fc",
    rpcs: ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org"],
  },
};

/**
 * Multicall3 — same address on Base and BSC.
 *
 * Three reads per quote, and a quote happens every time a buyer opens the sheet.
 * Against a public RPC that throttles at -32016 partway through, two of the
 * three landing is worse than none: the quote fails on an error that reads like
 * a revert. One eth_call cannot be throttled halfway.
 */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])",
];

const ABI = [
  "function getHedgeEventCore(uint256) view returns (uint256 id, address creator, string name, string underlying, uint256 strike, uint256 premiumRate, uint256 expiryDate, uint8 status, bool poolOpen, bool allowExternalLp, uint256 initialRate, bool strikeAbove)",
  "function getHedgeEventRange(uint256) view returns (uint256 strike, uint256 payoutCap, uint256 initialRate, bool strikeAbove)",
  "function getHedgeEventStats(uint256) view returns (uint256 settlementPrice, bool triggered, uint256 settledAt, uint256 creatorEarnings, uint256 totalLiquidity, uint256 totalExposure, uint256 totalPremiums, uint256 lpCount, uint256 hedgerCount, uint256 totalMaxPayout)",
];

/**
 * Utilisation markup. Quadratic, so early buyers are barely touched and the
 * last of the capacity is genuinely dear:
 *
 *   0% used   →  ×1.000        50% used  →  ×1.125
 *   90% used  →  ×1.405        100% used →  ×1.500
 *
 * An LP's marginal risk is not linear in how full their pool is. Nothing in the
 * engine priced this at all before — the same quote came out of an empty pool
 * and a pool with one slot left.
 */
export const UTILISATION_K = 0.5;

/** Refuse to quote inside this window; the outcome is close to decided. */
export const MIN_TENOR_HOURS = 1;

export interface PurchaseQuote {
  ok: true;
  /** Premium as a fraction of notional, after skew and floor. */
  premiumRate: number;
  premiumUsd: number;
  maxPayoutUsd: number;
  /** What the pool would have charged flat — for comparison, not for charging. */
  storedRate: number;
  storedPremiumUsd: number;
  breakdown: {
    spot: number;
    strike: number;
    payoutCap: number;
    daysRemaining: number;
    /** The LP's implied volatility, the anchor this is priced against. */
    sigmaStar: number;
    sigmaStarSource: "stored" | "inverted";
    /** Before skew and floor. */
    baseRate: number;
    utilisation: number;
    utilisationMultiplier: number;
    floorApplied: boolean;
    leverage: number;
  };
}

export interface PurchaseQuoteError {
  ok: false;
  reason: string;
}

async function provider(chainId: number): Promise<{ p: ethers.JsonRpcProvider; diamond: string }> {
  const cfg = CHAINS[chainId];
  if (!cfg) throw new Error(`Unsupported chain ${chainId}`);
  for (const url of cfg.rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(url, chainId, {
        staticNetwork: ethers.Network.from(chainId),
      });
      await p.getBlockNumber();
      return { p, diamond: cfg.diamond };
    } catch {
      /* try the next */
    }
  }
  throw new Error(`No reachable RPC for chain ${chainId}`);
}

/**
 * Price a purchase into an existing pool.
 *
 * `storedImpliedVol` is the anchor recorded at creation. When absent — pools
 * predating it, or a sync that has not run — σ* is recovered here from the
 * pool's own stored premium and its original tenor, which gives the same answer
 * at more cost. `originalTenorDays` is only needed for that path.
 */
export async function quotePurchase(args: {
  chainId: number;
  eventId: number;
  notional: number;
  storedImpliedVol?: number | null;
  minPremiumRate?: number | null;
  originalTenorDays?: number | null;
}): Promise<PurchaseQuote | PurchaseQuoteError> {
  if (!(args.notional > 0)) return { ok: false, reason: "notional must be > 0" };

  const { p, diamond } = await provider(args.chainId);
  const c = new ethers.Contract(diamond, ABI, p);
  const num = (v: bigint) => Number(ethers.formatUnits(v, 6));

  const iface = new ethers.Interface(ABI);
  const fns = ["getHedgeEventCore", "getHedgeEventRange", "getHedgeEventStats"] as const;
  let core: any, range: any, stats: any;
  try {
    const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, p);
    const res: Array<{ success: boolean; returnData: string }> = await mc.aggregate3(
      fns.map(fn => ({
        target: diamond,
        allowFailure: false,
        callData: iface.encodeFunctionData(fn, [args.eventId]),
      })),
    );
    [core, range, stats] = fns.map((fn, i) => iface.decodeFunctionResult(fn, res[i].returnData));
  } catch {
    // Multicall absent or the batch failed — fall back to three separate reads.
    [core, range, stats] = await Promise.all([
      c.getHedgeEventCore(args.eventId),
      c.getHedgeEventRange(args.eventId),
      c.getHedgeEventStats(args.eventId),
    ]);
  }

  if (Number(core.status) !== 0) return { ok: false, reason: "This pool has already settled." };
  if (!core.poolOpen) return { ok: false, reason: "This pool is closed to new cover." };

  const strike = num(range.strike);
  const payoutCap = num(range.payoutCap);
  const S0 = num(range.initialRate);
  const strikeAbove = range.strikeAbove as boolean;
  const storedRate = num(core.premiumRate);
  const expiry = Number(core.expiryDate);

  const secondsLeft = expiry - Math.floor(Date.now() / 1000);
  if (secondsLeft <= 0) return { ok: false, reason: "This pool has expired." };
  if (secondsLeft < MIN_TENOR_HOURS * 3600) {
    return {
      ok: false,
      reason:
        `Only ${Math.round(secondsLeft / 60)} minutes remain on this pool. Cover is not sold inside ` +
        `the final hour — the outcome is close to decided and the premium would be a formality.`,
    };
  }
  const T = secondsLeft / (365.25 * 24 * 3600);
  const daysRemaining = secondsLeft / 86400;

  const pair = core.underlying as string;
  const spotRow = await getRate(pair);
  if (!spotRow) return { ok: false, reason: `No live rate for ${pair}.` };
  const S = spotRow.rate;

  // Jump parameters must match what the pool was priced with, or σ* means
  // something different on the way in than on the way out. getPairJumpParams
  // resolves the pair's tier itself and applies any per-pair override.
  const jump = await getPairJumpParams(pair).catch(() => ({
    lambda: 2.0,
    jumpMean: 0.08,
    jumpStd: 0.12,
  }));

  // The anchor.
  let sigmaStar = args.storedImpliedVol ?? null;
  let sigmaStarSource: "stored" | "inverted" = "stored";
  if (!sigmaStar || !(sigmaStar > 0)) {
    const tenorDays = args.originalTenorDays ?? null;
    if (!tenorDays || !(tenorDays > 0)) {
      return {
        ok: false,
        reason:
          "No implied volatility recorded for this pool and no original tenor to recover it from. " +
          "The pool keeps its fixed rate until it is re-synced.",
      };
    }
    const inv = impliedVolFromPremiumRate({
      targetRate: storedRate,
      S: S0,
      strike,
      payoutCap,
      T: tenorDays / 365.25,
      strikeAbove,
      ...jump,
    });
    if (!inv.ok) return { ok: false, reason: `Cannot recover this pool's volatility: ${inv.reason}` };
    sigmaStar = inv.sigma;
    sigmaStarSource = "inverted";
  }

  const perUnit = strikeAbove
    ? mertonCallSpread({ S, K_lower: strike, K_upper: payoutCap, T, r: 0, q: 0, sigma: sigmaStar, ...jump })
    : mertonPutSpread({ S, K_lower: payoutCap, K_upper: strike, T, r: 0, q: 0, sigma: sigmaStar, ...jump });
  const baseRate = perUnit / S;

  const totalLiquidity = num(stats.totalLiquidity);
  const totalMaxPayout = num(stats.totalMaxPayout);
  const utilisation = totalLiquidity > 0 ? Math.min(1, totalMaxPayout / totalLiquidity) : 0;
  const utilisationMultiplier = 1 + UTILISATION_K * utilisation * utilisation;

  let premiumRate = baseRate * utilisationMultiplier;
  const floor = args.minPremiumRate ?? 0;
  const floorApplied = floor > 0 && premiumRate < floor;
  if (floorApplied) premiumRate = floor;

  const maxPayoutUsd = (args.notional * Math.abs(payoutCap - strike)) / S0;
  const premiumUsd = args.notional * premiumRate;

  if (!(premiumUsd > 0) || Math.round(premiumRate * 1e6) <= 0) {
    return {
      ok: false,
      reason:
        "The premium rounds to zero at the contract's precision — the strike is too far from spot " +
        "for the time remaining. This pool is not worth buying into right now.",
    };
  }
  const leverage = maxPayoutUsd / premiumUsd;
  if (leverage > MAX_LEVERAGE_RATIO) {
    return { ok: false, reason: `Quote rejected: ${leverage.toFixed(0)}× leverage exceeds the ${MAX_LEVERAGE_RATIO}× cap.` };
  }
  if (leverage < MIN_LEVERAGE_RATIO) {
    return {
      ok: false,
      reason:
        `Spot has moved so far through the strike that the premium is ${(100 / leverage).toFixed(0)}% of the ` +
        `most this position could pay. After fees a buyer cannot profit. This pool is no longer worth ` +
        `buying into.`,
    };
  }

  return {
    ok: true,
    premiumRate,
    premiumUsd,
    maxPayoutUsd,
    storedRate,
    storedPremiumUsd: args.notional * storedRate,
    breakdown: {
      spot: S,
      strike,
      payoutCap,
      daysRemaining,
      sigmaStar,
      sigmaStarSource,
      baseRate,
      utilisation,
      utilisationMultiplier,
      floorApplied,
      leverage,
    },
  };
}
