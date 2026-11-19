/**
 * Homepage sections for a trading-platform feel: hero with a live markets panel, a rates
 * ticker, the four products, platform features and a closing call to action.
 *
 * Live numbers come from the testnet app's public, read-only endpoints. If they cannot be
 * reached (for example before cross-site reads are allowed), the panels fall back to the
 * currency list without prices; nothing on the page depends on them.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import './website-trade.css';
import { HeroRotator, useHeroSurface } from './website';

const HERO_WORDS = ['Hedge', 'Trade', 'Swap', 'Underwrite'];

const clean = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\/+$/, '') : fallback);
const APP = clean(import.meta.env.VITE_TESTNET_APP_URL, 'https://testnet.blockfinax.com');
const LAUNCH = `${APP}/hedge`;

type Rate = { pair: string; spot: number | null; change: number | null };
type Pool = { pair: string; direction: string; acceptingHedges: boolean; legacy?: boolean; liquidity: { capacity: string } };
type Perp = { id: number; pair: string; base: string; quote: string; decimals: number; mark: number; change24h: number; maxLeverage: number };

const NAMES: Record<string, string> = {
  NGN: 'Nigerian Naira', GHS: 'Ghanaian Cedi', KES: 'Kenyan Shilling', ZAR: 'South African Rand', EGP: 'Egyptian Pound',
  UGX: 'Ugandan Shilling', TZS: 'Tanzanian Shilling', MAD: 'Moroccan Dirham', XOF: 'West African CFA franc', ZMW: 'Zambian Kwacha', ETB: 'Ethiopian Birr', RWF: 'Rwandan Franc',
  XAF: 'Central African CFA franc', MZN: 'Mozambican Metical', BWP: 'Botswana Pula', MUR: 'Mauritian Rupee', TND: 'Tunisian Dinar',
};
const COUNTRY: Record<string, string> = { NGN: 'ng', GHS: 'gh', KES: 'ke', ZAR: 'za', EGP: 'eg', UGX: 'ug', TZS: 'tz', MAD: 'ma', XOF: 'sn', ZMW: 'zm', ETB: 'et', RWF: 'rw', XAF: 'cm', MZN: 'mz', BWP: 'bw', MUR: 'mu', TND: 'tn' };
const FALLBACK: Rate[] = ['NGN', 'GHS', 'KES', 'ZAR', 'EGP', 'UGX', 'TZS', 'MAD'].map((c) => ({ pair: `USD/${c}`, spot: null, change: null }));

function useJson<T>(path: string, pick: (j: any) => T, every = 60_000) {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${APP}${path}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => { if (alive) setData(pick(j)); }).catch(() => undefined);
    load();
    const t = setInterval(load, every);
    return () => { alive = false; clearInterval(t); };
  }, [path]);
  return data;
}

const quote = (pair: string) => pair.split('/')[1] ?? pair;
const fmtRate = (v: number | null) => (v == null ? '-' : v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 2 : 4 }));
const fmtChange = (v: number | null) => (v == null ? '' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`);
const compact = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`);

function Flag({ code }: { code: string }) {
  const c = COUNTRY[code];
  return c ? <img className="tx-flag" src={`https://flagcdn.com/w40/${c}.png`} alt="" loading="lazy" /> : <span className="tx-flag" />;
}

// ── Hero ───────────────────────────────────────────────────────────────────

export function TradeHero() {
  const rates = useJson<Rate[]>('/api/v2/rates', (j) => j.rates ?? []);
  const cvRef = useRef<HTMLCanvasElement>(null);
  useHeroSurface(cvRef);
  return (
    <header className="tx-hero">
      <div className="wrap tx-hero-grid">
        <div className="tx-hero-copy">
          <span className="tx-eyebrow">Onchain · settled in USDC</span>
          <h1><HeroRotator words={HERO_WORDS} /><br />exotic currencies.</h1>
          <p className="tx-sub">Earn in local currency, pay in foreign currency? Protect your margin from devaluation. Trade the rate with perpetual futures, or swap USDC for local currency.</p>
          <div className="tx-ctas">
            <a className="btn btn-primary" href={LAUNCH}>Launch App <span className="arrow">→</span></a>
            <a className="btn tx-btn-ghost" href="#markets">See markets</a>
          </div>
          <ul className="tx-points">
            <li><b>{(rates ?? FALLBACK).length}</b><span>currency pairs</span></li>
            <li><b>USDC</b><span>only, network fees covered</span></li>
            <li><b>Passkey</b><span>wallet, no seed phrase</span></li>
          </ul>
        </div>
        <div className="tx-hero-side">
          <canvas ref={cvRef} className="tx-surface" aria-hidden="true" />
        </div>
      </div>
      <Ticker rates={rates ?? FALLBACK} />
    </header>
  );
}

const PITCH: Record<Tab, { title: string; line: string; href: string; cta: string }> = {
  rates: { title: 'Follow the official rate for every pair.', line: 'Live rates for 23 currency pairs, taken from more than one source.', href: LAUNCH, cta: 'Open the app' },
  cover: { title: 'Lock in an exchange rate to protect your margin from volatility.', line: 'Pay one premium. If the rate moves past your level, you get the difference.', href: '/hedger', cta: 'How cover works' },
  perps: { title: 'Go long or short on exotic currencies.', line: 'Trade the rate with leverage, settled onchain in USDC.', href: '/trade', cta: 'How trading works' },
};

export function MarketsSection() {
  const rates = useJson<Rate[]>('/api/v2/rates', (j) => j.rates ?? []);
  const [tab, setTab] = useState<Tab>('rates');
  const pitch = PITCH[tab];
  return (
    <section className="tx-markets">
      <div className="wrap">
        <div className="tx-sec-head">
          <span className="tx-eyebrow">Markets</span>
          <h2>Live rates, cover and perps.</h2>
        </div>
        <div className="tx-mgrid">
          <div className="tx-pitch" aria-live="polite">
            <p className="tx-pitch-title">{pitch.title}</p>
            <p className="tx-pitch-line">{pitch.line}</p>
            <a className="tx-plink" href={pitch.href}>{pitch.cta} →</a>
          </div>
          <MarketsPanel rates={rates} tab={tab} setTab={setTab} />
        </div>
      </div>
    </section>
  );
}

type Tab = 'rates' | 'cover' | 'perps';

function MarketsPanel({ rates, tab, setTab }: { rates: Rate[] | null; tab: Tab; setTab: (t: Tab) => void }) {
  const pools = useJson<Pool[]>('/api/v2/pools', (j) => j.pools ?? [], 120_000);
  const perps = useJson<Perp[]>('/api/perps/markets', (j) => j.markets ?? [], 15_000);
  const prices = useJson<Record<string, number>>('/api/v2/cover-prices', (j) => Object.fromEntries((j.prices ?? []).map((x: { pair: string; premium: number }) => [x.pair, x.premium])), 300_000);
  const list = rates ?? FALLBACK;
  const cover = (() => {
    const by = new Map<string, number>();
    for (const p of pools ?? []) if (p.acceptingHedges && !p.legacy) by.set(p.pair, (by.get(p.pair) ?? 0) + Number(p.liquidity.capacity || 0));
    return Array.from(by.entries()).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  })();
  const rateOf = (pair: string) => list.find((r) => r.pair === pair);
  const twoCol = tab === 'rates' && list.every((r) => r.change == null);
  return (
    <div className="tx-panel" id="markets">
      <div className="tx-tabs" role="tablist">
        {(['rates', 'cover', 'perps'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'rates' ? 'Index' : t === 'cover' ? 'Cover' : 'Perps'}
          </button>
        ))}
        <a className="tx-all" href={LAUNCH}>Open app →</a>
      </div>
      <div className={`tx-head${twoCol ? ' tx-2' : ''}`}><span>Market</span><span>{tab === 'perps' ? 'Price' : tab === 'cover' ? 'Premium' : 'Index'}</span>{!twoCol && <span>{tab === 'cover' ? 'Liquidity' : '24h'}</span>}</div>
      {tab === 'rates' && list.slice(0, 7).map((r) => (
        <a key={r.pair} className={`tx-row${twoCol ? ' tx-2' : ''}`} href={LAUNCH}>
          <span className="tx-name"><Flag code={quote(r.pair)} /><b>{r.pair}</b><small>{NAMES[quote(r.pair)] ?? ''}</small></span>
          <span className="tx-num">{fmtRate(r.spot)}</span>
          {!twoCol && <span className={`tx-num ${r.change == null ? 'tx-muted' : r.change >= 0 ? 'tx-up' : 'tx-down'}`}>{fmtChange(r.change) || '-'}</span>}
        </a>
      ))}
      {tab === 'cover' && (cover.length ? cover.slice(0, 7).map(([pair, liq]) => (
        <a key={pair} className="tx-row" href={LAUNCH}>
          <span className="tx-name"><Flag code={quote(pair)} /><b>{pair}</b><small>Up and Down cover</small></span>
          <span className="tx-num">{prices?.[pair] != null ? `${(prices[pair] * 100).toFixed(2)}%` : '-'}</span>
          <span className="tx-num">{compact(liq)}</span>
        </a>
      )) : <div className="tx-empty">Cover markets load from the app. <a href={LAUNCH}>Open the app</a> to see live liquidity.</div>)}
      {tab === 'perps' && (perps && perps.length ? perps.map((m) => (
        <a key={m.id} className="tx-row" href={LAUNCH}>
          <span className="tx-name"><Flag code={m.quote} /><b>{m.base}{m.quote}-PERP</b><small>up to {m.maxLeverage}x</small></span>
          <span className="tx-num">{m.mark.toLocaleString(undefined, { maximumFractionDigits: m.decimals })}</span>
          <span className={`tx-num ${m.change24h >= 0 ? 'tx-up' : 'tx-down'}`}>{fmtChange(m.change24h)}</span>
        </a>
      )) : <div className="tx-empty">Perpetual futures on the Naira, Cedi, Shilling and Rand. <a href={LAUNCH}>Open the app</a> to see live prices.</div>)}
      <div className="tx-foot">{tab === 'cover' ? 'Premium: lowest price for 30 days of cover, as a share of the amount' : tab === 'rates' ? 'Index: the official reference rate, taken from more than one source' : 'Prices are indicative'}</div>
    </div>
  );
}

function Ticker({ rates }: { rates: Rate[] }) {
  const items = [...rates, ...rates];
  return (
    <div className="tx-ticker" aria-label="Live rates">
      <div className="tx-ticker-track">
        {items.map((r, i) => (
          <span key={`${r.pair}-${i}`} className="tx-tick">
            <Flag code={quote(r.pair)} /><b>{r.pair}</b><span className="tx-num">{fmtRate(r.spot)}</span>
            {r.change != null && <span className={`tx-num ${r.change >= 0 ? 'tx-up' : 'tx-down'}`}>{fmtChange(r.change)}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Products ───────────────────────────────────────────────────────────────

const PRODUCTS: { key: string; href: string; name: string; title: string; text: string; points: string[]; cta: string }[] = [
  { key: 'hedge', href: '/hedger', name: 'Hedge', title: 'Cover a foreign currency payment',
    text: 'Choose the amount and the end date. Pay one premium in USDC. If the rate moves past your level, you are paid the difference.',
    points: ['Any end date, 1 to 90 days', 'Pays the full move, up to 20% of the amount', 'Up and Down cover on every pair'], cta: 'Buy cover' },
  { key: 'trade', href: '/trade', name: 'Trade', title: 'Perpetual futures',
    text: 'Go long or short on exotic currencies with an order book, hourly funding and on-chain settlement.',
    points: ['USD/NGN, USD/GHS, USD/KES, USD/ZAR', 'Margin and liquidations run by a smart contract', 'Prices track the official rate'], cta: 'Open Trade' },
  { key: 'otc', href: '/otc', name: 'OTC', title: 'Swap USDC and local currency',
    text: 'Buy or sell USDC for Cedi, Naira, Shilling and more with approved merchants, by bank transfer or mobile money.',
    points: ['USDC held safely until both sides are done', 'Live indicative rates', 'Personal and business accounts'], cta: 'See OTC' },
  { key: 'earn', href: '/liquidity-provider', name: 'Underwrite', title: 'Back cover, earn premiums',
    text: 'Your USDC backs the cover businesses buy, and earns the premiums they pay.',
    points: ['Choose the currency you back', 'Pays out only if the rate moves', 'Withdraw free USDC any time'], cta: 'Underwrite' },
];

export function ProductsSection() {
  const [, go] = useLocation();
  return (
    <section className="tx-products" id="products">
      <div className="wrap">
        <div className="tx-sec-head">
          <span className="tx-eyebrow">Products</span>
          <h2>Four products, one wallet.</h2>
          <p className="tx-sec-sub">Protect a payment, trade the rate, swap into local currency, or earn by backing other people&apos;s cover. Each one uses the same USDC balance.</p>
        </div>
        <div className="tx-pgrid">
          {PRODUCTS.map((p) => (
            <article key={p.key} className={`tx-pcard tx-${p.key}`} role="link" tabIndex={0} aria-label={`${p.name}: read more`}
              onClick={() => go(p.href)} onKeyDown={(e) => { if (e.key === 'Enter') go(p.href); }}>
              <div className="tx-pcard-top"><span className="tx-pname">{p.name}</span></div>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
              <ul>{p.points.map((x) => <li key={x}>{x}</li>)}</ul>
              <div className="tx-plinks"><Link className="tx-plink" href={p.href} onClick={(e) => e.stopPropagation()}>Learn more →</Link><a className="tx-plink2" href={LAUNCH} onClick={(e) => e.stopPropagation()}>{p.cta}</a></div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── How to start ──────────────────────────────────────────────────────────

const START = [
  { t: 'Sign in', d: 'With email or Google. A passkey becomes your wallet.' },
  { t: 'Add USDC', d: 'Deposit, or move it in from another network.' },
  { t: 'Hedge, trade or swap', d: 'One balance for every product. Fees covered.' },
];

export function StartSteps() {
  return (
    <section className="tx-steps">
      <div className="wrap">
        <div className="tx-sec-head">
          <span className="tx-eyebrow">Getting started</span>
          <h2>Ready in three steps.</h2>
        </div>
        <ol className="tx-sgrid">
          {START.map((x, i) => <li key={x.t}><span className="tx-fnum">{String(i + 1).padStart(2, '0')}</span><h3>{x.t}</h3><p>{x.d}</p></li>)}
        </ol>
      </div>
    </section>
  );
}

// ── How each product works: one example per product, step by step ─────────

type TourStep = { title: string; line: string };
/** Real screens from the app, captured by scripts/website-shots/capture.ts in the app repo. */
const TOURS: { key: string; name: string; steps: TourStep[] }[] = [
  { key: 'hedge', name: 'Hedge', steps: [
    { title: 'Choose your cover', line: 'Pick the currency, the amount and the end date. The price shows straight away.' },
    { title: 'Review and approve', line: 'See what you pay and what the cover can pay you, then approve with your passkey.' },
    { title: 'Follow it to the end', line: 'Your cover sits in your list with its payout today, until the end date.' },
  ] },
  { key: 'trade', name: 'Trade', steps: [
    { title: 'Set your order', line: 'Go long or short, pick the size and trade against a live order book.' },
    { title: 'Watch your position', line: 'Profit or loss, margin and liquidation price update live.' },
    { title: 'Every fill on record', line: 'Each trade settles onchain and shows in your history.' },
  ] },
  { key: 'otc', name: 'OTC', steps: [
    { title: 'Enter the amount', line: 'Type what you send and see what you receive at the live rate.' },
    { title: 'Pick your currency', line: 'Cedi, Naira, Shilling, Rand or Egyptian Pound.' },
    { title: 'Buy or sell', line: 'Switch sides to sell USDC for local currency.' },
  ] },
  { key: 'earn', name: 'Underwrite', steps: [
    { title: 'Pick a pool', line: 'See each pool’s price, size and past results before you add money.' },
    { title: 'Add liquidity', line: 'Your USDC joins the pool and starts backing cover.' },
    { title: 'See what it earns', line: 'Every cover bought from the pool, with the premium it paid.' },
  ] },
];

const prefersReduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

export function HowItWorks() {
  const [tab, setTab] = useState(0);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || prefersReduced()) return;
    const id = window.setInterval(() => setStep((x) => (x + 1) % 3), 3600);
    return () => clearInterval(id);
  }, [paused, tab]);
  const t = TOURS[tab];
  const pick = (k: number) => { setPaused(true); setStep(k); };
  return (
    <section className="trust" id="how" aria-labelledby="how-title">
      <div className="wrap">
        <div className="assets-head">
          <span className="tx-eyebrow">How it works</span>
          <h2 id="how-title">How each product works.</h2>
          <p>Real screens from the app. Pick a product and follow it step by step.</p>
        </div>
        <div className="tx-tourtabs" role="tablist">
          {TOURS.map((x, i) => (
            <button key={x.key} role="tab" aria-selected={tab === i} className={tab === i ? 'on' : ''}
              onClick={() => { setTab(i); setStep(0); setPaused(false); }}>{x.name}</button>
          ))}
        </div>
        <div className="trust-split tx-tour" onMouseLeave={() => setPaused(false)}>
          <ol className="trust-steps">
            {t.steps.map((x, k) => (
              <li key={x.title}>
                <button type="button" className={step === k ? 'on' : ''} aria-pressed={step === k}
                  onMouseEnter={() => pick(k)} onFocus={() => pick(k)} onClick={() => pick(k)}>
                  <span className="trust-when">{String(k + 1).padStart(2, '0')}</span>
                  <span className="trust-title">{x.title}</span>
                  <span className="trust-text">{x.line}</span>
                  <span className="trust-bar" aria-hidden="true"><i key={`${tab}-${paused ? 'p' : step}`} className={!paused && step === k ? 'run' : ''} /></span>
                </button>
              </li>
            ))}
          </ol>
          <figure className="tx-shot" aria-label={`${t.name}: ${t.steps[step].title}`}>
            <div className="tx-shot-bar" aria-hidden="true"><i /><i /><i /><span>BlockFinaX app</span></div>
            <div className="tx-shot-view">
              {TOURS.map((x, i) => [0, 1, 2].map((k) => (
                <img key={`${x.key}-${k}`} src={`/product/${x.key}-${k + 1}.webp`} alt={i === tab && k === step ? `${x.name}: ${x.steps[k].title}` : ''}
                  loading="lazy" decoding="async" width={1440} height={900}
                  className={i === tab && k === step ? 'on' : ''} />
              )))}
            </div>
          </figure>
        </div>
      </div>
    </section>
  );
}

// ── Platform features ──────────────────────────────────────────────────────

const FEATURES: { title: string; text: string }[] = [
  { title: 'A wallet you already know how to use', text: 'Sign in with email or Google. A passkey on your phone or laptop becomes your wallet. No seed phrase to lose.' },
  { title: 'USDC only, fees covered', text: 'Every premium, margin and payout is in USDC. You never need XLM or any other token: network fees are covered.' },
  { title: 'Settled onchain', text: 'Cover, pools and perps run on smart contracts. Anyone can check a position, a payout or a liquidation onchain.' },
  { title: 'Official rates', text: 'Prices follow the official rate for each currency, from more than one source, so the number you are paid on is the one your bank uses.' },
  { title: 'Your money stays yours', text: 'BlockFinaX runs the protocol. Your USDC sits in your own wallet or in the contract, never with us.' },
  { title: 'Fund from other networks', text: 'Move USDC in from other networks through Circle CCTP. It arrives ready to use.' },
];

export function FeaturesSection() {
  return (
    <section className="tx-features">
      <div className="wrap">
        <div className="tx-sec-head">
          <span className="tx-eyebrow">The platform</span>
          <h2>What sits under every product.</h2>
        </div>
        <div className="tx-fgrid">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="tx-feature"><span className="tx-fnum">{String(i + 1).padStart(2, '0')}</span><h3>{f.title}</h3><p>{f.text}</p></div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Closing call to action ─────────────────────────────────────────────────

export function StartBand() {
  return (
    <section className="tx-start">
      <div className="wrap tx-start-in">
        <div className="tx-start-copy">
          <h2>Open your wallet in a minute.</h2>
          <ol className="tx-start-steps">
            {START.map((x, i) => <li key={x.t}><span>{String(i + 1).padStart(2, '0')}</span><b>{x.t}</b><small>{x.d}</small></li>)}
          </ol>
        </div>
        <div className="tx-ctas">
          <a className="btn btn-primary" href={LAUNCH}>Launch App <span className="arrow">→</span></a>
          <a className="btn tx-btn-ghost" href="/contact">Talk to us</a>
        </div>
      </div>
    </section>
  );
}

export function RiskNote() {
  return (
    <div className="wrap tx-risk">
      Perpetual futures use leverage: a small move in the rate can cause a large loss, and positions can be liquidated. Cover pays up to its stated limit. Nothing on this site is financial advice.
    </div>
  );
}
