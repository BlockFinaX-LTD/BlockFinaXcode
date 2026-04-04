/**
 * Hedge Contract Integration - Direct on-chain calls to the HedgeFacet
 *
 * All interaction with the BlockFinaX Diamond contract on Lisk Mainnet goes through this file.
 * Covers: event creation, buying protection (hedger), providing liquidity (LP),
 * claiming payouts, withdrawing LP funds, fetching event and position data.
 * Contract address: 0x885E663645173a0791b82f0e6608921D31E3D700 (Diamond — Lisk Mainnet)
 * Exports: DIAMOND_ADDRESS, USDC_ADDRESS, getHedgeFacetContract, createHedgeEvent,
 *          buyProtection, depositLiquidity, claimPayout, withdrawLiquidity, and more.
 */
import { ethers } from 'ethers';

export const DIAMOND_ADDRESS = '0x885E663645173a0791b82f0e6608921D31E3D700';
export const USDC_ADDRESS = '0xF242275d3a6527d877f2c927a82D9b057609cc71';
export const USDT_ADDRESS_SEPOLIA: string = "0x05D032ac25d322df992303dCa074EE7392C117b9";
export const LISK_SEPOLIA_CHAIN_ID = 1135;
export const LISK_SEPOLIA_RPC = 'https://rpc.api.lisk.com';
export const LISK_BLOCKSCOUT = 'https://blockscout.lisk.com/api';
export const PRECISION = 1e6;

export const CHAIN_RPC_MAP: Record<number, string> = {
  1135: 'https://rpc.api.lisk.com',
  8453: 'https://mainnet.base.org',
  56:   'https://bsc-dataseed.binance.org',
};

export const CHAIN_EXPLORER_API_MAP: Record<number, string> = {
  1135: 'https://blockscout.lisk.com/api',
  8453: 'https://base.blockscout.com/api',
  56:   'https://api.bscscan.com/api',
};

export const CHAIN_TOKEN_DECIMALS_MAP: Record<number, number> = {
  1135: 6,
  8453: 6,
  56:   18,
};

export const CHAIN_DIAMOND_MAP: Record<number, string> = {
  1135: '0x885E663645173a0791b82f0e6608921D31E3D700',
  8453: '0xcC594031d1c059Eb1d6bCb0c7b1c82D31115E6E6',
  56:   '0xcC594031d1c059Eb1d6bCb0c7b1c82D31115E6E6',
};

export const CHAIN_USDC_MAP: Record<number, string> = {
  1135: '0xF242275d3a6527d877f2c927a82D9b057609cc71',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  56:   '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
};

export const CHAIN_USDT_MAP: Record<number, string> = {
  1135: '',
  8453: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  56:   '0x55d398326f99059fF775485246999027B3197955',
};

export function getUsdtAddress(chainId: number): string {
  return CHAIN_USDT_MAP[chainId] || '';
}

export const CHAIN_SAFE_MAP: Record<number, string> = {
  1135: '0xfce89FA90Ee1C78B15eE0f12f62B03153814699D',
  8453: '0x7909a2f1fAd63678eEDcC5A75462B66D062189Bb',
  56:   '0x2a0ab363E01b518B189218e39f79Bfc3AE310807',
};

export const CHAIN_EXPLORER_MAP: Record<number, string> = {
  1135: 'https://blockscout.lisk.com',
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
  return CHAIN_EXPLORER_MAP[chainId] || 'https://blockscout.lisk.com';
}

const PROTECTION_BOUGHT_TOPIC = '0x4481909ec72817de979b2b76609a83284e6faacdfa26174543ad38431274eed5';
const LIQUIDITY_DEPOSITED_TOPIC = '0xbff736a88c4d6fc1bc430cb94a5d36706a0d4b369de04ea80fc121296def3cb2';
const EVENT_CREATED_TOPIC = '0x971a52d02f8b95a7a75a0f42d1fb5ab027b59b71c15f1f6095e5323ddd308736';

const HEDGE_ABI = [
  'function createEvent(tuple(string name, string underlying, uint256 strike, uint256 premiumRate, uint256 expiryDate, bool allowExternalLp, uint256 initialLiquidity, uint256 initialRate, bool strikeAbove, address paymentToken)) returns (uint256)',
  'function setPoolSettings(uint256 _eventId, bool _poolOpen, bool _allowExternalLp)',
  'function deposit(uint256 _eventId, uint256 _amount) returns (uint256)',
  'function buyProtection(uint256 _eventId, uint256 _notional) returns (uint256)',
  'function settleEvent(uint256 _eventId, uint256 _settlementPrice)',
  'function claimPayout(uint256 _positionId)',
  'function claimPremiums(uint256 _depositId)',
  'function withdrawCapital(uint256 _depositId)',
  'function withdrawCreatorEarnings(uint256 _eventId)',
  'function initializeHedgeFees(uint256,uint256,uint256,uint256,uint256)',
  'function setOracleAdmin(address)',
  'function withdrawPlatformFees(uint256)',
  'function getHedgeEventCore(uint256) view returns (uint256 id, address creator, string name, string underlying, uint256 strike, uint256 premiumRate, uint256 expiryDate, uint8 status, bool poolOpen, bool allowExternalLp, uint256 initialRate, bool strikeAbove)',
  'function getHedgeEventStats(uint256) view returns (uint256 settlementPrice, bool triggered, uint256 settledAt, uint256 creatorEarnings, uint256 totalLiquidity, uint256 totalExposure, uint256 totalPremiums, uint256 hedgerCount, uint256 lpCount, uint256 totalMaxPayout)',
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
  /** ERC-20 token address used for all payments in this event (USDC or USDT). */
  paymentToken: string;
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
  private _chainId: number = 1135;

  /** Switch the active chain. Call this whenever the user changes network. */
  setChain(chainId: number): void {
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
    return CHAIN_EXPLORER_API_MAP[this._chainId] || LISK_BLOCKSCOUT;
  }

  get tokenDecimals(): number {
    return CHAIN_TOKEN_DECIMALS_MAP[this._chainId] ?? 6;
  }

  getProvider(): ethers.JsonRpcProvider {
    if (!this.provider) {
      const rpc = CHAIN_RPC_MAP[this._chainId] || LISK_SEPOLIA_RPC;
      this.provider = new ethers.JsonRpcProvider(rpc);
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

  async ensureGas(walletAddress: string): Promise<void> {
    try {
      const balance = await this.getProvider().getBalance(walletAddress);
      const minGas = ethers.parseEther("0.001");
      if (balance < minGas) {
        const res = await fetch("/api/gas/sponsor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress }),
        });
        const data = await res.json();
        if (data.sponsored) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    } catch (e) {
      console.warn("Gas sponsorship check failed:", e);
    }
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
      const res = await fetch(url);
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
  async approveToken(signer: ethers.Wallet, tokenAddress: string, _amount: string): Promise<void> {
    const connected = signer.connect(this.getProvider());
    await this.ensureGas(connected.address);
    const token = new ethers.Contract(tokenAddress, USDC_ABI, connected);
    const currentAllowance = await token.allowance(connected.address, this.activeDiamond);
    const maxThreshold = ethers.parseUnits("1000000000", this.tokenDecimals);
    if (currentAllowance >= maxThreshold) {
      return;
    }
    const tx = await token.approve(this.activeDiamond, ethers.MaxUint256);
    await tx.wait();
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

  private static readonly DEFAULT_FEE_CONFIG: HedgeFeeConfig = {
    creationFee: 2,
    hedgerFeeRate: 0.005,
    hedgerPayoutFeeRate: 0.01,
    lpProfitFeeRate: 0.01,
    creatorLoyaltyRate: 0.005,
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
      this.feeConfigCache = {
        creationFee: toNum(fees[0]),
        hedgerFeeRate: parseFloat(ethers.formatUnits(fees[1], 6)),
        hedgerPayoutFeeRate: parseFloat(ethers.formatUnits(fees[2], 6)),
        lpProfitFeeRate: parseFloat(ethers.formatUnits(fees[3], 6)),
        creatorLoyaltyRate: parseFloat(ethers.formatUnits(fees[4], 6)),
      };
      this.feeConfigCachedAt = now;
      return this.feeConfigCache;
    } catch (e) {
      console.warn('[getFeeConfig] RPC failed, using defaults:', e);
      return HedgeContractManager.DEFAULT_FEE_CONFIG;
    }
  }

  async getUSDCAllowance(owner: string, spender?: string): Promise<string> {
    const usdcAddr = CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS;
    const usdc = new ethers.Contract(usdcAddr, USDC_ABI, this.getProvider());
    const allowance = await usdc.allowance(owner, spender || this.activeDiamond);
    return ethers.formatUnits(allowance, this.tokenDecimals);
  }

  private formatEvent(core: any, stats: any, createdAt?: Date | null, paymentToken?: string): HedgeEventData {
    const totalLiquidity = toNum(stats.totalLiquidity);
    const totalExposure = toNum(stats.totalExposure);
    const totalMaxPayout = toNum(stats.totalMaxPayout);
    const initialRate = toNum(core.initialRate);
    const strike = toNum(core.strike);
    const rawStrikeAbove = core.strikeAbove as boolean;
    // Legacy events (before bidirectional support) have strikeAbove=false but strike > initialRate
    // Infer they are actually upward hedges to display and calculate correctly
    const strikeAbove = rawStrikeAbove || (!rawStrikeAbove && strike > initialRate);
    const priceDelta = strikeAbove ? strike - initialRate : initialRate - strike;
    const payoutPercent = initialRate > 0 ? priceDelta / initialRate : 0;
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
      paymentToken: paymentToken || (CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS),
    };
  }

  async getAllEvents(): Promise<HedgeEventData[]> {
    const contract = this.getReadContract();
    const [total, eventTimestamps] = await Promise.all([
      contract.getTotalHedgeEvents(),
      this.getEventTimestamps(),
    ]);
    const count = Number(total);
    const events: HedgeEventData[] = [];
    for (let i = 1; i <= count; i++) {
      try {
        const [core, stats, paymentToken] = await Promise.all([
          contract.getHedgeEventCore(i),
          contract.getHedgeEventStats(i),
          contract.getEventPaymentToken(i).catch(() => CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS),
        ]);
        events.push(this.formatEvent(core, stats, eventTimestamps.get(i), paymentToken as string));
      } catch (err) {
        console.error(`[HedgeContract] Failed to load event #${i}:`, err);
        continue;
      }
    }
    return events;
  }

  async getEvent(eventId: number): Promise<HedgeEventData> {
    const contract = this.getReadContract();
    const [core, stats, eventTimestamps, paymentToken] = await Promise.all([
      contract.getHedgeEventCore(eventId),
      contract.getHedgeEventStats(eventId),
      this.getEventTimestamps(),
      contract.getEventPaymentToken(eventId).catch(() => CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS),
    ]);
    return this.formatEvent(core, stats, eventTimestamps.get(eventId), paymentToken as string);
  }

  async getPositionsByWallet(address: string): Promise<HedgePositionData[]> {
    const contract = this.getReadContract();
    const [ids, timestamps] = await Promise.all([
      contract.getHedgerPositionIds(address),
      this.getPositionTimestamps(),
    ]);
    const positions: HedgePositionData[] = [];
    for (const id of ids as bigint[]) {
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
    const contract = this.getReadContract();
    const [ids, timestamps] = await Promise.all([
      contract.getLpDepositIds(address),
      this.getDepositTimestamps(),
    ]);
    const deposits: HedgeLpDepositData[] = [];
    for (const id of ids as bigint[]) {
      try {
        const d = await contract.getHedgeLpDeposit(id);
        const depId = Number(d.id);
        deposits.push({
          id: depId,
          eventId: Number(d.eventId),
          lp: d.lp,
          amount: toNum(d.amount),
          shares: ethers.formatUnits(d.shares, 18),
          premiumsEarned: toNum(d.premiumsEarned),
          premiumsClaimed: toNum(d.premiumsClaimed),
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

  async createEvent(
    signer: ethers.Wallet,
    params: {
      name: string;
      underlying: string;
      strike: number;
      premiumRate: number;
      expiryDate: Date;
      allowExternalLp: boolean;
      initialLiquidity: string;
      initialRate: number;
      strikeAbove: boolean;
      /** ERC-20 token address to use for this event. Defaults to USDC if not supplied. */
      paymentToken?: string;
    }
  ): Promise<ethers.TransactionResponse> {
    const connected = signer.connect(this.getProvider());
    const feeConfig = await this.getFeeConfig();
    const tokenAddress = params.paymentToken || (CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS);
    const dec = this.tokenDecimals;
    const initialLiquidityWei = ethers.parseUnits(params.initialLiquidity, dec);
    const creationFeeWei = ethers.parseUnits(feeConfig.creationFee.toString(), dec);
    const totalCost = initialLiquidityWei + creationFeeWei;

    const tokenContract = new ethers.Contract(tokenAddress, USDC_ABI, this.getProvider());
    const balance = await tokenContract.balanceOf(connected.address);
    if (balance < totalCost) {
      const balanceFormatted = ethers.formatUnits(balance, dec);
      const costFormatted = ethers.formatUnits(totalCost, dec);
      const activeUsdc = (CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS).toLowerCase();
      const symbol = tokenAddress.toLowerCase() === activeUsdc ? 'USDC' : 'USDT';
      throw new Error(`Insufficient ${symbol} balance. You have ${balanceFormatted} but need ${costFormatted} (${params.initialLiquidity} liquidity + $${feeConfig.creationFee} fee).`);
    }

    await this.approveToken(signer, tokenAddress, ethers.formatUnits(totalCost, dec));
    await this.ensureGas(connected.address);

    const contract = this.getWriteContract(signer);
    const strikeWei = ethers.parseUnits(params.strike.toString(), 6);
    const premiumRateWei = ethers.parseUnits(params.premiumRate.toString(), 6);
    const expiryTimestamp = toTimestamp(params.expiryDate);
    const initialRateWei = ethers.parseUnits(params.initialRate.toFixed(6), 6);

    try {
      const tx = await contract.createEvent([
        params.name,
        params.underlying,
        strikeWei,
        premiumRateWei,
        expiryTimestamp,
        params.allowExternalLp,
        initialLiquidityWei,
        initialRateWei,
        params.strikeAbove,
        tokenAddress,
      ]);
      await tx.wait();
      return tx;
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
    allowExternalLp: boolean
  ): Promise<ethers.TransactionResponse> {
    const connected = signer.connect(this.getProvider());
    await this.ensureGas(connected.address);
    const contract = this.getWriteContract(signer);
    const tx = await contract.setPoolSettings(eventId, poolOpen, allowExternalLp);
    await tx.wait();
    return tx;
  }

  async deposit(
    signer: ethers.Wallet,
    eventId: number,
    amount: string
  ): Promise<ethers.TransactionResponse> {
    const readContract = this.getReadContract();
    const tokenAddress = await readContract.getEventPaymentToken(eventId).catch(() => CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS) as string;
    const connected = signer.connect(this.getProvider());
    const dec = this.tokenDecimals;
    const amountWei = ethers.parseUnits(amount, dec);

    // Pre-flight balance check
    const tokenContract = new ethers.Contract(tokenAddress, USDC_ABI, this.getProvider());
    const balance = await tokenContract.balanceOf(connected.address);
    if (balance < amountWei) {
      const balanceFormatted = ethers.formatUnits(balance, dec);
      const activeUsdc = (CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS).toLowerCase();
      const symbol = tokenAddress.toLowerCase() === activeUsdc ? 'USDC' : 'USDT';
      throw new Error(
        `Insufficient ${symbol} balance. You have ${parseFloat(balanceFormatted).toFixed(2)} ${symbol} but need ${parseFloat(amount).toFixed(2)} ${symbol}.`
      );
    }

    await this.approveToken(signer, tokenAddress, amount);
    const contract = this.getWriteContract(signer);
    const tx = await contract.deposit(eventId, amountWei);
    await tx.wait();
    return tx;
  }

  async buyProtection(
    signer: ethers.Wallet,
    eventId: number,
    notional: string
  ): Promise<ethers.TransactionResponse> {
    const readContract = this.getReadContract();
    const [core, feeConfig, tokenAddress] = await Promise.all([
      readContract.getHedgeEventCore(eventId),
      readContract.getHedgeFeeConfig(),
      readContract.getEventPaymentToken(eventId).catch(() => CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS),
    ]);

    const connected = signer.connect(this.getProvider());
    const dec = this.tokenDecimals;
    const notionalWei = ethers.parseUnits(notional, dec);
    const premiumRate = core.premiumRate as bigint;
    const hedgerFeeRate = feeConfig[1] as bigint;

    const premium = (notionalWei * premiumRate) / BigInt(PRECISION);
    const fee = (notionalWei * hedgerFeeRate) / BigInt(PRECISION);
    const totalCost = premium + fee;

    // Pre-flight balance check
    const activeUsdc = (CHAIN_USDC_MAP[this._chainId] || USDC_ADDRESS).toLowerCase();
    const symbol = (tokenAddress as string).toLowerCase() === activeUsdc ? 'USDC' : 'USDT';
    const tokenContract = new ethers.Contract(tokenAddress as string, USDC_ABI, this.getProvider());
    const balance = await tokenContract.balanceOf(connected.address);
    if (balance < totalCost) {
      const balanceFormatted = ethers.formatUnits(balance, dec);
      const costFormatted = ethers.formatUnits(totalCost, dec);
      throw new Error(
        `Insufficient ${symbol} balance. You have ${parseFloat(balanceFormatted).toFixed(2)} ${symbol} but need ${parseFloat(costFormatted).toFixed(2)} ${symbol} (premium + fee).`
      );
    }

    await this.approveToken(signer, tokenAddress as string, ethers.formatUnits(totalCost, dec));

    const contract = this.getWriteContract(signer);
    try {
      const tx = await contract.buyProtection(eventId, notionalWei);
      await tx.wait();
      return tx;
    } catch (error: any) {
      const msg = error?.reason || error?.message || 'Transaction failed';
      if (msg.includes('insufficient') || msg.includes('transfer amount exceeds balance')) {
        throw new Error(`Insufficient ${symbol} balance — the contract rejected the transfer. Please top up your ${symbol} and try again.`);
      }
      throw new Error(`Buy protection failed: ${msg}`);
    }
  }

  async claimPayout(signer: ethers.Wallet, positionId: number): Promise<ethers.TransactionResponse> {
    const connected = signer.connect(this.getProvider());
    await this.ensureGas(connected.address);
    const contract = this.getWriteContract(signer);
    const tx = await contract.claimPayout(positionId);
    await tx.wait();
    return tx;
  }

  async claimPremiums(signer: ethers.Wallet, depositId: number): Promise<ethers.TransactionResponse> {
    const connected = signer.connect(this.getProvider());
    await this.ensureGas(connected.address);
    const contract = this.getWriteContract(signer);
    const tx = await contract.claimPremiums(depositId);
    await tx.wait();
    return tx;
  }

  async withdrawCapital(signer: ethers.Wallet, depositId: number): Promise<ethers.TransactionResponse> {
    const connected = signer.connect(this.getProvider());
    await this.ensureGas(connected.address);
    const contract = this.getWriteContract(signer);
    const tx = await contract.withdrawCapital(depositId);
    await tx.wait();
    return tx;
  }

  async withdrawCreatorEarnings(signer: ethers.Wallet, eventId: number): Promise<ethers.TransactionResponse> {
    const connected = signer.connect(this.getProvider());
    await this.ensureGas(connected.address);
    const contract = this.getWriteContract(signer);
    const tx = await contract.withdrawCreatorEarnings(eventId);
    await tx.wait();
    return tx;
  }
}

export const hedgeContract = new HedgeContractManager();
