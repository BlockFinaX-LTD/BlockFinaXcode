/**
 * scan-onchain-everything.ts — full reconnaissance across every deployed Diamond.
 *
 * For each Diamond (current + legacy on Lisk / Base / BSC), pulls:
 *
 *   Diamond-level
 *   ──────────────
 *   - Owner, pending owner
 *   - Paused?, fees-initialised?, oracleV2-active?
 *   - HedgeFeeConfig (creation fee + 4 rate fields)
 *   - Total platform fees collected
 *   - Oracle admin (single-key path)
 *   - Multi-oracle: registered oracles, requiredSigners, toleranceBps
 *
 *   Per hedge event (1..N)
 *   ──────────────────────
 *   - core (creator, name, underlying, strike, premiumRate, expiry, status,
 *     poolOpen, allowExternalLp, initialRate, strikeAbove)
 *   - stats (settlementPrice, triggered, settledAt, creatorEarnings,
 *     totalLiquidity, totalExposure, totalPremiums, lpCount, hedgerCount,
 *     totalMaxPayout)
 *   - per-position: hedger, notional, premiumPaid, payout, status, claimed
 *   - per-deposit: lp, amount, shares, premiumsClaimed, withdrawn
 *
 * Usage:
 *   npx tsx server/pricing/scripts/scan-onchain-everything.ts
 *
 * Output:
 *   1. Human-readable summary on stdout
 *   2. Full JSON dump at ./onchain-snapshot-<timestamp>.json
 */

// Note: this script reads optional env vars (LISK_RPC_URL etc.) but has working
// public defaults, so no dotenv import is required. Env vars set in your shell
// or via Railway will still take precedence.
import { ethers } from "ethers";
import * as fs from "fs";

// ── Configuration ────────────────────────────────────────────────────────────

interface ChainConfig {
  label: string;
  chainId: number;
  diamond: string;
  rpcs: string[];                  // try in order until one works
  paymentTokenDecimals: number;
  generation: "current" | "legacy";
}

const LISK_RPCS = [process.env.LISK_RPC_URL, "https://rpc.api.lisk.com", "https://lisk.drpc.org"].filter(Boolean) as string[];
const BASE_RPCS = [process.env.BASE_RPC_URL, "https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"].filter(Boolean) as string[];

// Public RPCs throttle hard under bursts. Space every call by this much.
const RPC_INTER_CALL_MS = 600;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const BSC_RPCS  = [process.env.BSC_RPC_URL,  "https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org"].filter(Boolean) as string[];

const CHAINS: ChainConfig[] = [
  // Current production Diamonds (deployed 2026-04-06)
  { label: "Lisk-current", chainId: 1135, diamond: "0x69cB5BA093e44B345B617f72a148Ee43c4a18465", rpcs: LISK_RPCS, paymentTokenDecimals: 6,  generation: "current" },
  { label: "Base-current", chainId: 8453, diamond: "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef", rpcs: BASE_RPCS, paymentTokenDecimals: 6,  generation: "current" },
  { label: "BSC-current",  chainId: 56,   diamond: "0xaC939C0897981Abc0711ec4e37527F13106180fc", rpcs: BSC_RPCS,  paymentTokenDecimals: 18, generation: "current" },
  // Legacy Diamonds referenced by older admin pages
  { label: "Lisk-legacy",  chainId: 1135, diamond: "0x885E663645173a0791b82f0e6608921D31E3D700", rpcs: LISK_RPCS, paymentTokenDecimals: 6,  generation: "legacy" },
  { label: "Base-legacy",  chainId: 8453, diamond: "0xcC594031d1c059Eb1d6bCb0c7b1c82D31115E6E6", rpcs: BASE_RPCS, paymentTokenDecimals: 6,  generation: "legacy" },
  { label: "BSC-legacy",   chainId: 56,   diamond: "0xcC594031d1c059Eb1d6bCb0c7b1c82D31115E6E6", rpcs: BSC_RPCS,  paymentTokenDecimals: 18, generation: "legacy" },
];

// "Expanded" ABI — current production facet (v6, deployed 2026-04-06)
const ABI_EXPANDED = [
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function isPaused() view returns (bool)",
  "function isFeesInitialized() view returns (bool)",
  "function getHedgeFeeConfig() view returns (uint256 eventCreationFee, uint256 hedgerFeeRate, uint256 hedgerPayoutFeeRate, uint256 lpProfitFeeRate, uint256 creatorLoyaltyRate)",
  "function getHedgePlatformFees() view returns (uint256)",
  "function getTotalHedgeEvents() view returns (uint256)",
  "function getHedgeEventCore(uint256) view returns (uint256 id, address creator, string name, string underlying, uint256 strike, uint256 premiumRate, uint256 expiryDate, uint8 status, bool poolOpen, bool allowExternalLp, uint256 initialRate, bool strikeAbove)",
  "function getHedgeEventStats(uint256) view returns (uint256 settlementPrice, bool triggered, uint256 settledAt, uint256 creatorEarnings, uint256 totalLiquidity, uint256 totalExposure, uint256 totalPremiums, uint256 lpCount, uint256 hedgerCount, uint256 totalMaxPayout)",
  "function getEventPositionIds(uint256) view returns (uint256[])",
  "function getEventDepositIds(uint256) view returns (uint256[])",
  "function getHedgePosition(uint256) view returns (uint256 id, uint256 eventId, address hedger, uint256 notional, uint256 premiumPaid, uint256 platformFeePaid, uint256 payoutAmount, uint8 status, bool claimed)",
  "function getHedgeLpDeposit(uint256) view returns (uint256 id, uint256 eventId, address lp, uint256 amount, uint256 shares, uint256 premiumsEarned, uint256 premiumsClaimed, bool withdrawn)",
  "function getOracles() view returns (address[])",
  "function getOracleConfig() view returns (uint256 requiredSigners, uint256 toleranceBps, uint256 oracleCount, uint256 maxOracles)",
];

// "Compact" ABI — older v3-fixed facet (March 2026 lineage). Different return shape:
//   - no `underlying` field (the `name` field doubles as the pair label)
//   - no `initialRate`, no `strikeAbove`
//   - field rename: `strike` → `strikePrice`; adds `payoutPercent`
//   - field reorder: `status` last instead of mid-tuple
const ABI_COMPACT = [
  "function getTotalHedgeEvents() view returns (uint256)",
  "function getHedgeEventCore(uint256) view returns (uint256 id, address creator, string name, uint256 premiumRate, uint256 payoutPercent, uint256 strikePrice, uint256 expiryDate, bool poolOpen, bool allowExternalLp, uint8 status)",
  "function getHedgeEventStats(uint256) view returns (uint256 settlementPrice, bool triggered, uint256 settledAt, uint256 creatorEarnings, uint256 totalLiquidity, uint256 totalExposure, uint256 totalPremiums, uint256 lpCount, uint256 hedgerCount, uint256 totalMaxPayout)",
  "function getEventPositionIds(uint256) view returns (uint256[])",
  "function getEventDepositIds(uint256) view returns (uint256[])",
  "function getHedgePosition(uint256) view returns (uint256 id, uint256 eventId, address hedger, uint256 notional, uint256 premiumPaid, uint256 platformFeePaid, uint256 payoutAmount, uint8 status, bool claimed)",
  "function getHedgeLpDeposit(uint256) view returns (uint256 id, uint256 eventId, address lp, uint256 amount, uint256 shares, uint256 premiumsEarned, uint256 premiumsClaimed, bool withdrawn)",
  "function getHedgePlatformFees() view returns (uint256)",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const POSITION_STATUS = ["Active", "SettledWin", "SettledLoss", "Claimed", "Claimable", "Expired"];
const EVENT_STATUS = ["Open", "Settled", "Expired"];

function fmtAmount(raw: bigint, decimals: number): string {
  return ethers.formatUnits(raw, decimals);
}
function fmtRate6(raw: bigint): string {
  return ethers.formatUnits(raw, 6);
}
function fmtPct(raw: bigint): string {
  // Stored as fraction of 1e6
  return (Number(raw) / 1e4).toFixed(3) + "%";
}
function ts(unix: bigint | number): string {
  const n = typeof unix === "bigint" ? Number(unix) : unix;
  return n === 0 ? "—" : new Date(n * 1000).toISOString();
}

/** Try each RPC in order until one responds. Throws if none reachable. */
async function getProvider(rpcs: string[]): Promise<ethers.JsonRpcProvider> {
  let lastErr: any;
  for (const rpc of rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(rpc);
      await p.getBlockNumber();
      return p;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`All RPCs failed: ${lastErr?.message?.slice(0, 100)}`);
}

/** safeRead with retries + global pacing — public RPCs throttle hard under bursts. */
async function safeRead<T>(fn: () => Promise<T>, retries = 4): Promise<T | string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      await sleep(RPC_INTER_CALL_MS);
      return result;
    } catch (e: any) {
      if (attempt === retries) {
        await sleep(RPC_INTER_CALL_MS);
        return `revert: ${(e?.shortMessage || e?.message || "?").slice(0, 80)}`;
      }
      await sleep(1500 + attempt * 1500);   // backoff: 1.5s, 3s, 4.5s, 6s
    }
  }
  return "n/a";
}

/** Like safeRead but throws after retries — for critical reads where we need a value. */
async function strictRead<T>(fn: () => Promise<T>, label: string, retries = 5): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      await sleep(RPC_INTER_CALL_MS);
      return result;
    } catch (e: any) {
      if (attempt === retries) {
        return null;
      }
      await sleep(2000 + attempt * 2000);
    }
  }
  return null;
}

// ── Per-Diamond scan ─────────────────────────────────────────────────────────

interface DiamondSnapshot {
  label: string;
  chainId: number;
  diamond: string;
  generation: string;
  hasCode: boolean;
  // Diamond-level
  owner?: string | null;
  pendingOwner?: string | null;
  isPaused?: boolean | string;
  isFeesInitialized?: boolean | string;
  hedgeFeeConfig?: {
    eventCreationFee: string;
    hedgerFeeRate: string;
    hedgerPayoutFeeRate: string;
    lpProfitFeeRate: string;
    creatorLoyaltyRate: string;
  } | string;
  hedgePlatformFees?: string;
  totalHedgeEvents?: number | string;
  oracles?: string[] | string;
  oracleConfig?: {
    requiredSigners: number;
    toleranceBps: number;
    oracleCount: number;
    maxOracles: number;
  } | string;
  // Per-event detail
  events?: Array<{
    id: number;
    creator: string;
    name: string;
    underlying: string;
    strike: string;
    premiumRate: string;
    expiryDate: string;
    status: string;
    poolOpen: boolean;
    allowExternalLp: boolean;
    initialRate: string;
    strikeAbove: boolean;
    // stats
    settlementPrice: string;
    triggered: boolean;
    settledAt: string;
    creatorEarnings: string;
    totalLiquidity: string;
    totalExposure: string;
    totalPremiums: string;
    lpCount: number;
    hedgerCount: number;
    totalMaxPayout: string;
    // children
    positions: Array<{
      id: number;
      hedger: string;
      notional: string;
      premiumPaid: string;
      platformFeePaid: string;
      payoutAmount: string;
      status: string;
      claimed: boolean;
    }>;
    deposits: Array<{
      id: number;
      lp: string;
      amount: string;
      shares: string;
      premiumsEarned: string;
      premiumsClaimed: string;
      withdrawn: boolean;
    }>;
  }>;
  errors: string[];
}

async function scanDiamond(cfg: ChainConfig): Promise<DiamondSnapshot> {
  const out: DiamondSnapshot = {
    label: cfg.label, chainId: cfg.chainId, diamond: cfg.diamond,
    generation: cfg.generation, hasCode: false, errors: [], events: [],
  };

  let provider: ethers.JsonRpcProvider;
  try { provider = await getProvider(cfg.rpcs); }
  catch (e: any) {
    out.errors.push(`RPC unreachable: ${e?.message?.slice(0, 80)}`);
    return out;
  }

  let code: string;
  try {
    code = await provider.getCode(cfg.diamond);
  } catch (e: any) {
    out.errors.push(`getCode failed: ${e?.message?.slice(0, 80)}`);
    return out;
  }
  out.hasCode = code !== undefined && code !== "0x";
  if (!out.hasCode) {
    out.errors.push("No bytecode at address");
    return out;
  }
  await sleep(RPC_INTER_CALL_MS);

  const c = new ethers.Contract(cfg.diamond, ABI_EXPANDED, provider);
  const cCompact = new ethers.Contract(cfg.diamond, ABI_COMPACT, provider);
  const dec = cfg.paymentTokenDecimals;

  // Diamond-level reads — sequential to avoid public-RPC throttling on parallel call bursts.
  // ~15 calls × ~150ms each = ~2-3s per Diamond, totally fine.
  const owner        = await safeRead<string>(() => c.owner());
  const pendingOwner = await safeRead<string>(() => c.pendingOwner());
  const paused       = await safeRead<boolean>(() => c.isPaused());
  const feesInit     = await safeRead<boolean>(() => c.isFeesInitialized());
  const fees         = await safeRead<any>(() => c.getHedgeFeeConfig());
  const platformFees = await safeRead<bigint>(() => c.getHedgePlatformFees());
  const totalEvents  = await safeRead<bigint>(() => c.getTotalHedgeEvents());
  const oracles      = await safeRead<string[]>(() => c.getOracles());
  const oracleCfg    = await safeRead<any>(() => c.getOracleConfig());

  out.owner = typeof owner === "string" && owner.startsWith("0x") ? owner : null;
  out.pendingOwner = typeof pendingOwner === "string" && pendingOwner.startsWith("0x") ? pendingOwner : null;
  out.isPaused = typeof paused === "boolean" ? paused : String(paused);
  out.isFeesInitialized = typeof feesInit === "boolean" ? feesInit : String(feesInit);

  // ethers v6 returns tuples as Result objects — index access works either way
  if (fees && typeof fees === "object" && (fees as any).length === 5) {
    const [creation, hedger, payout, lpProfit, loyalty] = fees as any;
    out.hedgeFeeConfig = {
      eventCreationFee:    fmtAmount(creation, dec),
      hedgerFeeRate:       fmtPct(hedger),
      hedgerPayoutFeeRate: fmtPct(payout),
      lpProfitFeeRate:     fmtPct(lpProfit),
      creatorLoyaltyRate:  fmtPct(loyalty),
    };
  } else {
    out.hedgeFeeConfig = String(fees);
  }

  out.hedgePlatformFees = typeof platformFees === "bigint" ? fmtAmount(platformFees, dec) : String(platformFees);

  out.totalHedgeEvents = typeof totalEvents === "bigint" ? Number(totalEvents) : String(totalEvents);

  out.oracles = Array.isArray(oracles) ? oracles : String(oracles);

  if (oracleCfg && typeof oracleCfg === "object" && (oracleCfg as any).length === 4) {
    const [reqSigners, tolBps, oCount, maxO] = oracleCfg as any;
    out.oracleConfig = {
      requiredSigners: Number(reqSigners),
      toleranceBps:    Number(tolBps),
      oracleCount:     Number(oCount),
      maxOracles:      Number(maxO),
    };
  } else {
    out.oracleConfig = String(oracleCfg);
  }

  // Per-event scan — sequential with pacing for the same RPC throttling reason.
  // For each event, try expanded ABI first; if it reverts, try compact ABI (older
  // facet generations that have a different return tuple).
  //
  // Known-total fallbacks: when getTotalHedgeEvents() reverts intermittently on a
  // known-active Diamond, we still attempt to scan up to a sane upper bound so the
  // events get pulled. Per-event reads have their own retry loop.
  let totalSafe = typeof totalEvents === "bigint" ? Number(totalEvents) : 0;
  if (totalSafe === 0 && typeof totalEvents !== "bigint") {
    // getTotalHedgeEvents reverted — try scanning up to 20 anyway. Per-event errors will skip.
    totalSafe = 20;
    out.errors.push(`getTotalHedgeEvents reverted; scanning IDs 1..20 as fallback`);
  }
  for (let i = 1; i <= totalSafe; i++) {
    try {
      // Try expanded ABI with retries first; fall back to compact on persistent failure.
      let core = await strictRead(() => c.getHedgeEventCore(i), `event ${i} core`);
      let abiUsed: "expanded" | "compact" = "expanded";
      if (core === null) {
        core = await strictRead(() => cCompact.getHedgeEventCore(i), `event ${i} core (compact)`);
        if (core === null) {
          // Both ABIs failed and we're in fallback mode — likely event ID doesn't exist.
          continue;
        }
        abiUsed = "compact";
      }
      const stats  = await strictRead(() => c.getHedgeEventStats(i),    `event ${i} stats`);
      const posIds = (await strictRead(() => c.getEventPositionIds(i), `event ${i} pos ids`)) as bigint[] | null;
      const depIds = (await strictRead(() => c.getEventDepositIds(i),  `event ${i} dep ids`)) as bigint[] | null;
      if (!stats || !posIds || !depIds) {
        out.errors.push(`event ${i}: partial read — stats/posIds/depIds unavailable`);
        continue;
      }

      const positions: any[] = [];
      for (const pid of posIds) {
        const p = await c.getHedgePosition(pid);
        await sleep(RPC_INTER_CALL_MS);
        positions.push({
          id: Number(p.id),
          hedger: p.hedger,
          notional:        fmtAmount(p.notional, dec),
          premiumPaid:     fmtAmount(p.premiumPaid, dec),
          platformFeePaid: fmtAmount(p.platformFeePaid, dec),
          payoutAmount:    fmtAmount(p.payoutAmount, dec),
          status: POSITION_STATUS[Number(p.status)] ?? `?(${p.status})`,
          claimed: p.claimed,
        });
      }

      const deposits: any[] = [];
      for (const did of depIds) {
        const d = await c.getHedgeLpDeposit(did);
        await sleep(RPC_INTER_CALL_MS);
        deposits.push({
          id: Number(d.id),
          lp: d.lp,
          amount:         fmtAmount(d.amount, dec),
          shares:         d.shares.toString(),
          premiumsEarned: fmtAmount(d.premiumsEarned, dec),
          premiumsClaimed: fmtAmount(d.premiumsClaimed, dec),
          withdrawn: d.withdrawn,
        });
      }

      // Field name dispatch by ABI generation. Compact lacks `underlying` (uses `name`),
      // `initialRate`, and `strikeAbove`; uses `strikePrice` instead of `strike`.
      const strikeRaw = abiUsed === "expanded" ? core.strike : core.strikePrice;
      const underlying = abiUsed === "expanded" ? core.underlying : core.name;
      const initialRate = abiUsed === "expanded" ? fmtRate6(core.initialRate) : "n/a (compact ABI)";
      const strikeAbove = abiUsed === "expanded" ? core.strikeAbove : false;

      out.events!.push({
        id: Number(core.id),
        creator: core.creator,
        name: core.name + (abiUsed === "compact" ? " [compact-ABI event]" : ""),
        underlying,
        strike:      fmtRate6(strikeRaw),
        premiumRate: fmtPct(core.premiumRate),
        expiryDate:  ts(core.expiryDate),
        status: EVENT_STATUS[Number(core.status)] ?? `?(${core.status})`,
        poolOpen: core.poolOpen,
        allowExternalLp: core.allowExternalLp,
        initialRate,
        strikeAbove,

        settlementPrice: fmtRate6(stats.settlementPrice),
        triggered: stats.triggered,
        settledAt: ts(stats.settledAt),
        creatorEarnings:  fmtAmount(stats.creatorEarnings, dec),
        totalLiquidity:   fmtAmount(stats.totalLiquidity, dec),
        totalExposure:    fmtAmount(stats.totalExposure, dec),
        totalPremiums:    fmtAmount(stats.totalPremiums, dec),
        lpCount: Number(stats.lpCount),
        hedgerCount: Number(stats.hedgerCount),
        totalMaxPayout:   fmtAmount(stats.totalMaxPayout, dec),

        positions, deposits,
      });
    } catch (e: any) {
      out.errors.push(`event ${i}: ${e?.shortMessage || e?.message || "?"}`);
    }
  }

  return out;
}

// ── Pretty-print summary ─────────────────────────────────────────────────────

function printSummary(snap: DiamondSnapshot): void {
  const heading = `${snap.label} (chain ${snap.chainId})  ${snap.diamond}`;
  console.log("\n" + "=".repeat(heading.length));
  console.log(heading);
  console.log("=".repeat(heading.length));

  if (!snap.hasCode) {
    console.log("  NO BYTECODE — Diamond not deployed at this address.");
    if (snap.errors.length) console.log("  errors:", snap.errors.join("; "));
    return;
  }

  console.log(`  owner            : ${snap.owner ?? "?"}`);
  console.log(`  pendingOwner     : ${snap.pendingOwner ?? "?"}`);
  console.log(`  paused           : ${snap.isPaused}`);
  console.log(`  feesInitialized  : ${snap.isFeesInitialized}`);

  if (typeof snap.hedgeFeeConfig === "object") {
    const f = snap.hedgeFeeConfig;
    console.log(`  fees             : creation $${f.eventCreationFee}, hedger ${f.hedgerFeeRate}, payout ${f.hedgerPayoutFeeRate}, lpProfit ${f.lpProfitFeeRate}, loyalty ${f.creatorLoyaltyRate}`);
  } else {
    console.log(`  fees             : ${snap.hedgeFeeConfig}`);
  }
  console.log(`  platformFees     : ${snap.hedgePlatformFees}`);
  console.log(`  totalHedgeEvents : ${snap.totalHedgeEvents}`);

  if (Array.isArray(snap.oracles)) {
    console.log(`  oracles (${snap.oracles.length}) : ${snap.oracles.length === 0 ? "none" : snap.oracles.join(", ")}`);
  } else {
    console.log(`  oracles          : ${snap.oracles}`);
  }
  if (typeof snap.oracleConfig === "object") {
    const o = snap.oracleConfig;
    console.log(`  oracleConfig     : requiredSigners=${o.requiredSigners}, toleranceBps=${o.toleranceBps}, count=${o.oracleCount}/${o.maxOracles}`);
  }

  if (snap.errors.length > 0) {
    console.log(`  ERRORS: ${snap.errors.join("; ")}`);
  }

  if (!snap.events || snap.events.length === 0) {
    console.log("\n  (No hedge events on-chain.)");
    return;
  }

  for (const e of snap.events) {
    console.log(`\n  ── Event #${e.id} ──`);
    console.log(`     pair=${e.underlying.padEnd(8)}  name="${e.name}"`);
    console.log(`     creator=${e.creator}`);
    console.log(`     strike=${e.strike}  initialRate=${e.initialRate}  strikeAbove=${e.strikeAbove}`);
    console.log(`     premiumRate=${e.premiumRate}  expiry=${e.expiryDate}`);
    console.log(`     status=${e.status}  poolOpen=${e.poolOpen}  allowExternalLp=${e.allowExternalLp}`);
    console.log(`     ── pool ── totalLiquidity=$${e.totalLiquidity}  totalExposure=$${e.totalExposure}  totalPremiums=$${e.totalPremiums}  totalMaxPayout=$${e.totalMaxPayout}`);
    console.log(`     ── settlement ── price=${e.settlementPrice}  triggered=${e.triggered}  settledAt=${e.settledAt}  creatorEarnings=$${e.creatorEarnings}`);
    console.log(`     ── counts ── ${e.hedgerCount} hedger position(s), ${e.lpCount} lp deposit(s)`);

    if (e.positions.length > 0) {
      console.log(`     positions:`);
      for (const p of e.positions) {
        console.log(`       #${p.id}  hedger=${p.hedger}  notional=$${p.notional}  premium=$${p.premiumPaid}  payout=$${p.payoutAmount}  status=${p.status}  claimed=${p.claimed}`);
      }
    }
    if (e.deposits.length > 0) {
      console.log(`     deposits:`);
      for (const d of e.deposits) {
        console.log(`       #${d.id}  lp=${d.lp}  amount=$${d.amount}  premiumsClaimed=$${d.premiumsClaimed}  withdrawn=${d.withdrawn}`);
      }
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nBlockFinaX on-chain reconnaissance\n");
  console.log(`Scanning ${CHAINS.length} Diamond(s)...\n`);

  const snapshots: DiamondSnapshot[] = [];
  for (const cfg of CHAINS) {
    process.stderr.write(`  ${cfg.label}... `);
    const snap = await scanDiamond(cfg);
    snapshots.push(snap);
    process.stderr.write(`done (events: ${snap.events?.length ?? 0}, errors: ${snap.errors.length})\n`);
  }

  for (const snap of snapshots) printSummary(snap);

  // ── Cross-Diamond aggregate ────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("AGGREGATE SUMMARY");
  console.log("=".repeat(60));
  let totalEvents = 0, totalPositions = 0, totalDeposits = 0;
  const allUnderlyings = new Map<string, number>();
  const allCreators = new Set<string>();
  const allHedgers = new Set<string>();
  const allLps = new Set<string>();
  for (const s of snapshots) {
    if (!s.events) continue;
    for (const e of s.events) {
      totalEvents++;
      totalPositions += e.positions.length;
      totalDeposits  += e.deposits.length;
      allUnderlyings.set(e.underlying, (allUnderlyings.get(e.underlying) ?? 0) + 1);
      allCreators.add(e.creator);
      e.positions.forEach(p => allHedgers.add(p.hedger));
      e.deposits.forEach(d => allLps.add(d.lp));
    }
  }
  console.log(`Total events across all Diamonds : ${totalEvents}`);
  console.log(`Total hedger positions           : ${totalPositions}`);
  console.log(`Total LP deposits                : ${totalDeposits}`);
  console.log(`Unique creators                  : ${allCreators.size}`);
  console.log(`Unique hedgers                   : ${allHedgers.size}`);
  console.log(`Unique LPs                       : ${allLps.size}`);
  console.log(`Underlying pairs in use:`);
  Array.from(allUnderlyings.entries()).sort().forEach(([p, n]) => console.log(`   ${p.padEnd(15)} ${n} event(s)`));

  // ── JSON dump ──────────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = `onchain-snapshot-${stamp}.json`;
  fs.writeFileSync(outPath, JSON.stringify(snapshots, null, 2));
  console.log(`\nFull JSON dump written to: ${outPath}\n`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Scan failed:", err);
    process.exit(1);
  });
