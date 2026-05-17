/**
 * pairs.ts — registry of every asset the pricing engine supports.
 *
 * For each asset:
 *   - displayPair         The string used everywhere (matches fx-oracle's pair label)
 *   - assetClass          'fx' | 'commodity' | 'crypto'
 *   - source              Which historical-data API serves this pair
 *   - sourceSymbol        Symbol the source actually understands (often != displayPair)
 *   - tier                Risk-premium tier for the realized-vol markup
 *   - useEmpiricalDrift   §3.5 EM drift correction flag — true for everything except
 *                         IRP-holding G10/major-EM FX pairs
 *
 * Source policy:
 *   - **Yahoo Finance** is the primary historical-data source for FX, crypto, gold, and
 *     all commodity futures. Free, no API key, deep history, broad coverage including
 *     African frontier FX (audited 2026-05-06: 32/36 USD-Africa pairs return clean
 *     5-year series). Trade-off: anonymous use is rate-limited, no SLA.
 *   - **TwelveData** is no longer used by default. The free tier requires per-endpoint
 *     enablement and "Global trial symbols" excludes frontier FX; we kept the client
 *     code (server/pricing/data/twelvedata.ts) as an opt-in fallback if Yahoo ever
 *     starts blocking us.
 *
 * Pairs we deliberately DO NOT list (Yahoo coverage too sparse):
 *   USD/AOA  — Angola: Yahoo has 1 close (a stub), kwanza is heavily managed
 *   USD/STN  — Sao Tome: 1 close, micro-economy
 *   USD/ERN  — Eritrea: 1 close, closed economy
 *   USD/SLL  — Sierra Leone redenominated to SLE in 2022; SLE has no Yahoo history
 *   GBP/GHS  — sparse on Yahoo; use USD/GHS or EUR/GHS instead
 *
 * To add a new pair:
 *   1. Add an entry below
 *   2. Add the corresponding markup if you introduce a brand-new tier
 *   3. Run `npm run pricing:bootstrap` to seed classification + backfill history
 */

export type AssetClass = "fx" | "commodity" | "crypto";
export type DataSource = "twelvedata" | "yahoo";

export type PairTier =
  | "g10"               // EUR/USD, USD/JPY, etc. — IRP holds
  | "majorEM"           // BRL, MXN, ZAR, INR — liquid NDF, IRP roughly holds
  | "lessLiquidEM"      // PHP, COP, IDR
  | "frontierEM"        // GHS, NGN, KES, UGX, most of Africa
  | "pegged"            // pegged or managed currencies
  | "commodityMetal"    // XAU, XAG, XPT, XPD
  | "commodityEnergy"   // WTI, Brent, NatGas
  | "commodityAgri"     // sugar, coffee, cocoa, wheat
  | "cryptoMajor"       // BTC, ETH
  | "cryptoOther";      // BNB, SOL, XRP, ADA

export interface PairSpec {
  displayPair: string;
  assetClass: AssetClass;
  source: DataSource;
  sourceSymbol: string;
  tier: PairTier;
  useEmpiricalDrift: boolean;
  notes: string;
}

// ── FX: USD vs major / less-liquid EM (LatAm + Asia ex-China) ───────────────
// Audited 2026-05-17: every pair below returns ≥15y of daily closes from Yahoo
// via period1/period2 fetch. Tier assignments follow Hull / standard market
// convention: BRL/MXN/INR/ZAR/KRW = majorEM (deep NDF, IRP roughly holds);
// PHP/COP/IDR/THB/MYR/CLP = lessLiquidEM (NDF exists but thinner); ARS/TRY/
// VND/PKR/EGP = frontier-ish (capital controls, devaluation regimes).
const USD_LATAM_ASIA_PAIRS: PairSpec[] = [
  // ── majorEM ────────────────────────────────────────────────────────────
  { displayPair: "USD/BRL", assetClass: "fx", source: "yahoo", sourceSymbol: "BRL=X",
    tier: "majorEM", useEmpiricalDrift: true,
    notes: "Brazilian real — deep NDF + free float. IRP roughly holds; could flip to NDF-derived q." },
  { displayPair: "USD/MXN", assetClass: "fx", source: "yahoo", sourceSymbol: "MXN=X",
    tier: "majorEM", useEmpiricalDrift: true,
    notes: "Mexican peso — most liquid LatAm FX; deep options market." },
  { displayPair: "USD/INR", assetClass: "fx", source: "yahoo", sourceSymbol: "INR=X",
    tier: "majorEM", useEmpiricalDrift: true,
    notes: "Indian rupee — RBI-managed crawling peg; NDF active." },
  { displayPair: "USD/KRW", assetClass: "fx", source: "yahoo", sourceSymbol: "KRW=X",
    tier: "majorEM", useEmpiricalDrift: true,
    notes: "Korean won — deep NDF, BOK-managed during stress." },

  // ── lessLiquidEM ───────────────────────────────────────────────────────
  { displayPair: "USD/PHP", assetClass: "fx", source: "yahoo", sourceSymbol: "PHP=X",
    tier: "lessLiquidEM", useEmpiricalDrift: true,
    notes: "Philippine peso." },
  { displayPair: "USD/COP", assetClass: "fx", source: "yahoo", sourceSymbol: "COP=X",
    tier: "lessLiquidEM", useEmpiricalDrift: true,
    notes: "Colombian peso — commodity-currency linked (oil)." },
  { displayPair: "USD/IDR", assetClass: "fx", source: "yahoo", sourceSymbol: "IDR=X",
    tier: "lessLiquidEM", useEmpiricalDrift: true,
    notes: "Indonesian rupiah — central bank intervention common." },
  { displayPair: "USD/THB", assetClass: "fx", source: "yahoo", sourceSymbol: "THB=X",
    tier: "lessLiquidEM", useEmpiricalDrift: true,
    notes: "Thai baht — BOT managed." },
  { displayPair: "USD/MYR", assetClass: "fx", source: "yahoo", sourceSymbol: "MYR=X",
    tier: "lessLiquidEM", useEmpiricalDrift: true,
    notes: "Malaysian ringgit — NDF-only since 1998 controls." },
  { displayPair: "USD/CLP", assetClass: "fx", source: "yahoo", sourceSymbol: "CLP=X",
    tier: "lessLiquidEM", useEmpiricalDrift: true,
    notes: "Chilean peso — copper-linked." },
  { displayPair: "USD/PEN", assetClass: "fx", source: "yahoo", sourceSymbol: "PEN=X",
    tier: "lessLiquidEM", useEmpiricalDrift: true,
    notes: "Peruvian sol — copper + gold linked." },

  // ── frontier / capital-control regimes ────────────────────────────────
  { displayPair: "USD/ARS", assetClass: "fx", source: "yahoo", sourceSymbol: "ARS=X",
    tier: "frontierEM", useEmpiricalDrift: true,
    notes: "Argentine peso — hyperinflation + dual-rate regime. Empirical drift dominates." },
  { displayPair: "USD/TRY", assetClass: "fx", source: "yahoo", sourceSymbol: "TRY=X",
    tier: "frontierEM", useEmpiricalDrift: true,
    notes: "Turkish lira — heterodox policy + capital flight; classic jump regime." },
  { displayPair: "USD/VND", assetClass: "fx", source: "yahoo", sourceSymbol: "VND=X",
    tier: "frontierEM", useEmpiricalDrift: true,
    notes: "Vietnamese dong — SBV-managed crawling band." },
  { displayPair: "USD/PKR", assetClass: "fx", source: "yahoo", sourceSymbol: "PKR=X",
    tier: "frontierEM", useEmpiricalDrift: true,
    notes: "Pakistani rupee — IMF-program cycles." },
];

// ── G10 FX (DM benchmark) ────────────────────────────────────────────────────
// Useful as a control group — the engine collapses to plain GK for these
// (λ=0). Also gives the engine real σ_LR / μ for cross-pair comparisons.
const G10_FX_PAIRS: PairSpec[] = [
  { displayPair: "EUR/USD", assetClass: "fx", source: "yahoo", sourceSymbol: "EURUSD=X",
    tier: "g10", useEmpiricalDrift: false,
    notes: "Euro — IRP holds; needs rate-differential q (NDF not needed)." },
  { displayPair: "GBP/USD", assetClass: "fx", source: "yahoo", sourceSymbol: "GBPUSD=X",
    tier: "g10", useEmpiricalDrift: false,
    notes: "Sterling — IRP holds." },
  { displayPair: "USD/JPY", assetClass: "fx", source: "yahoo", sourceSymbol: "JPY=X",
    tier: "g10", useEmpiricalDrift: false,
    notes: "Yen — IRP holds; BOJ intervention is the tail risk." },
  { displayPair: "USD/CHF", assetClass: "fx", source: "yahoo", sourceSymbol: "CHF=X",
    tier: "g10", useEmpiricalDrift: false,
    notes: "Swiss franc — IRP holds; SNB floor break (Jan 2015) is in the history." },
  { displayPair: "USD/CAD", assetClass: "fx", source: "yahoo", sourceSymbol: "CAD=X",
    tier: "g10", useEmpiricalDrift: false,
    notes: "Loonie — commodity-currency, IRP holds." },
  { displayPair: "AUD/USD", assetClass: "fx", source: "yahoo", sourceSymbol: "AUDUSD=X",
    tier: "g10", useEmpiricalDrift: false,
    notes: "Aussie — commodity-currency, IRP holds." },
  { displayPair: "NZD/USD", assetClass: "fx", source: "yahoo", sourceSymbol: "NZDUSD=X",
    tier: "g10", useEmpiricalDrift: false,
    notes: "Kiwi — IRP holds." },
];

// ── FX: USD vs Africa ────────────────────────────────────────────────────────
// All audited on Yahoo 2026-05-06: full 5-year history, zero gaps >7 days.
const USD_AFRICA_PAIRS: PairSpec[] = [
  // South Africa is the only African pair with a liquid NDF + free float.
  // Tier majorEM, but we still default to empirical drift until we wire NDF.
  { displayPair: "USD/ZAR", assetClass: "fx", source: "yahoo", sourceSymbol: "USDZAR=X",
    tier: "majorEM", useEmpiricalDrift: true,
    notes: "Liquid NDF + free float; could flip to IRP-derived q once NDF feed wired." },

  // Frontier EM — capital controls, no/illiquid NDF, IRP doesn't hold.
  // Dropped from this list (Yahoo coverage too sparse): AOA, STN, ERN, SLL.
  ...["GHS","NGN","KES","UGX","TZS","RWF","ETB","EGP","MAD","TND","MZN","ZMW","MWK","CDF","SDG","GMD","LRD","BWP","NAD","SZL","LSL","SCR","MUR","DJF","SOS","BIF","CVE","KMF","MGA"]
    .map((q): PairSpec => ({
      displayPair: `USD/${q}`, assetClass: "fx", source: "yahoo", sourceSymbol: `USD${q}=X`,
      tier: "frontierEM", useEmpiricalDrift: true,
      notes: "Frontier EM: no NDF / capital controls — empirical drift required.",
    })),

  // CFA franc zones (XOF West, XAF Central) are pegged to EUR.
  // Treat as pegged tier with conservative markup.
  { displayPair: "USD/XOF", assetClass: "fx", source: "yahoo", sourceSymbol: "USDXOF=X",
    tier: "pegged", useEmpiricalDrift: true,
    notes: "West African CFA — pegged to EUR (655.957). Devaluation risk is the tail." },
  { displayPair: "USD/XAF", assetClass: "fx", source: "yahoo", sourceSymbol: "USDXAF=X",
    tier: "pegged", useEmpiricalDrift: true,
    notes: "Central African CFA — pegged to EUR (655.957). Same risk as XOF." },
];

// EUR and GBP crosses — same tier as the underlying African leg.
// EUR crosses: all 9 audited clean on Yahoo. GBP crosses: GBP/GHS dropped (sparse).
const EUR_AFRICA_PAIRS: PairSpec[] = ["GHS","NGN","KES","ZAR","XOF","XAF","EGP","MAD","TND"]
  .map((q): PairSpec => ({
    displayPair: `EUR/${q}`, assetClass: "fx", source: "yahoo", sourceSymbol: `EUR${q}=X`,
    tier: q === "ZAR" ? "majorEM" : (q === "XOF" || q === "XAF" ? "pegged" : "frontierEM"),
    useEmpiricalDrift: true,
    notes: "EUR cross — empirical drift on top of EM leg.",
  }));

const GBP_AFRICA_PAIRS: PairSpec[] = ["NGN","KES","ZAR","EGP"]
  .map((q): PairSpec => ({
    displayPair: `GBP/${q}`, assetClass: "fx", source: "yahoo", sourceSymbol: `GBP${q}=X`,
    tier: q === "ZAR" ? "majorEM" : "frontierEM",
    useEmpiricalDrift: true,
    notes: "GBP cross — empirical drift on top of EM leg.",
  }));

// ── Commodities: metals ──────────────────────────────────────────────────────
// All on Yahoo as front-month futures — TwelveData free tier doesn't carry
// these spot symbols, and Yahoo's futures basis is small for short-dated options.
const METALS: PairSpec[] = [
  { displayPair: "XAU/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "GC=F",
    tier: "commodityMetal", useEmpiricalDrift: true,
    notes: "Gold — Yahoo GC=F futures front-month (XAUUSD=X has no Yahoo history)." },
  { displayPair: "XAG/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "SI=F",
    tier: "commodityMetal", useEmpiricalDrift: true,
    notes: "Silver — Yahoo SI=F futures front-month." },
  { displayPair: "XPT/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "PL=F",
    tier: "commodityMetal", useEmpiricalDrift: true,
    notes: "Platinum — Yahoo PL=F futures front-month." },
  { displayPair: "XPD/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "PA=F",
    tier: "commodityMetal", useEmpiricalDrift: true,
    notes: "Palladium — Yahoo PA=F futures front-month." },
];

// ── Commodities: energy ──────────────────────────────────────────────────────
const ENERGY: PairSpec[] = [
  { displayPair: "XTI/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "CL=F",
    tier: "commodityEnergy", useEmpiricalDrift: true,
    notes: "WTI crude — Yahoo CL=F futures front-month." },
  { displayPair: "XBR/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "BZ=F",
    tier: "commodityEnergy", useEmpiricalDrift: true,
    notes: "Brent crude — Yahoo BZ=F futures front-month." },
  { displayPair: "XNG/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "NG=F",
    tier: "commodityEnergy", useEmpiricalDrift: true,
    notes: "Henry Hub natural gas — Yahoo NG=F futures front-month." },
];

// ── Commodities: agriculture ─────────────────────────────────────────────────
const AGRI: PairSpec[] = [
  { displayPair: "XCO/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "CC=F",
    tier: "commodityAgri", useEmpiricalDrift: true,
    notes: "Cocoa — Yahoo CC=F futures front-month." },
  { displayPair: "XCF/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "KC=F",
    tier: "commodityAgri", useEmpiricalDrift: true,
    notes: "Coffee — Yahoo KC=F futures front-month." },
  { displayPair: "XWH/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "ZW=F",
    tier: "commodityAgri", useEmpiricalDrift: true,
    notes: "Wheat — Yahoo ZW=F futures front-month." },
  { displayPair: "XSG/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "SB=F",
    tier: "commodityAgri", useEmpiricalDrift: true,
    notes: "Sugar — Yahoo SB=F futures front-month." },
];

// ── Crypto ───────────────────────────────────────────────────────────────────
// Yahoo uses BASE-USD format (note hyphen, not slash). 1827 closes per pair (5y daily,
// crypto trades 24/7 so no business-day gaps).
const CRYPTO: PairSpec[] = [
  { displayPair: "BTC/USD", assetClass: "crypto", source: "yahoo", sourceSymbol: "BTC-USD",
    tier: "cryptoMajor", useEmpiricalDrift: true, notes: "Bitcoin — no carry, empirical drift." },
  { displayPair: "ETH/USD", assetClass: "crypto", source: "yahoo", sourceSymbol: "ETH-USD",
    tier: "cryptoMajor", useEmpiricalDrift: true, notes: "Ether — no carry, empirical drift." },
  { displayPair: "BNB/USD", assetClass: "crypto", source: "yahoo", sourceSymbol: "BNB-USD",
    tier: "cryptoOther", useEmpiricalDrift: true, notes: "BNB — empirical drift." },
  { displayPair: "SOL/USD", assetClass: "crypto", source: "yahoo", sourceSymbol: "SOL-USD",
    tier: "cryptoOther", useEmpiricalDrift: true, notes: "Solana — empirical drift." },
  { displayPair: "XRP/USD", assetClass: "crypto", source: "yahoo", sourceSymbol: "XRP-USD",
    tier: "cryptoOther", useEmpiricalDrift: true, notes: "XRP — empirical drift." },
  { displayPair: "ADA/USD", assetClass: "crypto", source: "yahoo", sourceSymbol: "ADA-USD",
    tier: "cryptoOther", useEmpiricalDrift: true, notes: "Cardano — empirical drift." },
];

// ── Master registry ──────────────────────────────────────────────────────────
export const SUPPORTED_PAIRS: PairSpec[] = [
  ...G10_FX_PAIRS,
  ...USD_LATAM_ASIA_PAIRS,
  ...USD_AFRICA_PAIRS,
  ...EUR_AFRICA_PAIRS,
  ...GBP_AFRICA_PAIRS,
  ...METALS,
  ...ENERGY,
  ...AGRI,
  ...CRYPTO,
];

const BY_PAIR = new Map(SUPPORTED_PAIRS.map(p => [p.displayPair, p]));

/** Look up a pair spec; returns undefined if not registered. */
export function getPairSpec(pair: string): PairSpec | undefined {
  return BY_PAIR.get(pair);
}

/** Look up or throw — used by callers that require a registered pair. */
export function requirePairSpec(pair: string): PairSpec {
  const s = BY_PAIR.get(pair);
  if (!s) throw new Error(`Pair "${pair}" is not in the pricing-engine registry.`);
  return s;
}

/** All registered display pairs, for bootstrap and admin views. */
export function listAllPairs(): string[] {
  return SUPPORTED_PAIRS.map(p => p.displayPair);
}
