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
