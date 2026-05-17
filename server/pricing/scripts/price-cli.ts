/**
 * price-cli.ts — interactive command-line pricing tool.
 *
 * Run with:
 *   npx tsx server/pricing/scripts/price-cli.ts \
 *     --pair USD/GHS --tier frontierEM \
 *     --spot 11.07 --strike 11.40 --cap 12.00 \
 *     --notional 1000 --days 60 \
 *     --usd-rate 0.045 --drift 0.12 \
 *     --sigma 0.22 --long-run-sigma 0.20 \
 *     --direction up
 *
 * What it does:
 *   - Runs the SAME Merton jump-diffusion + GARCH integrated-variance math
 *     the production /api/pricing/quote endpoint uses
 *   - No DB, no oracle, no network — just kernel math against your inputs
 *   - Prints full breakdown including jump premium lift vs flat-vol GK,
 *     leverage ratio, and the integrated σ that actually fed the kernel
 *
 * Three modes:
 *   single   — price one scenario (default)
 *   sweep    — sweep one input across a range, print a table
 *   compare  — price the same scenario across multiple pairs/tiers
 */

import {
  mertonCallSpread,
  mertonPutSpread,
  premiumInBaseCurrency,
} from "../kernel";
import {
  integratedVariance,
  TIER_PERSISTENCE,
  longRunVolFromCloses,
} from "../data/garch";
import { TIER_JUMP_PARAMS } from "../data/jump-params";
import type { PairTier } from "../data/pairs";
import { computeRealizedVol } from "../data/vol-math";

interface CliInputs {
  pair: string;
  tier: PairTier;
  spot: number;
  strike: number;
  cap: number;
  notional: number;
  days: number;
  usdRate: number;
  drift: number;
  sigma: number;
  longRunSigma: number;
  direction: "up" | "down";
}

const ALL_TIERS: PairTier[] = [
  "g10", "majorEM", "lessLiquidEM", "frontierEM", "pegged",
  "commodityMetal", "commodityEnergy", "commodityAgri",
  "cryptoMajor", "cryptoOther",
];

// ── arg parsing (no external dep) ────────────────────────────────────────────

function parseArgs(argv: string[]): { mode: string; args: Record<string, string> } {
  const args: Record<string, string> = {};
  let mode = "single";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (i === 2 && !a.startsWith("--")) { mode = a; continue; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = "true";
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return { mode, args };
}

function num(args: Record<string, string>, key: string, dflt?: number): number {
  const v = args[key];
  if (v === undefined) {
    if (dflt !== undefined) return dflt;
    throw new Error(`Missing required --${key}`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} must be a number, got "${v}"`);
  return n;
}

function readInputs(args: Record<string, string>): CliInputs {
  const tier = (args.tier ?? "frontierEM") as PairTier;
  if (!ALL_TIERS.includes(tier)) {
    throw new Error(`--tier must be one of: ${ALL_TIERS.join(", ")}`);
  }
  const direction = (args.direction ?? "up") as "up" | "down";
  if (direction !== "up" && direction !== "down") {
    throw new Error(`--direction must be "up" or "down"`);
  }
  // When --from-db is set, --spot / --sigma can be omitted (filled from the DB
  // history). We mark them as NaN here and validate after maybeOverrideFromDb.
  const fromDb = !!args["from-db"];
  const spot = fromDb ? num(args, "spot", NaN) : num(args, "spot");
  const sigma = fromDb ? num(args, "sigma", NaN) : num(args, "sigma");
  const longRun = args["long-run-sigma"] !== undefined
    ? num(args, "long-run-sigma")
    : (fromDb ? NaN : sigma);
  return {
    pair: args.pair ?? "USD/GHS",
    tier,
    spot,
    strike: num(args, "strike"),
    cap: num(args, "cap"),
    notional: num(args, "notional", 1000),
    days: num(args, "days", 60),
    usdRate: num(args, "usd-rate", 0.045),
    drift: fromDb ? num(args, "drift", NaN) : num(args, "drift", 0.0),
    sigma,
    longRunSigma: longRun,
    direction,
  };
}

function validateInputs(i: CliInputs): void {
  for (const [k, v] of Object.entries(i)) {
    if (typeof v === "number" && !Number.isFinite(v)) {
      throw new Error(`Missing or non-finite input "${k}". Provide --${k.replace(/([A-Z])/g, "-$1").toLowerCase()} or use --from-db.`);
    }
  }
}

/**
 * If `--from-db` was passed, read 5y of historical closes from the DB for
 * the pair and compute σ_LR (long-run sample stdev), σ_0 (EWMA-60), and μ
 * (empirical drift over the window). Override the corresponding CliInputs
 * fields.
 *
 * Requires `historical_fx_closes` to be populated for the pair — run
 * `pricing:backfill-30y --only <pair>` first.
 */
async function maybeOverrideFromDb(inputs: CliInputs, args: Record<string, string>): Promise<CliInputs> {
  if (!args["from-db"]) return inputs;

  // Lazy-load DB-dependent modules so the CLI doesn't require DATABASE_URL
  // unless the user explicitly asked for DB-backed pricing.
  const { getRecentCloses } = await import("../data/historical");

  const closes = await getRecentCloses(inputs.pair, 252 * 5);   // ~5y window
  if (closes.length < 60) {
    throw new Error(
      `--from-db: not enough history for ${inputs.pair} (have ${closes.length} closes, need ≥60).\n` +
      `Run: npm run pricing:backfill-30y -- --only ${inputs.pair}`,
    );
  }

  const closeNumbers = closes.map(c => Number(c.close));

  // σ_LR — equally-weighted sample stdev over the full window (Hull §23.1)
  const sigmaLongRun = longRunVolFromCloses(closeNumbers);

  // σ_0 — EWMA-94 over the last 60+ returns (vol-math.ts default)
  // Use the most recent 61 closes so we get exactly 60 returns
  const recent = closeNumbers.slice(-61);
  const sigmaEwma = computeRealizedVol(recent);

  // μ — annualized log-return over the full window
  const oldest = closeNumbers[0];
  const newest = closeNumbers[closeNumbers.length - 1];
  const years = closes.length / 252;
  const mu = Math.log(newest / oldest) / years;
  // cap |μ| at ±50% to match drift.ts safety bound
  const muCapped = Math.max(-0.5, Math.min(0.5, mu));

  console.log(`\n  ── DB-sourced inputs for ${inputs.pair} ──`);
  console.log(`     window         : ${closes[0].date} → ${closes[closes.length - 1].date} (${years.toFixed(2)}y, ${closes.length} closes)`);
  console.log(`     σ_LR (sample)  : ${(sigmaLongRun * 100).toFixed(2)}%`);
  console.log(`     σ_0 (EWMA-94)  : ${(sigmaEwma * 100).toFixed(2)}%`);
  console.log(`     μ (empirical)  : ${(muCapped * 100).toFixed(2)}%/yr${mu !== muCapped ? "  (capped from " + (mu * 100).toFixed(1) + "%)" : ""}`);
  console.log(`     latest close   : ${newest.toFixed(4)}`);

  return {
    ...inputs,
    spot: args.spot !== undefined ? inputs.spot : newest,
    drift: args.drift !== undefined ? inputs.drift : muCapped,
    sigma: args.sigma !== undefined ? inputs.sigma : sigmaEwma,
    longRunSigma: args["long-run-sigma"] !== undefined ? inputs.longRunSigma : sigmaLongRun,
  };
}

// ── pricing ──────────────────────────────────────────────────────────────────

interface PriceResult {
  premiumUsd: number;
  premiumRate: number;
  maxPayoutUsd: number;
  leverage: number;
  sigmaIntegrated: number;
  jumpComponentBps: number;       // jump premium lift in basis points
  flatGkPremiumUsd: number;
  jump: { lambda: number; jumpMean: number; jumpStd: number };
  persistence: number;
}

function priceOne(i: CliInputs): PriceResult {
  const T_years = i.days / 365.25;
  const qEffective = i.usdRate - i.drift;
  const persistence = TIER_PERSISTENCE[i.tier];
  const jump = TIER_JUMP_PARAMS[i.tier];

  const integ = integratedVariance({
    sigma0: i.sigma,
    sigmaLongRun: i.longRunSigma,
    TYears: T_years,
    persistence,
  });

  const strikeAbove = i.direction === "up";
  const kLower = strikeAbove ? i.strike : i.cap;
  const kUpper = strikeAbove ? i.cap : i.strike;

  const fn = strikeAbove ? mertonCallSpread : mertonPutSpread;

  const spread = fn({
    S: i.spot, K_lower: kLower, K_upper: kUpper,
    T: T_years, r: i.usdRate, q: qEffective,
    sigma: integ.sigmaIntegrated,
    lambda: jump.lambda, jumpMean: jump.jumpMean, jumpStd: jump.jumpStd,
  });
  const flatGk = fn({
    S: i.spot, K_lower: kLower, K_upper: kUpper,
    T: T_years, r: i.usdRate, q: qEffective,
    sigma: integ.sigmaIntegrated,
    lambda: 0, jumpMean: 0, jumpStd: 0,
  });

  const premiumUsd = premiumInBaseCurrency(spread, i.notional, i.spot);
  const flatGkPremiumUsd = premiumInBaseCurrency(flatGk, i.notional, i.spot);
  const premiumRate = premiumUsd / i.notional;
  const maxPayoutUsd = (i.notional * Math.abs(i.cap - i.strike)) / i.spot;
  const leverage = premiumUsd > 0 ? maxPayoutUsd / premiumUsd : Infinity;
  const jumpComponentBps = flatGkPremiumUsd > 0
    ? ((premiumUsd - flatGkPremiumUsd) / flatGkPremiumUsd) * 10_000
    : 0;

  return {
    premiumUsd, premiumRate, maxPayoutUsd, leverage,
    sigmaIntegrated: integ.sigmaIntegrated,
    jumpComponentBps, flatGkPremiumUsd,
    jump, persistence,
  };
}

// ── printing ────────────────────────────────────────────────────────────────

function pct(n: number, decimals = 2): string { return `${(n * 100).toFixed(decimals)}%`; }
function usd(n: number): string { return `$${n.toFixed(2)}`; }

function printSingle(i: CliInputs, r: PriceResult): void {
  console.log("");
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log(`│  BlockFinaX pricing engine  ·  ${i.pair.padEnd(20)} │`);
  console.log("└─────────────────────────────────────────────────────────┘");
  console.log("");
  console.log(`  Spot               : ${i.spot.toFixed(4)}`);
  console.log(`  Strike → Cap       : ${i.strike} → ${i.cap}  (${i.direction === "up" ? "upward" : "downward"})`);
  console.log(`  Notional           : ${usd(i.notional)} USDC`);
  console.log(`  Tenor              : ${i.days} days  (T=${(i.days / 365.25).toFixed(4)}y)`);
  console.log("");
  console.log(`  USD risk-free      : ${pct(i.usdRate, 2)}`);
  console.log(`  Empirical drift μ  : ${pct(i.drift, 2)}/yr`);
  console.log(`  q_effective        : ${pct(i.usdRate - i.drift, 2)}`);
  console.log(`  σ EWMA (spot)      : ${pct(i.sigma, 1)}`);
  console.log(`  σ long-run         : ${pct(i.longRunSigma, 1)}`);
  console.log("");
  console.log(`  Engine             : Merton jump-diffusion + GARCH-integrated variance`);
  console.log(`  Tier               : ${i.tier}`);
  console.log(`    persistence α+β  : ${r.persistence.toFixed(2)}`);
  console.log(`    λ (jumps/yr)     : ${r.jump.lambda.toFixed(2)}`);
  console.log(`    μ_J (mean log-jump): ${pct(r.jump.jumpMean, 2)}`);
  console.log(`    σ_J (jump stdev) : ${pct(r.jump.jumpStd, 1)}`);
  console.log(`  σ integrated → kernel: ${pct(r.sigmaIntegrated, 1)}`);
  console.log("");
  console.log("─────────────────────────── result ──────────────────────────");
  console.log(`  Premium            : ${usd(r.premiumUsd)}  (${pct(r.premiumRate, 3)} of notional)`);
  console.log(`  Max payout         : ${usd(r.maxPayoutUsd)}`);
  console.log(`  Leverage ratio     : ${r.leverage.toFixed(1)}×`);
  console.log(`  Flat-vol GK ref    : ${usd(r.flatGkPremiumUsd)}`);
  console.log(`  Jump premium lift  : ${r.jumpComponentBps.toFixed(0)} bps`);
  console.log("─────────────────────────────────────────────────────────────");
  if (r.leverage > 100) {
    console.log("");
    console.log(`  ⚠️  Leverage > 100× — production engine would REJECT this quote.`);
    console.log(`     Try moving the strike closer to spot or narrowing the cap.`);
  }
  console.log("");
}

function sweep(base: CliInputs, args: Record<string, string>): void {
  const sweepVar = args.var ?? "days";
  const rangeStr = args.range ?? "7,14,30,60,90,180";
  const values = rangeStr.split(",").map(Number);

  console.log("");
  console.log(`  Sweep on --${sweepVar} for ${base.pair} (${base.direction})`);
  console.log("");
  console.log(`  ${sweepVar.padEnd(10)} │  premium │  rate     │  σ_int  │  jump lift │  leverage`);
  console.log(`  ${"".padEnd(10, "─")}─┼──────────┼───────────┼─────────┼────────────┼──────────`);

  for (const v of values) {
    const i: any = { ...base };
    if (sweepVar === "days") i.days = v;
    else if (sweepVar === "sigma") { i.sigma = v; i.longRunSigma = v; }
    else if (sweepVar === "strike") i.strike = v;
    else if (sweepVar === "cap") i.cap = v;
    else if (sweepVar === "spot") i.spot = v;
    else if (sweepVar === "drift") i.drift = v;
    else throw new Error(`unknown --var ${sweepVar}`);

    const r = priceOne(i as CliInputs);
    console.log(
      `  ${String(v).padEnd(10)} │ ${usd(r.premiumUsd).padStart(8)} │ ` +
      `${pct(r.premiumRate, 3).padStart(8)}  │ ${pct(r.sigmaIntegrated, 1).padStart(6)} │ ` +
      `${(r.jumpComponentBps / 100).toFixed(2).padStart(6)}%    │ ${r.leverage.toFixed(1).padStart(7)}×`,
    );
  }
  console.log("");
}

function compare(base: CliInputs, _args: Record<string, string>): void {
  // Default comparison set: a representative pair from each tier we care about
  const pairs: Array<{ pair: string; tier: PairTier; sigma: number; drift: number }> = [
    { pair: "EUR/USD", tier: "g10",         sigma: 0.08, drift: 0.0   },
    { pair: "USD/ZAR", tier: "majorEM",     sigma: 0.16, drift: 0.04  },
    { pair: "USD/PHP", tier: "lessLiquidEM",sigma: 0.10, drift: 0.02  },
    { pair: "USD/GHS", tier: "frontierEM",  sigma: 0.22, drift: 0.12  },
    { pair: "USD/NGN", tier: "frontierEM",  sigma: 0.28, drift: 0.15  },
    { pair: "USD/HKD", tier: "pegged",      sigma: 0.02, drift: 0.0   },
  ];

  console.log("");
  console.log(`  Compare across pairs  ·  ${base.days}-day, ${pct((base.strike - base.spot)/base.spot, 1)} OTM strike → ${pct((base.cap-base.spot)/base.spot,1)} cap, $${base.notional}`);
  console.log("");
  console.log(`  Pair      │  tier         │  σ_int  │  premium │  rate     │  jump lift │  leverage`);
  console.log(`  ─────────┼───────────────┼─────────┼──────────┼───────────┼────────────┼──────────`);

  for (const p of pairs) {
    // Re-scale strike/cap as percentages of spot so the comparison is honest
    const otmFraction = (base.strike - base.spot) / base.spot;
    const capFraction = (base.cap - base.spot) / base.spot;
    const scenario: CliInputs = {
      ...base,
      pair: p.pair,
      tier: p.tier,
      spot: base.spot,                 // keep the same notional spot for comparability
      strike: base.spot * (1 + otmFraction),
      cap: base.spot * (1 + capFraction),
      sigma: p.sigma,
      longRunSigma: p.sigma,
      drift: p.drift,
    };
    const r = priceOne(scenario);
    console.log(
      `  ${p.pair.padEnd(9)} │ ${p.tier.padEnd(13)} │ ${pct(r.sigmaIntegrated,1).padStart(6)} │ ` +
      `${usd(r.premiumUsd).padStart(8)} │ ${pct(r.premiumRate,3).padStart(8)}  │ ` +
      `${(r.jumpComponentBps/100).toFixed(2).padStart(6)}%    │ ${r.leverage.toFixed(1).padStart(7)}×`,
    );
  }
  console.log("");
  console.log("  Note: same OTM %, same tenor, same notional — only the tier-specific");
  console.log("  jump params + σ change. This isolates how much the engine charges per tier.");
  console.log("");
}

// ── help ────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
BlockFinaX pricing CLI — Merton jump-diffusion + GARCH integrated variance

USAGE
  npx tsx server/pricing/scripts/price-cli.ts <mode> [flags]

MODES
  single      Price one scenario (default)
  sweep       Sweep one input across a range, print a table
              --var <days|sigma|strike|cap|spot|drift>
              --range <comma-separated values>
  compare     Price the same OTM-percentage scenario across all tiers

REQUIRED FLAGS (single mode)
  --spot <number>            current rate
  --strike <number>          entry-edge of payout zone
  --cap <number>             far-edge of payout zone
  --sigma <number>           σ (annualized, e.g. 0.22 = 22%)

OPTIONAL FLAGS
  --pair <string>            display label (default USD/GHS)
  --tier <tier>              ${ALL_TIERS.join(" | ")}
                             (default frontierEM)
  --notional <USD>           (default 1000)
  --days <int>               (default 60)
  --usd-rate <decimal>       (default 0.045)
  --drift <decimal>          empirical drift μ (default 0)
  --long-run-sigma <decimal> (default = --sigma)
  --direction <up|down>      (default up)
  --from-db                  pull spot / σ_0 / σ_LR / μ from historical_fx_closes
                             for the pair (run pricing:backfill-30y first).
                             When set, --spot / --sigma / --drift become optional
                             — only ones you explicitly pass are kept.

EXAMPLES
  # Price a 60-day USD/GHS upward hedge
  npx tsx server/pricing/scripts/price-cli.ts \\
    --spot 11.07 --strike 11.40 --cap 12.00 \\
    --sigma 0.22 --drift 0.12 --days 60

  # Sweep tenor on the same scenario
  npx tsx server/pricing/scripts/price-cli.ts sweep \\
    --spot 11.07 --strike 11.40 --cap 12.00 --sigma 0.22 --drift 0.12 \\
    --var days --range 7,14,30,60,90,180

  # Compare a 5% OTM 60-day upward hedge across every tier
  npx tsx server/pricing/scripts/price-cli.ts compare \\
    --spot 100 --strike 105 --cap 110 --sigma 0.20 --days 60
`);
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { mode, args } = parseArgs(process.argv);
  if (args.help || args.h || mode === "help") { printHelp(); return; }

  try {
    let inputs = readInputs(args);
    // --from-db: pull σ_LR / σ_0 / μ / spot from the backfilled history table
    inputs = await maybeOverrideFromDb(inputs, args);
    // Catch any inputs that remained NaN (e.g. --from-db with no history)
    validateInputs(inputs);

    if (mode === "single") {
      const r = priceOne(inputs);
      printSingle(inputs, r);
    } else if (mode === "sweep") {
      sweep(inputs, args);
    } else if (mode === "compare") {
      compare(inputs, args);
    } else {
      console.error(`Unknown mode "${mode}"`);
      printHelp();
      process.exit(1);
    }
  } catch (e: any) {
    console.error(`Error: ${e?.message ?? e}`);
    console.error(`Run with --help for usage.`);
    process.exit(1);
  }
}

main();
