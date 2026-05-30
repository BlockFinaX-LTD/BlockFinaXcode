import { Link } from "wouter";
import { 
  TrendingUp,
  ArrowRight,
  ChevronDown,
  Twitter,
  Linkedin,
  Github,
  Menu,
  X,
  Clock,
  Shield,
  ChevronRight,
  Send,
  Mail,
  Globe,
  Zap,
  LockKeyhole
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import logoPath from "@/assets/logo.png";
import appScreenshotImg from "@assets/1_1772315359090.png";
import tradingChartsImg from "@assets/stock_images/hero_mobile_finance.jpg";

const FLAG_MAP: Record<string, string> = {
  'GHS': '\u{1F1EC}\u{1F1ED}', 'NGN': '\u{1F1F3}\u{1F1EC}', 'KES': '\u{1F1F0}\u{1F1EA}',
  'ZAR': '\u{1F1FF}\u{1F1E6}', 'XOF': '\u{1F310}', 'XAF': '\u{1F310}', 'EUR': '\u{1F1EA}\u{1F1FA}'
};

function LiveFxTicker() {
  const { data } = useQuery<{ rates: Record<string, { pair: string; rate: number; lastUpdated: string }> }>({
    queryKey: ['/api/fx/rates'],
    refetchInterval: 30000,
  });

  if (!data?.rates) return null;
  const pairs = Object.values(data.rates);
  const doubled = [...pairs, ...pairs];

  return (
    <div className="relative overflow-hidden border-b border-gray-100 py-2 z-40">
      <div className="flex animate-scroll gap-10" style={{ width: 'max-content' }}>
        {doubled.map((r, i) => {
          const quote = r.pair.split('/')[1];
          return (
            <div key={i} className="flex items-center gap-2 text-sm whitespace-nowrap px-3">
              <span className="text-base">{FLAG_MAP[quote] || ''}</span>
              <span className="font-semibold" style={{ color: '#1e3a5f' }}>{r.pair}</span>
              <span className="font-mono font-bold" style={{ color: '#0f2744' }}>{r.rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
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

function LiveHedgeEvents() {
  const { data: events } = useQuery<Array<{
    id: number; name: string; underlying: string; strike: string; premiumRate: string;
    status: string; expiryDate: string; poolOpen: boolean;
  }>>({
    queryKey: ['/api/hedge/events/open'],
    refetchInterval: 30000,
  });

  if (!events || events.length === 0) return null;

  return (
    <section className="py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <h2 className="text-lg font-semibold text-gray-900">Live Hedge Events</h2>
          </div>
          <Link href="/hedge">
            <button className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1 transition-colors">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </Link>
        </div>

        <div className="space-y-2">
          {events.map((event) => {
            const quote = event.underlying.split('/')[1];
            const expiry = new Date(event.expiryDate);
            const now = new Date();
            const daysLeft = Math.max(0, Math.ceil((expiry.getTime() - now.getTime()) / 86400000));

            return (
              <Link key={event.id} href="/hedge">
                <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-all cursor-pointer group">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{FLAG_MAP[quote] || '\u{1F310}'}</span>
                    <div>
                      <span className="font-semibold text-gray-900">{event.underlying}</span>
                      <span className="text-gray-400 text-sm ml-2 hidden sm:inline">{event.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 sm:gap-6">
                    <div className="text-right">
                      <div className="text-[10px] sm:text-xs text-gray-400">Strike</div>
                      <div className="font-mono font-semibold text-gray-900 text-xs sm:text-sm">{parseFloat(event.strike).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] sm:text-xs text-gray-400">Premium</div>
                      <div className="font-mono font-semibold text-green-600 text-xs sm:text-sm">{(parseFloat(event.premiumRate) * 100).toFixed(1)}%</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] sm:text-xs text-gray-400 hidden sm:block">Expires</div>
                      <div className="font-mono text-gray-500 text-xs sm:text-sm flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {daysLeft}d
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition-colors hidden sm:block" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ProblemSection() {
  const stats = [
    { figure: '-238%', label: 'NGN vs USD, 2022→2025', sub: '₦460 → ₦1,555 / $' },
    { figure: '-69%', label: 'GHS vs USD, 2022→2025', sub: '₵6.0 → ₵15.5 / $' },
    { figure: '-66%', label: 'EGP vs USD, Mar 2024', sub: 'devalued in a single day' },
    { figure: '-46%', label: 'KES vs USD, 2022→2024', sub: 'KSh 115 → KSh 161 / $' },
  ];
  const lossExamples = [
    {
      headline: '$1,000,000 NGN payable, unhedged',
      body: 'Importer with a 90-day USD invoice. Naira moves 14% over the period. Forwards from the bank are unavailable or quoted at 18%+. They eat the move directly.',
      cost: '$140,000',
      costLabel: 'lost margin',
    },
    {
      headline: '$50,000 GHS payroll, monthly',
      body: 'SaaS company billing in USD, paying engineers in Ghana. Cedi appreciates 4% between invoicing and pay day — gross margin drops by the same.',
      cost: '$2,000',
      costLabel: 'eaten in one month',
    },
    {
      headline: '$200K USDC sitting idle',
      body: 'African market-maker holding stables waiting for trades. Annualised, that capital could earn 10–18% writing FX cover — but there\'s no liquid options market locally.',
      cost: '$20K–$36K',
      costLabel: 'opportunity / year',
    },
  ];

  return (
    <section id="problem" className="py-14 sm:py-20 border-t border-gray-100 bg-gradient-to-b from-white to-gray-50/40">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-50px' }} transition={{ duration: 0.3 }}
          className="max-w-2xl mb-10">
          <span className="inline-block text-[11px] uppercase tracking-wider text-[#1a4480] font-semibold bg-[#1a4480]/10 rounded-full px-2.5 py-1 mb-3">The problem</span>
          <h2 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-3 leading-tight tracking-tight">
            FX volatility is a tax on every African business that touches dollars.
          </h2>
          <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
            Importers, exporters, remitters, treasuries, market-makers — they all hold the wrong side of an exchange rate at some point. The hedging tools that big firms in New York use to manage this — FX forwards, options, swaps — barely exist for businesses operating in cedis, naira, or shillings. Banks, when they offer them, charge 12–25% premiums. So most firms simply absorb the loss.
          </p>
        </motion.div>

        {/* Stat strip */}
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-50px' }} transition={{ duration: 0.3 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {stats.map((s, i) => (
            <div key={i} className="rounded-2xl bg-white border border-gray-100 p-4">
              <p className="font-mono text-2xl sm:text-3xl font-bold text-red-600 tracking-tight">{s.figure}</p>
              <p className="text-xs font-semibold text-gray-900 mt-1.5 leading-tight">{s.label}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 font-mono">{s.sub}</p>
            </div>
          ))}
        </motion.div>

        {/* Concrete loss scenarios */}
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-50px' }} transition={{ duration: 0.3 }}
          className="space-y-3">
          {lossExamples.map((ex, i) => (
            <div key={i} className="rounded-2xl bg-white border border-gray-100 p-4 sm:p-5 flex flex-col sm:flex-row gap-4 sm:gap-6 sm:items-center">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm sm:text-base font-semibold text-gray-900 mb-1">{ex.headline}</h3>
                <p className="text-xs sm:text-sm text-gray-500 leading-relaxed">{ex.body}</p>
              </div>
              <div className="text-right shrink-0 border-t sm:border-t-0 sm:border-l border-gray-100 sm:pl-6 pt-3 sm:pt-0">
                <p className="font-mono text-xl sm:text-2xl font-bold text-red-600">{ex.cost}</p>
                <p className="text-[11px] text-gray-400 uppercase tracking-wider mt-1">{ex.costLabel}</p>
              </div>
            </div>
          ))}
        </motion.div>

        <motion.p initial={{ opacity: 0.6 }} whileInView={{ opacity: 1 }} viewport={{ once: true, margin: '-50px' }} transition={{ duration: 0.3 }}
          className="text-center text-sm text-gray-500 mt-8 max-w-xl mx-auto">
          BlockFinaX exists so businesses across emerging markets can buy the same kind of FX protection a multinational treasury would buy — in USDC, on-chain, in minutes, with no bank relationship required.
        </motion.p>
      </div>
    </section>
  );
}

function UnderwriterSection() {
  const yieldScenarios = [
    { tier: 'Conservative', pair: 'USD/EUR', annualised: '4–7%', desc: 'Low-vol majors, wide strikes' },
    { tier: 'Balanced', pair: 'USD/ZAR · USD/KES', annualised: '9–14%', desc: 'Liquid EM with predictable bands' },
    { tier: 'High yield', pair: 'USD/NGN · USD/GHS · USD/EGP', annualised: '18–32%', desc: 'Frontier EM, wider premiums' },
  ];

  return (
    <section id="underwriters" className="py-14 sm:py-20 border-t border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-50px' }} transition={{ duration: 0.3 }}
          className="max-w-2xl mb-10">
          <span className="inline-block text-[11px] uppercase tracking-wider text-emerald-700 font-semibold bg-emerald-50 rounded-full px-2.5 py-1 mb-3">For liquidity providers</span>
          <h2 className="text-2xl sm:text-4xl font-bold text-gray-900 mb-3 leading-tight tracking-tight">
            Underwrite FX cover. Earn premiums while you sleep.
          </h2>
          <p className="text-sm sm:text-base text-gray-600 leading-relaxed">
            You deposit USDC into a cover pool of your choice — say USD/NGN at a ₦1,800 strike, 30 days out. Hedgers pay a premium upfront to buy protection backed by your capital. If the rate stays inside the band, you keep every cent. If it breaches, the pool pays out and the rest stays with you.
          </p>
        </motion.div>

        {/* The economics, broken down */}
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-50px' }} transition={{ duration: 0.3 }}
          className="rounded-2xl border border-gray-100 bg-white p-5 sm:p-7 mb-6">
          <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-4">Worked example · 30-day USD/NGN pool, ₦1,800 strike</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 mb-6">
            <div>
              <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Your deposit</p>
              <p className="font-mono text-xl font-bold text-gray-900">$50,000</p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Premium earned</p>
              <p className="font-mono text-xl font-bold text-emerald-600">+$1,250</p>
              <p className="text-[10px] text-gray-400 mt-0.5">2.5% in 30 days</p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">If pool doesn't pay</p>
              <p className="font-mono text-xl font-bold text-gray-900">$51,250</p>
              <p className="text-[10px] text-gray-400 mt-0.5">all premium, no payout</p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Annualised</p>
              <p className="font-mono text-xl font-bold text-emerald-600">~30%</p>
              <p className="text-[10px] text-gray-400 mt-0.5">if rolled monthly</p>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-5">
            <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-3">If the strike is breached</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                <p className="text-xs text-gray-500 mb-1">Premium kept</p>
                <p className="font-mono text-base font-bold text-amber-700">+$1,250</p>
              </div>
              <div className="rounded-xl bg-red-50 border border-red-100 p-3">
                <p className="text-xs text-gray-500 mb-1">Pool payout used</p>
                <p className="font-mono text-base font-bold text-red-700">−$3,800</p>
                <p className="text-[10px] text-gray-400 mt-0.5">capped per position</p>
              </div>
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3">
                <p className="text-xs text-gray-500 mb-1">Net for the month</p>
                <p className="font-mono text-base font-bold text-gray-900">−$2,550</p>
                <p className="text-[10px] text-gray-400 mt-0.5">−5.1% on your stake</p>
              </div>
            </div>
            <p className="text-[11px] text-gray-500 mt-4 leading-relaxed">
              Payouts are <strong>capped per position</strong> using the <code className="bg-gray-100 px-1 py-0.5 rounded text-[10px]">payoutCap</code> field on every event — your liability is bounded before a hedger ever buys. The pool is collateralised first and offered second.
            </p>
          </div>
        </motion.div>

        {/* Why this matters */}
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-50px' }} transition={{ duration: 0.3 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
          {[
            { title: 'Capital efficiency', body: 'Deposit once, earn premium across the whole pool lifetime. Withdraw your principal + premium after settlement.' },
            { title: 'Position-level risk caps', body: 'Every cover position has a capped payout. You can model your worst case exactly before depositing.' },
            { title: 'Yield where banks won\'t go', body: 'Frontier-EM FX premiums are 3–5× higher than developed-market options. Same risk math, different price.' },
          ].map((b, i) => (
            <div key={i} className="rounded-2xl border border-gray-100 bg-white p-4">
              <p className="text-sm font-semibold text-gray-900 mb-1.5">{b.title}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{b.body}</p>
            </div>
          ))}
        </motion.div>

        {/* Yield by pool tier */}
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-50px' }} transition={{ duration: 0.3 }}
          className="rounded-2xl border border-gray-100 overflow-hidden bg-white">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50">
            <p className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Indicative yield by tier</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 sm:px-5 py-3 text-[10px] uppercase tracking-wider font-medium text-gray-400">Tier</th>
                <th className="text-left px-4 sm:px-5 py-3 text-[10px] uppercase tracking-wider font-medium text-gray-400">Typical pair</th>
                <th className="text-right px-4 sm:px-5 py-3 text-[10px] uppercase tracking-wider font-medium text-gray-400">Annualised</th>
              </tr>
            </thead>
            <tbody>
              {yieldScenarios.map((y, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-b-0">
                  <td className="px-4 sm:px-5 py-3.5">
                    <p className="text-sm font-semibold text-gray-900">{y.tier}</p>
                    <p className="text-[11px] text-gray-400">{y.desc}</p>
                  </td>
                  <td className="px-4 sm:px-5 py-3.5 text-sm font-mono text-gray-700">{y.pair}</td>
                  <td className="px-4 sm:px-5 py-3.5 text-right">
                    <p className="font-mono text-base font-bold text-emerald-600">{y.annualised}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>

        <p className="text-[11px] text-gray-400 text-center mt-4 max-w-2xl mx-auto">
          Indicative ranges based on Q1 2026 pool history. Actual yields depend on pool selection, strike distance, expiry, and realised FX path. Past performance does not predict future results.
        </p>

        <div className="text-center mt-10">
          <Link href="/apply">
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700 rounded-full px-7 h-11 text-sm font-medium">
              Apply to underwrite <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function SolutionsSection() {
  return (
    <section id="solutions" className="py-16 border-t border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.3 }}
          className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1a4480] mb-2">The platform</h2>
          <p className="text-sm text-gray-500">Two products. One wallet. Built for markets that move fast.</p>
        </motion.div>
        <div className="grid grid-cols-2 gap-4 sm:gap-6">
          <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.3, delay: 0.05 }}
            className="rounded-2xl bg-[#1a4480] p-4 sm:p-6">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/15 flex items-center justify-center mb-3 sm:mb-4">
              <Shield className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
            </div>
            <h3 className="text-base sm:text-lg font-bold text-white mb-2">Hedging</h3>
            <p className="text-xs sm:text-sm text-blue-100 leading-relaxed mb-4">
              Set a strike price, pay a premium, and get paid automatically when the market moves against you.
            </p>
            <Link href="/hedge">
              <button className="text-xs sm:text-sm font-medium text-white/80 hover:text-white flex items-center gap-1">
                Open hedge marketplace <ArrowRight className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </button>
            </Link>
          </motion.div>

          <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.3, delay: 0.1 }}
            className="rounded-2xl bg-[#1a4480] p-4 sm:p-6">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/15 flex items-center justify-center mb-3 sm:mb-4">
              <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
            </div>
            <h3 className="text-base sm:text-lg font-bold text-white mb-2">Payments</h3>
            <p className="text-xs sm:text-sm text-blue-100 leading-relaxed mb-4">
              Send and receive payments across borders instantly, without banks, delays, or wire transfer fees.
            </p>
            <Link href="/wallet">
              <button className="text-xs sm:text-sm font-medium text-white/80 hover:text-white flex items-center gap-1">
                Open your wallet <ArrowRight className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </button>
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function WhoForSection() {
  const cards = [
    {
      role: 'Importers',
      pain: 'Supplier invoices in USD, revenue in NGN, GHS, or KES.',
      solution: 'Lock in the cost of dollars at a chosen strike. Get paid if the local currency drops below it.',
    },
    {
      role: 'Exporters',
      pain: 'Receive foreign currency, spend at home.',
      solution: 'Set a floor on what your USD receivables are worth. Collect a payout if the rate moves against you.',
    },
    {
      role: 'Treasuries',
      pain: 'Mixed-currency books, no working hedging line.',
      solution: 'Programmatic hedges sized to your monthly burn. No bank relationship required to execute.',
    },
    {
      role: 'Liquidity providers',
      pain: 'Idle USDC sitting at 5% lending yields.',
      solution: 'Underwrite FX cover for 10–30% APY on liberalised pairs, 30–80% on frontier EM. Capped, fully-collateralised risk.',
    },
  ];

  return (
    <section id="who-this-is-for" className="py-16 sm:py-24 border-t border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0.6, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.3 }}
          className="max-w-2xl mb-10 sm:mb-12"
        >
          <p className="text-[11px] uppercase tracking-[0.12em] text-gray-400 font-medium mb-3">Who it&rsquo;s for</p>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-gray-900 leading-tight">
            Four buyers. One protocol.
          </h2>
          <p className="mt-3 text-sm sm:text-base text-gray-500 leading-relaxed">
            Built for businesses with real FX exposure and the capital that wants to write that risk.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {cards.map((c, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0.6, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className="rounded-2xl border border-gray-100 bg-white p-5 sm:p-6 hover:border-gray-200 transition-colors"
            >
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 tracking-tight">{c.role}</h3>
              <p className="mt-2 text-[13px] sm:text-sm text-gray-500 leading-relaxed">{c.pain}</p>
              <p className="mt-3 pt-3 border-t border-gray-100 text-[13px] sm:text-sm text-gray-900 leading-relaxed">
                {c.solution}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "1", label: "Pick pair & strike", desc: "Choose FX, commodity, or crypto. Set the price that triggers your payout." },
    { n: "2", label: "Pay premium", desc: "Max loss = premium paid. Nothing more. Shown before you confirm." },
    { n: "3", label: "Oracle watches", desc: "Price checked every 5 minutes. No action needed from you." },
    { n: "4", label: "Auto-settlement", desc: "Strike touched? Payout credited automatically to your wallet." },
  ];

  return (
    <section id="how-it-works" className="py-12 sm:py-16 border-t border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.3 }}
          className="text-center mb-8">
          <h2 className="text-xl sm:text-3xl font-bold text-[#1a4480] mb-2">How it works</h2>
          <p className="text-sm text-gray-500">Four steps. No minimum. No paperwork.</p>
        </motion.div>

        {/* Trading charts image accent */}
        <motion.div initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.4 }}
          className="relative rounded-xl sm:rounded-2xl overflow-hidden mb-6 h-36 sm:h-48">
          <img src={tradingChartsImg} alt="Market data" className="w-full h-full object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#1a4480]/80 to-[#1a4480]/20 flex items-center px-6 sm:px-8">
            <div>
              <p className="text-white font-bold text-lg sm:text-2xl">63 pairs covered</p>
              <p className="text-blue-200 text-xs sm:text-sm mt-0.5">FX · Commodities · Crypto · Checked every 5 minutes</p>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-5">
          {steps.map((s, i) => (
            <motion.div key={i} initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.25, delay: i * 0.06 }}
              className="bg-white rounded-xl sm:rounded-2xl border border-gray-100 p-4 sm:p-5">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#1a4480] text-white text-xs sm:text-sm font-bold flex items-center justify-center mb-3">{s.n}</div>
              <h3 className="text-xs sm:text-sm font-semibold text-gray-900 mb-1">{s.label}</h3>
              <p className="text-xs text-gray-400 leading-snug">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ExampleSection() {
  const notional = 10000;
  const premiumRate = 0.04;
  const initialRate = 16.00;
  const strike = 17.60; // 10% above initial
  const premium = notional * premiumRate; // $400

  // Payout formula: Notional × (Strike − InitialRate) / InitialRate
  const payoutPct = (strike - initialRate) / initialRate;
  const grossPayout = notional * payoutPct;
  const payoutFee = grossPayout * 0.01; // 1% payout fee
  const netPayout = grossPayout - payoutFee;
  const netGain = netPayout - premium;

  const rows = [
    {
      scenario: "Rate moves to 17.60+",
      color: "text-green-700",
      bg: "bg-green-50",
      premiumPaid: `-$${premium.toFixed(0)}`,
      payout: `+$${netPayout.toFixed(0)}`,
      net: `+$${netGain.toFixed(0)}`,
      note: "Strike touched — contract pays out automatically."
    },
  ];

  return (
    <section className="py-12 sm:py-16 border-t border-gray-100 bg-gray-50/40">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.3 }}
          className="text-center mb-8">
          <h2 className="text-xl sm:text-3xl font-bold text-[#1a4480] mb-2">A worked example</h2>
          <p className="text-sm text-gray-500">USD/GHS · $10,000 coverage · 4% premium · 30 days</p>
        </motion.div>

        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.3 }}>
          {/* Contract terms - 2x2 on mobile, 4-col on desktop */}
          <div className="grid grid-cols-2 sm:grid-cols-4 rounded-xl sm:rounded-2xl overflow-hidden border border-gray-100 bg-white mb-3">
            {[
              { label: "Coverage", value: "$10,000" },
              { label: "Initial rate", value: "16.00" },
              { label: "Strike (+10%)", value: "17.60" },
              { label: "Premium", value: "$400" },
            ].map((item, i) => (
              <div key={i} className={`p-3 sm:p-4 ${i % 2 === 0 ? 'border-r border-gray-100' : ''} ${i < 2 ? 'border-b sm:border-b-0 border-gray-100' : ''} ${i > 0 && i < 3 ? 'sm:border-r sm:border-gray-100' : ''}`}>
                <p className="text-xs text-gray-400 mb-1">{item.label}</p>
                <p className="font-mono font-bold text-gray-900 text-sm sm:text-base">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Scenario - card on mobile */}
          <div className="sm:hidden">
            <div className="rounded-xl bg-green-50 border border-green-100 p-4">
              <p className="font-semibold text-green-700 text-sm mb-2">✓ Rate hits 17.60 — Strike touched</p>
              <div className="flex justify-between text-xs text-gray-600">
                <span>Premium paid</span><span className="font-mono">-$400</span>
              </div>
              <div className="flex justify-between text-xs text-gray-600">
                <span>Payout received</span><span className="font-mono text-green-700">+${netPayout.toFixed(0)}</span>
              </div>
              <div className="flex justify-between text-xs font-bold text-green-700 border-t border-green-200 mt-2 pt-2">
                <span>Net gain</span><span className="font-mono">+${netGain.toFixed(0)}</span>
              </div>
            </div>
          </div>

          <div className="hidden sm:block rounded-2xl border border-gray-100 overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">When the strike is touched</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Premium</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Payout</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Net</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={`border-b border-gray-50 ${row.bg}`}>
                    <td className={`px-4 py-3 font-medium text-sm ${row.color}`}>{row.scenario}<span className="text-xs text-gray-400 font-normal ml-2">{row.note}</span></td>
                    <td className="px-4 py-3 text-right font-mono text-sm text-gray-600">{row.premiumPaid}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold text-sm ${row.color}`}>{row.payout}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold text-sm ${row.color}`}>{row.net}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400 mt-3 text-center">Payout is fixed at purchase. Net gain deducts the 1% settlement fee.</p>
        </motion.div>
      </div>
    </section>
  );
}


function VisionSection() {
  return (
    <section id="about" className="py-16 border-t border-gray-100">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.4 }}>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6">Why We Exist</h2>
          <p className="text-lg sm:text-xl text-gray-600 leading-relaxed mb-6">
            Somewhere, a trader is watching markets move against them and doing the math on what it means for their capital, earnings and costs. They know the risk. What they didn't have was a way to protect against it.
          </p>
          <p className="text-base sm:text-lg font-semibold text-[#1a4480] leading-relaxed">
            BlockFinaX is becoming the world's largest platform for trade and cross-border risk mitigation — where protection against market exposure is as accessible as making a payment, available to anyone, at any size.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

function CredibilitySection() {
  return (
    <section id="how-its-structured" className="py-16 border-t border-gray-100 bg-gray-50/40">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.3 }}
          className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1a4480] mb-2">How it's structured</h2>
          <p className="text-sm text-gray-500">No trust assumptions. All mechanics are on-chain and verifiable.</p>
        </motion.div>

        <div className="grid sm:grid-cols-2 gap-3 sm:gap-5 mb-3 sm:mb-5">
          {[
            {
              title: "Collateral model",
              body: "Every pool is fully collateralized before hedgers can buy. Your payout is reserved the moment you purchase — it cannot be redirected.",
            },
            {
              title: "Price oracle",
              body: "Rates from ExchangeRate-API (FX), Yahoo Finance (commodities), CoinGecko (crypto). Checked every 5 minutes. Settlement called on-chain automatically.",
            },
          ].map((item, i) => (
            <motion.div key={i} initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.25, delay: i * 0.05 }}
              className="rounded-xl sm:rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
              <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">{item.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{item.body}</p>
            </motion.div>
          ))}
        </div>

        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.25, delay: 0.1 }}
          className="rounded-xl sm:rounded-2xl border border-amber-200 bg-amber-50/40 p-4 sm:p-6">
          <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">Risk disclosure</h3>
          <p className="text-sm text-gray-500 leading-relaxed">Max loss = premium paid. Payouts depend on price touching the strike before expiry — not guaranteed. Non-custodial: we do not hold your funds. Not regulated financial advice.</p>
        </motion.div>
      </div>
    </section>
  );
}


function EmailCapture() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  const subscribe = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest('POST', '/api/subscribe', { email });
      return res.json();
    },
    onSuccess: (data: { message: string }) => {
      setMessage(data.message);
      setEmail('');
    },
    onError: () => {
      setMessage('Something went wrong. Try again.');
    }
  });

  return (
    <section className="py-12">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0.6, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.3 }}
          className="max-w-lg mx-auto text-center">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Stay updated</h3>
          <p className="text-sm text-gray-500 mb-4">Get the latest updates on new features and supported pairs.</p>
          {message ? (
            <div className="text-sm text-green-600 bg-green-50 rounded-full py-3 px-4">{message}</div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); if (email) subscribe.mutate(email); }}
              className="flex gap-2">
              <div className="flex-1 relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full pl-10 pr-4 py-2.5 rounded-full border border-gray-200 text-sm focus:outline-none focus:border-gray-400 bg-gray-50 transition-colors"
                  required
                />
              </div>
              <Button type="submit" disabled={subscribe.isPending}
                className="bg-gray-900 text-white hover:bg-gray-800 rounded-full px-6 text-sm font-medium">
                {subscribe.isPending ? '...' : 'Subscribe'}
              </Button>
            </form>
          )}
        </motion.div>
      </div>
    </section>
  );
}

function FAQ() {
  const [open, setOpen] = useState<number | null>(null);
  const faqs = [
    {
      q: "What is a stop-loss rebate?",
      a: "A stop-loss rebate is a predetermined payout you receive if a market (FX rate, commodity price, or crypto price) moves against you and touches your chosen strike level. You pay a small premium upfront; if the market hits your strike before expiry, the contract pays out automatically on-chain. Think of it as a downside insurance with a transparent, pre-agreed payout."
    },
    {
      q: "Which asset classes can I hedge?",
      a: "BlockFinaX supports three asset classes: FX (40+ African and major currency pairs like USD/GHS, USD/NGN, EUR/GHS), Commodities (metals: Gold, Silver, Platinum; energy: WTI Oil, Brent Oil, Natural Gas; agri: Cocoa, Coffee, Wheat, Sugar), and Crypto (BTC, ETH, BNB, SOL, XRP, ADA). 63 pairs in total."
    },
    {
      q: "Who is BlockFinaX for?",
      a: "Any business or individual exposed to price volatility: African SME importers and exporters managing FX risk, commodity traders hedging cocoa or oil exposure, crypto holders protecting portfolio value, and liquidity providers who want to earn premiums by supplying the volatility buffer that others need."
    },
    {
      q: "How does the hedge marketplace work?",
      a: "Event creators set up a one-touch protection pool — specifying the pair, strike price, premium rate, and duration. Liquidity providers fund the pool and earn premiums. Hedgers buy protection by paying the premium. If the price touches the strike before expiry (one-touch settlement), hedgers receive their predetermined payout. If it never touches, LPs keep all premiums."
    },
    {
      q: "Is BlockFinaX live?",
      a: "Yes — BlockFinaX is live on Base and BNB Smart Chain. The Wallet, Hedge marketplace, and the full suite of 63 pairs are fully operational. Connect your wallet and start trading."
    },
    {
      q: "Is this regulated?",
      a: "BlockFinaX is structured as a P2P parametric protection protocol. We are actively pursuing regulatory sandbox approval, including an application to the Bank of Ghana. The protocol is non-custodial — funds are held in smart contracts, not by BlockFinaX."
    }
  ];

  return (
    <section className="py-12 border-t border-gray-100">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.h3 initial={{ opacity: 0.6 }} whileInView={{ opacity: 1 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.2 }}
          className="text-lg font-semibold text-gray-900 mb-6 text-center">Frequently asked questions</motion.h3>
        <div className="space-y-2">
          {faqs.map((faq, i) => (
            <motion.div key={i} initial={{ opacity: 0.6, y: 5 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-50px" }} transition={{ duration: 0.2, delay: i * 0.03 }}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-left hover:bg-gray-50 transition-colors"
              >
                <span className="text-sm font-medium text-gray-900">{faq.q}</span>
                <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open === i ? 'rotate-180' : ''}`} />
              </button>
              {open === i && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.2 }}
                  className="px-4 pb-3">
                  <p className="text-sm text-gray-500 leading-relaxed">{faq.a}</p>
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Website() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [mobileProductsOpen, setMobileProductsOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [mobileExploreOpen, setMobileExploreOpen] = useState(false);

  return (
    <div className="min-h-screen text-gray-900 relative" style={{ background: 'linear-gradient(180deg, #f0f4ff 0%, #ffffff 30%, #f8faff 60%, #ffffff 100%)' }}>
      <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 1 }}>
        <div className="web3-grid" />
        <div className="web3-orb web3-orb-1" />
        <div className="web3-orb web3-orb-2" />
        <div className="web3-orb web3-orb-3" />
        <div className="web3-particle web3-p1" />
        <div className="web3-particle web3-p2" />
        <div className="web3-particle web3-p3" />
        <div className="web3-particle web3-p4" />
        <div className="web3-particle web3-p5" />
        <div className="web3-particle web3-p6" />
        <div className="web3-particle web3-p7" />
        <div className="web3-particle web3-p8" />
      </div>
      <style>{`
        .web3-grid {
          position: absolute;
          inset: 0;
          background-image: 
            linear-gradient(rgba(26,68,128,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(26,68,128,0.04) 1px, transparent 1px);
          background-size: 60px 60px;
          mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, black 0%, transparent 70%);
          -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 30%, black 0%, transparent 70%);
        }
        .web3-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(60px);
        }
        .web3-orb-1 {
          width: 400px; height: 400px;
          top: -5%; right: 5%;
          background: radial-gradient(circle, rgba(46,91,186,0.15) 0%, rgba(26,68,128,0.05) 50%, transparent 70%);
          animation: orb-float-1 12s ease-in-out infinite;
        }
        .web3-orb-2 {
          width: 350px; height: 350px;
          top: 40%; left: -5%;
          background: radial-gradient(circle, rgba(26,68,128,0.12) 0%, rgba(46,91,186,0.04) 50%, transparent 70%);
          animation: orb-float-2 15s ease-in-out infinite;
        }
        .web3-orb-3 {
          width: 300px; height: 300px;
          bottom: 10%; right: 15%;
          background: radial-gradient(circle, rgba(46,91,186,0.1) 0%, rgba(26,68,128,0.03) 50%, transparent 70%);
          animation: orb-float-3 18s ease-in-out infinite;
        }
        @keyframes orb-float-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-40px, 30px) scale(1.1); }
          66% { transform: translate(20px, -20px) scale(0.9); }
        }
        @keyframes orb-float-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(50px, -30px) scale(1.15); }
        }
        @keyframes orb-float-3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          40% { transform: translate(-30px, -40px) scale(1.1); }
          80% { transform: translate(20px, 20px) scale(0.95); }
        }
        .web3-particle {
          position: absolute;
          border-radius: 50%;
          background: rgba(46,91,186,0.3);
          box-shadow: 0 0 6px rgba(46,91,186,0.4), 0 0 15px rgba(26,68,128,0.15);
        }
        .web3-p1 { width: 6px; height: 6px; top: 12%; left: 15%; animation: particle-rise 8s linear infinite; }
        .web3-p2 { width: 4px; height: 4px; top: 25%; left: 75%; animation: particle-rise 12s linear infinite; animation-delay: -3s; }
        .web3-p3 { width: 5px; height: 5px; top: 45%; left: 85%; animation: particle-rise 10s linear infinite; animation-delay: -6s; }
        .web3-p4 { width: 3px; height: 3px; top: 60%; left: 25%; animation: particle-rise 9s linear infinite; animation-delay: -2s; }
        .web3-p5 { width: 5px; height: 5px; top: 35%; left: 45%; animation: particle-rise 11s linear infinite; animation-delay: -4s; }
        .web3-p6 { width: 4px; height: 4px; top: 70%; left: 60%; animation: particle-rise 7s linear infinite; animation-delay: -1s; }
        .web3-p7 { width: 3px; height: 3px; top: 80%; left: 35%; animation: particle-rise 13s linear infinite; animation-delay: -5s; }
        .web3-p8 { width: 6px; height: 6px; top: 55%; left: 90%; animation: particle-rise 10s linear infinite; animation-delay: -7s; }
        @keyframes particle-rise {
          0% { transform: translateY(0) translateX(0) scale(1); opacity: 0; }
          10% { opacity: 1; }
          50% { transform: translateY(-120px) translateX(20px) scale(1.2); opacity: 0.6; }
          90% { opacity: 0; }
          100% { transform: translateY(-250px) translateX(-10px) scale(0.5); opacity: 0; }
        }
      `}</style>

      <nav className="border-b border-gray-100/80 sticky top-0 bg-white/60 backdrop-blur-xl" style={{ zIndex: 50 }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center space-x-2 cursor-pointer">
              <img src={logoPath} alt="BlockFinaX" className="w-7 h-7" />
              <span className="text-lg font-bold text-[#1a4480]">BlockFinaX</span>
            </button>

            <div className="hidden md:flex items-center space-x-6">
              <a href="#about" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">Why Us</a>
              <a href="#solutions" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">The Platform</a>
              <a href="#who-this-is-for" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">Users</a>
              <Link href="/liquidity-provider" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">Liquidity provider</Link>
              <div className="relative" onMouseEnter={() => setExploreOpen(true)} onMouseLeave={() => setExploreOpen(false)}>
                <button className="text-sm text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1">
                  Resources <ChevronDown className={`h-3.5 w-3.5 transition-transform ${exploreOpen ? 'rotate-180' : ''}`} />
                </button>
                {exploreOpen && (
                  <div className="absolute top-full left-0 mt-1 w-44 bg-white border border-gray-100 shadow-lg rounded-xl py-1">
                    <Link href="/whitepaper">
                      <button onClick={() => setExploreOpen(false)} className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors">Whitepaper</button>
                    </Link>
                    <Link href="/blog">
                      <button onClick={() => setExploreOpen(false)} className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors">Blog</button>
                    </Link>
                    <Link href="/pitch">
                      <button onClick={() => setExploreOpen(false)} className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors">Pitch Deck</button>
                    </Link>
                    <div className="border-t border-gray-100 my-1" />
                    <Link href="/data-room">
                      <button onClick={() => setExploreOpen(false)} className="w-full text-left px-4 py-2 text-sm text-[#1a4480] font-medium hover:bg-blue-50 transition-colors flex items-center gap-1.5">
                        <span>Investor Access</span>
                        <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-semibold">NDA</span>
                      </button>
                    </Link>
                  </div>
                )}
              </div>
              <Link href="/apply">
                <Button size="sm" className="bg-[#1a4480] text-white hover:bg-[#153a6e] rounded-full px-5 text-sm font-medium">
                  Apply for access
                </Button>
              </Link>
            </div>

            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2 hover:bg-gray-50 rounded-lg transition-colors">
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          {mobileMenuOpen && (
            <div className="md:hidden border-t border-gray-100 bg-white pb-4">
              <div className="py-2 space-y-1">
                <a href="#about" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors">Why Us</a>
                <a href="#solutions" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors">The Platform</a>
                <a href="#who-this-is-for" onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors">Users</a>
                <Link href="/liquidity-provider">
                  <a onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors">Liquidity provider</a>
                </Link>
                <div>
                  <button onClick={() => setMobileExploreOpen(!mobileExploreOpen)} className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors">
                    Resources <ChevronDown className={`h-3.5 w-3.5 transition-transform ${mobileExploreOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {mobileExploreOpen && (
                    <div className="pl-6 space-y-1">
                      <Link href="/whitepaper"><button onClick={() => setMobileMenuOpen(false)} className="block w-full text-left py-2 px-3 text-sm text-gray-500 hover:text-gray-900 rounded-lg">Whitepaper</button></Link>
                      <Link href="/blog"><button onClick={() => setMobileMenuOpen(false)} className="block w-full text-left py-2 px-3 text-sm text-gray-500 hover:text-gray-900 rounded-lg">Blog</button></Link>
                      <Link href="/pitch"><button onClick={() => setMobileMenuOpen(false)} className="block w-full text-left py-2 px-3 text-sm text-gray-500 hover:text-gray-900 rounded-lg">Pitch Deck</button></Link>
                      <Link href="/data-room"><button onClick={() => setMobileMenuOpen(false)} className="block w-full text-left py-2 px-3 text-sm text-[#1a4480] font-medium hover:bg-blue-50 rounded-lg">Investor Access (NDA)</button></Link>
                    </div>
                  )}
                </div>
                <div className="px-3 pt-2">
                  <Link href="/apply">
                    <Button className="w-full bg-[#1a4480] text-white hover:bg-[#153a6e] rounded-full font-medium" size="sm">Apply for access</Button>
                  </Link>
                </div>
                <div className="px-3">
                  <Link href="/docs/request">
                    <Button variant="outline" className="w-full rounded-full font-medium" size="sm">Request docs</Button>
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>

      <LiveFxTicker />

      <section className="pt-12 pb-10 md:pt-20 md:pb-16 overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-[48%_52%] gap-10 md:gap-12 items-center">

            {/* Left: text content */}
            <div className="text-center md:text-left">
              <motion.h1 initial={{ opacity: 0.6, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
                className="text-[34px] sm:text-5xl md:text-[56px] font-semibold tracking-[-0.02em] leading-[1.05] text-gray-900">
                On-chain FX protection
                <span className="block text-gray-400 mt-1.5">for businesses banks won't serve.</span>
              </motion.h1>

              <motion.p initial={{ opacity: 0.6, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.08 }}
                className="mt-5 sm:mt-6 text-[15px] sm:text-base text-gray-500 max-w-lg mx-auto md:mx-0 leading-relaxed">
                Buy parametric FX cover priced by a live market. Underwrite emerging-market currency risk for premium income. Settle on-chain, in USDC, without a bank in the loop.
              </motion.p>

              <motion.div initial={{ opacity: 0.6, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.16 }}
                className="mt-8 sm:mt-10 flex flex-col sm:flex-row justify-center md:justify-start items-stretch sm:items-center gap-3">
                <Link href="/apply">
                  <Button className="w-full sm:w-auto bg-gray-900 text-white hover:bg-gray-800 rounded-full px-7 h-11 text-sm font-medium">
                    Request access <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/docs/request">
                  <Button variant="outline" className="w-full sm:w-auto rounded-full px-7 h-11 text-sm font-medium border-gray-200 text-gray-700 hover:bg-gray-50 hover:text-gray-900">
                    Read the docs
                  </Button>
                </Link>
              </motion.div>

              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.3 }}
                className="mt-8 text-xs text-gray-400 font-medium tracking-wide uppercase">
                Live on Base &amp; BNB Smart Chain
              </motion.p>
            </div>

            {/* Right: app screenshot */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }}
              className="relative w-full">
              <div className="relative w-full">
                <img
                  src={appScreenshotImg}
                  alt="BlockFinaX — wallet, hedge marketplace, live rates"
                  className="w-full object-contain"
                  style={{ mixBlendMode: 'multiply' }}
                />
              </div>
            </motion.div>

          </div>
        </div>
      </section>

      <section className="border-y border-gray-100 py-4 bg-gray-50/60">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-row items-center justify-center gap-4 sm:gap-10">
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#1a4480]/10 flex items-center justify-center shrink-0">
                <LockKeyhole className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-[#1a4480]" />
              </div>
              <span className="text-xs sm:text-sm text-gray-700 font-semibold sm:font-normal whitespace-nowrap">
                <span className="font-semibold text-gray-900">Your key, your control.</span>
                <span className="hidden sm:inline text-gray-600"> We never hold your private key.</span>
              </span>
            </div>
            <div className="w-px h-5 bg-gray-200 shrink-0" />
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#1a4480]/10 flex items-center justify-center shrink-0">
                <Shield className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-[#1a4480]" />
              </div>
              <span className="text-xs sm:text-sm text-gray-700 font-semibold sm:font-normal whitespace-nowrap">
                <span className="font-semibold text-gray-900">Funds in smart contracts.</span>
                <span className="hidden sm:inline text-gray-600"> Not with us.</span>
              </span>
            </div>
            <div className="w-px h-5 bg-gray-200 shrink-0" />
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#1a4480]/10 flex items-center justify-center shrink-0">
                <Globe className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-[#1a4480]" />
              </div>
              <span className="text-xs sm:text-sm text-gray-700 font-semibold sm:font-normal whitespace-nowrap">
                <span className="font-semibold text-gray-900">All on-chain.</span>
                <span className="hidden sm:inline text-gray-600"> Every transaction is verifiable.</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <ProblemSection />

      <VisionSection />

      <SolutionsSection />

      <WhoForSection />

      <HowItWorks />

      <ExampleSection />

      <UnderwriterSection />

      <LiveHedgeEvents />

      <CredibilitySection />

      <EmailCapture />

      <FAQ />

      <footer className="border-t border-gray-100 py-8 mt-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-start gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-3">
                <img src={logoPath} alt="BlockFinaX" className="w-6 h-6" />
                <span className="font-bold text-gray-900">BlockFinaX</span>
              </div>
              <p className="text-sm text-gray-400 max-w-xs">On-chain parametric downside protection for FX, commodities, and crypto — built for emerging markets.</p>
            </div>
            <div className="flex gap-12">
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-3">Platform</h4>
                <ul className="space-y-2 text-sm text-gray-400">
                  <li><Link href="/apply" className="hover:text-gray-600 transition-colors">Apply for access</Link></li>
                  <li><Link href="/docs/request" className="hover:text-gray-600 transition-colors">Request docs</Link></li>
                  <li><a href="mailto:hello@blockfinax.com" className="hover:text-gray-600 transition-colors">Partnerships</a></li>
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-3">Resources</h4>
                <ul className="space-y-2 text-sm text-gray-400">
                  <li><Link href="/whitepaper" className="hover:text-gray-600 transition-colors">Whitepaper</Link></li>
                  <li><Link href="/blog" className="hover:text-gray-600 transition-colors">Blog</Link></li>
                  <li><Link href="/pitch" className="hover:text-gray-600 transition-colors">Pitch Deck</Link></li>
                  <li><a href="mailto:info@blockfinax.com" className="hover:text-gray-600 transition-colors">Contact</a></li>
                </ul>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-3">Community</h4>
                <ul className="space-y-2 text-sm text-gray-400">
                  <li><a href="https://x.com/blockfinax?s=21" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors flex items-center gap-1.5"><Twitter className="h-3.5 w-3.5" /> Twitter</a></li>
                  <li><a href="https://www.linkedin.com/company/blockfinax/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors flex items-center gap-1.5"><Linkedin className="h-3.5 w-3.5" /> LinkedIn</a></li>
                  <li><a href="https://t.me/+4flz7LGYq_82YTM8" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors flex items-center gap-1.5"><Send className="h-3.5 w-3.5" /> Telegram</a></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-100 mt-8 pt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
            <p className="text-xs text-gray-400">&copy; {new Date().getFullYear()} BlockFinaX. All rights reserved.</p>
            <div className="flex gap-4 text-xs text-gray-400">
              <Link href="/privacy" className="hover:text-gray-600 transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-gray-600 transition-colors">Terms of Use</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
