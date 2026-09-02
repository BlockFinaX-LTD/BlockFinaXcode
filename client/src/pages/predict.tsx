/**
 * Predict — a parimutuel market on where a rate finishes.
 *
 * Everyone backing Yes shares the pot against everyone backing No, split by
 * stake. There is no order book and no automated market maker, so there is no
 * liquidity to seed and the market can never pay out more than it took in. The
 * price is what the split implies rather than a number anyone quotes, which is
 * why a market with one empty side is shown as having no price at all instead
 * of 100%.
 *
 * The maths lives on the server in predict/parimutuel.ts and is tested there.
 * This page asks for a quote rather than computing one, because a stake has to
 * be priced into the pool it is joining and doing that in two places is how the
 * two answers drift apart.
 */
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, Loader2, TrendingUp } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { useWallet } from '@/hooks/use-wallet';
import { useToast } from '@/hooks/use-toast';
import { predictApi, type PredictAccount } from '@/lib/predict-api';
import { DEFAULT_NETWORK } from '@/lib/networks';

interface Pools { yes: number; no: number }
interface Market {
  id: number; pair: string; question: string; threshold: number;
  direction: 'above' | 'below'; closesAt: string; settlesAt: string;
  status: string; pools: Pools; impliedYes: number | null;
  settlementRate: number | null; outcome: string | null;
}
interface Quote { total: number; winnings: number; multiple: number; impliedOdds: number | null }

const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (p: number) => Math.round(p * 100) + '%';

function closesIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'closed';
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} min left`;
  if (h < 48) return `${Math.round(h)} hours left`;
  return `${Math.round(h / 24)} days left`;
}

/**
 * The split, drawn.
 *
 * A bar rather than two numbers, because the one thing a reader wants at a
 * glance is which way the money has gone, and two dollar figures make that a
 * subtraction.
 */
function SplitBar({ pools }: { pools: Pools }) {
  const total = pools.yes + pools.no;
  const yesPct = total > 0 ? (pools.yes / total) * 100 : 50;
  const priced = pools.yes > 0 && pools.no > 0;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-[color:var(--film-2)]">
        <div style={{ width: `${yesPct}%` }} className={priced ? 'bg-emerald-500' : 'bg-[color:var(--border-2)]'} />
        <div style={{ width: `${100 - yesPct}%` }} className={priced ? 'bg-rose-400' : 'bg-[color:var(--border-2)]'} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-[color:var(--tx-3)]">
        <span>Yes {usd(pools.yes)}</span>
        <span>No {usd(pools.no)}</span>
      </div>
    </div>
  );
}


/**
 * Balance, deposits and withdrawals.
 *
 * Depositing is two steps and the page says so, because pretending otherwise is
 * what makes people think their money vanished: the transfer goes on chain
 * first, and only then does the server read that transaction and credit it.
 * Nothing here sends an amount to the server. The hash is enough, and the chain
 * is the source of truth for how much arrived.
 */
function AccountPanel({ onChanged }: { onChanged: () => void }) {
  const { wallet } = useWallet();
  const { toast } = useToast();
  const [acct, setAcct] = useState<PredictAccount | null>(null);
  const [txHash, setTxHash] = useState('');
  const [wd, setWd] = useState('');
  const [busy, setBusy] = useState<'deposit' | 'withdraw' | null>(null);

  const load = () => {
    if (!wallet?.address) { setAcct(null); return; }
    predictApi.account(DEFAULT_NETWORK.chainId).then(setAcct).catch(() => setAcct(null));
  };
  useEffect(load, [wallet?.address]);

  if (!wallet?.address) {
    return (
      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card-2)] p-4 text-[13px] text-[color:var(--tx-2)]">
        Unlock your wallet to see your balance and take positions.
      </div>
    );
  }

  const claim = async () => {
    setBusy('deposit');
    try {
      const r = await predictApi.deposit(DEFAULT_NETWORK.chainId, txHash.trim());
      toast({
        title: r.alreadyCredited ? 'Already credited' : 'Deposit credited',
        description: r.alreadyCredited
          ? 'That transaction had been counted already, so nothing was added twice.'
          : `${usd(r.amount)} ${r.token} added to your balance.`,
      });
      setTxHash(''); load(); onChanged();
    } catch (e: any) {
      toast({ title: 'Not credited', description: e?.message, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const withdraw = async () => {
    const amt = parseFloat(wd);
    setBusy('withdraw');
    try {
      const r = await predictApi.withdraw(DEFAULT_NETWORK.chainId, amt);
      toast({
        title: r.sent ? 'Sent' : 'Queued',
        description: r.sent
          ? `${usd(amt)} is on its way to your wallet.`
          : r.note || 'Your balance is debited and the transfer will follow.',
      });
      setWd(''); load(); onChanged();
    } catch (e: any) {
      toast({ title: 'Not withdrawn', description: e?.message, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--tx-4)]">Your balance</span>
        <span className="text-2xl font-semibold tabular-nums text-[color:var(--tx)]">
          {acct ? usd(acct.balance) : '—'}
        </span>
      </div>

      {acct?.depositAddress ? (
        <div className="mt-4 space-y-2">
          <p className="text-[13px] leading-relaxed text-[color:var(--tx-3)]">
            To add funds, send USDC on Base to{' '}
            <span className="break-all font-mono text-[12px] text-[color:var(--tx)]">{acct.depositAddress}</span>,
            then paste the transaction hash below. The amount is read from the chain, not from what you type.
          </p>
          <div className="flex gap-2">
            <input
              value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="0x…"
              className="min-w-0 flex-1 rounded-xl border border-[color:var(--border)] px-3 py-2 font-mono text-[12px] outline-none"
            />
            <button
              onClick={claim} disabled={busy !== null || txHash.trim().length < 66}
              className="flex-none rounded-xl bg-[color:var(--acc,#1a4480)] px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy === 'deposit' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Credit'}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-[color:var(--tx-4)]">Deposits are not enabled on this deployment yet.</p>
      )}

      {acct && acct.balance > 0 && (
        <div className="mt-4 flex gap-2 border-t border-[color:var(--border)] pt-4">
          <input
            value={wd} onChange={(e) => setWd(e.target.value)}
            placeholder={`Withdraw (min $${acct.minWithdrawal})`}
            inputMode="decimal"
            className="min-w-0 flex-1 rounded-xl border border-[color:var(--border)] px-3 py-2 text-sm outline-none"
          />
          <button
            onClick={withdraw}
            disabled={busy !== null || !(parseFloat(wd) >= acct.minWithdrawal) || parseFloat(wd) > acct.balance}
            className="flex-none rounded-xl border border-[color:var(--border)] px-4 text-sm font-medium text-[color:var(--tx-2)] disabled:opacity-40"
          >
            {busy === 'withdraw' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Withdraw'}
          </button>
        </div>
      )}
    </div>
  );
}

function MarketCard({ m, onStaked }: { m: Market; onStaked: () => void }) {
  const { wallet } = useWallet();
  const { toast } = useToast();
  const [side, setSide] = useState<'yes' | 'no' | null>(null);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState(false);

  const open = m.status === 'open' && new Date(m.closesAt).getTime() > Date.now();
  const stake = parseFloat(amount);

  useEffect(() => {
    if (!side || !Number.isFinite(stake) || stake <= 0) { setQuote(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/predict/quote', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ marketId: m.id, side, stake }), signal: ctl.signal,
        });
        const j = await r.json();
        if (r.ok) setQuote(j);
      } catch { /* a failed quote must not block the page */ }
    }, 300);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [side, stake, m.id]);

  const submit = async () => {
    if (!wallet?.address) {
      toast({ title: 'Wallet locked', description: 'Unlock your wallet to take a position.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      await predictApi.stake(DEFAULT_NETWORK.chainId, m.id, side!, stake);
      toast({ title: 'Position taken', description: `${usd(stake)} on ${side === 'yes' ? 'Yes' : 'No'}.` });
      setAmount(''); setSide(null); setQuote(null); onStaked();
    } catch (e: any) {
      toast({ title: 'Not placed', description: e?.message || 'Something went wrong.', variant: 'destructive' });
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--tx-4)]">{m.pair}</div>
          <h3 className="mt-1 text-[15px] font-semibold leading-snug text-[color:var(--tx)]">{m.question}</h3>
        </div>
        <div className="flex-none text-right">
          {m.impliedYes == null ? (
            <>
              <div className="text-[13px] font-medium text-[color:var(--tx-4)]">no price</div>
              <div className="text-[11px] text-[color:var(--tx-4)]">one side empty</div>
            </>
          ) : (
            <>
              <div className="text-2xl font-semibold tabular-nums leading-none text-[color:var(--tx)]">{pct(m.impliedYes)}</div>
              <div className="text-[11px] text-[color:var(--tx-3)]">chance of Yes</div>
            </>
          )}
        </div>
      </div>

      <div className="mt-4"><SplitBar pools={m.pools} /></div>

      {m.status === 'settled' || m.status === 'void' ? (
        <div className="mt-4 rounded-xl bg-[color:var(--card-2)] p-3 text-[13px] text-[color:var(--tx-2)]">
          {m.status === 'void' ? (
            <>Nobody took the other side, so every stake was refunded in full.</>
          ) : (
            <>Settled at <strong className="text-[color:var(--tx)]">{m.settlementRate}</strong>.{' '}
              The answer was <strong className="text-[color:var(--tx)]">{m.outcome === 'yes' ? 'Yes' : 'No'}</strong>.</>
          )}
        </div>
      ) : !open ? (
        <div className="mt-4 text-[13px] text-[color:var(--tx-3)]">Staking has closed. Waiting to settle.</div>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between">
            <div className="flex gap-2">
              {(['yes', 'no'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(side === s ? null : s)}
                  className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                    side === s
                      ? s === 'yes' ? 'bg-emerald-600 text-white' : 'bg-rose-500 text-white'
                      : 'border border-[color:var(--border)] text-[color:var(--tx-2)] hover:border-[color:var(--border-2)]'
                  }`}
                >
                  {s === 'yes' ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
            <span className="text-[12px] text-[color:var(--tx-4)]">{closesIn(m.closesAt)}</span>
          </div>

          {side && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2 rounded-xl border border-[color:var(--border)] px-3 py-2">
                <span className="text-sm text-[color:var(--tx-4)]">$</span>
                <input
                  inputMode="decimal" placeholder="0" value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-transparent text-sm outline-none"
                />
              </div>
              {quote && Number.isFinite(stake) && stake > 0 && (
                <div className="rounded-xl bg-[color:var(--card-2)] p-3 text-[13px] leading-relaxed text-[color:var(--tx-2)]">
                  If <strong className="text-[color:var(--tx)]">{side === 'yes' ? 'Yes' : 'No'}</strong> wins you get back{' '}
                  <strong className="text-[color:var(--tx)]">{usd(quote.total)}</strong>, which is{' '}
                  {quote.multiple.toFixed(2)}x your stake. If it does not, you get nothing.
                  <div className="mt-1 text-[12px] text-[color:var(--tx-4)]">
                    Priced with your stake already in the pool, so this is what you would actually receive.
                  </div>
                </div>
              )}
              <button
                onClick={submit}
                disabled={busy || !Number.isFinite(stake) || stake < 1}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[color:var(--acc,#1a4480)] px-5 py-3 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Placing…</> : <>Take this position</>}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PredictPage() {
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const load = () => {
    fetch('/api/predict/markets')
      .then((r) => r.json())
      .then((j) => setMarkets(j.markets ?? []))
      .catch(() => setMarkets([]));
  };
  useEffect(load, []);

  return (
    <AppShell
      active="predict"
      greeting={{ title: 'Predict', subtitle: 'Take a view on where a rate finishes' }}
    >
      <div className="mx-auto max-w-2xl">
        <section className="pt-14 pb-8">
          <span className="inline-flex items-center gap-2 rounded-full bg-[color:var(--film-2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--tx-2)]">
            <TrendingUp className="h-3.5 w-3.5" /> Predict
          </span>
          <h1 className="mt-5 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Where will the rate finish?
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--tx-3)]">
            Back Yes or No on a currency level. Everyone on the winning side shares what the losing
            side staked, split by how much each put in. There is no house taking the other side of
            your position, so the odds are simply where the money has gone.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-[color:var(--tx-4)]">
            Markets settle on the same rates BlockFinaX Cover settles on. A rate that lands exactly
            on the line has not passed it.
          </p>
        </section>

        <div className="mb-6"><AccountPanel onChanged={load} /></div>

        {markets === null ? (
          <div className="flex justify-center py-14"><Loader2 className="h-5 w-5 animate-spin text-[color:var(--tx-4)]" /></div>
        ) : markets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--border)] py-14 text-center">
            <p className="text-sm text-[color:var(--tx-3)]">No markets are open yet.</p>
            <p className="mt-1 text-[13px] text-[color:var(--tx-4)]">Check back shortly, or hedge a real position in Cover.</p>
            <Link href="/hedge" className="mt-5 inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] px-5 py-2.5 text-sm font-medium text-[color:var(--tx-2)] no-underline hover:border-[color:var(--border-2)]">
              Open Cover <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {markets.map((m) => <MarketCard key={m.id} m={m} onStaked={load} />)}
          </div>
        )}
      </div>
    </AppShell>
  );
}
