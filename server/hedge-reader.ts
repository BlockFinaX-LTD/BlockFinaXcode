/**
 * Hedge Reader - Reads live hedge event data directly from the blockchain
 *
 * Connects to all three mainnet Diamond contracts (Lisk, Base, BSC) and
 * aggregates hedge events, positions, LP deposits, and platform fees.
 * Used by the admin dashboard and hedge marketplace API.
 */
import { ethers } from 'ethers';

const CHAINS = [
  {
    id: 1135,
    name: 'Lisk',
    diamond: '0x885E663645173a0791b82f0e6608921D31E3D700',
    rpcs: ['https://rpc.api.lisk.com', 'https://lisk.drpc.org'],
    decimals: 6,
  },
  {
    id: 8453,
    name: 'Base',
    diamond: '0xcC594031d1c059Eb1d6bCb0c7b1c82D31115E6E6',
    rpcs: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org'],
    decimals: 6,
  },
  {
    id: 56,
    name: 'BSC',
    diamond: '0xcC594031d1c059Eb1d6bCb0c7b1c82D31115E6E6',
    rpcs: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org'],
    decimals: 18,
  },
] as const;

const HEDGE_ABI = [
  'function getHedgeEventCore(uint256) view returns (uint256 id, address creator, string name, string underlying, uint256 strike, uint256 premiumRate, uint256 expiryDate, uint8 status, bool poolOpen, bool allowExternalLp, uint256 initialRate, bool strikeAbove)',
  'function getHedgeEventStats(uint256) view returns (uint256 settlementPrice, bool triggered, uint256 settledAt, uint256 creatorEarnings, uint256 totalLiquidity, uint256 totalExposure, uint256 totalPremiums, uint256 hedgerCount, uint256 lpCount, uint256 totalMaxPayout)',
  'function getHedgePosition(uint256) view returns (uint256 id, uint256 eventId, address hedger, uint256 notional, uint256 premiumPaid, uint256 platformFeePaid, uint256 payoutAmount, uint8 status, bool claimed)',
  'function getHedgeLpDeposit(uint256) view returns (uint256 id, uint256 eventId, address lp, uint256 amount, uint256 shares, uint256 premiumsEarned, uint256 premiumsClaimed, bool withdrawn)',
  'function getEventPositionIds(uint256) view returns (uint256[])',
  'function getEventDepositIds(uint256) view returns (uint256[])',
  'function getHedgePlatformFees() view returns (uint256)',
  'function getTotalHedgeEvents() view returns (uint256)',
];

const EVENT_STATUS    = ['open', 'settled', 'expired'] as const;
const POSITION_STATUS = ['active', 'claimable', 'claimed', 'expired', 'settled_win'] as const;

async function getProvider(rpcs: readonly string[]): Promise<ethers.JsonRpcProvider> {
  for (const url of rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      await p.getBlockNumber();
      return p;
    } catch { /* try next */ }
  }
  throw new Error(`No reachable RPC in list: ${rpcs.join(', ')}`);
}

function toNum(value: bigint, decimals: number): number {
  return parseFloat(ethers.formatUnits(value, decimals));
}

export interface ChainEvent {
  id: number;
  chainId: number;
  chainName: string;
  creator: string;
  name: string;
  underlying: string;
  strike: number;
  premiumRate: number;
  expiryDate: Date;
  status: string;
  poolOpen: boolean;
  allowExternalLp: boolean;
  initialRate: number;
  strikeAbove: boolean;
  settlementPrice: number;
  triggered: boolean;
  settledAt: Date | null;
  creatorEarnings: number;
  totalLiquidity: number;
  totalExposure: number;
  totalPremiums: number;
  hedgerCount: number;
  lpCount: number;
  totalMaxPayout: number;
}

export interface ChainPosition {
  id: number;
  eventId: number;
  chainId: number;
  hedger: string;
  notional: number;
  premiumPaid: number;
  platformFeePaid: number;
  payoutAmount: number;
  status: string;
  claimed: boolean;
}

export interface ChainDeposit {
  id: number;
  eventId: number;
  chainId: number;
  lp: string;
  amount: number;
  premiumsEarned: number;
  premiumsClaimed: number;
  withdrawn: boolean;
}

let _cache: { events: ChainEvent[]; fetchedAt: number } | null = null;
const CACHE_TTL = 30_000;

export async function readChainEvents(): Promise<ChainEvent[]> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL) return _cache.events;

  const allEvents: ChainEvent[] = [];

  await Promise.allSettled(
    CHAINS.map(async (chain) => {
      try {
        const provider = await getProvider(chain.rpcs);
        const contract = new ethers.Contract(chain.diamond, HEDGE_ABI, provider);

        let total: number;
        try {
          total = Number(await contract.getTotalHedgeEvents());
        } catch {
          // Scan upward if getTotalHedgeEvents not available
          total = 0;
          for (let i = 1; i <= 20; i++) {
            try { await contract.getHedgeEventCore(i); total = i; } catch { break; }
          }
        }
        if (total === 0) return;

        const results = await Promise.allSettled(
          Array.from({ length: total }, (_, i) => i + 1).map(async (id) => {
            const [core, stats] = await Promise.all([
              contract.getHedgeEventCore(id),
              contract.getHedgeEventStats(id),
            ]);
            const event: ChainEvent = {
              id,
              chainId: chain.id,
              chainName: chain.name,
              creator: core.creator,
              name: core.name,
              underlying: core.underlying,
              strike: toNum(core.strike, chain.decimals),
              premiumRate: toNum(core.premiumRate, chain.decimals),
              expiryDate: new Date(Number(core.expiryDate) * 1000),
              status: EVENT_STATUS[Number(core.status)] ?? 'open',
              poolOpen: core.poolOpen,
              allowExternalLp: core.allowExternalLp,
              initialRate: toNum(core.initialRate, chain.decimals),
              strikeAbove: core.strikeAbove,
              settlementPrice: toNum(stats.settlementPrice, chain.decimals),
              triggered: stats.triggered,
              settledAt: Number(stats.settledAt) > 0 ? new Date(Number(stats.settledAt) * 1000) : null,
              creatorEarnings: toNum(stats.creatorEarnings, chain.decimals),
              totalLiquidity: toNum(stats.totalLiquidity, chain.decimals),
              totalExposure: toNum(stats.totalExposure, chain.decimals),
              totalPremiums: toNum(stats.totalPremiums, chain.decimals),
              hedgerCount: Number(stats.hedgerCount),
              lpCount: Number(stats.lpCount),
              totalMaxPayout: toNum(stats.totalMaxPayout, chain.decimals),
            };
            return event;
          })
        );

        for (const r of results) {
          if (r.status === 'fulfilled') allEvents.push(r.value);
        }
      } catch (e: any) {
        console.warn(`[HedgeReader] Could not read events from ${chain.name}:`, e?.message);
      }
    })
  );

  _cache = { events: allEvents, fetchedAt: Date.now() };
  return allEvents;
}

export async function readChainPositionsByEvent(eventId: number, chainId?: number): Promise<ChainPosition[]> {
  const chains = chainId ? CHAINS.filter(c => c.id === chainId) : CHAINS;
  const all: ChainPosition[] = [];

  await Promise.allSettled(
    chains.map(async (chain) => {
      try {
        const provider = await getProvider(chain.rpcs);
        const contract = new ethers.Contract(chain.diamond, HEDGE_ABI, provider);
        let ids: bigint[];
        try { ids = await contract.getEventPositionIds(eventId); } catch { return; }

        const results = await Promise.allSettled(
          ids.map(async (id) => {
            const p = await contract.getHedgePosition(id);
            return {
              id: Number(p.id),
              eventId: Number(p.eventId),
              chainId: chain.id,
              hedger: p.hedger,
              notional: toNum(p.notional, chain.decimals),
              premiumPaid: toNum(p.premiumPaid, chain.decimals),
              platformFeePaid: toNum(p.platformFeePaid, chain.decimals),
              payoutAmount: toNum(p.payoutAmount, chain.decimals),
              status: POSITION_STATUS[Number(p.status)] ?? 'active',
              claimed: p.claimed,
            } as ChainPosition;
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled') all.push(r.value);
        }
      } catch (e: any) {
        console.warn(`[HedgeReader] Position read failed on ${chain.name} event ${eventId}:`, e?.message);
      }
    })
  );
  return all;
}

export async function readChainDepositsByEvent(eventId: number, chainId?: number): Promise<ChainDeposit[]> {
  const chains = chainId ? CHAINS.filter(c => c.id === chainId) : CHAINS;
  const all: ChainDeposit[] = [];

  await Promise.allSettled(
    chains.map(async (chain) => {
      try {
        const provider = await getProvider(chain.rpcs);
        const contract = new ethers.Contract(chain.diamond, HEDGE_ABI, provider);
        let ids: bigint[];
        try { ids = await contract.getEventDepositIds(eventId); } catch { return; }

        const results = await Promise.allSettled(
          ids.map(async (id) => {
            const d = await contract.getHedgeLpDeposit(id);
            return {
              id: Number(d.id),
              eventId: Number(d.eventId),
              chainId: chain.id,
              lp: d.lp,
              amount: toNum(d.amount, chain.decimals),
              premiumsEarned: toNum(d.premiumsEarned, chain.decimals),
              premiumsClaimed: toNum(d.premiumsClaimed, chain.decimals),
              withdrawn: d.withdrawn,
            } as ChainDeposit;
          })
        );
        for (const r of results) {
          if (r.status === 'fulfilled') all.push(r.value);
        }
      } catch (e: any) {
        console.warn(`[HedgeReader] Deposit read failed on ${chain.name} event ${eventId}:`, e?.message);
      }
    })
  );
  return all;
}

export async function readPlatformFees(): Promise<number> {
  let total = 0;
  await Promise.allSettled(
    CHAINS.map(async (chain) => {
      try {
        const provider = await getProvider(chain.rpcs);
        const contract = new ethers.Contract(chain.diamond, HEDGE_ABI, provider);
        const fees = await contract.getHedgePlatformFees();
        total += toNum(fees, chain.decimals);
      } catch { /* skip silently */ }
    })
  );
  return total;
}

export function invalidateChainCache() {
  _cache = null;
}
