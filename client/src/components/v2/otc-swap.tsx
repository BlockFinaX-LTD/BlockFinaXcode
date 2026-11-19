/**
 * OTC, before launch: a simple swap card (buy or sell USDC for a local currency) at the live
 * rate. Continue says the service is launching soon. The full merchant marketplace (otc.tsx)
 * replaces this at launch.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, X } from 'lucide-react';
import { api } from '@/lib/wallets/passkey-wallet';
import { useUsdcBalances } from './shared';
import { Flag } from './ui';
import './otc-swap.css';

const CURRENCIES: { code: string; name: string }[] = [
  { code: 'GHS', name: 'Ghanaian Cedi' },
  { code: 'NGN', name: 'Nigerian Naira' },
  { code: 'KES', name: 'Kenyan Shilling' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'EGP', name: 'Egyptian Pound' },
];

const fmt = (v: number, dp = 2) => (Number.isFinite(v) ? v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp }) : '0');

export function OtcSwap() {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [ccy, setCcy] = useState('GHS');
  const [amount, setAmount] = useState('');
  const [picking, setPicking] = useState(false);
  const [soon, setSoon] = useState(false);
  const balances = useUsdcBalances();
  const usdc = balances.data?.total ?? 0;
  const rate = useQuery({
    queryKey: ['v2-spot', `USD/${ccy}`],
    queryFn: async () => Number((await api<{ spot: string }>(`/api/v2/spot?pair=${encodeURIComponent(`USD/${ccy}`)}`)).spot),
    refetchInterval: 60_000,
  });
  const r = rate.data ?? 0;
  const n = Number(amount) || 0;
  // Buy: you send local currency and receive USDC. Sell: you send USDC and receive local currency.
  const receive = side === 'buy' ? (r ? n / r : 0) : n * r;
  const sendCode = side === 'buy' ? ccy : 'USDC';
  const getCode = side === 'buy' ? 'USDC' : ccy;
  const info = CURRENCIES.find((c) => c.code === ccy)!;

  const coin = (code: string, pickable: boolean) => (
    <button className={`ox-coin${pickable ? ' pick' : ''}`} onClick={() => pickable && setPicking(!picking)} aria-haspopup={pickable ? 'listbox' : undefined}>
      {code === 'USDC' ? <span className="ox-usdc">$</span> : <Flag pair={`USD/${code}`} />}
      <b>{code}</b>{pickable && <span className="ox-caret">▾</span>}
    </button>
  );

  return (
    <main className="bx-main bx-desk ox-main">
      <div className="ox-wrap">
        <div className="ox-side" role="group" aria-label="Buy or sell USDC">
          <button className={side === 'buy' ? 'on' : ''} onClick={() => { setSide('buy'); setAmount(''); }}>Buy USDC</button>
          <button className={side === 'sell' ? 'on' : ''} onClick={() => { setSide('sell'); setAmount(''); }}>Sell USDC</button>
        </div>
        <div className="ox-card">
          <div className="ox-box">
            <div className="ox-row"><span className="ox-k">You send</span>
              {sendCode === 'USDC' && <span className="ox-bal num">{fmt(usdc)} <button className="ox-max" onClick={() => setAmount(String(Math.floor(usdc * 100) / 100))}>MAX</button></span>}
            </div>
            <div className="ox-row">
              <input id="ox-amount" className="ox-amt num" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} aria-label={`Amount in ${sendCode}`} />
              {coin(sendCode, sendCode !== 'USDC')}
            </div>
          </div>
          <button className="ox-flip" aria-label="Switch buy and sell" onClick={() => { setSide(side === 'buy' ? 'sell' : 'buy'); setAmount(''); }}><ArrowDownUp size={16} /></button>
          <div className="ox-box ox-get">
            <div className="ox-row"><span className="ox-k">You receive</span></div>
            <div className="ox-row">
              <span className="ox-amt num">{receive ? fmt(receive, getCode === 'USDC' ? 2 : 2) : '0'}</span>
              {coin(getCode, getCode !== 'USDC')}
            </div>
          </div>
          {picking && (
            <div className="ox-list" role="listbox">
              {CURRENCIES.map((c) => (
                <button key={c.code} role="option" aria-selected={c.code === ccy} className={c.code === ccy ? 'on' : ''} onClick={() => { setCcy(c.code); setPicking(false); }}>
                  <Flag pair={`USD/${c.code}`} /><b>{c.code}</b><span className="muted">{c.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="ox-rate num">{r ? `1 USDC = ${fmt(r, 4)} ${ccy}` : 'Loading rate...'}<span className="muted"> · indicative, {info.name}</span></div>
          <button className="ox-go" disabled={!(n > 0)} onClick={() => setSoon(true)}>{n > 0 ? 'Continue' : 'Enter an amount'}</button>
        </div>
      </div>

      {soon && (
        <div className="bx-modal-bg" onClick={() => setSoon(false)}>
          <div className="bx-modal ox-soon" role="dialog" aria-modal="true" aria-label="Launching soon" onClick={(e) => e.stopPropagation()}>
            <button className="ox-close" aria-label="Close" onClick={() => setSoon(false)}><X size={18} /></button>
            <div className="ox-soon-badge">Launching soon</div>
            <h2>{side === 'buy' ? `Buy USDC with ${ccy}` : `Sell USDC for ${ccy}`}</h2>
            <p>Swap USDC and local currency with approved merchants, paid by bank transfer or mobile money, with the USDC held safely until both sides are done.</p>
            <p className="muted">It is not open yet. Your quote: {fmt(n)} {sendCode} for about {fmt(receive)} {getCode}.</p>
            <button className="ox-go" onClick={() => setSoon(false)}>OK</button>
          </div>
        </div>
      )}
    </main>
  );
}
