/**
 * oracle-node.ts
 *
 * Core logic shared by all three oracle node processes.
 * Each node is initialised with its own private key and data source fetcher.
 *
 * ISOLATION: This file is completely independent of the existing fx-oracle.ts.
 *            It does not import from or modify any existing server files.
 *            It interacts only with the OracleFacet.submitRate() on-chain.
 */

import { ethers } from "ethers";

// ============================================================
//                          TYPES
// ============================================================

export interface PriceMap {
  [pair: string]: number;
}

export type PriceFetcher = () => Promise<PriceMap>;

export interface OracleNodeConfig {
  /** Oracle wallet private key (ORACLE_KEY_A / B / C) */
  privateKey: string;

  /** Label for this node in logs */
  nodeLabel: string;

  /** RPC endpoint */
  rpcUrl: string;

  /** Diamond contract address */
  diamondAddress: string;

  /** Function that returns current prices for all supported pairs */
  fetchPrices: PriceFetcher;

  /** Poll interval in milliseconds (default 5 min) */
  pollIntervalMs?: number;

  /** Delay in ms before the first poll — use to stagger multiple node starts */
  startDelayMs?: number;

  /**
   * Maximum allowed deviation from the previous observed rate, as a fraction.
   * Submissions deviating beyond this are skipped and logged. Default 0.07 (7%).
   */
  maxDeviationFraction?: number;
}

// ============================================================
//                        ABIs
// ============================================================

const ORACLE_FACET_ABI = [
  "function submitRate(uint256 eventId, uint256 price) external",
  "function getOracleConfig() external view returns (uint256 requiredSigners, uint256 toleranceBps, uint256 oracleCount)",
  "function addOracle(address oracle) external",
  "function removeOracle(address oracle) external",
  "function isAuthorisedOracle(address oracle) external view returns (bool)",
  "function isAuthorizedOracle(address oracle) external view returns (bool)",
];

const HEDGE_FACET_ABI = [
  "function getTotalHedgeEvents() external view returns (uint256)",
  "function getHedgeEventCore(uint256) external view returns (uint256 id, address creator, string name, string underlying, uint256 strike, uint256 premiumRate, uint256 expiryDate, uint8 status, bool poolOpen, bool allowExternalLp, uint256 initialRate, bool strikeAbove)",
];

// ============================================================
//                      ORACLE NODE CLASS
// ============================================================

export class OracleNode {
  private config: Required<OracleNodeConfig>;
  private provider: ethers.JsonRpcProvider | ethers.FallbackProvider;
  private signer: ethers.Wallet;
  private writeContract: ethers.Contract;
  private readContract: ethers.Contract;
  private lastKnownRates: Map<string, number> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: OracleNodeConfig) {
    this.config = {
      pollIntervalMs: 5 * 60 * 1000,
      maxDeviationFraction: 0.07,
      startDelayMs: 0,
      ...config,
    };

    // Support comma-separated RPC URLs for automatic failover
    const rpcUrls = this.config.rpcUrl.split(',').map(u => u.trim()).filter(Boolean);
    if (rpcUrls.length > 1) {
      const providers = rpcUrls.map((url, i) => ({
        provider: new ethers.JsonRpcProvider(url),
        priority: i + 1,
        stallTimeout: 3000,
        weight: 1,
      }));
      this.provider = new ethers.FallbackProvider(providers, undefined, { quorum: 1 });
    } else {
      this.provider = new ethers.JsonRpcProvider(rpcUrls[0]);
    }
    this.signer = new ethers.Wallet(this.config.privateKey, this.provider as any);
    this.writeContract = new ethers.Contract(
      this.config.diamondAddress,
      ORACLE_FACET_ABI,
      this.signer
    );
    this.readContract = new ethers.Contract(
      this.config.diamondAddress,
      [...ORACLE_FACET_ABI, ...HEDGE_FACET_ABI],
      this.provider
    );
  }

  get label() {
    return this.config.nodeLabel;
  }

  async start() {
    this.log(`Starting — wallet: ${this.signer.address}`);

    try {
      const isAuth = await this.readContract.isAuthorisedOracle(this.signer.address);
      if (!isAuth) {
        this.log(
          "WARNING: This wallet is NOT registered as an authorised oracle. " +
          "Run addOracle() on the Diamond first. Submissions will be rejected."
        );
      } else {
        this.log("Wallet is authorised oracle — ready to submit.");
      }
    } catch {
      this.log("Wallet is authorised oracle — ready to submit.");
    }

    const startDelay = this.config.startDelayMs ?? 0;
    if (startDelay > 0) {
      this.log(`Delaying first poll by ${Math.round(startDelay / 1000)}s to stagger startup`);
      await new Promise((r) => setTimeout(r, startDelay));
    }

    await this.runCycle();

    this.intervalId = setInterval(async () => {
      try {
        await this.runCycle();
      } catch (err) {
        this.log(`Error in poll cycle: ${err instanceof Error ? err.message : err}`);
      }
    }, this.config.pollIntervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.log("Stopped.");
    }
  }

  private async runCycle() {
    this.log("Poll cycle starting...");

    let prices: PriceMap;
    try {
      prices = await this.config.fetchPrices();
      this.log(`Fetched prices for ${Object.keys(prices).length} pairs`);
    } catch (err) {
      this.log(`Price fetch failed: ${err instanceof Error ? err.message : err}`);
      return;
    }

    // getTotalHedgeEvents() may be absent on older Diamond deployments (Base/BSC).
    // If it fails, scan IDs upward from 1 and stop at the first revert — that's the end.
    const MAX_SCAN = 10_000;
    let knownTotal: number | null = null;
    try {
      knownTotal = Number(await this.readContract.getTotalHedgeEvents());
      this.log(`Total on-chain events: ${knownTotal}`);
    } catch {
      this.log(`getTotalHedgeEvents() unavailable — scanning event IDs upward`);
    }

    const now = Math.floor(Date.now() / 1000);
    let submitted = 0;
    let skipped = 0;
    let consecutiveRpcErrors = 0;
    const MAX_CONSECUTIVE_RPC_ERRORS = 3;

    for (let i = 1; i <= (knownTotal ?? MAX_SCAN); i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let core: any = null;
      try {
        core = await this.readContract.getHedgeEventCore(i);
        consecutiveRpcErrors = 0; // reset on success
      } catch (err: any) {
        if (knownTotal === null) {
          // In scan mode, distinguish contract reverts (no event) from RPC errors.
          const msg: string = (err?.message ?? "").toLowerCase();
          const isRevert = msg.includes("revert") || msg.includes("invalid event") ||
            msg.includes("call exception") || msg.includes("missing revert data");
          if (isRevert) break; // clean end-of-events
          consecutiveRpcErrors++;
          if (consecutiveRpcErrors >= MAX_CONSECUTIVE_RPC_ERRORS) {
            this.log(`  Scan aborted after ${MAX_CONSECUTIVE_RPC_ERRORS} consecutive RPC errors`);
            break;
          }
          this.log(`  Event #${i}: RPC read error (continuing scan) — ${err?.message ?? err}`);
          continue;
        }
        continue; // known-total mode: skip this ID
      }
      if (!core) continue;
      try {
        const status = Number(core.status);
        if (status !== 0) continue; // 0 = Open

        const underlying: string = core.underlying;
        const currentPrice = prices[underlying];

        if (!currentPrice || currentPrice <= 0) {
          this.log(`  Event #${i} (${underlying}): no price available — skip`);
          skipped++;
          continue;
        }

        const deviationCheck = this.checkDeviation(underlying, currentPrice);
        if (!deviationCheck.ok) {
          this.log(
            `  Event #${i} (${underlying}): deviation guard — ${deviationCheck.reason} — skip`
          );
          skipped++;
          continue;
        }

        const strike = Number(ethers.formatUnits(core.strike, 6));
        const initialRate = Number(ethers.formatUnits(core.initialRate, 6));
        const strikeAbove: boolean = core.strikeAbove;
        const effectiveStrikeAbove = strikeAbove || (!strikeAbove && strike > initialRate);
        const expiryDate = Number(core.expiryDate);
        const isExpired = expiryDate <= now;
        const isTouched = effectiveStrikeAbove
          ? currentPrice >= strike
          : currentPrice <= strike;

        if (!isExpired && !isTouched) continue;

        const priceWei = ethers.parseUnits(currentPrice.toFixed(6), 6);
        this.log(
          `  Event #${i} (${underlying}): submitting ${currentPrice} ` +
          `[${isTouched ? "ONE-TOUCH" : "EXPIRY"}]`
        );

        const tx = await this.writeContract.submitRate(i, priceWei);
        await tx.wait();

        this.lastKnownRates.set(underlying, currentPrice);
        submitted++;
      } catch (err) {
        this.log(
          `  Event #${i}: submission error — ${err instanceof Error ? err.message : err}`
        );
      }
    }

    this.log(
      `Poll cycle complete — submitted: ${submitted}, skipped: ${skipped}`
    );
  }

  private checkDeviation(
    pair: string,
    currentPrice: number
  ): { ok: boolean; reason?: string } {
    const last = this.lastKnownRates.get(pair);
    if (!last || last === 0) {
      this.lastKnownRates.set(pair, currentPrice);
      return { ok: true };
    }
    const deviation = Math.abs(currentPrice - last) / last;
    if (deviation > this.config.maxDeviationFraction) {
      return {
        ok: false,
        reason: `${(deviation * 100).toFixed(2)}% move vs last known ${last} (limit ${(this.config.maxDeviationFraction * 100).toFixed(0)}%)`,
      };
    }
    this.lastKnownRates.set(pair, currentPrice);
    return { ok: true };
  }

  private log(msg: string) {
    console.log(`[${this.config.nodeLabel}] ${msg}`);
  }
}
