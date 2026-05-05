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
const USD_AFRICA_PAIRS: PairSpec[] = [
  // South Africa is the only African pair with a liquid NDF + free float.
  // Tier majorEM, but we still default to empirical drift until we wire NDF.
  { displayPair: "USD/ZAR", assetClass: "fx", source: "twelvedata", sourceSymbol: "USD/ZAR",
    tier: "majorEM", useEmpiricalDrift: true,
    notes: "Liquid NDF + free float; could flip to IRP-derived q once NDF feed wired." },

  // Frontier EM — capital controls, no/illiquid NDF, IRP doesn't hold.
  ...["GHS","NGN","KES","UGX","TZS","RWF","ETB","EGP","MAD","TND","MZN","ZMW","MWK","AOA","CDF","SDG","GMD","SLL","LRD","BWP","NAD","SZL","LSL","SCR","MUR","DJF","ERN","SOS","BIF","CVE","KMF","MGA","STN"]
    .map((q): PairSpec => ({
      displayPair: `USD/${q}`, assetClass: "fx", source: "twelvedata", sourceSymbol: `USD/${q}`,
      tier: "frontierEM", useEmpiricalDrift: true,
      notes: "Frontier EM: no NDF / capital controls — empirical drift required.",
    })),

  // CFA franc zones (XOF West, XAF Central) are pegged to EUR.
  // Treat as pegged tier with conservative markup.
  { displayPair: "USD/XOF", assetClass: "fx", source: "twelvedata", sourceSymbol: "USD/XOF",
    tier: "pegged", useEmpiricalDrift: true,
    notes: "West African CFA — pegged to EUR (655.957). Devaluation risk is the tail." },
  { displayPair: "USD/XAF", assetClass: "fx", source: "twelvedata", sourceSymbol: "USD/XAF",
    tier: "pegged", useEmpiricalDrift: true,
    notes: "Central African CFA — pegged to EUR (655.957). Same risk as XOF." },
];

// EUR and GBP crosses — same tier as the underlying African leg.
const EUR_AFRICA_PAIRS: PairSpec[] = ["GHS","NGN","KES","ZAR","XOF","XAF","EGP","MAD","TND"]
  .map((q): PairSpec => ({
    displayPair: `EUR/${q}`, assetClass: "fx", source: "twelvedata", sourceSymbol: `EUR/${q}`,
    tier: q === "ZAR" ? "majorEM" : (q === "XOF" || q === "XAF" ? "pegged" : "frontierEM"),
    useEmpiricalDrift: true,
    notes: "EUR cross — empirical drift on top of EM leg.",
  }));

const GBP_AFRICA_PAIRS: PairSpec[] = ["GHS","NGN","KES","ZAR","EGP"]
  .map((q): PairSpec => ({
    displayPair: `GBP/${q}`, assetClass: "fx", source: "twelvedata", sourceSymbol: `GBP/${q}`,
    tier: q === "ZAR" ? "majorEM" : "frontierEM",
    useEmpiricalDrift: true,
    notes: "GBP cross — empirical drift on top of EM leg.",
  }));

// ── Commodities: metals ──────────────────────────────────────────────────────
const METALS: PairSpec[] = [
  // Gold is on TwelveData free tier. Silver/platinum/palladium are paid; fall back to Yahoo.
  { displayPair: "XAU/USD", assetClass: "commodity", source: "twelvedata", sourceSymbol: "XAU/USD",
    tier: "commodityMetal", useEmpiricalDrift: true,
    notes: "Gold spot. Carry irrelevant; use empirical drift (model gold's secular trend)." },
  { displayPair: "XAG/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "SI=F",
    tier: "commodityMetal", useEmpiricalDrift: true,
    notes: "Silver — TwelveData paid-only; Yahoo silver futures front-month." },
  { displayPair: "XPT/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "PL=F",
    tier: "commodityMetal", useEmpiricalDrift: true,
    notes: "Platinum — Yahoo platinum futures front-month." },
  { displayPair: "XPD/USD", assetClass: "commodity", source: "yahoo", sourceSymbol: "PA=F",
    tier: "commodityMetal", useEmpiricalDrift: true,
    notes: "Palladium — Yahoo palladium futures front-month." },
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
const CRYPTO: PairSpec[] = [
  { displayPair: "BTC/USD", assetClass: "crypto", source: "twelvedata", sourceSymbol: "BTC/USD",
    tier: "cryptoMajor", useEmpiricalDrift: true,
    notes: "Bitcoin — no carry, empirical drift." },
  { displayPair: "ETH/USD", assetClass: "crypto", source: "twelvedata", sourceSymbol: "ETH/USD",
    tier: "cryptoMajor", useEmpiricalDrift: true,
    notes: "Ether — no carry, empirical drift." },
  { displayPair: "BNB/USD", assetClass: "crypto", source: "twelvedata", sourceSymbol: "BNB/USD",
    tier: "cryptoOther", useEmpiricalDrift: true,
    notes: "BNB — empirical drift." },
  { displayPair: "SOL/USD", assetClass: "crypto", source: "twelvedata", sourceSymbol: "SOL/USD",
    tier: "cryptoOther", useEmpiricalDrift: true,
    notes: "Solana — empirical drift." },
  { displayPair: "XRP/USD", assetClass: "crypto", source: "twelvedata", sourceSymbol: "XRP/USD",
    tier: "cryptoOther", useEmpiricalDrift: true,
    notes: "XRP — empirical drift." },
  { displayPair: "ADA/USD", assetClass: "crypto", source: "twelvedata", sourceSymbol: "ADA/USD",
    tier: "cryptoOther", useEmpiricalDrift: true,
    notes: "Cardano — empirical drift." },
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
