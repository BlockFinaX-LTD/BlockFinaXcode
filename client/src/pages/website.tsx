/**
 * website.tsx — Public landing page.
 *
 * B2B infrastructure positioning. No problem/solution narrative, no
 * decorative animations, no emoji cards. Hero → capability statement →
 * products grid → supported pairs → trust strip → footer.
 */

import { Link } from 'wouter';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Twitter,
  Linkedin,
  Send,
  Menu,
  X,
  Shield,
  Layers,
  BarChart3,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import logoPath from '@/assets/logo.png';

// ── Currency flag map (reused across the page) ──────────────────────────

const FLAG_MAP: Record<string, string> = {
  GHS: '\u{1F1EC}\u{1F1ED}',
  NGN: '\u{1F1F3}\u{1F1EC}',
  KES: '\u{1F1F0}\u{1F1EA}',
  ZAR: '\u{1F1FF}\u{1F1E6}',
  EGP: '\u{1F1EA}\u{1F1EC}',
  ETB: '\u{1F1EA}\u{1F1F9}',
  XOF: '\u{1F1F8}\u{1F1F3}',
  XAF: '\u{1F1E8}\u{1F1F2}',
  RWF: '\u{1F1F7}\u{1F1FC}',
  UGX: '\u{1F1FA}\u{1F1EC}',
  TZS: '\u{1F1F9}\u{1F1FF}',
  MWK: '\u{1F1F2}\u{1F1FC}',
  MZN: '\u{1F1F2}\u{1F1FF}',
  ZMW: '\u{1F1FF}\u{1F1F2}',
  AOA: '\u{1F1E6}\u{1F1F4}',
  EUR: '\u{1F1EA}\u{1F1FA}',
  GBP: '\u{1F1EC}\u{1F1E7}',
  USD: '\u{1F1FA}\u{1F1F8}',
};

const SUPPORTED_PAIRS = [
  'NGN', 'KES', 'GHS', 'ZAR', 'EGP', 'ETB',
  'UGX', 'TZS', 'RWF', 'MWK', 'MZN', 'ZMW',
  'XOF', 'XAF', 'AOA', 'EUR', 'GBP', 'USD',
];

// ── Live FX ticker (real data, scrolls) ──────────────────────────────────

function LiveFxTicker() {
  const { data } = useQuery<{ rates: Record<string, { pair: string; rate: number; lastUpdated: string }> }>({
    queryKey: ['/api/fx/rates'],
    refetchInterval: 30_000,
  });
  if (!data?.rates) return null;
  const pairs = Object.values(data.rates);
  const doubled = [...pairs, ...pairs];
  return (
    <div className="relative overflow-hidden border-y border-gray-200/80 py-2.5 bg-white">
      <div className="flex animate-scroll gap-10" style={{ width: 'max-content' }}>
        {doubled.map((r, i) => {
          const quote = r.pair.split('/')[1];
          return (
            <div key={i} className="flex items-center gap-2 text-sm whitespace-nowrap px-3">
              <span className="text-base leading-none">{FLAG_MAP[quote] || ''}</span>
              <span className="text-[#001F5C] font-semibold tracking-tight">{r.pair}</span>
              <span className="font-mono-data font-semibold text-gray-900">
                {r.rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .animate-scroll { animation: scroll 120s linear infinite; }
        .animate-scroll:hover { animation-play-state: paused; }
      `}</style>
    </div>
  );
}

// ── Top navigation ──────────────────────────────────────────────────────

function TopNav({ tone }: { tone: 'dark' | 'light' }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);

  const dark = tone === 'dark';
  const linkBase = dark
    ? 'text-sm text-white/80 hover:text-white transition-colors'
    : 'text-sm text-gray-600 hover:text-gray-900 transition-colors';

  return (
    <nav className={`sticky top-0 z-50 ${dark ? 'bg-[#0a1733]/80' : 'bg-white/90'} backdrop-blur-md border-b ${dark ? 'border-white/5' : 'border-gray-200/80'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <img src={logoPath} alt="BlockFinaX" className="h-7 w-7 object-contain" />
            <span className={`text-base font-semibold tracking-tight ${dark ? 'text-white' : 'text-gray-900'}`}>
              BlockFinaX
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-7">
            <a href="#about" className={linkBase}>About</a>
            <a href="#products" className={linkBase}>Products</a>
            <Link href="/liquidity-provider" className={linkBase}>Liquidity provider</Link>
            <div
              className="relative"
              onMouseEnter={() => setResourcesOpen(true)}
              onMouseLeave={() => setResourcesOpen(false)}
            >
              <button className={`${linkBase} flex items-center gap-1`}>
                Resources <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {resourcesOpen && (
                <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-gray-200 shadow-xl rounded-xl py-1.5 z-10">
                  <Link href="/docs/request">
                    <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Documentation</button>
                  </Link>
                  <Link href="/whitepaper">
                    <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Whitepaper</button>
                  </Link>
                  <Link href="/pitch">
                    <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Pitch deck</button>
                  </Link>
                  <Link href="/blog">
                    <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Blog</button>
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 shrink-0">
            <Link href="/auth">
              <button className={`${dark ? 'bg-white/10 text-white hover:bg-white/15' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'} h-9 px-4 rounded-full text-sm font-medium transition-colors`}>
                Sign in
              </button>
            </Link>
            <Link href="/apply">
              <button className={`${dark ? 'bg-white text-[#001F5C] hover:bg-gray-100' : 'bg-[#001F5C] text-white hover:bg-[#003088]'} h-9 px-4 rounded-full text-sm font-semibold transition-colors`}>
                Request access
              </button>
            </Link>
          </div>

          <button
            onClick={() => setMobileOpen((o) => !o)}
            className={`md:hidden p-2 rounded-md ${dark ? 'text-white hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'}`}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileOpen && (
          <div className={`md:hidden ${dark ? 'border-t border-white/5 bg-[#0a1733]' : 'border-t border-gray-200 bg-white'} pb-4 pt-2`}>
            <div className="space-y-1">
              {[
                ['#about', 'About'],
                ['#products', 'Products'],
                ['/liquidity-provider', 'Liquidity provider'],
                ['/whitepaper', 'Whitepaper'],
                ['/pitch', 'Pitch deck'],
                ['/blog', 'Blog'],
              ].map(([href, label]) => (
                <a
                  key={label}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`block px-3 py-2 text-sm rounded-md ${dark ? 'text-white/80 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-100'}`}
                >
                  {label}
                </a>
              ))}
              <div className="px-3 pt-3 grid grid-cols-2 gap-2">
                <Link href="/auth">
                  <button className={`w-full h-10 rounded-full text-sm font-medium ${dark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900'}`}>
                    Sign in
                  </button>
                </Link>
                <Link href="/apply">
                  <button className={`w-full h-10 rounded-full text-sm font-semibold ${dark ? 'bg-white text-[#001F5C]' : 'bg-[#001F5C] text-white'}`}>
                    Request access
                  </button>
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section
      className="relative overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 50% 0%, #1a4480 0%, #0a1733 60%, #050c1d 100%)',
      }}
    >
      {/* Subtle grid texture */}
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      {/* Star dots */}
      <div className="absolute inset-0 pointer-events-none">
        {[
          [12, 18], [78, 22], [22, 65], [85, 70], [40, 32], [62, 78],
          [8, 88], [92, 12], [55, 10], [30, 88], [70, 45], [18, 40],
          [88, 55], [48, 92], [5, 50], [95, 38],
        ].map(([x, y], i) => (
          <span
            key={i}
            className="absolute w-[2px] h-[2px] rounded-full bg-white/40"
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        ))}
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 lg:pt-32 pb-20 sm:pb-28">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-5xl mx-auto"
        >
          <h1 className="text-white font-semibold tracking-[-0.02em] leading-[1.02] text-[40px] sm:text-6xl lg:text-[80px]">
            On-chain FX cover
            <br />
            <span className="text-white/60">for emerging markets</span>
          </h1>
          <p className="mt-6 sm:mt-8 text-[15px] sm:text-lg text-white/70 max-w-2xl mx-auto leading-relaxed">
            Parametric FX protection priced by a live market, settled in USDC,
            available to importers, exporters, and treasuries without a banking
            relationship.
          </p>
          <div className="mt-9 sm:mt-12 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <Link href="/apply">
              <Button className="w-full sm:w-auto h-12 sm:h-13 px-7 rounded-full bg-white text-[#001F5C] hover:bg-gray-100 text-sm font-semibold">
                Request access <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </Link>
            <Link href="/docs/request">
              <Button
                variant="outline"
                className="w-full sm:w-auto h-12 sm:h-13 px-7 rounded-full bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white text-sm font-medium"
              >
                Read the docs
              </Button>
            </Link>
          </div>
          <p className="mt-10 text-[11px] uppercase tracking-[0.12em] text-white/40 font-medium">
            Live on Base &middot; BNB Chain &middot; Lisk
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ── About / capability statement ────────────────────────────────────────

function Capability() {
  return (
    <section id="about" className="py-20 sm:py-28 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-[1fr_auto] gap-10 items-center">
        <div className="max-w-2xl">
          <span className="inline-block px-3 py-1 rounded-full bg-[#EDF1F8] text-[#001F5C] text-xs font-semibold tracking-wide">
            Infrastructure
          </span>
          <h2 className="mt-4 text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-gray-900 leading-[1.1]">
            Parametric FX cover and on-chain settlement infrastructure for emerging markets
          </h2>
          <p className="mt-5 text-base sm:text-lg text-gray-600 leading-relaxed">
            BlockFinaX provides fully collateralised FX cover, AMM-discovered
            pricing, and multi-chain settlement for SMEs, treasuries, and capital
            partners operating in markets where banks won&rsquo;t write the risk.
          </p>
          <div className="mt-7">
            <Link href="/docs/request">
              <Button className="h-11 px-6 rounded-full bg-[#001F5C] text-white hover:bg-[#003088] text-sm font-semibold">
                Read more <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats column — concrete numbers, no fluff */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1 lg:w-72">
          {[
            ['63', 'currency pairs covered'],
            ['3', 'production chains'],
            ['100%', 'collateralised, no liquidations'],
            ['N-of-M', 'oracle settlement'],
          ].map(([n, label]) => (
            <div key={label} className="bg-gray-50 rounded-2xl p-5 border border-gray-200/60">
              <p className="text-3xl lg:text-[34px] font-semibold tracking-tight text-[#001F5C] font-mono-data">{n}</p>
              <p className="text-xs sm:text-sm text-gray-600 mt-1 leading-tight">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Products section ────────────────────────────────────────────────────

function Products() {
  const products = [
    {
      icon: Shield,
      title: 'FX Cover',
      body: 'Parametric protection priced by a live market. Cap your max loss, settle automatically on-chain at expiry. No bank relationship required.',
      href: '/whitepaper',
    },
    {
      icon: Layers,
      title: 'Underwriter pools',
      body: 'Capital providers earn premium for accepting bounded FX risk. Fully collateralised, no liquidations, fixed maximum exposure per event.',
      href: '/liquidity-provider',
    },
    {
      icon: BarChart3,
      title: 'Liquidity workbench',
      body: 'Backtest underwriting terms against real FX history. Price exposure across pairs. Built for treasury teams and capital partners.',
      href: '/liquidity-provider',
    },
  ];

  return (
    <section id="products" className="py-20 sm:py-28" style={{ backgroundColor: '#001F5C' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-end mb-12 sm:mb-16">
          <div className="max-w-2xl">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-white leading-[1.1]">
              On-chain protection and liquidity, end to end
            </h2>
            <p className="mt-5 text-base sm:text-lg text-white/70 leading-relaxed">
              We unbundle FX hedging into the parts businesses, capital providers,
              and treasuries actually need.
            </p>
          </div>
          <Link href="/liquidity-provider">
            <Button className="h-11 px-6 rounded-full bg-white text-[#001F5C] hover:bg-gray-100 text-sm font-semibold shrink-0">
              See all products <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </Link>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map(({ icon: Icon, title, body, href }) => (
            <div
              key={title}
              className="bg-white rounded-2xl p-6 sm:p-7 flex flex-col"
            >
              <div className="h-11 w-11 rounded-xl bg-[#EDF1F8] flex items-center justify-center mb-5">
                <Icon className="h-5 w-5 text-[#001F5C]" strokeWidth={1.8} />
              </div>
              <h3 className="text-lg sm:text-xl font-semibold text-gray-900 tracking-tight">{title}</h3>
              <p className="mt-2 text-[14px] text-gray-600 leading-relaxed flex-1">{body}</p>
              <Link href={href}>
                <button className="mt-5 inline-flex items-center text-sm font-semibold text-[#001F5C] hover:gap-2 transition-all gap-1.5">
                  Read more <ArrowRight className="h-4 w-4" />
                </button>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Supported pairs ─────────────────────────────────────────────────────

function SupportedPairs() {
  return (
    <section className="py-20 sm:py-28 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-10 sm:mb-12">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-gray-900 leading-[1.1]">
            Pairs supported
          </h2>
          <p className="mt-4 text-base sm:text-lg text-gray-600 leading-relaxed">
            USD-quoted, settled in USDC across Base, BNB Smart Chain, and Lisk. More
            pairs added quarterly based on flow.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 sm:gap-3">
          {SUPPORTED_PAIRS.map((code) => (
            <div
              key={code}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-[#001F5C]/30 hover:bg-gray-50 transition-colors"
            >
              <span className="text-xl leading-none">{FLAG_MAP[code] || ''}</span>
              <span className="text-sm font-semibold text-gray-900 font-mono-data">{code}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Trust strip ─────────────────────────────────────────────────────────

function TrustStrip() {
  return (
    <section className="py-14 sm:py-20 bg-gray-50 border-y border-gray-200/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
          {[
            ['Fully collateralised', 'Every position is backed by USDC locked on-chain at the time of purchase. The protocol cannot owe more than it holds.'],
            ['No liquidations', 'Bounded payout per event by construction. Underwriters cannot be liquidated; their downside is capped at the cap they set.'],
            ['Multi-oracle settlement', 'N-of-M consensus on settlement rates. No single point of failure on price feeds.'],
            ['Non-custodial', 'BlockFinaX never holds user funds. Cover positions, premium receipts, and underwriting capital live in audited contracts.'],
          ].map(([title, body]) => (
            <div key={title}>
              <p className="text-sm sm:text-base font-semibold text-[#001F5C] tracking-tight">{title}</p>
              <p className="mt-1.5 text-[13px] sm:text-sm text-gray-600 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Closing CTA ─────────────────────────────────────────────────────────

function ClosingCTA() {
  return (
    <section
      className="py-20 sm:py-28"
      style={{
        background:
          'radial-gradient(ellipse 60% 80% at 50% 50%, #1a4480 0%, #0a1733 70%, #050c1d 100%)',
      }}
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-white leading-[1.1]">
          Ready to underwrite or hedge?
        </h2>
        <p className="mt-5 text-base sm:text-lg text-white/70 leading-relaxed">
          We&rsquo;re onboarding partners and capital one cohort at a time. Apply,
          and the team will reach out within 48 hours.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-center">
          <Link href="/apply">
            <Button className="w-full sm:w-auto h-12 px-7 rounded-full bg-white text-[#001F5C] hover:bg-gray-100 text-sm font-semibold">
              Request access <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </Link>
          <Link href="/docs/request">
            <Button
              variant="outline"
              className="w-full sm:w-auto h-12 px-7 rounded-full bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white text-sm font-medium"
            >
              Read the docs
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="bg-gray-50 border-t border-gray-200/80 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <img src={logoPath} alt="BlockFinaX" className="h-7 w-7 object-contain" />
              <span className="text-base font-semibold tracking-tight text-gray-900">BlockFinaX</span>
            </Link>
            <p className="mt-3 text-xs text-gray-500 max-w-xs leading-relaxed">
              On-chain FX cover and settlement infrastructure for emerging markets.
            </p>
          </div>

          <div>
            <p className="text-[10px] font-semibold text-gray-900 tracking-[0.08em] uppercase">Product</p>
            <ul className="mt-4 space-y-2.5 text-sm text-gray-500">
              <li><Link href="/apply" className="hover:text-gray-900">Request access</Link></li>
              <li><Link href="/docs/request" className="hover:text-gray-900">Documentation</Link></li>
              <li><Link href="/liquidity-provider" className="hover:text-gray-900">Liquidity provider</Link></li>
            </ul>
          </div>

          <div>
            <p className="text-[10px] font-semibold text-gray-900 tracking-[0.08em] uppercase">Resources</p>
            <ul className="mt-4 space-y-2.5 text-sm text-gray-500">
              <li><Link href="/whitepaper" className="hover:text-gray-900">Whitepaper</Link></li>
              <li><Link href="/pitch" className="hover:text-gray-900">Pitch deck</Link></li>
              <li><Link href="/blog" className="hover:text-gray-900">Blog</Link></li>
              <li><a href="mailto:hello@blockfinax.com" className="hover:text-gray-900">Contact</a></li>
            </ul>
          </div>

          <div>
            <p className="text-[10px] font-semibold text-gray-900 tracking-[0.08em] uppercase">Social</p>
            <ul className="mt-4 space-y-2.5 text-sm text-gray-500">
              <li>
                <a href="https://x.com/blockfinax?s=21" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 inline-flex items-center gap-1.5">
                  <Twitter className="h-3.5 w-3.5" /> X / Twitter
                </a>
              </li>
              <li>
                <a href="https://www.linkedin.com/company/blockfinax/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 inline-flex items-center gap-1.5">
                  <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                </a>
              </li>
              <li>
                <a href="https://t.me/+4flz7LGYq_82YTM8" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 inline-flex items-center gap-1.5">
                  <Send className="h-3.5 w-3.5" /> Telegram
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-6 border-t border-gray-200/60 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-xs text-gray-500">
          <p>&copy; {new Date().getFullYear()} BlockFinaX. All rights reserved.</p>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-gray-900">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-900">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ── Main page ───────────────────────────────────────────────────────────

export default function Website() {
  return (
    <div className="min-h-screen bg-white">
      <TopNav tone="dark" />
      <Hero />
      <LiveFxTicker />
      <Capability />
      <Products />
      <SupportedPairs />
      <TrustStrip />
      <ClosingCTA />
      <Footer />
    </div>
  );
}
