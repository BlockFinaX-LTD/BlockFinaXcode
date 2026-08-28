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
import { resolveSigmaStar } from "./sigma-star";
import { getPairJumpParams } from "./data/jump-params";

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

// The maths, and these two, live in ./purchase-math so they can be tested
// without a chain behind them. Re-exported: callers import them from here.
export { pricePurchase, UTILISATION_K, MIN_TENOR_HOURS } from "./purchase-math";
import { pricePurchase, MIN_TENOR_HOURS } from "./purchase-math";

// Defined in ./purchase-math beside the function that builds them.
export type { PurchaseQuote, PurchaseQuoteError } from "./purchase-math";
import type { PurchaseQuote, PurchaseQuoteError } from "./purchase-math";

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

  /**
   * The anchor.
   *
   * Delegated to resolveSigmaStar, which takes the pool's creation time from
   * the chain rather than from the mirror. `hedge_events.created_at` is the
   * row-insert time, so a tenor derived from it is short by however long
   * chain-sync took to notice the pool, and sigma is sensitive enough to tenor
   * on short cover that the same pool priced from two mirrors returned 43.41%
   * and 29.21%. A price that moves with job timing is not a price.
   *
   * The answer is cached back onto the event, so the chain is read once per
   * pool rather than once per quote.
   */
  let sigmaStar = args.storedImpliedVol ?? null;
  let sigmaStarSource: "stored" | "inverted" = "stored";
  if (!sigmaStar || !(sigmaStar > 0)) {
    const resolved = await resolveSigmaStar({
      chainId: args.chainId,
      eventId: args.eventId,
      storedRate,
      spotAtCreation: S0,
      strike,
      payoutCap,
      strikeAbove,
      pair,
      expiryUnixSeconds: expiry,
      mirrorCreatedAt: args.originalTenorDays
        ? new Date((expiry - args.originalTenorDays * 86400) * 1000)
        : null,
    });
    if (!resolved) {
      return {
        ok: false,
        reason:
          "This pool's opening volatility could not be recovered, so there is no basis to " +
          "re-price it. It keeps its fixed rate.",
      };
    }
    sigmaStar = resolved.sigma;
    sigmaStarSource = "inverted";
  }

  return pricePurchase({
    notional: args.notional,
    S, S0, strike, payoutCap, strikeAbove, T, daysRemaining,
    sigmaStar, sigmaStarSource, jump,
    totalLiquidity: num(stats.totalLiquidity),
    totalMaxPayout: num(stats.totalMaxPayout),
    minPremiumRate: args.minPremiumRate ?? 0,
    storedRate,
  });
}
