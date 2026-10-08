import { isWalletSandbox, walletDefaultChainId, sandboxTokenAddress, sandboxDiamondAddress, assertWalletTransactionsEnabled } from "./wallet-environment";
/**
 * Hedge Contract Integration - Direct on-chain calls to the HedgeFacet
 *
 * All interaction with the BlockFinaX Diamond contracts goes through this file.
 * Supported chains: Base (8453) and BSC (56). Lisk has been removed — we no
 * longer deploy smart contracts on the Lisk network.
 *
 * Covers: event creation, buying protection (hedger), providing liquidity (LP),
 * claiming payouts, withdrawing LP funds, fetching event and position data.
 * Exports: DIAMOND_ADDRESS, USDC_ADDRESS, getHedgeFacetContract, createHedgeEvent,
 *          buyProtection, depositLiquidity, claimPayout, withdrawLiquidity, and more.
 */
import { ethers } from 'ethers';

// Default chain = Base
export const DIAMOND_ADDRESS = isWalletSandbox ? sandboxDiamondAddress : '0xbCC51E62C4948FD35ab505bd71804C849601e4Ef';
export const USDC_ADDRESS = isWalletSandbox ? sandboxTokenAddress : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const USDT_ADDRESS_SEPOLIA: string = "0x05D032ac25d322df992303dCa074EE7392C117b9";
export const PRECISION = 1e6;

export const CHAIN_RPC_MAP: Record<number, string> = isWalletSandbox ? { 84532: 'https://sepolia.base.org' } : {
  8453: 'https://mainnet.base.org',
  56:   'https://bsc-dataseed.binance.org',
};

export const CHAIN_EXPLORER_API_MAP: Record<number, string> = isWalletSandbox ? { 84532: 'https://base-sepolia.blockscout.com/api' } : {
  8453: 'https://base.blockscout.com/api',
  56:   'https://api.bscscan.com/api',
};

export const CHAIN_TOKEN_DECIMALS_MAP: Record<number, number> = isWalletSandbox ? { 84532: 6 } : {
  8453: 6,
  56:   18,
};

export const CHAIN_DIAMOND_MAP: Record<number, string> = isWalletSandbox ? { 84532: sandboxDiamondAddress } : {
  8453: '0xbCC51E62C4948FD35ab505bd71804C849601e4Ef',  // Base Mainnet
  56:   '0xaC939C0897981Abc0711ec4e37527F13106180fc',  // BSC Mainnet
};

export const CHAIN_USDC_MAP: Record<number, string> = isWalletSandbox ? { 84532: sandboxTokenAddress } : {
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  56:   '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
};

export const CHAIN_USDT_MAP: Record<number, string> = isWalletSandbox ? {} : {
  8453: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  56:   '0x55d398326f99059fF775485246999027B3197955',
};

export function getUsdtAddress(chainId: number): string {
  return CHAIN_USDT_MAP[chainId] || '';
}

export const CHAIN_SAFE_MAP: Record<number, string> = isWalletSandbox ? {} : {
  8453: '0x7909a2f1fAd63678eEDcC5A75462B66D062189Bb',
  56:   '0x2a0ab363E01b518B189218e39f79Bfc3AE310807',
};

export const CHAIN_EXPLORER_MAP: Record<number, string> = isWalletSandbox ? { 84532: 'https://sepolia.basescan.org' } : {
  8453: 'https://basescan.org',
  56:   'https://bscscan.com',
};

export function getDiamondAddress(chainId: number): string {
  return CHAIN_DIAMOND_MAP[chainId] || DIAMOND_ADDRESS;
}

export function getUsdcAddress(chainId: number): string {
  return CHAIN_USDC_MAP[chainId] || USDC_ADDRESS;
}

export function getSafeAddress(chainId: number): string {
  return CHAIN_SAFE_MAP[chainId] || '';
}

export function getExplorerUrl(chainId: number): string {
  return CHAIN_EXPLORER_MAP[chainId] || (isWalletSandbox ? 'https://sepolia.basescan.org' : 'https://basescan.org');
}

const PROTECTION_BOUGHT_TOPIC = '0x4481909ec72817de979b2b76609a83284e6faacdfa26174543ad38431274eed5';
const LIQUIDITY_DEPOSITED_TOPIC = '0xbff736a88c4d6fc1bc430cb94a5d36706a0d4b369de04ea80fc121296def3cb2';
const EVENT_CREATED_TOPIC = '0x971a52d02f8b95a7a75a0f42d1fb5ab027b59b71c15f1f6095e5323ddd308736';

/**
 * Multicall3 — the same address on Base, BSC and most other chains.
 *
 * Reading the market is four calls per pool, and the public RPCs throttle well
 * before that finishes. At ten pools it is forty round trips; mainnet.base.org
 * answers a portion of them with -32016 "over rate limit", ethers surfaces that
 * as CALL_EXCEPTION "missing revert data" — indistinguishable from a genuine
 * revert — and the retry backoff turns a slow page into a very slow one.
 *
 * Batching them into a single eth_call removes the cause rather than pacing
 * around it: measured 3,818ms across forty calls against 545ms for the same
 * forty inside one multicall, and one request cannot be rate-limited partway.
 */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])",
];

const HEDGE_ABI = [
  // v7 + v8: payoutCap (range product) + signature/timestamp/nonce (pricing-engine attestation)
  'function createEvent(tuple(string name, string underlying, uint256 strike, uint256 payoutCap, uint256 premiumRate, uint256 expiryDate, bool allowExternalLp, uint256 initialLiquidity, uint256 initialRate, bool strikeAbove, address paymentToken, bool dynamicPricing, bytes signature, uint256 quoteTimestamp, bytes32 quoteNonce)) returns (uint256)',
  'function setPoolSettings(uint256 _eventId, bool _poolOpen, bool _allowExternalLp)',
  'function deposit(uint256 _eventId, uint256 _amount) returns (uint256)',
  'function buyProtection(uint256 _eventId, uint256 _notional, uint256 _maxCost, uint256 _deadline) returns (uint256)',
  // Dynamic pools are bought through this instead: the premium comes from a
  // signed quote rather than the rate frozen at creation. Which one works is
  // decided by the pool, not the buyer — buyProtection reverts on a dynamic
  // pool and this reverts on a fixed one, so neither side can pick whichever
  // price happens to be cheaper.
  'function buyProtectionQuoted(uint256 _eventId, uint256 _notional, uint256 _maxCost, uint256 _deadline, uint256 _premiumRate, uint256 _quoteTimestamp, bytes32 _quoteNonce, bytes _signature) returns (uint256)',
  'function isDynamicallyPriced(uint256) view returns (bool)',
  'function settleEvent(uint256 _eventId, uint256 _settlementPrice)',
  'function claimPayout(uint256 _positionId)',
  'function claimPremiums(uint256 _depositId)',
  'function pendingPremiums(uint256) view returns (uint256)',
  'function withdrawCapital(uint256 _depositId)',
  'function withdrawCreatorEarnings(uint256 _eventId)',
  'function recoverExpiredPayouts(uint256 _eventId)',
  'function initializeHedgeFees(uint256,uint256,uint256,uint256,uint256)',
  'function setOracleAdmin(address)',
  'function withdrawPlatformFees(uint256)',
  'function getHedgeEventCore(uint256) view returns (uint256 id, address creator, string name, string underlying, uint256 strike, uint256 premiumRate, uint256 expiryDate, uint8 status, bool poolOpen, bool allowExternalLp, uint256 initialRate, bool strikeAbove)',
  'function getHedgeEventStats(uint256) view returns (uint256 settlementPrice, bool triggered, uint256 settledAt, uint256 creatorEarnings, uint256 totalLiquidity, uint256 totalExposure, uint256 totalPremiums, uint256 lpCount, uint256 hedgerCount, uint256 totalMaxPayout)',
  'function getHedgePosition(uint256) view returns (uint256 id, uint256 eventId, address hedger, uint256 notional, uint256 premiumPaid, uint256 platformFeePaid, uint256 payoutAmount, uint8 status, bool claimed)',
  'function getHedgeLpDeposit(uint256) view returns (uint256 id, uint256 eventId, address lp, uint256 amount, uint256 shares, uint256 premiumsEarned, uint256 premiumsClaimed, bool withdrawn)',
  'function getEventPositionIds(uint256) view returns (uint256[])',
  'function getEventDepositIds(uint256) view returns (uint256[])',
  'function getCreatorEventIds(address) view returns (uint256[])',
  'function getHedgerPositionIds(address) view returns (uint256[])',
  'function getLpDepositIds(address) view returns (uint256[])',
  'function getHedgeFeeConfig() view returns (uint256,uint256,uint256,uint256,uint256)',
  'function getHedgePlatformFees() view returns (uint256)',
  'function getTotalHedgeEvents() view returns (uint256)',
  // v7: range geometry view + what-if quote
  'function getHedgeEventRange(uint256) view returns (uint256 strike, uint256 payoutCap, uint256 initialRate, bool strikeAbove)',
  'function quoteRangePayout(uint256, uint256, uint256) view returns (uint256)',
  // v8: pricing-engine attestation
  'function setPricingEngineSigner(address)',
  'function getPricingEngineSigner() view returns (address)',
  'function getEventQuoteSigner(uint256) view returns (address)',
  'function isQuoteNonceUsed(bytes32) view returns (bool)',
  'function getPoolUtilization(uint256) view returns (uint256 totalLiquidity, uint256 totalExposure, uint256 availableCapacity, uint256 utilizationRate)',
  // v3 multi-token functions
  'function getEventPaymentToken(uint256) view returns (address)',
  'function isAllowedPaymentToken(address) view returns (bool)',
  'function setAllowedPaymentToken(address,bool)',
  'function getPlatformFeesByToken(address) view returns (uint256)',
  'function withdrawPlatformFeesByToken(address,uint256)',
];

const USDC_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const EVENT_STATUS_MAP: Record<number, 'open' | 'settled' | 'expired'> = {
  0: 'open',
  1: 'settled',
  2: 'expired',
};

const POSITION_STATUS_MAP: Record<number, 'active' | 'claimable' | 'claimed' | 'expired' | 'settled_win'> = {
  0: 'active',
  1: 'claimable',
  2: 'claimed',
  3: 'expired',
  4: 'settled_win',
};

export interface HedgeEventData {
  id: number;
  creator: string;
  name: string;
  underlying: string;
  strike: number;
  premiumRate: number;
  expiryDate: Date;
  status: 'open' | 'settled' | 'expired';
  poolOpen: boolean;
  allowExternalLp: boolean;
  initialRate: number;
  strikeAbove: boolean;
  settlementPrice: number;
  triggered: boolean;
  creatorEarnings: number;
  totalLiquidity: number;
  totalExposure: number;
  totalPremiums: number;
  totalMaxPayout: number;
  lpCount: number;
  hedgerCount: number;
  createdAt: Date | null;
  settledAt: Date | null;
  availableCapacity: number;
  utilization: number;
  payoutPercent: number;
  /** Rate at which the payout stops growing. 0 if the Diamond has no range getter. */
  payoutCap: number;
  /** ERC-20 token address used for all payments in this event (USDC or USDT). */
  paymentToken: string;
  /**
   * v8: address of the pricing-engine signer that attested this event's premium,
   * or address(0) if the creator self-priced (skipped engine attestation). UIs use
   * this to display a "Priced by engine" vs "Manually priced" badge so hedgers
   * know whether the premium came from the platform's pricing model.
   */
  quoteSigner?: string;
  /** Optional description added by the event creator (stored in DB, not on-chain). */
  description?: string;
}

export interface HedgePositionData {
  id: number;
  eventId: number;
  hedger: string;
  notional: number;
  premiumPaid: number;
  platformFeePaid: number;
  payoutAmount: number;
  status: 'active' | 'claimable' | 'claimed' | 'expired' | 'settled_win';
  claimed: boolean;
  createdAt: Date | null;
}

export interface HedgeLpDepositData {
  id: number;
  eventId: number;
  lp: string;
  amount: number;
  shares: string;
  premiumsEarned: number;
  premiumsClaimed: number;
  /**
   * What the contract will actually pay out on claimPremiums right now.
   *
   * Not the same as premiumsEarned − premiumsClaimed, and the difference is
   * the whole point: premiumsEarned is only credited to the deposit record at
   * settlement, while the contract lets an LP claim from the moment a hedger
   * pays. A $400 deposit against a live event sat showing $0 earned while
   * pendingPremiums reported the full $90 waiting.
   *
   * Null when the Diamond has no such getter, in which case the stored
   * difference is the best available answer.
   */
  pendingPremiums: number | null;
  withdrawn: boolean;
  createdAt: Date | null;
}

export interface HedgeFeeConfig {
  creationFee: number;
  hedgerFeeRate: number;
  hedgerPayoutFeeRate: number;
  lpProfitFeeRate: number;
  creatorLoyaltyRate: number;
}

function toNum(value: bigint): number {
  return parseFloat(ethers.formatUnits(value, 6));
}

function toTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function fromTimestamp(ts: bigint): Date {
  return new Date(Number(ts) * 1000);
}

function fromTimestampOrNull(ts: bigint): Date | null {
  const n = Number(ts);
  return n === 0 ? null : new Date(n * 1000);
}

class HedgeContractManager {
  private provider: ethers.JsonRpcProvider | null = null;
  private timestampCache: Map<string, Date> = new Map();
  private _chainId: number = walletDefaultChainId;   // default to Base

  /** Switch the active chain. Call this whenever the user changes network. */
  setChain(chainId: number): void {
    if (isWalletSandbox && chainId !== 84532) throw new Error('Sandbox supports only Base Sepolia.');
    if (this._chainId === chainId) return;
    this._chainId = chainId;
    this.provider = null;        // reset provider so next call uses new RPC
    this.feeConfigCache = null;  // fee params may differ per chain
    this.feeConfigCachedAt = 0;
    this.timestampCache.clear();
  }

  get chainId(): number { return this._chainId; }

  get activeDiamond(): string {
    return CHAIN_DIAMOND_MAP[this._chainId] || DIAMOND_ADDRESS;
  }

  get activeExplorerApi(): string {
    return CHAIN_EXPLORER_API_MAP[this._chainId] || (isWalletSandbox ? 'https://base-sepolia.blockscout.com/api' : 'https://base.blockscout.com/api');
  }

  get tokenDecimals(): number {
    return CHAIN_TOKEN_DECIMALS_MAP[this._chainId] ?? 6;
  }

  getProvider(): ethers.JsonRpcProvider {
    if (!this.provider) {
      // Route all RPC calls through the server proxy so the server's IP hits the
      // public RPC nodes — avoids rate-limits imposed on browser IPs in production.
      const proxyUrl = `${window.location.origin}/api/rpc/${this._chainId}`;
      this.provider = new ethers.JsonRpcProvider(
        proxyUrl,
        this._chainId,
        { staticNetwork: true }   // skip eth_chainId auto-detect round-trip
      );
    }
    return this.provider;
  }

  getReadContract(): ethers.Contract {
    return new ethers.Contract(this.activeDiamond, HEDGE_ABI, this.getProvider());
  }

  getWriteContract(signer: ethers.Wallet): ethers.Contract {
    const connected = signer.connect(this.getProvider());
    return new ethers.Contract(this.activeDiamond, HEDGE_ABI, connected);
  }

  getUsdcContract(signer: ethers.Wallet): ethers.Contract {
    const connected = signer.connect(this.getProvider());
    return new ethers.Contract(CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS, USDC_ABI, connected);
  }

  /**
   * Return the on-chain address that actually holds funds and executes calls.
   * On the supported AA chains (Base, BSC) this is the smart-account address
   * (where user sends USDC).
   */
  async getEffectiveAddress(fallback: string): Promise<string> {
    // With Rift, the smart wallet address is the same across all chains.
    return fallback;
  }

  async ensureGas(_walletAddress: string): Promise<void> {
    // Rift handles gas (gasless transactions paid in USDC). No-op.
  }

  /**
   * Send a contract write transaction via the server to avoid CORS errors on
   * Base/BSC RPC nodes. The signer never connects to a live provider —
   * signing is done offline. Only the signed hex leaves the browser.
   */
  private async sendContractTx(
    _signer: ethers.Wallet,
    to: string,
    calldata: string,
    value: bigint = 0n,
    _gasBumpPct = 0,
    onStep?: (step: string) => void
  ): Promise<string> {
    assertWalletTransactionsEnabled();
    const chainId = this._chainId;

    // Route the contract call through Rift's signer service.
    // The user's smart wallet (managed by Rift) signs + broadcasts, gasless.
    const { chainIdToRift, signerSendTransaction } = await import('./rift-client');
    const { requestTxAuth } = await import('./tx-auth');

    const chainName = chainIdToRift(chainId);
    if (!chainName) {
      throw new Error(`Chain ${chainId} is not supported by Rift.`);
    }

    // A migrated wallet signs on the device: the proof is bound to this exact
    // operation, so nothing reusable is typed in and nothing reusable is
    // cached. trySignWithV3 returns null when the wallet has not migrated,
    // which is the only case that still needs a one-time code.
    const { trySignWithV3 } = await import('./v3-sign');
    const v3Hash = await trySignWithV3(
      { chain: chainName, to, data: calldata, value: value.toString() },
      { title: 'Approve this transaction', onStep },
    );
    if (v3Hash) return v3Hash;

    onStep?.('Authorizing transaction...');
    const auth = await requestTxAuth(
      'Authorize on-chain action',
      'Enter your credential to submit this transaction. The code is valid for 5 minutes.'
    );

    onStep?.('Submitting transaction...');
    try {
      const { hash } = await signerSendTransaction(
        { chain: chainName, to, data: calldata, value: value.toString() },
        auth,
      );
      if (!hash) throw new Error('Rift returned no transaction hash');
      return hash;
    } catch (err: any) {
      // If auth was rejected (wrong OTP/password), clear the cache so the next
      // attempt re-prompts instead of silently failing on the stale credential.
      const msg = String(err?.message || err || '').toLowerCase();
      if (msg.includes('unauthorized') || msg.includes('invalid code') || msg.includes('invalid otp') || msg.includes('invalid password')) {
        const { clearCachedTxAuth } = await import('./tx-auth');
        clearCachedTxAuth();
      }
      throw err;
    }
  }

  /**
   * Wait for a transaction to be mined by polling the server-side receipt endpoint.
   * This avoids direct browser→RPC calls (CORS issues on Base/BSC).
   * Polls every 3 s, times out after 90 s.
   * Returns the transaction logs when includeLogs=true and the tx is confirmed.
   */
  private async waitForTx(
    txHash: string,
    opts: { includeLogs?: boolean } = {}
  ): Promise<{ logs?: Array<{ topics: string[]; data: string }> }> {
    const chainId = this._chainId;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch('/api/wallet/tx-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash, chainId, includeLogs: opts.includeLogs }),
        });
        if (res.ok) {
          const body = await res.json();
          if (body.confirmed) {
            // status 0 = reverted on-chain; status 1 = success
            if (body.status === 0) {
              throw new Error(
                `Transaction was mined but reverted on-chain. ` +
                `This usually means the contract rejected the call — e.g. the liquidity pool is empty, ` +
                `the token transfer failed, or the event is no longer active. ` +
                `Hash: ${txHash}`
              );
            }
            return { logs: body.logs };
          }
        }
      } catch (e: any) {
        // Re-throw on-chain reverts immediately — these are definitive, not transient
        if (e?.message?.includes('reverted on-chain')) throw e;
        // Otherwise it's a network hiccup — keep polling
      }
      await new Promise(r => setTimeout(r, 3_000));
    }
    // Timeout — not catastrophic, the tx may still mine
    console.warn(`[waitForTx] timeout after 90 s for ${txHash}`);
    return {};
  }

  private parseHexOrDec(value: string): number {
    if (value.startsWith('0x') || value.startsWith('0X')) {
      return parseInt(value, 16);
    }
    return Number(value);
  }

  private async fetchEventLogTimestamps(topic0: string, idTopicIndex: number = 2): Promise<Map<number, Date>> {
    const map = new Map<number, Date>();
    try {
      const url = `${this.activeExplorerApi}?module=logs&action=getLogs&address=${this.activeDiamond}&fromBlock=0&toBlock=latest&topic0=${topic0}`;
      // The block explorer (Blockscout/BscScan) can be slow or rate-limited.
      // Timestamps are non-essential decoration — never let them block the UI.
      // Abort after 6s and fall back to an empty map rather than hanging reads.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      let res: Response;
      try {
        res = await fetch(url, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      const data = await res.json();
      if (data.result && Array.isArray(data.result)) {
        for (const log of data.result) {
          if (log.topics && log.topics.length > idTopicIndex && log.topics[idTopicIndex]) {
            const itemId = this.parseHexOrDec(log.topics[idTopicIndex]);
            const ts = this.parseHexOrDec(log.timeStamp);
            if (!isNaN(itemId) && !isNaN(ts) && ts > 0) {
              map.set(itemId, new Date(ts * 1000));
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch event log timestamps:', e);
    }
    return map;
  }

  async getPositionTimestamps(): Promise<Map<number, Date>> {
    return this.fetchEventLogTimestamps(PROTECTION_BOUGHT_TOPIC);
  }

  async getDepositTimestamps(): Promise<Map<number, Date>> {
    return this.fetchEventLogTimestamps(LIQUIDITY_DEPOSITED_TOPIC);
  }

  async getEventTimestamps(): Promise<Map<number, Date>> {
    return this.fetchEventLogTimestamps(EVENT_CREATED_TOPIC, 1);
  }

  async approveUSDC(signer: ethers.Wallet, amount: string): Promise<void> {
    return this.approveToken(signer, CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS, amount);
  }

  /** Generic ERC-20 approve for the Diamond — works for USDC, USDT, or any whitelisted token. */
  async approveToken(signer: ethers.Wallet, tokenAddress: string, _amount: string, onStep?: (s: string) => void): Promise<void> {
    await this.ensureGas(signer.address);
    // On AA chains the approval is from the smart account (not the PKP EOA).
    const effectiveAddr = await this.getEffectiveAddress(signer.address);
    try {
      const token = new ethers.Contract(tokenAddress, USDC_ABI, this.getProvider());
      const currentAllowance = await token.allowance(effectiveAddr, this.activeDiamond);
      const maxThreshold = ethers.parseUnits("1000000000", this.tokenDecimals);
      if (currentAllowance >= maxThreshold) {
        return; // already approved — skip silently
      }
    } catch (e) {
      console.warn('[approveToken] allowance check failed, proceeding with approve:', e);
    }
    onStep?.('Approving token...');
    const iface = new ethers.Interface(USDC_ABI);
    const calldata = iface.encodeFunctionData('approve', [this.activeDiamond, ethers.MaxUint256]);
    const txHash = await this.sendContractTx(signer, tokenAddress, calldata, 0n, 0, onStep);
    onStep?.('Waiting for approval...');
    await this.waitForTx(txHash);
  }

  async getUSDCBalance(address: string): Promise<string> {
    const usdcAddr = CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS;
    const dec = this.tokenDecimals;
    const usdc = new ethers.Contract(usdcAddr, USDC_ABI, this.getProvider());
    const balance = await usdc.balanceOf(address);
    return ethers.formatUnits(balance, dec);
  }

  async getNativeBalance(walletAddress: string): Promise<string> {
    const balance = await this.getProvider().getBalance(walletAddress);
    return ethers.formatEther(balance);
  }

  async getTokenBalance(tokenAddress: string, walletAddress: string): Promise<string> {
    const tokenAbi = [
      'function balanceOf(address) view returns (uint256)',
      'function decimals() view returns (uint8)',
    ];
    const contract = new ethers.Contract(tokenAddress, tokenAbi, this.getProvider());
    const [balance, decimals] = await Promise.all([
      contract.balanceOf(walletAddress),
      contract.decimals().catch(() => this.tokenDecimals),
    ]);
    return ethers.formatUnits(balance, decimals);
  }

  private feeConfigCache: HedgeFeeConfig | null = null;
  private feeConfigCachedAt: number = 0;
  private static readonly FEE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Fallback fee config, used only when getHedgeFeeConfig() times out.
   *
   * Per chain, because the live values differ a lot: Base charges a $25
   * creation fee and a 5% hedger fee, BSC charges $2 and 0.5%. A single
   * shared default (previously BSC's numbers) quoted Base users roughly a
   * tenth of what the contract actually charges them. Verified by reading
   * getHedgeFeeConfig() on both Diamonds.
   */
  private static readonly DEFAULT_FEE_CONFIG_BY_CHAIN: Record<number, HedgeFeeConfig> = {
    8453: { creationFee: 25, hedgerFeeRate: 0.05,  hedgerPayoutFeeRate: 0.02, lpProfitFeeRate: 0.02, creatorLoyaltyRate: 0.05 },
    56:   { creationFee: 2,  hedgerFeeRate: 0.005, hedgerPayoutFeeRate: 0.01, lpProfitFeeRate: 0.01, creatorLoyaltyRate: 0.05 },
  };

  /**
   * Unknown chain: quote the most expensive fees we charge anywhere. Showing a
   * user less than they will be charged is the failure that actually hurts.
   */
  private static readonly DEFAULT_FEE_CONFIG: HedgeFeeConfig = {
    creationFee: 25,
    hedgerFeeRate: 0.05,
    hedgerPayoutFeeRate: 0.02,
    lpProfitFeeRate: 0.02,
    creatorLoyaltyRate: 0.05,
  };

  async getFeeConfig(): Promise<HedgeFeeConfig> {
    const now = Date.now();
    if (this.feeConfigCache && (now - this.feeConfigCachedAt) < HedgeContractManager.FEE_CACHE_TTL_MS) {
      return this.feeConfigCache;
    }
    try {
      const contract = this.getReadContract();
      const rpcTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getFeeConfig RPC timeout')), 8000)
      );
      const fees = await Promise.race([contract.getHedgeFeeConfig(), rpcTimeout]);
      // fees[0] is the raw on-chain creation fee in the token's smallest unit
      // (e.g. 2000000 on Base = $2.00 USDC with 6 decimals). Format to human-readable.
      const dec = this.tokenDecimals;
      this.feeConfigCache = {
        creationFee: parseFloat(ethers.formatUnits(fees[0], dec)),
        hedgerFeeRate: parseFloat(ethers.formatUnits(fees[1], 6)),
        hedgerPayoutFeeRate: parseFloat(ethers.formatUnits(fees[2], 6)),
        lpProfitFeeRate: parseFloat(ethers.formatUnits(fees[3], 6)),
        creatorLoyaltyRate: parseFloat(ethers.formatUnits(fees[4], 6)),
      };
      this.feeConfigCachedAt = now;
      return this.feeConfigCache;
    } catch (e) {
      // Deliberately not cached: a fallback must not suppress the next attempt
      // to read the real numbers off chain.
      const fallback =
        HedgeContractManager.DEFAULT_FEE_CONFIG_BY_CHAIN[this._chainId]
        ?? HedgeContractManager.DEFAULT_FEE_CONFIG;
      console.warn(`[getFeeConfig] RPC failed on chain ${this._chainId}, using fallback fees:`, e);
      return fallback;
    }
  }

  async getUSDCAllowance(owner: string, spender?: string): Promise<string> {
    const usdcAddr = CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS;
    const usdc = new ethers.Contract(usdcAddr, USDC_ABI, this.getProvider());
    const allowance = await usdc.allowance(owner, spender || this.activeDiamond);
    return ethers.formatUnits(allowance, this.tokenDecimals);
  }

  private formatEvent(core: any, stats: any, createdAt?: Date | null, paymentToken?: string, range?: any): HedgeEventData {
    const totalLiquidity = toNum(stats.totalLiquidity);
    const totalExposure = toNum(stats.totalExposure);
    const totalMaxPayout = toNum(stats.totalMaxPayout);
    const initialRate = toNum(core.initialRate);
    const strike = toNum(core.strike);
    const rawStrikeAbove = core.strikeAbove as boolean;
    // Legacy events (before bidirectional support) have strikeAbove=false but strike > initialRate
    // Infer they are actually upward hedges to display and calculate correctly
    const strikeAbove = rawStrikeAbove || (!rawStrikeAbove && strike > initialRate);
    // What a position actually pays, per dollar of notional.
    //
    // This used to be (strike − initialRate) / initialRate — the gap between
    // spot and the strike, which is not a payout at all. It showed a $9,000
    // position as covering $129 when the contract had reserved $306.86 for it.
    //
    // The real product is a range: payout ramps from zero at the strike to its
    // maximum at payoutCap, so the rate is the width of that range over the
    // initial rate. getHedgeEventRange returns the cap and is live on both
    // Diamonds; the old expression is kept only for a Diamond that lacks it.
    const payoutCap = range ? toNum(range.payoutCap) : 0;
    const rangeWidth = payoutCap > 0
      ? (strikeAbove ? payoutCap - strike : strike - payoutCap)
      : (strikeAbove ? strike - initialRate : initialRate - strike);
    const payoutPercent = initialRate > 0 ? Math.max(0, rangeWidth) / initialRate : 0;
    return {
      id: Number(core.id),
      creator: core.creator,
      name: core.name,
      underlying: core.underlying,
      strike,
      premiumRate: toNum(core.premiumRate),
      expiryDate: fromTimestamp(core.expiryDate),
      status: EVENT_STATUS_MAP[Number(core.status)] || 'open',
      poolOpen: core.poolOpen,
      allowExternalLp: core.allowExternalLp,
      initialRate,
      strikeAbove,
      settlementPrice: toNum(stats.settlementPrice),
      triggered: stats.triggered,
      creatorEarnings: toNum(stats.creatorEarnings),
      totalLiquidity,
      totalExposure,
      totalPremiums: toNum(stats.totalPremiums),
      totalMaxPayout,
      lpCount: Number(stats.lpCount),
      hedgerCount: Number(stats.hedgerCount),
      createdAt: createdAt || null,
      settledAt: fromTimestampOrNull(stats.settledAt),
      availableCapacity: totalLiquidity - totalMaxPayout,
      utilization: totalLiquidity > 0 ? totalMaxPayout / totalLiquidity : 0,
      payoutPercent,
      payoutCap,
      paymentToken: paymentToken || (CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS),
    };
  }

  /**
   * Every event's core, stats, payment token and range in one request.
   *
   * Returns null when multicall is unavailable or the shape is not what we
   * expect, so the caller keeps its per-event path. allowFailure is set per
   * call because individual events do revert on some getters after a facet
   * upgrade, and one bad event must not void the whole read.
   */
  private async readEventsViaMulticall(
    count: number,
  ): Promise<Array<{ id: number; core: unknown; stats: unknown; paymentToken: string; range: unknown }> | null> {
    if (count < 1) return [];
    try {
      const provider = this.getProvider();
      if ((await provider.getCode(MULTICALL3)) === "0x") return null;

      const iface = new ethers.Interface(HEDGE_ABI);
      const fns = ["getHedgeEventCore", "getHedgeEventStats", "getEventPaymentToken", "getHedgeEventRange"] as const;
      const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];
      for (let i = 1; i <= count; i++) {
        for (const fn of fns) {
          calls.push({ target: this.activeDiamond, allowFailure: true, callData: iface.encodeFunctionData(fn, [i]) });
        }
      }

      const mc = new ethers.Contract(MULTICALL3, MULTICALL3_ABI, provider);
      const results = await Promise.race([
        mc.aggregate3(calls) as Promise<Array<{ success: boolean; returnData: string }>>,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("multicall timeout")), 12_000)),
      ]);
      if (!Array.isArray(results) || results.length !== calls.length) return null;

      const out: Array<{ id: number; core: unknown; stats: unknown; paymentToken: string; range: unknown }> = [];
      for (let i = 1; i <= count; i++) {
        const base = (i - 1) * fns.length;
        const decode = (k: number) => {
          const r = results[base + k];
          if (!r?.success) return null;
          try { return iface.decodeFunctionResult(fns[k], r.returnData); } catch { return null; }
        };
        const core = decode(0);
        const stats = decode(1);
        // An event whose core or stats cannot be read is skipped, exactly as the
        // per-event path skips it.
        if (!core || !stats) continue;
        const tokenRes = decode(2);
        out.push({
          id: i,
          core,
          stats,
          paymentToken: (tokenRes ? String(tokenRes[0]) : "") || CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS,
          range: decode(3),
        });
      }
      return out;
    } catch {
      return null;
    }
  }

  async getAllEvents(): Promise<HedgeEventData[]> {
    if (isWalletSandbox && !sandboxDiamondAddress) return [];
    const contract = this.getReadContract();
    const MAX_SCAN = 500;
    // Public Base RPCs throttle aggressively, and ethers surfaces a throttled
    // response as CALL_EXCEPTION "missing revert data" — indistinguishable from
    // a genuine revert. Reading 10 pools at once (30 calls) reliably trips it
    // and silently drops pools from the market. Smaller batches plus retries
    // read the full book; measured 3/9 pools before, 9/9 after.
    const BATCH = 4;
    const READ_RETRIES = 4;

    // Timestamps are decoration on top of the event data, so they must not gate
    // the reads — kick the request off now and join it at the end. Previously
    // this was awaited first and cost ~600ms before a single event was fetched.
    const timestampsPromise = this.getEventTimestamps().catch(() => new Map<number, Date>());

    // Try fast path first; fall back to scanning if getTotalHedgeEvents() is unavailable
    let count: number | null = null;
    try {
      const total = await Promise.race([
        contract.getTotalHedgeEvents(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ]);
      count = Number(total);
    } catch {
      console.warn('[HedgeContract] getTotalHedgeEvents() unavailable — scanning upward');
    }

    type RawEvent = { id: number; core: unknown; stats: unknown; paymentToken: string; range: any };

    /** Retry a single read; throttled responses look like reverts, so retry both. */
    const readWithRetry = async <T>(call: () => Promise<T>): Promise<T | null> => {
      for (let attempt = 0; attempt < READ_RETRIES; attempt++) {
        try {
          return await call();
        } catch {
          await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
        }
      }
      return null;
    };

    const loadOne = async (i: number): Promise<RawEvent | null> => {
      // Sequential rather than Promise.all: three concurrent calls per pool is
      // what pushes the RPC over its limit in the first place.
      const core = await readWithRetry(() => contract.getHedgeEventCore(i));
      if (core === null) return null;
      const stats = await readWithRetry(() => contract.getHedgeEventStats(i));
      if (stats === null) return null;
      const paymentToken =
        (await readWithRetry(() => contract.getEventPaymentToken(i)))
        ?? (CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS);
      // The payout cap. Worth the extra round trip: without it the payout rate
      // has to be guessed from the strike, and that guess was wrong by 58%.
      const range = await readWithRetry(() => contract.getHedgeEventRange(i));
      return { id: i, core, stats, paymentToken: paymentToken as string, range };
    };

    const raw: RawEvent[] = [];

    // One request for the whole book. Falls through to the per-event path below
    // when multicall is unavailable, times out, or returns nothing usable — so
    // this is a speed-up, never a new way for the market to fail to load.
    if (count !== null && count > 0) {
      const viaMulticall = await this.readEventsViaMulticall(count);
      if (viaMulticall && viaMulticall.length > 0) {
        const eventTimestamps = await timestampsPromise;
        return viaMulticall.map((r) =>
          this.formatEvent(r.core, r.stats, eventTimestamps.get(r.id), r.paymentToken, r.range),
        );
      }
      console.warn('[HedgeContract] multicall unavailable — falling back to per-event reads');
    }

    if (count === null) {
      // Scan mode: without a count, a run of reverts is the only signal that
      // the list has ended. Stopping at the *first* revert is wrong here —
      // several live events revert on these getters (facet version skew) and
      // the RPC reverts intermittently under load, either of which would
      // truncate the book to nothing. Require consecutive misses instead.
      const STOP_AFTER_CONSECUTIVE_MISSES = 3;
      let misses = 0;
      for (let i = 1; i <= MAX_SCAN && misses < STOP_AFTER_CONSECUTIVE_MISSES; i++) {
        const r = await loadOne(i);
        if (r) { raw.push(r); misses = 0; } else { misses++; }
      }
    } else {
      // Known count: fetch in parallel batches. Several deployed events revert
      // on these getters, and serially eating one round trip per failure is
      // what made this page take seconds to appear. Batched rather than fully
      // parallel so a large book doesn't hammer the public RPC in one burst.
      let failed = 0;
      for (let start = 1; start <= count; start += BATCH) {
        const end = Math.min(start + BATCH - 1, count);
        const batch: Array<Promise<RawEvent | null>> = [];
        for (let i = start; i <= end; i++) batch.push(loadOne(i));
        for (const r of await Promise.all(batch)) {
          if (r) raw.push(r); else failed++;
        }
      }
      if (failed > 0) {
        console.warn(`[HedgeContract] ${failed}/${count} event(s) unreadable on chain ${this._chainId} — skipped`);
      }
    }

    const eventTimestamps = await timestampsPromise;
    return raw.map((r) => this.formatEvent(r.core, r.stats, eventTimestamps.get(r.id), r.paymentToken, r.range));
  }

  async getEvent(eventId: number): Promise<HedgeEventData> {
    const contract = this.getReadContract();
    // getEventQuoteSigner is a v8 function — wrap in a catch so older Diamonds
    // (or in-flight upgrades) don't blow up the dialog. Returns ZeroAddress on
    // any error, which the UI interprets as "manually priced / unknown".
    const [core, stats, eventTimestamps, paymentToken, quoteSigner, range] = await Promise.all([
      contract.getHedgeEventCore(eventId),
      contract.getHedgeEventStats(eventId),
      this.getEventTimestamps(),
      contract.getEventPaymentToken(eventId).catch(() => CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS),
      contract.getEventQuoteSigner(eventId).catch(() => ethers.ZeroAddress),
      contract.getHedgeEventRange(eventId).catch(() => null),
    ]);
    const ev = this.formatEvent(core, stats, eventTimestamps.get(eventId), paymentToken as string, range);
    ev.quoteSigner = quoteSigner as string;
    return ev;
  }

  async getPositionsByWallet(address: string): Promise<HedgePositionData[]> {
    if (isWalletSandbox && !sandboxDiamondAddress) return [];
    const contract = this.getReadContract();
    let ids: bigint[] = [];
    let timestamps: Map<number, Date> = new Map();
    try {
      const result = await Promise.all([
        contract.getHedgerPositionIds(address),
        this.getPositionTimestamps(),
      ]);
      ids = result[0] as bigint[];
      timestamps = result[1] as Map<number, Date>;
    } catch {
      return []; // function not deployed on this Diamond or call failed
    }
    const positions: HedgePositionData[] = [];
    for (const id of ids) {
      try {
        const p = await contract.getHedgePosition(id);
        const posId = Number(p.id);
        positions.push({
          id: posId,
          eventId: Number(p.eventId),
          hedger: p.hedger,
          notional: toNum(p.notional),
          premiumPaid: toNum(p.premiumPaid),
          platformFeePaid: toNum(p.platformFeePaid),
          payoutAmount: toNum(p.payoutAmount),
          status: POSITION_STATUS_MAP[Number(p.status)] || 'active',
          claimed: p.claimed,
          createdAt: timestamps.get(posId) || null,
        });
      } catch {
        continue;
      }
    }
    return positions;
  }

  async getDepositsByWallet(address: string): Promise<HedgeLpDepositData[]> {
    if (isWalletSandbox && !sandboxDiamondAddress) return [];
    const contract = this.getReadContract();
    let ids: bigint[] = [];
    let timestamps: Map<number, Date> = new Map();
    try {
      const result = await Promise.all([
        contract.getLpDepositIds(address),
        this.getDepositTimestamps(),
      ]);
      ids = result[0] as bigint[];
      timestamps = result[1] as Map<number, Date>;
    } catch {
      return []; // function not deployed on this Diamond or call failed
    }
    const deposits: HedgeLpDepositData[] = [];
    for (const id of ids) {
      try {
        const d = await contract.getHedgeLpDeposit(id);
        const depId = Number(d.id);
        // Asked per deposit rather than derived, because the stored figures
        // lag the contract's own answer until settlement.
        let pending: number | null = null;
        try { pending = toNum(await contract.pendingPremiums(id)); } catch { /* older facet */ }
        deposits.push({
          id: depId,
          eventId: Number(d.eventId),
          lp: d.lp,
          amount: toNum(d.amount),
          shares: ethers.formatUnits(d.shares, 18),
          premiumsEarned: toNum(d.premiumsEarned),
          premiumsClaimed: toNum(d.premiumsClaimed),
          pendingPremiums: pending,
          withdrawn: d.withdrawn,
          createdAt: timestamps.get(depId) || null,
        });
      } catch {
        continue;
      }
    }
    return deposits;
  }

  async getEventsByCreator(address: string): Promise<HedgeEventData[]> {
    const contract = this.getReadContract();
    const [ids, eventTimestamps] = await Promise.all([
      contract.getCreatorEventIds(address),
      this.getEventTimestamps(),
    ]);
    const events: HedgeEventData[] = [];
    for (const id of ids as bigint[]) {
      try {
        const [core, stats, paymentToken] = await Promise.all([
          contract.getHedgeEventCore(id),
          contract.getHedgeEventStats(id),
          contract.getEventPaymentToken(id).catch(() => CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS),
        ]);
        events.push(this.formatEvent(core, stats, eventTimestamps.get(Number(id)), paymentToken as string));
      } catch {
        continue;
      }
    }
    return events;
  }

  async getPoolUtilization(eventId: number): Promise<{ totalLiquidity: number; totalExposure: number; availableCapacity: number; utilizationRate: number }> {
    const contract = this.getReadContract();
    const result = await contract.getPoolUtilization(eventId);
    return {
      totalLiquidity: toNum(result.totalLiquidity),
      totalExposure: toNum(result.totalExposure),
      availableCapacity: toNum(result.availableCapacity),
      utilizationRate: toNum(result.utilizationRate),
    };
  }

  /**
   * Creates a new hedge event on-chain.
   * Returns the new on-chain event ID (parsed from the EventCreated log),
   * or null if the log could not be parsed (caller should use scan/fallback).
   */
  async createEvent(
    signer: ethers.Wallet,
    params: {
      name: string;
      underlying: string;
      strike: number;
      /** v7: far edge of the payout range. Pass 0 for legacy single-strike events. */
      payoutCap: number;
      premiumRate: number;
      expiryDate: Date;
      allowExternalLp: boolean;
      initialLiquidity: string;
      initialRate: number;
      strikeAbove: boolean;
      paymentToken?: string;
      /**
       * How this pool prices cover for its whole life. Chosen here and never
       * changeable: there is no setter on the contract.
       *
       *   false — fixed. Every buyer pays this premium, whatever the time left.
       *   true  — dynamic. Each purchase is re-priced from the volatility your
       *           opening premium implies, so it moves with time and with spot
       *           against the strike.
       *
       * It also decides which entry point buyers use, so it cannot be inferred
       * later or left undefined at the contract.
       */
      dynamicPricing?: boolean;
      /** v8 pricing-engine attestation (required when on-chain pricingEngineSigner is set). */
      signature?: string;        // 0x-prefixed 65-byte hex; default "0x" for legacy mode
      quoteTimestamp?: number;   // unix seconds; default 0 for legacy mode
      quoteNonce?: string;       // 0x-prefixed 32-byte hex; default ZeroHash for legacy mode
    },
    onStep?: (step: string) => void
  ): Promise<{ eventId: number | null; txHash: string }> {
    const feeConfig = await this.getFeeConfig();
    const tokenAddress = params.paymentToken || (CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS);
    const dec = this.tokenDecimals;
    const initialLiquidityWei = ethers.parseUnits(params.initialLiquidity, dec);
    const creationFeeWei = ethers.parseUnits(feeConfig.creationFee.toString(), dec);
    const totalCost = initialLiquidityWei + creationFeeWei;

    try {
      const tokenContract = new ethers.Contract(tokenAddress, USDC_ABI, this.getProvider());
      const effectiveAddr = await this.getEffectiveAddress(signer.address);
      const balance = await tokenContract.balanceOf(effectiveAddr);
      if (balance < totalCost) {
        const balanceFormatted = ethers.formatUnits(balance, dec);
        const costFormatted = ethers.formatUnits(totalCost, dec);
        const activeUsdc = (CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS).toLowerCase();
        const symbol = tokenAddress.toLowerCase() === activeUsdc ? 'USDC' : 'USDT';
        throw new Error(`Insufficient ${symbol} balance. You have ${balanceFormatted} but need ${costFormatted} (${params.initialLiquidity} liquidity + $${feeConfig.creationFee} fee).`);
      }
    } catch (e: any) {
      // Only rethrow explicit insufficient balance errors; ignore read failures
      if (e?.message?.startsWith('Insufficient')) throw e;
      console.warn('[createEvent] Pre-flight balance check failed, proceeding:', e?.message);
    }

    await this.approveToken(signer, tokenAddress, ethers.formatUnits(totalCost, dec), onStep);
    // Brief pause so the approve TX propagates to all RPC nodes before we
    // call estimateGas for createEvent — avoids "exceeds allowance" on lagging nodes.
    await new Promise(r => setTimeout(r, 2500));
    await this.ensureGas(signer.address);

    const iface = new ethers.Interface(HEDGE_ABI);
    // .toFixed(6) for ALL price-like inputs — JS floats produce noise like
    // 0.0028100000000000004, which parseUnits(_, 6) rejects ("too many decimals
    // for format"). Truncating to exactly 6 decimal places matches the on-chain
    // PRECISION = 1e6 and avoids the underflow.
    const strikeWei       = ethers.parseUnits(params.strike.toFixed(6), 6);
    const payoutCapWei    = ethers.parseUnits((params.payoutCap || 0).toFixed(6), 6);
    const premiumRateWei  = ethers.parseUnits(params.premiumRate.toFixed(6), 6);
    const expiryTimestamp = toTimestamp(params.expiryDate);
    const initialRateWei  = ethers.parseUnits(params.initialRate.toFixed(6), 6);

    // v8: pricing-engine attestation. Empty defaults match the contract's "legacy mode"
    // when the on-chain pricingEngineSigner is unset; the contract rejects empty
    // signatures once a signer is registered.
    const signature = params.signature || "0x";
    const quoteTimestamp = BigInt(params.quoteTimestamp || 0);
    const quoteNonce = params.quoteNonce || ethers.ZeroHash;

    try {
      const calldata = iface.encodeFunctionData('createEvent', [[
        params.name,
        params.underlying,
        strikeWei,
        payoutCapWei,
        premiumRateWei,
        expiryTimestamp,
        params.allowExternalLp,
        initialLiquidityWei,
        initialRateWei,
        params.strikeAbove,
        tokenAddress,
        params.dynamicPricing === true,
        signature,
        quoteTimestamp,
        quoteNonce,
      ]]);
      onStep?.('Submitting to blockchain...');
      const txHash = await this.sendContractTx(signer, this.activeDiamond, calldata, 0n, 0, onStep);
      onStep?.('Waiting for confirmation...');
      const { logs } = await this.waitForTx(txHash, { includeLogs: true });

      // Parse the new event ID from the EventCreated log (topic[1] = event ID)
      const eventLog = logs?.find(l => l.topics?.[0] === EVENT_CREATED_TOPIC);
      const eventId = eventLog?.topics?.[1] ? parseInt(eventLog.topics[1], 16) : null;
      return { eventId, txHash };
    } catch (error: any) {
      const msg = error?.reason || error?.message || 'Transaction failed';
      if (msg.includes('insufficient') || msg.includes('transfer amount exceeds balance')) {
        throw new Error(`Transaction failed: token transfer was rejected by the contract. Please ensure your balance is sufficient and try again.`);
      }
      throw new Error(`Create event failed: ${msg}`);
    }
  }

  async setPoolSettings(
    signer: ethers.Wallet,
    eventId: number,
    poolOpen: boolean,
    allowExternalLp: boolean,
    onStep?: (s: string) => void
  ): Promise<string> {
    await this.ensureGas(signer.address);
    const iface = new ethers.Interface(HEDGE_ABI);
    const calldata = iface.encodeFunctionData('setPoolSettings', [eventId, poolOpen, allowExternalLp]);
    onStep?.('Submitting to blockchain...');
    const txHash = await this.sendContractTx(signer, this.activeDiamond, calldata, 0n, 0, onStep);
    onStep?.('Waiting for confirmation...');
    await this.waitForTx(txHash);
    return txHash;
  }

  async deposit(
    signer: ethers.Wallet,
    eventId: number,
    amount: string,
    onStep?: (s: string) => void
  ): Promise<string> {
    const readContract = this.getReadContract();
    const tokenAddress = await readContract.getEventPaymentToken(eventId).catch(() => CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS) as string;
    const dec = this.tokenDecimals;
    const amountWei = ethers.parseUnits(amount, dec);

    try {
      const tokenContract = new ethers.Contract(tokenAddress, USDC_ABI, this.getProvider());
      const effectiveAddr = await this.getEffectiveAddress(signer.address);
      const balance = await tokenContract.balanceOf(effectiveAddr);
      if (balance < amountWei) {
        const balanceFormatted = ethers.formatUnits(balance, dec);
        const activeUsdc = (CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS).toLowerCase();
        const symbol = tokenAddress.toLowerCase() === activeUsdc ? 'USDC' : 'USDT';
        throw new Error(
          `Insufficient ${symbol} balance. You have ${parseFloat(balanceFormatted).toFixed(2)} ${symbol} but need ${parseFloat(amount).toFixed(2)} ${symbol}.`
        );
      }
    } catch (e: any) {
      if (e?.message?.startsWith('Insufficient')) throw e;
      console.warn('[deposit] Pre-flight balance check failed, proceeding:', e?.message);
    }

    await this.approveToken(signer, tokenAddress, amount, onStep);
    await new Promise(r => setTimeout(r, 2500));
    const iface = new ethers.Interface(HEDGE_ABI);
    const calldata = iface.encodeFunctionData('deposit', [eventId, amountWei]);
    onStep?.('Submitting deposit...');
    const txHash = await this.sendContractTx(signer, this.activeDiamond, calldata, 0n, 0, onStep);
    onStep?.('Waiting for confirmation...');
    await this.waitForTx(txHash);
    return txHash;
  }

  /**
   * Whether this pool prices at the moment of purchase.
   *
   * Chosen by the creator and immutable once the pool exists, so it is safe to
   * cache per event id. Older Diamonds have no such getter; absent means fixed,
   * which is how every pool behaved before the choice existed.
   */
  async isDynamicallyPriced(eventId: number): Promise<boolean> {
    try {
      return Boolean(await this.getReadContract().isDynamicallyPriced(eventId));
    } catch {
      return false;
    }
  }

  /**
   * Buy cover, through whichever entry point this pool requires.
   *
   * A pool is either fixed-price or dynamically priced, chosen by its creator
   * and immutable. The contract enforces the split: buyProtection reverts on a
   * dynamic pool and buyProtectionQuoted reverts on a fixed one. That is
   * deliberate — both selectors are permissionless, so a buyer allowed to pick
   * would always take whichever was cheaper that day, at the LPs' expense.
   *
   * So the basis is read from the chain rather than passed in, and a caller
   * cannot accidentally route around it.
   *
   * `quote` is required for a dynamic pool and ignored for a fixed one. It must
   * be signed for THIS buyer: the contract binds the signature to msg.sender.
   */
  async buyProtection(
    signer: ethers.Wallet,
    eventId: number,
    notional: string,
    onStep?: (s: string) => void,
    quote?: { premiumRate: bigint; quoteTimestamp: bigint; quoteNonce: string; signature: string } | null,
  ): Promise<string> {
    const readContract = this.getReadContract();
    // getFeeConfig() has error handling + defaults for chains where getHedgeFeeConfig()
    // is absent (e.g. Base Diamond uses a different facet version).
    const [core, feeConfig, tokenAddress, dynamic] = await Promise.all([
      readContract.getHedgeEventCore(eventId),
      this.getFeeConfig(),
      readContract.getEventPaymentToken(eventId).catch(() => CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS),
      this.isDynamicallyPriced(eventId),
    ]);

    if (dynamic && !quote) {
      throw new Error(
        'This pool is priced at the time of purchase, and the price quote could not be obtained. ' +
        'Please try again in a moment.'
      );
    }

    const dec = this.tokenDecimals;
    const notionalWei = ethers.parseUnits(notional, dec);
    // A dynamic pool charges the signed rate, not the one stored at creation.
    // The cost preview below has to use the same number the contract will, or
    // the balance check and the approval are both drawn against the wrong sum.
    const premiumRate = dynamic && quote ? quote.premiumRate : (core.premiumRate as bigint);
    // getFeeConfig returns hedgerFeeRate as a float (e.g. 0.005 = 0.5%).
    // Convert back to 6-decimal fixed-point bigint to match contract math.
    const hedgerFeeRateBigInt = BigInt(Math.round(feeConfig.hedgerFeeRate * PRECISION));

    const premium = (notionalWei * premiumRate) / BigInt(PRECISION);
    // The fee is a share of the premium, not of the notional.
    //
    // This multiplied by notionalWei, which is what put "Platform fee (5.00%
    // of notional) $500" on a $10,000 quote whose real fee is $5. The chain
    // settles the question: position #7 on Base paid $4.50 on a $90 premium
    // against a $9,000 notional, and getHedgeFeeConfig reports 50000. At the
    // 1e6 precision that makes creatorLoyaltyRate the documented 5%, only the
    // premium basis reproduces $4.50 — the notional basis gives $450. The six
    // older positions were charged on notional at 0.5%, which is the facet
    // this quote was written against and no longer the one deployed.
    //
    // The overstatement did not revert anything, since maxCost is an upper
    // bound. It did something quieter: the pre-flight balance check and the
    // ERC-20 approval are both drawn from totalCost, so a hedger holding
    // plenty was told they were short, and anyone who got through approved
    // roughly a hundred times the spend.
    const fee = (premium * hedgerFeeRateBigInt) / BigInt(PRECISION);
    const totalCost = premium + fee;

    const activeUsdc = (CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS).toLowerCase();
    const symbol = (tokenAddress as string).toLowerCase() === activeUsdc ? 'USDC' : 'USDT';
    try {
      const tokenContract = new ethers.Contract(tokenAddress as string, USDC_ABI, this.getProvider());
      const effectiveAddr = await this.getEffectiveAddress(signer.address);
      const balance = await tokenContract.balanceOf(effectiveAddr);
      if (balance < totalCost) {
        const balanceFormatted = ethers.formatUnits(balance, dec);
        const costFormatted = ethers.formatUnits(totalCost, dec);
        throw new Error(
          `Insufficient ${symbol} balance. You have ${parseFloat(balanceFormatted).toFixed(2)} ${symbol} but need ${parseFloat(costFormatted).toFixed(2)} ${symbol} (premium + fee).`
        );
      }
    } catch (e: any) {
      if (e?.message?.startsWith('Insufficient')) throw e;
      console.warn('[buyProtection] Pre-flight balance check failed, proceeding:', e?.message);
    }

    await this.approveToken(signer, tokenAddress as string, ethers.formatUnits(totalCost, dec), onStep);
    await new Promise(r => setTimeout(r, 2500));

    const iface = new ethers.Interface(HEDGE_ABI);
    try {
      // maxCost = totalCost + 10% slippage buffer so minor price moves don't block the tx
      const maxCost = (totalCost * 110n) / 100n;
      // deadline = 5 minutes from now (in unix seconds)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const calldata = dynamic && quote
        ? iface.encodeFunctionData('buyProtectionQuoted', [
            eventId, notionalWei, maxCost, deadline,
            quote.premiumRate, quote.quoteTimestamp, quote.quoteNonce, quote.signature,
          ])
        : iface.encodeFunctionData('buyProtection', [eventId, notionalWei, maxCost, deadline]);
      onStep?.('Submitting to blockchain...');
      const txHash = await this.sendContractTx(signer, this.activeDiamond, calldata, 0n, 0, onStep);
      onStep?.('Waiting for confirmation...');
      await this.waitForTx(txHash);
      return txHash;
    } catch (error: any) {
      const msg = error?.reason || error?.message || 'Transaction failed';
      if (msg.includes('insufficient') || msg.includes('transfer amount exceeds balance')) {
        throw new Error(`Insufficient ${symbol} balance — the contract rejected the transfer. Please top up your ${symbol} and try again.`);
      }
      if (msg.includes('Quote expired')) {
        throw new Error('The price quote expired while the transaction was being prepared. Please try again.');
      }
      if (msg.includes('dynamically priced') || msg.includes('fixed price')) {
        throw new Error('This pool changed how it prices cover. Please reopen it and try again.');
      }
      throw new Error(`Buy protection failed: ${msg}`);
    }
  }

  async claimPayout(signer: ethers.Wallet, positionId: number, onStep?: (s: string) => void): Promise<string> {
    await this.ensureGas(signer.address);
    const iface = new ethers.Interface(HEDGE_ABI);
    const calldata = iface.encodeFunctionData('claimPayout', [positionId]);
    onStep?.('Submitting claim...');
    const txHash = await this.sendContractTx(signer, this.activeDiamond, calldata, 0n, 0, onStep);
    onStep?.('Waiting for confirmation...');
    await this.waitForTx(txHash);
    return txHash;
  }

  async claimPremiums(signer: ethers.Wallet, depositId: number, onStep?: (s: string) => void): Promise<string> {
    await this.ensureGas(signer.address);
    const iface = new ethers.Interface(HEDGE_ABI);
    const calldata = iface.encodeFunctionData('claimPremiums', [depositId]);
    onStep?.('Submitting claim...');
    const txHash = await this.sendContractTx(signer, this.activeDiamond, calldata, 0n, 0, onStep);
    onStep?.('Waiting for confirmation...');
    await this.waitForTx(txHash);
    return txHash;
  }

  async withdrawCapital(signer: ethers.Wallet, depositId: number, onStep?: (s: string) => void): Promise<string> {
    await this.ensureGas(signer.address);
    const iface = new ethers.Interface(HEDGE_ABI);
    const calldata = iface.encodeFunctionData('withdrawCapital', [depositId]);
    onStep?.('Submitting withdrawal...');
    const txHash = await this.sendContractTx(signer, this.activeDiamond, calldata, 0n, 0, onStep);
    onStep?.('Waiting for confirmation...');
    await this.waitForTx(txHash);
    return txHash;
  }

  async withdrawCreatorEarnings(signer: ethers.Wallet, eventId: number, onStep?: (s: string) => void): Promise<string> {
    await this.ensureGas(signer.address);
    const iface = new ethers.Interface(HEDGE_ABI);
    const calldata = iface.encodeFunctionData('withdrawCreatorEarnings', [eventId]);
    onStep?.('Submitting withdrawal...');
    const txHash = await this.sendContractTx(signer, this.activeDiamond, calldata, 0n, 0, onStep);
    onStep?.('Waiting for confirmation...');
    await this.waitForTx(txHash);
    return txHash;
  }

  async recoverExpiredPayouts(signer: ethers.Wallet, eventId: number, onStep?: (s: string) => void): Promise<string> {
    await this.ensureGas(signer.address);
    const iface = new ethers.Interface(HEDGE_ABI);
    const calldata = iface.encodeFunctionData('recoverExpiredPayouts', [eventId]);
    onStep?.('Recovering expired event...');
    const txHash = await this.sendContractTx(signer, this.activeDiamond, calldata, 0n, 0, onStep);
    onStep?.('Waiting for confirmation...');
    await this.waitForTx(txHash);
    return txHash;
  }
}

export const hedgeContract = new HedgeContractManager();
