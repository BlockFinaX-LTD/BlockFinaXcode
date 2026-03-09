/**
 * Hedge Reader - Reads live hedge event data directly from the blockchain
 *
 * Connects to the Diamond contract on Lisk Sepolia and fetches all hedge events,
 * positions, LP deposits, and platform fees. Used by the admin dashboard and
 * the hedge marketplace API to display real-time on-chain data.
 * Exports: readAllHedgeEvents, readHedgePlatformFees
 */
import { ethers } from 'ethers';

const DIAMOND_ADDRESS = '0x3582D8f5f88ef557ce10Af26834FAC8B8e1445bf';
const LISK_SEPOLIA_RPC = 'https://rpc.sepolia-api.lisk.com';

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

const EVENT_STATUS = ['open', 'settled', 'expired'] as const;
const POSITION_STATUS = ['active', 'claimable', 'claimed', 'expired', 'settled_win'] as const;

function toNum(value: bigint): number {
  return parseFloat(ethers.formatUnits(value, 6));
}

function getContract(): ethers.Contract {
  const provider = new ethers.JsonRpcProvider(LISK_SEPOLIA_RPC);
  return new ethers.Contract(DIAMOND_ADDRESS, HEDGE_ABI, provider);
}

export interface ChainEvent {
  id: number;
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
  const contract = getContract();
  const total = Number(await contract.getTotalHedgeEvents());
  if (total === 0) return [];

  const results = await Promise.allSettled(
    Array.from({ length: total }, (_, i) => i + 1).map(async (id) => {
      const [core, stats] = await Promise.all([
        contract.getHedgeEventCore(id),
        contract.getHedgeEventStats(id),
      ]);
      const event: ChainEvent = {
        id,
        creator: core.creator,
        name: core.name,
        underlying: core.underlying,
        strike: toNum(core.strike),
        premiumRate: toNum(core.premiumRate),
        expiryDate: new Date(Number(core.expiryDate) * 1000),
        status: EVENT_STATUS[Number(core.status)] ?? 'open',
        poolOpen: core.poolOpen,
        allowExternalLp: core.allowExternalLp,
        initialRate: toNum(core.initialRate),
        strikeAbove: core.strikeAbove,
        settlementPrice: toNum(stats.settlementPrice),
        triggered: stats.triggered,
        settledAt: Number(stats.settledAt) > 0 ? new Date(Number(stats.settledAt) * 1000) : null,
        creatorEarnings: toNum(stats.creatorEarnings),
        totalLiquidity: toNum(stats.totalLiquidity),
        totalExposure: toNum(stats.totalExposure),
        totalPremiums: toNum(stats.totalPremiums),
        hedgerCount: Number(stats.hedgerCount),
        lpCount: Number(stats.lpCount),
        totalMaxPayout: toNum(stats.totalMaxPayout),
      };
      return event;
    })
  );

  const events: ChainEvent[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') events.push(r.value);
  }

  _cache = { events, fetchedAt: Date.now() };
  return events;
}

export async function readChainPositionsByEvent(eventId: number): Promise<ChainPosition[]> {
  const contract = getContract();
  let ids: bigint[];
  try { ids = await contract.getEventPositionIds(eventId); } catch { return []; }
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const p = await contract.getHedgePosition(id);
      return {
        id: Number(p.id),
        eventId: Number(p.eventId),
        hedger: p.hedger,
        notional: toNum(p.notional),
        premiumPaid: toNum(p.premiumPaid),
        platformFeePaid: toNum(p.platformFeePaid),
        payoutAmount: toNum(p.payoutAmount),
        status: POSITION_STATUS[Number(p.status)] ?? 'active',
        claimed: p.claimed,
      } as ChainPosition;
    })
  );
  return results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<ChainPosition>).value);
}

export async function readChainDepositsByEvent(eventId: number): Promise<ChainDeposit[]> {
  const contract = getContract();
  let ids: bigint[];
  try { ids = await contract.getEventDepositIds(eventId); } catch { return []; }
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const d = await contract.getHedgeLpDeposit(id);
      return {
        id: Number(d.id),
        eventId: Number(d.eventId),
        lp: d.lp,
        amount: toNum(d.amount),
        premiumsEarned: toNum(d.premiumsEarned),
        premiumsClaimed: toNum(d.premiumsClaimed),
        withdrawn: d.withdrawn,
      } as ChainDeposit;
    })
  );
  return results.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<ChainDeposit>).value);
}

export async function readPlatformFees(): Promise<number> {
  try {
    const contract = getContract();
    const fees = await contract.getHedgePlatformFees();
    return toNum(fees);
  } catch { return 0; }
}

export function invalidateChainCache() {
  _cache = null;
}
