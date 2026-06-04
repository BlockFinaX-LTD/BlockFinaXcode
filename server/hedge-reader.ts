/**
 * Hedge Reader - Reads live hedge event data directly from the blockchain
 *
 * Connects to the two mainnet Diamond contracts (Base, BSC) and aggregates
 * hedge events, positions, LP deposits, and platform fees. Lisk support
 * was removed when smart-contract deployment on Lisk was dropped.
 * Used by the admin dashboard and hedge marketplace API.
 */
import { ethers } from 'ethers';

const CHAINS = [
  {
    id: 8453,
    name: 'Base',
    diamond: process.env.BASE_DIAMOND_ADDRESS || '0xbCC51E62C4948FD35ab505bd71804C849601e4Ef',
    rpcs: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org'],
    decimals: 6,
  },
  {
    id: 56,
    name: 'BSC',
    diamond: process.env.BSC_DIAMOND_ADDRESS || '0xaC939C0897981Abc0711ec4e37527F13106180fc',
    rpcs: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org'],
    decimals: 18,
  },
];

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
        } catch (totalErr: any) {
          // getTotalHedgeEvents reverted or doesn't exist on this Diamond.
          // Fall back to scanning IDs upward. Log the original failure so
          // we can tell whether the contract is wrong vs whether it's an
          // RPC issue (decoder error vs network error look very different).
          console.warn(`[HedgeReader:${chain.name}] getTotalHedgeEvents failed, scanning:`, totalErr?.message || totalErr);
          total = 0;
          for (let i = 1; i <= 20; i++) {
            try { await contract.getHedgeEventCore(i); total = i; } catch (scanErr: any) {
              if (i === 1) {
                console.warn(`[HedgeReader:${chain.name}] getHedgeEventCore(1) also failed:`, scanErr?.message || scanErr);
              }
              break;
            }
          }
        }
        if (total === 0) {
          console.warn(`[HedgeReader:${chain.name}] resolved total=0 (diamond=${chain.diamond})`);
          return;
        }
        console.log(`[HedgeReader:${chain.name}] reading ${total} on-chain event(s)`);

        // Serialise per-event reads. Public RPCs (mainnet.base.org,
        // bsc-dataseed) throttle the burst of 1 + total*2 parallel calls
        // we used to send and silently 429 the per-event reads. The result
        // was an empty allEvents and a 0 in the dashboard with no error
        // visible anywhere. Sequential is slower but never trips.
        const results: PromiseSettledResult<ChainEvent>[] = [];
        for (let i = 1; i <= total; i++) {
          const id = i;
          try {
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
            results.push({ status: 'fulfilled', value: event });
          } catch (eventErr: any) {
            console.warn(`[HedgeReader:${chain.name}] event #${id} read failed:`, eventErr?.message || eventErr);
            results.push({ status: 'rejected', reason: eventErr });
          }
        }

        let acceptedFromThisChain = 0;
        for (const r of results) {
          if (r.status === 'fulfilled') {
            allEvents.push(r.value);
            acceptedFromThisChain++;
          }
        }
        console.log(`[HedgeReader:${chain.name}] accepted ${acceptedFromThisChain}/${total} event(s) into the result set`);
      } catch (e: any) {
        console.warn(`[HedgeReader] Could not read events from ${chain.name}:`, e?.message);
      }
    })
  );

  // Only cache successful (non-empty) reads so a transient swallowed failure
  // doesn't lock us into an empty result for the next CACHE_TTL.
  if (allEvents.length > 0) {
    _cache = { events: allEvents, fetchedAt: Date.now() };
  }
  return allEvents;
}

// Per-chain inspection: does each step of the chain read actually work?
// Returns no event data — only booleans, counts, durations, and error
// strings. Safe to expose via an admin endpoint without leaking PII.
export interface ChainDiagnosis {
  chainId: number;
  name: string;
  diamond: string;
  rpcReachable: boolean;
  rpcUsed?: string;
  blockNumber?: number;
  getTotalHedgeEventsOk: boolean;
  totalReported?: number;
  getHedgeEventCoreOneOk: boolean;
  sampleEventStatusInt?: number;
  errors: Record<string, string>;
  ms: { rpc?: number; total?: number; sampleCore?: number };
}

export async function diagnoseChainReads(): Promise<ChainDiagnosis[]> {
  const out: ChainDiagnosis[] = [];
  for (const chain of CHAINS) {
    const d: ChainDiagnosis = {
      chainId: chain.id,
      name: chain.name,
      diamond: chain.diamond,
      rpcReachable: false,
      getTotalHedgeEventsOk: false,
      getHedgeEventCoreOneOk: false,
      errors: {},
      ms: {},
    };

    let provider: ethers.JsonRpcProvider | null = null;
    const t0 = Date.now();
    for (const url of chain.rpcs) {
      try {
        const p = new ethers.JsonRpcProvider(url);
        const bn = await p.getBlockNumber();
        provider = p;
        d.rpcReachable = true;
        d.rpcUsed = url;
        d.blockNumber = bn;
        break;
      } catch (e: any) {
        d.errors[`rpc:${url}`] = e?.message || String(e);
      }
    }
    d.ms.rpc = Date.now() - t0;
    if (!provider) { out.push(d); continue; }

    const contract = new ethers.Contract(chain.diamond, HEDGE_ABI, provider);

    const t1 = Date.now();
    try {
      const total = Number(await contract.getTotalHedgeEvents());
      d.getTotalHedgeEventsOk = true;
      d.totalReported = total;
    } catch (e: any) {
      d.errors.getTotalHedgeEvents = e?.message || String(e);
    }
    d.ms.total = Date.now() - t1;

    const t2 = Date.now();
    try {
      const core = await contract.getHedgeEventCore(1);
      d.getHedgeEventCoreOneOk = true;
      d.sampleEventStatusInt = Number(core.status);
    } catch (e: any) {
      d.errors.getHedgeEventCoreOne = e?.message || String(e);
    }
    d.ms.sampleCore = Date.now() - t2;

    out.push(d);
  }
  return out;
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

export interface ChainFeeResult {
  chainId: number;
  chainName: string;
  fees: number;
  /** true = read directly from getHedgePlatformFees(); false = function absent on this Diamond */
  onChain: boolean;
}

/**
 * Reads accumulated platform fees per chain from the on-chain Diamond.
 * Returns per-chain results so callers can apply fallbacks where the
 * function is absent (e.g. Base Diamond has a different facet set).
 */
export async function readPlatformFeesPerChain(): Promise<ChainFeeResult[]> {
  const results = await Promise.all(
    CHAINS.map(async (chain): Promise<ChainFeeResult> => {
      try {
        const provider = await getProvider(chain.rpcs);
        const contract = new ethers.Contract(chain.diamond, HEDGE_ABI, provider);
        const fees = await contract.getHedgePlatformFees();
        return { chainId: chain.id, chainName: chain.name, fees: toNum(fees, chain.decimals), onChain: true };
      } catch {
        return { chainId: chain.id, chainName: chain.name, fees: 0, onChain: false };
      }
    })
  );
  return results;
}

/** Convenience wrapper: returns total across all chains (best-effort). */
export async function readPlatformFees(): Promise<number> {
  const perChain = await readPlatformFeesPerChain();
  return perChain.reduce((s, c) => s + c.fees, 0);
}

export function invalidateChainCache() {
  _cache = null;
}
