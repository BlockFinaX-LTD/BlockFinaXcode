/**
 * Cover on the currency-pool model (Architecture v2.0), for the passkey-wallet build.
 *
 * Buy cover: pick a market, amount, length and Open or Capped cover, get a signed quote
 * from /api/v2/quotes, then approve the purchase with the passkey. BlockFinaX chooses the
 * execution network (the liquidity hub); the user never chooses a chain here.
 * Underwrite: add USDC liquidity to a pool. Portfolio: the user's cover and claims.
 *
 * Amounts are USDC and gas is sponsored, so the user needs nothing but USDC.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Layers, Loader2, Shield, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FlagSvg } from '@/components/app-glyphs';
import type { CurrencyPool, ProtectionPosition, ProtectionQuote, SettlementResult } from '@shared/domain/types';
import { api, passkeyBalances, passkeyWalletProvider } from '@/lib/wallets/passkey-wallet';
import { toWalletRequest, type PreparedTransaction } from '@/lib/wallet-provider';

type View = 'buy' | 'lp' | 'portfolio';
type Structure = 'open' | 'capped';
type Direction = 'up' | 'down';

const quoteCcy = (pair: string) => pair.split('/')[1] ?? pair;
const fmt = (v: string | number, dp = 2) => Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtRate = (v: string | number) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 });

function Flag({ pair }: { pair: string }) {
  return <span className="mkt-fl"><FlagSvg code={quoteCcy(pair)} /></span>;
}

/** Run each prepared transaction through the passkey wallet, in order. */
async function signAndSend(transactions: PreparedTransaction[], onStep: (m: string) => void) {
  let hash = '';
  for (const tx of transactions) {
    onStep(tx.label);
    hash = (await passkeyWalletProvider.sendTransaction(toWalletRequest(tx), onStep)).transactionHash;
  }
  return hash;
}

function useHubPools() {
  return useQuery({
    queryKey: ['v2-pools'],
    queryFn: async () => (await api<{ pools: CurrencyPool[] }>('/api/v2/pools')).pools,
    refetchInterval: 30_000,
  });
}

function useUsdc(chain: string | undefined) {
  return useQuery({
    queryKey: ['v2-usdc', chain],
    enabled: Boolean(chain),
    queryFn: async () => {
      const rows = await passkeyBalances();
      const key = (chain ?? '').toUpperCase().replace(/-/g, '_');
      return rows.find((b) => b.chain === key && b.token === 'USDC')?.amount ?? 0;
    },
    refetchInterval: 30_000,
  });
}

export function CoverV2() {
  const [view, setView] = useState<View>('buy');
  return (
    <>
      <div className="page-head">
        <div className="ph-l">
          <h1>Cover</h1>
          <p>Protect a payment against a currency move, or earn by underwriting. Everything is in USDC and network fees are covered.</p>
        </div>
      </div>
      <div className="cv-tabs">
        <button className={view === 'buy' ? 'on' : ''} onClick={() => setView('buy')}><ShieldCheck /> Buy cover</button>
        <button className={view === 'lp' ? 'on' : ''} onClick={() => setView('lp')}><Layers /> Underwrite</button>
        <button className={view === 'portfolio' ? 'on' : ''} onClick={() => setView('portfolio')}><Shield /> Portfolio</button>
      </div>
      {view === 'buy' && <BuyCover onBought={() => setView('portfolio')} />}
      {view === 'lp' && <Underwrite />}
      {view === 'portfolio' && <Portfolio />}
    </>
  );
}

// ── Buy cover ────────────────────────────────────────────────────────────────

function BuyCover({ onBought }: { onBought: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pools = useHubPools();
  const markets = useMemo(() => {
    const byPair = new Map<string, CurrencyPool[]>();
    for (const p of pools.data ?? []) if (p.acceptingHedges) byPair.set(p.pair, [...(byPair.get(p.pair) ?? []), p]);
    return Array.from(byPair.entries()).map(([pair, ps]) => ({
      pair, pools: ps, capacity: ps.reduce((s, p) => Math.max(s, Number(p.liquidity.capacity)), 0), chain: ps[0].chain,
    }));
  }, [pools.data]);

  const [pair, setPair] = useState<string | null>(null);
  const market = markets.find((m) => m.pair === pair) ?? null;
  const usdc = useUsdc(market?.chain);

  const options = useQuery({
    queryKey: ['v2-options', pair],
    enabled: Boolean(pair),
    queryFn: () => api<{ tenors: { tenorDays: number; open: boolean; capped: boolean; maxPayoutAvailable: string }[] }>(`/api/v2/options?pair=${encodeURIComponent(pair!)}`),
  });
  const spot = useQuery({
    queryKey: ['v2-spot', pair],
    enabled: Boolean(pair),
    queryFn: async () => Number((await api<{ spot: string }>(`/api/v2/spot?pair=${encodeURIComponent(pair!)}`)).spot),
    refetchInterval: 60_000,
  });

  const [notional, setNotional] = useState('1000');
  const [tenorDays, setTenorDays] = useState<number | null>(null);
  const [structure, setStructure] = useState<Structure>('capped');
  const [direction, setDirection] = useState<Direction>('up');
  const [strikeMove, setStrikeMove] = useState(0.02);
  const [capMove, setCapMove] = useState(0.1);
  const [quote, setQuote] = useState<ProtectionQuote | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => { if (!pair && markets[0]) setPair(markets[0].pair); }, [markets, pair]);
  useEffect(() => {
    const first = options.data?.tenors[0];
    if (first && !options.data!.tenors.some((t) => t.tenorDays === tenorDays)) setTenorDays(first.tenorDays);
  }, [options.data, tenorDays]);
  useEffect(() => { setQuote(null); }, [pair, notional, tenorDays, structure, direction, strikeMove, capMove]);
  useEffect(() => {
    if (!quote) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round(quote.expiresAt - Date.now() / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [quote]);

  const tenor = options.data?.tenors.find((t) => t.tenorDays === tenorDays);
  const sign = direction === 'up' ? 1 : -1;
  const strike = spot.data ? spot.data * (1 + sign * strikeMove) : null;
  const cap = strike ? strike * (1 + sign * capMove) : null;
  const ccy = pair ? quoteCcy(pair) : '';

  async function getQuote() {
    if (!pair || !tenorDays || !strike) return;
    setBusy('quote');
    try {
      setQuote(await api<ProtectionQuote>('/api/v2/quotes', {
        pair, notional, tenorDays, structure, direction,
        strike: strike.toFixed(6), ...(structure === 'capped' && cap ? { cap: cap.toFixed(6) } : {}),
      }));
    } catch (e) {
      toast({ title: 'No quote', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  async function buy() {
    if (!quote) return;
    if (Number(usdc.data ?? 0) < Number(quote.economic.totalCost)) {
      toast({ title: 'Not enough USDC', description: `You need ${fmt(quote.economic.totalCost)} USDC. Add USDC from Receive.`, variant: 'destructive' });
      return;
    }
    setBusy('Preparing...');
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>('/api/v2/hedges/prepare', { quote });
      const hash = await signAndSend(transactions, (m) => setBusy(m));
      setDone(hash);
      setQuote(null);
      void qc.invalidateQueries({ queryKey: ['v2-hedges'] });
      void qc.invalidateQueries({ queryKey: ['v2-pools'] });
      void qc.invalidateQueries({ queryKey: ['v2-usdc'] });
    } catch (e) {
      toast({ title: 'Purchase failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (pools.isLoading) return <p className="send-note"><Loader2 className="spin" /> Loading markets...</p>;
  if (!markets.length) return <p className="send-note">No cover is on sale right now. Check back soon.</p>;

  if (done) {
    return (
      <div className="pool-card" style={{ textAlign: 'center' }}>
        <CheckCircle2 style={{ color: 'var(--green)', width: 40, height: 40, margin: '8px auto' }} />
        <h3 style={{ fontSize: 17, fontWeight: 600 }}>You're covered</h3>
        <p style={{ fontSize: 12.5, color: 'var(--tx-3)' }}>Your cover is active. Track it in Portfolio.</p>
        <a href={`https://stellar.expert/explorer/testnet/tx/${done}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--blue)' }}>{done.slice(0, 10)}...{done.slice(-6)}</a>
        <div className="ctapair" style={{ marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={() => setDone(null)}>Buy more</button>
          <button className="btn btn-primary" onClick={() => { setDone(null); onBought(); }}>View portfolio</button>
        </div>
      </div>
    );
  }

  return (
    <section className="cv-view on">
      <div className="field">
        <label>Market</label>
        <div className="rtabs">
          {markets.map((m) => (
            <button key={m.pair} className={m.pair === pair ? 'on' : ''} onClick={() => setPair(m.pair)}>
              <Flag pair={m.pair} /> {m.pair}
            </button>
          ))}
        </div>
        {spot.data ? <p className="send-note">Today: 1 USD = {fmtRate(spot.data)} {ccy}</p> : null}
      </div>

      <div className="field">
        <label>You are protected if</label>
        <div className="rtabs">
          <button className={direction === 'up' ? 'on' : ''} onClick={() => setDirection('up')}>{ccy} weakens</button>
          <button className={direction === 'down' ? 'on' : ''} onClick={() => setDirection('down')}>{ccy} strengthens</button>
        </div>
      </div>

      <div className="field">
        <label>Amount to protect (USDC)</label>
        <input className="input" inputMode="decimal" value={notional} onChange={(e) => setNotional(e.target.value.replace(/[^0-9.]/g, ''))} />
      </div>

      <div className="field">
        <label>Length</label>
        <div className="rtabs">
          {(options.data?.tenors ?? []).map((t) => (
            <button key={t.tenorDays} className={t.tenorDays === tenorDays ? 'on' : ''} onClick={() => setTenorDays(t.tenorDays)}>{t.tenorDays} days</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Cover type</label>
        <div className="rtabs">
          <button className={structure === 'capped' ? 'on' : ''} disabled={tenor ? !tenor.capped : false} onClick={() => setStructure('capped')}>Capped</button>
          <button className={structure === 'open' ? 'on' : ''} disabled={tenor ? !tenor.open : false} onClick={() => setStructure('open')}>Open</button>
        </div>
        <p className="send-note">
          {structure === 'capped'
            ? 'Pays for the move between your protection rate and a cap you choose. Cheaper.'
            : "Pays for the move past your protection rate, up to the pool's maximum payout."}
        </p>
      </div>

      <div className="field">
        <label>Protection starts at</label>
        <div className="rtabs">
          {[0, 0.02, 0.05].map((m) => (
            <button key={m} className={strikeMove === m ? 'on' : ''} onClick={() => setStrikeMove(m)}>{m === 0 ? "Today's rate" : `${sign > 0 ? '+' : '-'}${m * 100}%`}</button>
          ))}
        </div>
        {strike ? <p className="send-note">1 USD = {fmtRate(strike)} {ccy}</p> : null}
      </div>

      {structure === 'capped' && (
        <div className="field">
          <label>Cap</label>
          <div className="rtabs">
            {[0.05, 0.1, 0.2].map((m) => (
              <button key={m} className={capMove === m ? 'on' : ''} onClick={() => setCapMove(m)}>{`${sign > 0 ? '+' : '-'}${m * 100}% beyond`}</button>
            ))}
          </div>
          {cap ? <p className="send-note">Pays up to 1 USD = {fmtRate(cap)} {ccy}</p> : null}
        </div>
      )}

      {!quote ? (
        <button className="btn btn-primary" disabled={!!busy || !strike || !tenorDays || !(Number(notional) > 0)} onClick={getQuote}>
          {busy === 'quote' ? <Loader2 className="spin" /> : null} Get price
        </button>
      ) : (
        <>
          <div className="brk">
            <div className="brk-line"><span className="l">Cover price</span><span className="v">{fmt(quote.economic.premium)} USDC</span></div>
            <div className="brk-line"><span className="l">BlockFinaX fee</span><span className="v">{fmt(quote.economic.hedgerFee)} USDC</span></div>
            <div className="brk-line total"><span className="l">You pay</span><span className="v">{fmt(quote.economic.totalCost)} USDC</span></div>
            <div className="brk-line"><span className="l">Most it can pay you</span><span className="v">{fmt(quote.economic.maxPayout)} USDC</span></div>
            <div className="brk-line"><span className="l">Ends</span><span className="v">in {quote.economic.tenorDays} days</span></div>
            <div className="brk-line"><span className="l">Network fees</span><span className="v" style={{ color: 'var(--green)' }}>Covered</span></div>
            <div className="brk-line"><span className="l">Your USDC</span><span className="v">{fmt(usdc.data ?? 0)} USDC</span></div>
          </div>
          <p className="send-note">{secondsLeft > 0 ? `Price held for ${secondsLeft}s.` : 'This price expired. Get a new one.'}</p>
          <div className="ctapair">
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => setQuote(null)}>Change</button>
            {secondsLeft > 0 ? (
              <button className="btn btn-primary" disabled={!!busy} onClick={buy}>
                {busy ? <><Loader2 className="spin" /> {busy}</> : `Buy cover for ${fmt(quote.economic.totalCost)} USDC`}
              </button>
            ) : (
              <button className="btn btn-primary" disabled={!!busy} onClick={getQuote}>New price</button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ── Underwrite ───────────────────────────────────────────────────────────────

function Underwrite() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pools = useHubPools();
  const usdc = useUsdc(pools.data?.[0]?.chain);
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function deposit(pool: CurrencyPool) {
    setBusy('Preparing...');
    try {
      const ref = `${pool.ref.chain}:${pool.ref.contract}:${pool.ref.id}`;
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${encodeURIComponent(ref)}/deposits/prepare`, { amount });
      await signAndSend(transactions, (m) => setBusy(m));
      toast({ title: 'Liquidity added', description: `${fmt(amount)} USDC added to the ${pool.pair} pool.` });
      setOpen(null); setAmount('');
      void qc.invalidateQueries({ queryKey: ['v2-pools'] });
      void qc.invalidateQueries({ queryKey: ['v2-usdc'] });
    } catch (e) {
      toast({ title: 'Deposit failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (pools.isLoading) return <p className="send-note"><Loader2 className="spin" /> Loading pools...</p>;
  return (
    <section className="cv-view on">
      {(pools.data ?? []).map((p) => {
        const key = p.ref.id;
        const used = Number(p.liquidity.nav) > 0 ? Math.round((Number(p.liquidity.reserved) / Number(p.liquidity.nav)) * 100) : 0;
        return (
          <div className="pool-card" key={key}>
            <div className="pool-top">
              <Flag pair={p.pair} />
              <div className="pt-nm"><div className="a">{p.pair}</div><div className="b">{p.tenors.filter((t) => t.active).map((t) => `${t.tenorDays}d`).join(' · ')}</div></div>
            </div>
            <div className="pool-stats">
              <div className="pool-stat"><div className="l">Pool size</div><div className="v tnum">{fmt(p.liquidity.nav, 0)}</div></div>
              <div className="pool-stat"><div className="l">Available</div><div className="v tnum">{fmt(p.liquidity.capacity, 0)}</div></div>
              <div className="pool-stat"><div className="l">Active cover</div><div className="v tnum">{p.activePositions}</div></div>
            </div>
            <div className="pool-cap"><div className="row1"><span>Capacity</span><span>{used}% used</span></div><div className="liqbar"><i style={{ width: `${used}%` }} /></div></div>
            {open === key ? (
              <>
                <div className="field" style={{ marginTop: 10 }}>
                  <label>Amount (USDC) · you have {fmt(usdc.data ?? 0)}</label>
                  <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
                </div>
                <div className="ctapair">
                  <button className="btn btn-ghost" disabled={!!busy} onClick={() => setOpen(null)}>Cancel</button>
                  <button className="btn btn-primary" disabled={!!busy || !(Number(amount) > 0) || !p.allowExternalLp} onClick={() => deposit(p)}>
                    {busy ? <><Loader2 className="spin" /> {busy}</> : 'Add liquidity'}
                  </button>
                </div>
              </>
            ) : (
              <button className="btn-sm2 primary" disabled={!p.allowExternalLp} onClick={() => setOpen(key)}>{p.allowExternalLp ? 'Underwrite' : 'Closed to new underwriters'}</button>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ── Portfolio ────────────────────────────────────────────────────────────────

function Portfolio() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const hedges = useQuery({
    queryKey: ['v2-hedges'],
    queryFn: async () => (await api<{ hedges: { position: ProtectionPosition; pair: string; settlement: SettlementResult }[] }>('/api/v2/hedges')).hedges,
    refetchInterval: 30_000,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function claim(ref: string) {
    setBusy(ref);
    try {
      const { transactions } = await api<{ transactions: PreparedTransaction[] }>(`/api/v2/hedges/${encodeURIComponent(ref)}/claim/prepare`, {});
      await signAndSend(transactions, () => {});
      toast({ title: 'Payout claimed', description: 'The USDC is in your wallet.' });
      void qc.invalidateQueries({ queryKey: ['v2-hedges'] });
    } catch (e) {
      toast({ title: 'Claim failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  if (hedges.isLoading) return <p className="send-note"><Loader2 className="spin" /> Loading your cover...</p>;
  if (!hedges.data?.length) return <p className="send-note">You have no cover yet. Buy cover to protect a payment.</p>;
  return (
    <section className="cv-view on">
      {hedges.data.map(({ position: p, pair, settlement: s }) => {
        const ref = s.position;
        const claimable = s.status === 'settled_claimable';
        const label = s.status === 'pending' ? 'Active' : claimable ? `Pays ${fmt(s.netPayout)} USDC` : s.status === 'claimed' ? 'Paid' : 'Ended, no payout';
        return (
          <div className="pool-card" key={ref}>
            <div className="pool-top">
              <Flag pair={pair} />
              <div className="pt-nm">
                <div className="a">{pair} · {p.structure === 'open' ? 'Open' : 'Capped'}</div>
                <div className="b">{fmt(p.notional)} USDC · from {fmtRate(p.strike)}{p.cap ? ` to ${fmtRate(p.cap)}` : ''}</div>
              </div>
              <div className="pool-apr"><div className="v">{label}</div><div className="l">{s.status === 'pending' ? `Ends ${new Date(p.expiry * 1000).toLocaleDateString()}` : ''}</div></div>
            </div>
            {claimable && (
              <button className="btn-sm2 primary" disabled={busy === ref} onClick={() => claim(ref)}>
                {busy === ref ? <Loader2 className="spin" /> : null} Claim {fmt(s.netPayout)} USDC
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
