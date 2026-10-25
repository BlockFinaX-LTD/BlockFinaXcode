/**
 * Interest-rate protection: buy from a benchmark's pools, see them in Markets, and track them
 * in My protections. Pools have fixed terms: the strike is the latest official fixing plus or
 * minus the pool's offset, and the payout uses the benchmark compounded over the protection.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Percent } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/wallets/passkey-wallet';
import type { PreparedTransaction } from '@/lib/wallet-provider';
import { dateOf, fmt, signAndSend, useUsdcBalances, usdcOn } from './shared';
import { hint, Loading, SHOW_INTEREST_RATES, Spin, Sum, Tag } from './ui';
import type { Go } from './workspace';

export interface RatePool {
  id: number; benchmark: string; direction: 'rise' | 'fall'; strikeOffsetPercent: string; capWidthPercent: string;
  lookbackDays: number; basis: number; capital: string; locked: string; available: string; active: boolean;
  tenors: { days: number; premiumBps: number }[];
  reference: { observationDate: string; ratePercent: string } | null;
  strikePercent: string | null; capPercent: string | null;
}

export interface RateProtection {
  id: number; poolId: number; benchmark: string; direction: 'rise' | 'fall'; notional: string; premium: string; days: number;
  strikePercent: string; capPercent: string; startDate: string; startRatePercent: string; windowEndDate: string;
  expiry: number; createdAt: number; maxPayout: string; status: 'active' | 'settleable' | 'settled' | 'refunded';
  settlementRatePercent: string | null; payout: string | null;
}

interface RateQuote { premium: string; maxPayout: string; premiumBps: number; enoughLiquidity: boolean; strikePercent: string | null; capPercent: string | null }

const CHAIN = 'stellar-testnet';
const pct = (s: string | null, dp = 2) => (s === null ? '-' : `${Number(s).toFixed(dp)}%`);
const day = (iso: string) => dateOf(Date.parse(`${iso}T12:00:00Z`) / 1000);

export function rateCoverLabel(direction: 'rise' | 'fall', benchmark: string) {
  return direction === 'rise'
    ? { title: 'Rate rise protection', who: 'For floating-rate borrowers', pays: `Pays if ${benchmark} averages above the strike` }
    : { title: 'Rate fall protection', who: 'For depositors and lenders', pays: `Pays if ${benchmark} averages below the strike` };
}

export function useRatePools() {
  return useQuery({
    queryKey: ['v2-rate-pools'],
    queryFn: async () => (await api<{ pools: RatePool[] }>('/api/v2/rate-pools')).pools,
    enabled: SHOW_INTEREST_RATES,
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useRateProtections() {
  return useQuery({
    queryKey: ['v2-rate-protections'],
    queryFn: async () => (await api<{ protections: RateProtection[] }>('/api/v2/rate-protections')).protections,
    enabled: SHOW_INTEREST_RATES,
    refetchInterval: 30_000,
    retry: false,
  });
}

const AMOUNTS = ['1000', '10000', '50000', '100000'];

/** Buy panel for one benchmark's pools, shown on the benchmark page. */
export function RateCoverPanel({ benchmark }: { benchmark: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pools = useRatePools();
  const balances = useUsdcBalances();
  const mine = (pools.data ?? []).filter((p) => p.benchmark === benchmark && p.active && p.tenors.length);
  const [direction, setDirection] = useState<'rise' | 'fall'>('rise');
  const pool = mine.find((p) => p.direction === direction) ?? mine[0];
  const [days, setDays] = useState<number | null>(null);
  const tenor = pool?.tenors.find((t) => t.days === days) ?? pool?.tenors[0];
  const [amount, setAmount] = useState('10000');
  const [busy, setBusy] = useState<string | null>(null);
  const valid = /^\d+(\.\d{1,7})?$/.test(amount) && Number(amount) > 0;

  const quote = useQuery({
    queryKey: ['v2-rate-quote', pool?.id, tenor?.days, amount],
    enabled: Boolean(pool && tenor && valid),
    queryFn: () => api<RateQuote>('/api/v2/rate-pools/quote', { poolId: pool!.id, days: tenor!.days, notional: amount }),
    retry: false,
  });

  if (pools.isLoading) return <div className="bx-card" style={{ marginTop: 16 }}><Loading /></div>;
  if (!mine.length) {
    return (
      <div className="bx-card" style={{ marginTop: 16 }}>
        <div className="bx-card-h"><h2>Protect against {benchmark} moves</h2></div>
        <div className="bx-empty">No {benchmark} cover is on sale right now.</div>
      </div>
    );
  }

  const label = rateCoverLabel(pool.direction, benchmark);
  const balance = usdcOn(balances.data?.rows, CHAIN);
  const q = quote.data;

  const buy = async () => {
    if (!q || !tenor) return;
    if (balance < Number(q.premium)) {
      toast({ title: 'Not enough USDC', description: `This needs $${fmt(q.premium)} USDC on Stellar. Add funds first.`, variant: 'destructive' });
      return;
    }
    try {
      setBusy('Preparing...');
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/rate-pools/${pool.id}/buy/prepare`, { days: tenor.days, notional: amount });
      await signAndSend(transactions, (m) => setBusy(m));
      toast({ title: 'Protection placed', description: `${label.title} on $${fmt(amount)} for ${tenor.days} days.` });
      for (const k of ['v2-rate-pools', 'v2-rate-protections', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (err) {
      toast({ title: 'Protection not placed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const directions = Array.from(new Set(mine.map((p) => p.direction)));
  return (
    <div className="bx-card" style={{ marginTop: 16 }}>
      <div className="bx-card-h">
        <div><h2>Protect against {benchmark} moves</h2><div className="sub">Lock in a ceiling or a floor on what {benchmark} costs or earns you. The payout uses {benchmark} compounded over your protection, the way a loan accrues.</div></div>
      </div>
      {directions.length > 1 && (
        <div className="bx-seg" role="group" aria-label="Protection type" style={{ marginBottom: 16 }}>
          {directions.map((d) => (
            <button key={d} className={pool.direction === d ? 'on' : ''} aria-pressed={pool.direction === d} onClick={() => { setDirection(d); setDays(null); }}>
              {rateCoverLabel(d, benchmark).title}
            </button>
          ))}
        </div>
      )}
      <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>{label.who}. {label.pays}.</div>

      <div className="muted" style={{ fontSize: 12, fontWeight: 600, margin: '8px 0 6px' }}>Amount protected (USD)</div>
      <div className="bx-pills" style={{ marginBottom: 8 }}>
        {AMOUNTS.map((a) => <button key={a} className={`bx-pill ${amount === a ? 'on' : ''}`} onClick={() => setAmount(a)}>${fmt(a, 0)}</button>)}
      </div>
      <input className="bx-input" inputMode="decimal" aria-label="Amount protected" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />

      <div className="muted" style={{ fontSize: 12, fontWeight: 600, margin: '16px 0 6px' }}>Length</div>
      <div className="bx-pills wrap">
        {pool.tenors.map((t) => <button key={t.days} className={`bx-pill ${tenor?.days === t.days ? 'on' : ''}`} onClick={() => setDays(t.days)}>{t.days} days</button>)}
      </div>

      <div style={{ marginTop: 16 }}>
        <Sum l={`Latest ${benchmark}`} v={pool.reference ? `${pct(pool.reference.ratePercent, 4)} for ${day(pool.reference.observationDate)}` : '-'} />
        <Sum l="Strike" v={pct(pool.strikePercent, 4)} />
        <Sum l={pool.direction === 'rise' ? 'Covered up to' : 'Covered down to'} v={pct(pool.capPercent, 4)} />
        <Sum l="Most you can receive" v={q ? `$${fmt(q.maxPayout)}` : '-'} />
        <Sum l="Premium" v={q ? `${(q.premiumBps / 100).toFixed(2)}% ($${fmt(q.premium)})` : '-'} />
        <Sum l="Network fees" v="Covered" good />
        <Sum total l="Total" v={q ? `$${fmt(q.premium)}` : '-'} />
      </div>
      {q && !q.enoughLiquidity && <div className="bx-note warn" style={{ marginTop: 12 }}>This pool cannot cover that amount right now. Try a smaller amount or a shorter length.</div>}
      {quote.isError && <div className="bx-note warn" style={{ marginTop: 12 }}>{(quote.error as Error).message}</div>}
      <button className="bx-btn" style={{ width: '100%', marginTop: 16 }} disabled={!q || !q.enoughLiquidity || Boolean(busy)} onClick={buy}>
        {busy ? <><Spin /> {busy}</> : 'Confirm protection'}
      </button>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        The strike is set from the latest official {benchmark} when you buy. Settlement averages {benchmark} from that fixing to {pool.lookbackDays} days before expiry. Testnet prices are set by the pool creator, not by a pricing model yet.
      </p>
    </div>
  );
}

/** Interest-rate pools: the Markets card, or a short list inside a Home card (`embedded`). */
export function RateMarkets({ go, embedded, limit }: { go: Go; embedded?: boolean; limit?: number }) {
  const pools = useRatePools();
  const all = (pools.data ?? []).filter((p) => p.active && p.tenors.length);
  const benchmarks = Array.from(new Set(all.map((p) => p.benchmark)));
  const [filter, setFilter] = useState('all');
  const rows = all.filter((p) => filter === 'all' || p.benchmark === filter).slice(0, limit ?? 100);
  const cols = { gridTemplateColumns: 'minmax(0, 2fr) repeat(3, minmax(0, 1fr)) 120px' };
  const list = pools.isLoading ? <Loading /> : pools.isError ? <div className="bx-empty">Interest rate cover is unavailable right now.</div>
    : !rows.length ? <div className="bx-empty">No interest rate cover is on sale right now.</div> : (
      <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 700 }}>
        <div className="bx-list-h" style={cols}><span>{hint("Cover")}</span><span className="r">{hint("Liquidity")}</span><span className="r">{hint("Strike today")}</span><span className="r">{hint("Lengths")}</span><span /></div>
        {rows.map((p) => {
          const l = rateCoverLabel(p.direction, p.benchmark);
          return (
            <div key={p.id} className="bx-li" style={cols}>
              <div className="bx-who"><span className="bx-ic"><Percent aria-hidden="true" /></span><div><div className="t">{p.benchmark} {l.title.toLowerCase()}</div><div className="d">{l.who}</div></div></div>
              <div className="r"><div className="num" style={{ fontWeight: 600 }}>${fmt(p.available)}</div><div className="muted" style={{ fontSize: 12 }}>available</div></div>
              <div className="r num">{pct(p.strikePercent, 2)}</div>
              <div className="r" style={{ fontSize: 13 }}>{p.tenors.map((t) => t.days).join(', ')} days</div>
              <div className="r"><button className="bx-btn small" onClick={() => go('h-rates', { rates: 'ir', benchmark: p.benchmark })}>Buy cover</button></div>
            </div>
          );
        })}
      </div></div>
    );
  if (embedded) return list;
  return (
    <div className="bx-card">
      <div className="bx-card-h" style={{ flexWrap: 'wrap' }}>
        <div><h2>Interest rate cover</h2><div className="sub">Pools that pay when an official benchmark rate rises or falls past the strike.</div></div>
        {benchmarks.length > 1 && (
          <div className="bx-seg" style={{ width: 'auto' }}>
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
            {benchmarks.map((b) => <button key={b} className={filter === b ? 'on' : ''} onClick={() => setFilter(b)}>{b}</button>)}
          </div>
        )}
      </div>
      {list}
    </div>
  );
}

/** Interest-rate protections: the My protections card, or active ones inside a Home card (`embedded`). */
export function RateProtections({ go, embedded }: { go: Go; embedded?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = useRateProtections();
  const [busy, setBusy] = useState<number | null>(null);
  const rows = (list.data ?? []).filter((p) => !embedded || p.status === 'active' || p.status === 'settleable');

  const settle = async (id: number) => {
    try {
      setBusy(id);
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/rate-protections/${id}/settle/prepare`, {});
      await signAndSend(transactions, () => {});
      toast({ title: 'Protection settled' });
      for (const k of ['v2-rate-protections', 'v2-rate-pools', 'v2-usdc-all']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (err) {
      toast({ title: 'Not settled yet', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const cols = { gridTemplateColumns: 'minmax(0, 2fr) repeat(3, minmax(0, 1fr)) 150px' };
  const body = list.isLoading ? <Loading /> : list.isError ? <div className="bx-empty">Interest rate protections are unavailable right now.</div>
    : !rows.length ? (
      <div className="bx-empty">No interest rate protection yet. <button className="bx-link" onClick={() => go('h-markets')}>See interest rate cover</button></div>
    ) : (
      <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 700 }}>
        <div className="bx-list-h" style={cols}><span>{hint("Protection")}</span><span className="r">{hint("Protected")}</span><span className="r">{hint("Strike")}</span><span className="r">{hint("Expires")}</span><span className="r">{hint("Status")}</span></div>
        {rows.map((p) => {
          const l = rateCoverLabel(p.direction, p.benchmark);
          return (
            <div key={p.id} className="bx-li" style={cols}>
              <div className="bx-who"><span className="bx-ic"><Percent aria-hidden="true" /></span><div><div className="t">{p.benchmark} {l.title.toLowerCase()}</div><div className="d">From {pct(p.startRatePercent, 4)} on {day(p.startDate)} · premium ${fmt(p.premium)}</div></div></div>
              <div className="r num">${fmt(p.notional)}</div>
              <div className="r num">{pct(p.strikePercent, 4)}</div>
              <div className="r num">{dateOf(p.expiry)}</div>
              <div className="r">
                {p.status === 'active' ? <Tag tone="green">Active</Tag>
                  : p.status === 'settleable' ? <button className="bx-btn small" disabled={busy === p.id} onClick={() => settle(p.id)}>{busy === p.id ? <Spin /> : 'Settle'}</button>
                  : p.status === 'refunded' ? <Tag tone="grey">Refunded</Tag>
                  : Number(p.payout) > 0 ? <Tag tone="green">Paid ${fmt(p.payout!)}</Tag>
                  : <Tag tone="grey">Expired · {pct(p.settlementRatePercent, 4)}</Tag>}
              </div>
            </div>
          );
        })}
      </div></div>
    );
  if (embedded) return body;
  return (
    <div className="bx-card">
      <div className="bx-card-h"><div><h2>Interest rate protections</h2><div className="sub">Settled from the official benchmark compounded over each protection.</div></div></div>
      {body}
    </div>
  );
}
