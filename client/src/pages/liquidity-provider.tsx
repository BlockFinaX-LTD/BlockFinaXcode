/**
 * liquidity-provider.tsx — LP underwriting workbench.
 *
 * Responsive React port of the standalone HTML tool. Same calculation
 * model, same FX history, same presets — rebuilt as a real component
 * with Recharts (no Chart.js CDN, no inline scripts, no CSP relaxation).
 *
 * Public route. Linked from the landing-page nav.
 */

import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ComposedChart,
  Bar,
  Scatter,
  ScatterChart,
} from 'recharts';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import logoPath from '@/assets/logo.png';

// ── Data ────────────────────────────────────────────────────────────────

type Regime = 'stable' | 'volatile' | 'extreme';

interface CurrencyData {
  label: string;
  short: string;
  name: string;
  regime: Regime;
  decimals: number;
  rates: Record<string, number>;
  intro: string;
  watch: string;
  recommended: { premium: number; range: number; cap: number };
  note: string;
}

const DATA: Record<string, CurrencyData> = {
  ghs: {
    label: 'USD / GHS — Ghana cedi',
    short: 'GHS',
    name: 'Ghana cedi',
    regime: 'volatile',
    decimals: 2,
    rates: {
      '2018-12': 4.82, '2019-03': 5.51, '2019-06': 5.27, '2019-09': 5.51, '2019-12': 5.67,
      '2020-03': 5.62, '2020-06': 5.78, '2020-09': 5.80, '2020-12': 5.76,
      '2021-03': 5.74, '2021-06': 5.78, '2021-09': 5.99, '2021-12': 6.03,
      '2022-03': 7.55, '2022-06': 7.91, '2022-09': 9.99, '2022-12': 8.50,
      '2023-03': 11.27, '2023-06': 11.49, '2023-09': 11.49, '2023-12': 11.65,
      '2024-03': 13.10, '2024-06': 14.86, '2024-09': 15.55, '2024-12': 14.50,
      '2025-03': 15.40, '2025-06': 10.40, '2025-09': 12.40, '2025-12': 10.40,
      '2026-03': 10.95, '2026-05': 10.99,
    },
    intro: "Ghana's currency is BlockFinaX's anchor market. Dramatic two-way volatility — losing 63% of value 2022–2023, then gaining 40% back in 2025. The textbook hedging market.",
    watch: 'Bank of Ghana monetary policy, cocoa export receipts, IMF program status, election cycles.',
    recommended: { premium: 2.5, range: 8, cap: 4.5 },
    note: "The cedi's whipsaw is both opportunity and risk. Premium pricing must reflect regime, not historical average.",
  },
  ngn: {
    label: 'USD / NGN — Nigerian naira',
    short: 'NGN',
    name: 'Nigerian naira',
    regime: 'extreme',
    decimals: 0,
    rates: {
      '2018-12': 364, '2019-03': 360, '2019-06': 360, '2019-09': 362, '2019-12': 364,
      '2020-03': 380, '2020-06': 386, '2020-09': 386, '2020-12': 394,
      '2021-03': 410, '2021-06': 411, '2021-09': 411, '2021-12': 415,
      '2022-03': 416, '2022-06': 415, '2022-09': 432, '2022-12': 460,
      '2023-03': 461, '2023-06': 770, '2023-09': 770, '2023-12': 899,
      '2024-03': 1450, '2024-06': 1485, '2024-09': 1675, '2024-12': 1535,
      '2025-03': 1530, '2025-06': 1530, '2025-09': 1490, '2025-12': 1460,
      '2026-03': 1380, '2026-05': 1378,
    },
    intro: 'Largest and most volatile African currency by economic significance. Lost roughly 70% of its value 2023–2024 in two major steps. Stabilized in 2025–2026 around 1,400.',
    watch: 'Crude oil prices, foreign reserves at CBN, parallel market spread.',
    recommended: { premium: 4.0, range: 12, cap: 7 },
    note: 'Step devaluations make standard pricing dangerous. Wide ranges with high caps, or limit notional exposure per event.',
  },
  kes: {
    label: 'USD / KES — Kenya shilling',
    short: 'KES',
    name: 'Kenya shilling',
    regime: 'stable',
    decimals: 2,
    rates: {
      '2018-12': 101.85, '2019-03': 100.36, '2019-06': 101.65, '2019-09': 103.92, '2019-12': 101.27,
      '2020-03': 105.79, '2020-06': 106.50, '2020-09': 108.50, '2020-12': 109.20,
      '2021-03': 109.79, '2021-06': 107.85, '2021-09': 110.65, '2021-12': 113.13,
      '2022-03': 115.13, '2022-06': 117.85, '2022-09': 120.66, '2022-12': 123.39,
      '2023-03': 132.66, '2023-06': 140.27, '2023-09': 148.07, '2023-12': 157.00,
      '2024-03': 131.18, '2024-06': 128.50, '2024-09': 128.92, '2024-12': 129.50,
      '2025-03': 129.20, '2025-06': 129.30, '2025-09': 129.05, '2025-12': 129.10,
      '2026-03': 129.20, '2026-05': 129.35,
    },
    intro: 'Depreciated steadily 2020–2023 (101 to 157), then reversed sharply to 129 in early 2024 and has held there since.',
    watch: 'Diaspora remittances, tourism, IMF program conditionality.',
    recommended: { premium: 1.5, range: 6, cap: 3 },
    note: 'Low volatility means low premium income but also low payout risk. Volume must compensate.',
  },
  etb: {
    label: 'USD / ETB — Ethiopian birr',
    short: 'ETB',
    name: 'Ethiopian birr',
    regime: 'extreme',
    decimals: 1,
    rates: {
      '2018-12': 28.07, '2019-12': 31.84,
      '2020-06': 34.50, '2020-12': 39.66,
      '2021-06': 43.55, '2021-12': 49.50,
      '2022-06': 51.92, '2022-12': 53.40,
      '2023-06': 54.55, '2023-12': 55.95,
      '2024-03': 56.50, '2024-06': 57.30, '2024-09': 122.5, '2024-12': 127.05,
      '2025-03': 132.0, '2025-06': 136.5, '2025-09': 141.8, '2025-12': 146.5,
      '2026-03': 157.0, '2026-05': 156.5,
    },
    intro: 'Underwent managed devaluation for years before the July 2024 float, when it lost more than 100% of value in three months.',
    watch: 'IMF program disbursements, parallel market premium, forex reserves.',
    recommended: { premium: 5.0, range: 15, cap: 10 },
    note: 'Most extreme regime on the platform. Smaller positions, wider ranges, higher caps.',
  },
  egp: {
    label: 'USD / EGP — Egyptian pound',
    short: 'EGP',
    name: 'Egyptian pound',
    regime: 'extreme',
    decimals: 2,
    rates: {
      '2018-12': 17.93, '2019-06': 16.65, '2019-12': 16.07,
      '2020-06': 16.18, '2020-12': 15.66,
      '2021-06': 15.66, '2021-12': 15.71,
      '2022-03': 18.30, '2022-06': 18.66, '2022-09': 19.32, '2022-12': 24.70,
      '2023-03': 30.83, '2023-06': 30.85, '2023-09': 30.85, '2023-12': 30.93,
      '2024-03': 47.42, '2024-06': 48.05, '2024-09': 49.10, '2024-12': 50.83,
      '2025-03': 50.50, '2025-06': 49.65, '2025-09': 48.20, '2025-12': 50.70,
      '2026-03': 52.80, '2026-05': 52.25,
    },
    intro: 'Three step-devaluations in 8 years (2016, 2022, 2024). March 2024 devaluation alone moved the rate from 31 to 47 in one week.',
    watch: 'IMF program reviews, Suez Canal revenues, gas exports, foreign reserves.',
    recommended: { premium: 3.5, range: 10, cap: 6 },
    note: 'Devaluations are concentrated rather than smooth. Best approach: shorter tenors and wider ranges.',
  },
  zar: {
    label: 'USD / ZAR — South African rand',
    short: 'ZAR',
    name: 'South African rand',
    regime: 'stable',
    decimals: 2,
    rates: {
      '2018-12': 14.36, '2019-06': 14.07, '2019-12': 14.04,
      '2020-03': 17.85, '2020-06': 17.33, '2020-09': 16.69, '2020-12': 14.62,
      '2021-03': 14.78, '2021-06': 14.27, '2021-09': 15.02, '2021-12': 15.95,
      '2022-03': 14.62, '2022-06': 16.27, '2022-09': 17.99, '2022-12': 17.04,
      '2023-03': 17.78, '2023-06': 18.83, '2023-09': 18.91, '2023-12': 18.42,
      '2024-03': 18.92, '2024-06': 18.20, '2024-09': 17.30, '2024-12': 18.91,
      '2025-03': 18.42, '2025-06': 17.90, '2025-09': 17.50, '2025-12': 16.57,
      '2026-03': 16.30, '2026-05': 16.39,
    },
    intro: 'Most liquid African currency. Behaves more like a developed-market currency — trades on global risk sentiment and commodity prices.',
    watch: 'Commodity prices (gold, platinum), Eskom/load-shedding, SARB policy.',
    recommended: { premium: 2.0, range: 7, cap: 4 },
    note: "Best characterized as 'volatile but liquid' rather than crisis-prone. Standard pricing approaches work better here.",
  },
};

const PAIRS = Object.keys(DATA);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const periodLabel = (p: string) => {
  const [y, m] = p.split('-');
  return `${MONTH_NAMES[parseInt(m) - 1]} ${y}`;
};

interface Preset {
  label: string;
  pair: string;
  start: string;
  end: string;
  tone: 'stable' | 'warning';
}

const PRESETS: Preset[] = [
  { label: 'Stable shilling (2022–2023)', pair: 'kes', start: '2022-03', end: '2023-12', tone: 'stable' },
  { label: 'Calm cedi (2020–2021)', pair: 'ghs', start: '2020-03', end: '2021-12', tone: 'stable' },
  { label: 'Typical rand (2020–2024)', pair: 'zar', start: '2020-03', end: '2024-12', tone: 'stable' },
  { label: 'Cedi crisis (2022–2023)', pair: 'ghs', start: '2022-03', end: '2023-12', tone: 'warning' },
  { label: 'Cedi whipsaw (2024–2025)', pair: 'ghs', start: '2024-03', end: '2025-12', tone: 'warning' },
  { label: 'Naira collapse (2023–2024)', pair: 'ngn', start: '2023-06', end: '2024-12', tone: 'warning' },
  { label: 'EGP devaluation (2022–2024)', pair: 'egp', start: '2022-03', end: '2024-12', tone: 'warning' },
  { label: 'ETB float (2024)', pair: 'etb', start: '2024-03', end: '2025-12', tone: 'warning' },
];

// ── Formatting helpers ──────────────────────────────────────────────────

const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const NUM2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const USD = (v: number) => {
  if (Math.abs(v) < 1000 && v !== 0) return (v < 0 ? '-' : '') + '$' + NUM2.format(Math.abs(v));
  return (v < 0 ? '-' : '') + '$' + NUM.format(Math.round(Math.abs(v)));
};
const PCT = (v: number) => (v * 100).toFixed(1) + '%';
const PCT_SIGN = (v: number) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';

// ── Backtest engine ─────────────────────────────────────────────────────

interface BacktestState {
  pair: string;
  start: string;
  end: string;
  capital: number;
  premium: number;
  range: number;
  cap: number;
  util: number;
  tenor: number;
}

interface MonthlyRow {
  period: string;
  label: string;
  rate: number;
  pctChange: number;
  events: number;
  triggers: number;
  premium: number;
  payouts: number;
  net: number;
  cumNet: number;
}

interface BacktestResult {
  series: { period: string; rate: number; label: string }[];
  monthly: MonthlyRow[];
  cumulativePremium: number;
  cumulativePayouts: number;
  totalNet: number;
  periodReturn: number;
  annualized: number;
  triggers: number;
  totalEvents: number;
  triggerRate: number;
  totalRateChange: number;
  months: number;
  notionalCapacity: number;
  activeNotional: number;
  notionalPerMonth: number;
  avgEventNotional: number;
  leverage: number;
}

function runBacktest(s: BacktestState): BacktestResult | null {
  const data = DATA[s.pair].rates;
  const periods = Object.keys(data).sort();
  const startIdx = periods.indexOf(s.start);
  const endIdx = periods.indexOf(s.end);
  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) return null;

  const series = periods.slice(startIdx, endIdx + 1).map(p => ({
    period: p,
    rate: data[p],
    label: periodLabel(p),
  }));

  const premiumRate = s.premium / 100;
  const rangePct = s.range / 100;
  const capPct = s.cap / 100;
  const util = s.util / 100;
  const LEVERAGE = 10;
  const notionalCapacity = s.capital * LEVERAGE;
  const activeNotional = notionalCapacity * util;
  const monthlyTurns = 365 / s.tenor / 12;
  const notionalPerMonth = activeNotional * monthlyTurns;

  let cumulativePremium = 0;
  let cumulativePayouts = 0;
  let triggers = 0;
  let totalEvents = 0;
  const monthly: MonthlyRow[] = [];

  for (let i = 0; i < series.length - 1; i++) {
    const startRate = series[i].rate;
    const endRate = series[i + 1].rate;
    const pctChange = (endRate - startRate) / startRate;
    const eventSize = Math.max(50, Math.min(50000, notionalPerMonth / 4));
    const events = Math.max(1, Math.round(notionalPerMonth / eventSize));
    totalEvents += events;
    const premium = notionalPerMonth * premiumRate;
    cumulativePremium += premium;
    let payouts = 0;
    let monthTriggers = 0;
    if (Math.abs(pctChange) > rangePct) {
      const excess = Math.abs(pctChange) - rangePct;
      const severity = Math.min(excess / rangePct, 1);
      monthTriggers = Math.round(events * severity);
      triggers += monthTriggers;
      payouts = monthTriggers * eventSize * capPct;
      cumulativePayouts += payouts;
    }
    const net = premium - payouts;
    monthly.push({
      period: series[i + 1].period,
      label: series[i + 1].label,
      rate: endRate,
      pctChange,
      events,
      triggers: monthTriggers,
      premium,
      payouts,
      net,
      cumNet: cumulativePremium - cumulativePayouts,
    });
  }

  const totalNet = cumulativePremium - cumulativePayouts;
  const periodReturn = totalNet / s.capital;
  const months = series.length - 1;
  const annualized = months > 0 ? Math.pow(1 + periodReturn, 12 / months) - 1 : 0;
  const triggerRate = totalEvents > 0 ? triggers / totalEvents : 0;
  const totalRateChange = (series[series.length - 1].rate - series[0].rate) / series[0].rate;
  const totalNotionalProtected = notionalPerMonth * months;
  const avgEventNotional = totalEvents > 0 ? totalNotionalProtected / totalEvents : 0;

  return {
    series,
    monthly,
    cumulativePremium,
    cumulativePayouts,
    totalNet,
    periodReturn,
    annualized,
    triggers,
    totalEvents,
    triggerRate,
    totalRateChange,
    months,
    notionalCapacity,
    activeNotional,
    notionalPerMonth,
    avgEventNotional,
    leverage: LEVERAGE,
  };
}

// ── Reusable UI primitives ──────────────────────────────────────────────

function Section({
  label,
  children,
  className = '',
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-white border border-gray-200/80 rounded-2xl p-4 sm:p-6 ${className}`}>
      {label && (
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0047BB] mb-4">
          {label}
        </p>
      )}
      {children}
    </section>
  );
}

function StatCard({
  label,
  value,
  detail,
  tone,
  highlight,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'positive' | 'negative' | 'neutral';
  highlight?: boolean;
}) {
  const valueColor =
    tone === 'positive' ? 'text-emerald-700'
    : tone === 'negative' ? 'text-red-600'
    : 'text-gray-900';
  return (
    <div className={`rounded-xl p-4 ${highlight ? 'bg-[#EDF1F8] border-2 border-[#0047BB]' : 'bg-gray-50 border border-transparent'}`}>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">{label}</p>
      <p className={`text-2xl sm:text-[26px] font-semibold tracking-tight mt-2 ${valueColor} font-mono-data`}>
        {value}
      </p>
      {detail && <p className="text-xs text-gray-500 mt-1">{detail}</p>}
    </div>
  );
}

function SliderRow({
  label,
  value,
  display,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  display: string;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-gray-600">{label}</span>
        <span className="text-[13px] font-semibold text-[#001F5C] font-mono-data">{display}</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        min={min}
        max={max}
        step={step}
        className="touch-pan-y"
      />
    </div>
  );
}

// ── Sub-pages ───────────────────────────────────────────────────────────

function HowItWorksTab() {
  const [openQa, setOpenQa] = useState<number | null>(null);
  const qa = [
    {
      q: 'How is BlockFinaX going to source enough hedger demand?',
      a: "Distribution is the gating factor. The premium-and-loss math means nothing if there's no hedger paying the premium. Before committing LP capital, you should see the customer pipeline: which Ghanaian importer/exporter networks are committed to using the platform, what their estimated monthly hedge volume is, and what conversion rate they've achieved in pilots.",
    },
    {
      q: 'What is the smart contract risk and how is it bounded?',
      a: 'Smart contracts can fail in ways that lose LP capital — oracle manipulation, code exploits, governance attacks. Mitigations: multiple independent audits, time-locked governance changes, maximum exposure per event. A sophisticated LP haircuts modelled returns by 1–2% to account for unquantified contract risk.',
    },
    {
      q: "What happens during regime breaks the model doesn't capture?",
      a: 'Step devaluations like Egypt 2024 (35% in one week) or Ethiopia 2024 (more than 100% in 6 months) violate the assumptions of normal-distribution pricing. An LP exposed to a single such event with naive pricing can lose multiple years of premium income in a single month.',
    },
    {
      q: 'How does adverse selection work in this market?',
      a: 'Hedgers buy protection when they expect the rate to move against them. They may know more about specific shipping cycles, supplier payment timing, or local political risk than the underwriter does. Compensating for this requires adding 10–20% to the risk premium beyond what pure historical volatility implies.',
    },
    {
      q: 'What is the lockup, and what is my real-world liquidity?',
      a: "Capital is locked for the period you commit to. There is no in-period exit unless a secondary market exists (it doesn't yet). If you need optionality on your capital, the LP position is not suitable.",
    },
  ];

  return (
    <div className="space-y-4">
      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-2">
          What does an LP actually do?
        </h2>
        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          A liquidity provider on BlockFinaX is an underwriter of FX risk. When a Ghanaian
          importer wants protection against the cedi weakening over the next 30 days, the LP
          is the counterpart who pays out if the rate moves and keeps the premium if it doesn't.
        </p>
        <p className="text-sm text-gray-700 leading-relaxed mb-3">
          This is fundamentally insurance underwriting, not lending. You're not loaning
          capital and earning interest. You're <strong>posting capital as collateral against
          a specific risk</strong> and earning premium for accepting that risk.
        </p>
        <ol className="mt-2 space-y-2 list-decimal pl-5">
          <li className="text-sm text-gray-700">
            <strong>You are not betting on direction.</strong> You don't need a view on whether
            the cedi will strengthen or weaken. You need a view on whether your premium properly
            compensates for the volatility.
          </li>
          <li className="text-sm text-gray-700">
            <strong>Your loss is bounded.</strong> The cap you set limits maximum payout per
            event. You cannot lose more than that on any single contract.
          </li>
          <li className="text-sm text-gray-700">
            <strong>Capital recycles.</strong> When an event expires, capital is freed for the
            next one. Over a year, $1 of LP capital backs many sequential events.
          </li>
        </ol>
      </Section>

      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-3">
          How to price the premium
        </h2>
        <div className="space-y-5">
          <Lesson n={1} title="Estimate the probability of trigger">
            <p className="text-sm text-gray-700">
              If the rate has to move 8% in 30 days for the event to trigger, how often does
              that happen? The honest answer requires looking at historical data for the
              specific currency, in the specific volatility regime.
            </p>
            <ExampleBox label="USD/GHS">
              Annualized volatility around 18%. Scaled to 30 days: 18% × √(30/365) ≈ 5.2%.
              A move of 8% is roughly 1.5 standard deviations. Under a normal distribution that's
              roughly 13% probability — but EM currencies have fat tails, so the real probability
              is higher, perhaps 18–25%.
            </ExampleBox>
          </Lesson>
          <Lesson n={2} title="Calculate fair value">
            <p className="text-sm text-gray-700">
              Fair value is the expected payout — the probability of trigger times the cap.
            </p>
            <Formula>Fair value = P(trigger) × Cap %</Formula>
            <ExampleBox label="Example continued">
              With 20% trigger probability and a 4.5% cap, fair value is 20% × 4.5% = 0.9% of
              notional. That's the breakeven premium — at this price, on average, the LP earns
              nothing.
            </ExampleBox>
          </Lesson>
          <Lesson n={3} title="Add the risk premium">
            <p className="text-sm text-gray-700">
              The LP cannot accept the breakeven premium because volatility can spike, fat-tail
              events occur, and regime breaks happen. The risk premium compensates for this —
              typically 40% to 80% above fair value in EM markets.
            </p>
            <Formula>Premium = Fair value × (1 + risk multiplier)</Formula>
            <ExampleBox label="Example continued">
              Fair value of 0.9%, with a 60% risk multiplier, gives a premium of 0.9% × 1.6 =
              1.44% of notional. On a $50,000 hedge, that's $720 charged to the hedger.
            </ExampleBox>
          </Lesson>
        </div>
      </Section>

      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-2">
          Why EM currencies trend toward depreciation
        </h2>
        <p className="text-sm text-gray-700 mb-3">
          An underwriter who treats USD/EM pairs as random walks gets systematically punished.
          EM currencies depreciate over time because of structural forces:
        </p>
        <ul className="space-y-2 list-disc pl-5">
          {[
            ['Inflation differentials.', 'When local inflation is 25% and US inflation is 3%, the local currency loses about 22% of its purchasing power per year.'],
            ['Productivity gaps.', 'Countries whose output growth lags developed economies see their currencies weaken over time.'],
            ['Capital flight in stress.', 'Whenever conditions deteriorate, savers move money to dollars.'],
            ['Debt service in foreign currency.', 'Many EM economies borrow in dollars. Servicing that debt creates structural demand for USD.'],
            ['Pegs and managed floats break.', 'When a central bank defends an overvalued rate, the eventual devaluation is concentrated rather than gradual.'],
          ].map(([bold, rest], i) => (
            <li key={i} className="text-sm text-gray-700">
              <strong>{bold}</strong> {rest}
            </li>
          ))}
        </ul>
      </Section>

      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-2">
          Probability is not destiny — regime matters
        </h2>
        <p className="text-sm text-gray-700 mb-3">
          The probability of trigger isn't a single number. It depends on the regime. The same
          range width that triggers 10% of the time in a calm period might trigger 50% of the
          time in a crisis.
        </p>
        <ExampleBox label="USD/GHS regime comparison">
          <strong>2020–2021 (calm):</strong> Cedi moved less than 5% over 24 months. An 8% range
          almost never triggered. An LP charging 1% premium made money easily.
          <br /><br />
          <strong>2022–2023 (crisis):</strong> Cedi went from 6 to 12. An 8% range triggered
          almost every month. An LP still charging 1% premium got destroyed. The honest premium
          for the new regime was 4–6%.
        </ExampleBox>
      </Section>

      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-2">
          Questions to ask before committing capital
        </h2>
        <div className="divide-y divide-gray-200/80">
          {qa.map((item, i) => {
            const isOpen = openQa === i;
            return (
              <div key={i} className="py-1">
                <button
                  type="button"
                  onClick={() => setOpenQa(isOpen ? null : i)}
                  className="w-full text-left py-3 flex items-start gap-3 hover:bg-gray-50/50 transition-colors rounded -mx-2 px-2"
                >
                  <span className="flex-1 text-sm font-medium text-[#001F5C]">{item.q}</span>
                  <ChevronDown
                    className={`h-4 w-4 text-gray-400 shrink-0 mt-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div className="mb-2 -mt-1 ml-2 mr-2 text-[13px] text-gray-700 bg-gray-50 border-l-2 border-[#0047BB] rounded-r-md p-3 leading-relaxed">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function Lesson({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-[#0047BB] text-white text-xs font-bold">
          {n}
        </span>
        <h3 className="text-[15px] font-semibold text-[#001F5C]">{title}</h3>
      </div>
      <div className="pl-8 space-y-2">{children}</div>
    </div>
  );
}

function ExampleBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3.5 mt-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0047BB] mb-1.5">
        {label}
      </p>
      <p className="text-[13px] text-gray-700 leading-relaxed">{children}</p>
    </div>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-block bg-gray-100 px-3 py-1.5 rounded font-mono-data text-[13px] text-[#001F5C] my-2">
      {children}
    </div>
  );
}

function CurrencyReferenceTab() {
  return (
    <div className="space-y-4">
      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-2">
          Currency reference
        </h2>
        <p className="text-sm text-gray-700">
          An LP should never underwrite a currency they don't understand. This section summarizes
          each currency's recent regime, what to watch for, and reasonable starting terms.
        </p>
      </Section>

      <div className="space-y-3">
        {PAIRS.map((pairKey) => {
          const c = DATA[pairKey];
          const periods = Object.keys(c.rates).sort();
          const firstRate = c.rates[periods[0]];
          const lastRate = c.rates[periods[periods.length - 1]];
          const totalChange = ((lastRate - firstRate) / firstRate) * 100;
          const regimeColors = {
            stable: 'bg-emerald-50 text-emerald-700',
            volatile: 'bg-amber-50 text-amber-700',
            extreme: 'bg-red-50 text-red-700',
          };
          return (
            <div
              key={pairKey}
              className="bg-white border border-gray-200/80 rounded-2xl p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <div>
                  <span className="text-base font-semibold text-[#001F5C]">{c.name}</span>
                  <span className="text-[13px] text-gray-500 ml-2 font-mono-data">USD/{c.short}</span>
                </div>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.06em] ${regimeColors[c.regime]}`}
                >
                  {c.regime}
                </span>
              </div>
              <p className="text-[13px] text-gray-700 mb-3 leading-relaxed">{c.intro}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                <MiniStat label="Current rate" value={lastRate.toFixed(c.decimals)} />
                <MiniStat
                  label={`${periods[0].substring(0, 4)} → now`}
                  value={`${totalChange > 0 ? '+' : ''}${totalChange.toFixed(0)}%`}
                  tone={totalChange > 0 ? 'negative' : 'positive'}
                />
                <MiniStat label="Recommended premium" value={`${c.recommended.premium}%`} />
                <MiniStat label="Recommended range" value={`${c.recommended.range}%`} />
              </div>
              <p className="text-[13px] text-gray-700 leading-relaxed">
                <strong className="text-[#001F5C]">What to watch:</strong> {c.watch}
              </p>
              <p className="text-[13px] text-gray-700 leading-relaxed mt-1.5">
                <strong className="text-[#001F5C]">Underwriter's note:</strong> {c.note}
              </p>
            </div>
          );
        })}
      </div>

      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-2">
          How to use this reference
        </h2>
        <p className="text-sm text-gray-700 mb-2">
          Before underwriting a new currency, check three things:
        </p>
        <ol className="list-decimal pl-5 space-y-2">
          <li className="text-sm text-gray-700">
            <strong>Regime stability.</strong> Has the central bank held the rate stable for
            years, or are there regular step-devaluations?
          </li>
          <li className="text-sm text-gray-700">
            <strong>Recent move size.</strong> What was the largest 30-day or 90-day move in
            the past 3 years? Your range width should be larger than this.
          </li>
          <li className="text-sm text-gray-700">
            <strong>Inflation and policy.</strong> Inflation above 15% and a central bank rate
            above 20% are signals that the currency is under depreciation pressure.
          </li>
        </ol>
      </Section>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  const valueColor =
    tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-red-600' : 'text-gray-900';
  return (
    <div className="bg-gray-50 rounded-md px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-gray-500 leading-tight">
        {label}
      </p>
      <p className={`text-[15px] font-semibold mt-0.5 font-mono-data ${valueColor}`}>{value}</p>
    </div>
  );
}

// ── Backtest tab ────────────────────────────────────────────────────────

function BacktestTab() {
  const [s, setS] = useState<BacktestState>({
    pair: 'ghs',
    start: '2022-03',
    end: '2023-12',
    capital: 250000,
    premium: 2.5,
    range: 8,
    cap: 4.5,
    util: 65,
    tenor: 30,
  });
  const [capitalInput, setCapitalInput] = useState(String(s.capital));

  const periodsForPair = useMemo(
    () => Object.keys(DATA[s.pair].rates).sort(),
    [s.pair],
  );

  const result = useMemo(() => runBacktest(s), [s]);

  const applyPreset = (preset: Preset) => {
    setS((prev) => ({
      ...prev,
      pair: preset.pair,
      start: preset.start,
      end: preset.end,
      premium: DATA[preset.pair].recommended.premium,
      range: DATA[preset.pair].recommended.range,
      cap: DATA[preset.pair].recommended.cap,
    }));
  };

  const onPairChange = (newPair: string) => {
    const newPeriods = Object.keys(DATA[newPair].rates).sort();
    setS((prev) => ({
      ...prev,
      pair: newPair,
      start: newPeriods.includes(prev.start) ? prev.start : newPeriods[0],
      end: newPeriods.includes(prev.end) ? prev.end : newPeriods[newPeriods.length - 1],
      premium: DATA[newPair].recommended.premium,
      range: DATA[newPair].recommended.range,
      cap: DATA[newPair].recommended.cap,
    }));
  };

  const onCapitalChange = (raw: string) => {
    setCapitalInput(raw);
    const v = parseFloat(raw);
    if (!isNaN(v) && v >= 1) {
      setS((prev) => ({ ...prev, capital: v }));
    }
  };

  const setCapital = (v: number) => {
    setS((prev) => ({ ...prev, capital: v }));
    setCapitalInput(String(v));
  };

  const insight = useMemo(() => {
    if (!result) return { msg: 'Pick a valid period (end must be after start).', tone: 'neutral' as const };
    const direction = result.totalRateChange >= 0 ? 'depreciated' : 'appreciated';
    const directionPct = Math.abs(result.totalRateChange * 100).toFixed(1);
    let msg = `**${DATA[s.pair].short}** ${direction} **${directionPct}%** over your period. `;
    if (result.totalNet > 0 && result.triggerRate < 0.10) msg += 'Few triggers, premium flowed through. Pricing was conservative for the conditions — strong return.';
    else if (result.totalNet > 0 && result.triggerRate < 0.25) msg += 'Moderate trigger rate, but premium covered the payouts. This is what good underwriting looks like.';
    else if (result.totalNet > 0) msg += 'High trigger rate, but premium still won. You priced this regime correctly.';
    else if (result.totalNet > -0.10 * s.capital) msg += 'Payouts exceeded premium. Modest loss — your pricing was slightly too cheap.';
    else msg += 'Severe loss. Your terms were inadequate for this regime — likely a step-devaluation period.';
    return { msg, tone: result.totalNet >= 0 ? 'positive' as const : 'negative' as const };
  }, [result, s.pair, s.capital]);

  // Chart data prep
  const rateChartData = useMemo(() => {
    if (!result) return [];
    return result.series.map((p, i) => {
      const prevRate = i === 0 ? p.rate : result.series[i - 1].rate;
      const upper = prevRate * (1 + s.range / 100);
      const lower = prevRate * (1 - s.range / 100);
      const change = i === 0 ? 0 : Math.abs((p.rate - prevRate) / prevRate);
      const triggered = change > s.range / 100;
      return {
        label: p.label.replace(' 20', ' \'').replace(' 19', ' \''),
        rate: p.rate,
        upper,
        lower,
        trigger: triggered ? p.rate : null,
      };
    });
  }, [result, s.range]);

  const pnlChartData = useMemo(() => {
    if (!result) return [];
    return result.monthly.map((m) => ({
      label: m.label.replace(' 20', ' \'').replace(' 19', ' \''),
      premium: m.premium,
      payouts: -m.payouts,
      cumCapital: s.capital + m.cumNet,
    }));
  }, [result, s.capital]);

  const pairDecimals = DATA[s.pair].decimals;
  const fmtRate = (v: number) => v.toFixed(pairDecimals);

  return (
    <div className="space-y-4">
      {/* Explainer */}
      <div className="bg-gradient-to-b from-[#EDF1F8] to-white border border-gray-200/80 rounded-2xl p-5 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight">
          What is a liquidity provider here?
        </h2>
        <p className="text-sm text-gray-700 mt-2 leading-relaxed">
          You are an <strong>underwriter of currency risk</strong>. You provide capital that
          protects African businesses against exchange-rate movement. You collect premium
          upfront. You pay out only if the rate moves outside the agreed range.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          {[
            ['1', 'You commit capital', 'Deposit any amount. It sits in the pool ready to back protection events.'],
            ['2', 'Hedgers buy protection', 'An importer paying $50K in 30 days wants protection. They pay you a premium upfront.'],
            ['3', 'Wait 30 days', 'If the rate stays inside the agreed range, the event expires. You keep the premium.'],
            ['4', 'If rate moves too far', 'You pay out — bounded by the cap. Maximum loss per event is fixed in advance.'],
          ].map(([n, title, body]) => (
            <div key={n} className="bg-white border border-gray-200/80 rounded-xl p-3.5">
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-[#0047BB] text-white text-[11px] font-bold">
                {n}
              </span>
              <p className="text-[13px] font-semibold text-[#001F5C] mt-2">{title}</p>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 text-[13px] text-[#001F5C] bg-white border-l-[3px] border-[#0047BB] rounded-r-md py-2.5 px-3.5">
          <strong>Your return = premium income − payouts.</strong> Backtest below shows what
          that would have been for any historical period, with the terms you set.
        </div>
        <div className="mt-3 text-xs text-gray-700 bg-white border border-gray-200/80 rounded-lg p-3 leading-relaxed">
          <strong className="text-[#001F5C]">Protocol leverage:</strong> $1 of LP capital
          backs $10 of notional protection (10x). Premium is charged as a % of notional, not
          a % of LP capital. This is how the math compounds: you collect premium on $10 of
          exposure for every $1 of capital committed.
        </div>
      </div>

      {/* Step 1 */}
      <Section label="Step 1 — what to underwrite, and when">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-[13px] text-gray-600 mb-1.5">Currency pair</p>
            <Select value={s.pair} onValueChange={onPairChange}>
              <SelectTrigger className="h-10 rounded-lg border-gray-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAIRS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {DATA[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-[13px] text-gray-600 mb-1.5">Start date</p>
            <Select value={s.start} onValueChange={(v) => setS((p) => ({ ...p, start: v }))}>
              <SelectTrigger className="h-10 rounded-lg border-gray-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {periodsForPair.map((p) => (
                  <SelectItem key={p} value={p}>
                    {periodLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-[13px] text-gray-600 mb-1.5">End date</p>
            <Select value={s.end} onValueChange={(v) => setS((p) => ({ ...p, end: v }))}>
              <SelectTrigger className="h-10 rounded-lg border-gray-200">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {periodsForPair.map((p) => (
                  <SelectItem key={p} value={p}>
                    {periodLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                preset.tone === 'stable'
                  ? 'bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-red-50 border-red-100 text-red-700 hover:bg-red-100'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Step 2 */}
      <Section label="Step 2 — your underwriting terms">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
          {/* Capital input */}
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-gray-600">Your capital commitment</p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <Input
                type="number"
                value={capitalInput}
                onChange={(e) => onCapitalChange(e.target.value)}
                onBlur={() => {
                  const v = parseFloat(capitalInput);
                  if (isNaN(v) || v < 1) {
                    setCapital(1);
                  }
                }}
                className="h-10 pl-7 rounded-lg border-gray-200 font-mono-data"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {[10, 100, 1000, 10000, 100000, 250000, 1000000].map((v) => (
                <button
                  key={v}
                  onClick={() => setCapital(v)}
                  className="px-2.5 py-1 rounded-full text-[11px] bg-gray-100 text-gray-700 hover:bg-[#EDF1F8] hover:text-[#001F5C] border border-gray-200 transition-colors"
                >
                  ${v >= 1000000 ? `${v / 1000000}M` : v >= 1000 ? `${v / 1000}K` : v}
                </button>
              ))}
            </div>
          </div>

          <SliderRow
            label="Premium you charge"
            value={s.premium}
            display={`${s.premium.toFixed(1)}%`}
            onChange={(v) => setS((p) => ({ ...p, premium: v }))}
            min={0.5} max={8} step={0.1}
          />
          <SliderRow
            label="Range width"
            value={s.range}
            display={`${s.range.toFixed(1)}%`}
            onChange={(v) => setS((p) => ({ ...p, range: v }))}
            min={2} max={25} step={0.5}
          />
          <SliderRow
            label="Cap — max payout per event"
            value={s.cap}
            display={`${s.cap.toFixed(1)}%`}
            onChange={(v) => setS((p) => ({ ...p, cap: v }))}
            min={1} max={15} step={0.5}
          />
          <SliderRow
            label="Capital utilization"
            value={s.util}
            display={`${s.util}%`}
            onChange={(v) => setS((p) => ({ ...p, util: v }))}
            min={20} max={95} step={5}
          />
          <SliderRow
            label="Event tenor (days)"
            value={s.tenor}
            display={`${s.tenor}`}
            onChange={(v) => setS((p) => ({ ...p, tenor: v }))}
            min={14} max={90} step={1}
          />
        </div>
      </Section>

      {/* Notional */}
      <Section label="Your notional exposure">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Notional capacity" value={result ? USD(result.activeNotional) : '—'} detail="LP capital × leverage × util" />
          <StatCard label="Annual notional" value={result ? USD(result.notionalPerMonth * 12) : '—'} detail="Over 12 months" />
          <StatCard label="Avg event size" value={result ? USD(result.avgEventNotional) : '—'} detail="Typical hedge" />
          <StatCard label="Leverage" value="10×" detail="LP capital → notional" />
        </div>
      </Section>

      {/* Step 3 — results */}
      <Section label="Step 3 — what would have happened">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Period return"
            value={result ? PCT_SIGN(result.periodReturn) : '—'}
            detail={result ? `Over ${result.months} months · ${DATA[s.pair].short}` : 'Pick a period'}
            tone={result ? (result.periodReturn >= 0 ? 'positive' : 'negative') : 'neutral'}
            highlight
          />
          <StatCard
            label="Annualized"
            value={result ? PCT_SIGN(result.annualized) : '—'}
            detail="Scaled to 1 year"
            tone={result ? (result.annualized >= 0 ? 'positive' : 'negative') : 'neutral'}
          />
          <StatCard
            label="Net P&L"
            value={result ? USD(result.totalNet) : '—'}
            detail={result ? `Premium ${USD(result.cumulativePremium)} − payouts ${USD(result.cumulativePayouts)}` : 'Over period'}
            tone={result ? (result.totalNet >= 0 ? 'positive' : 'negative') : 'neutral'}
          />
          <StatCard
            label="Trigger rate"
            value={result ? PCT(result.triggerRate) : '—'}
            detail={result ? `${NUM.format(result.triggers)} of ${NUM.format(result.totalEvents)}` : 'Events triggered'}
          />
        </div>
        <div className="mt-4 text-[13px] text-[#001F5C] bg-[#EDF1F8] border-l-[3px] border-[#0047BB] rounded-r-md py-2.5 px-3.5 leading-relaxed">
          <span dangerouslySetInnerHTML={{ __html: insight.msg.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
        </div>
      </Section>

      {/* Rate chart */}
      <Section label="Currency path during your period">
        <div className="flex flex-wrap gap-3 text-xs text-gray-600 mb-2">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#001F5C]" /> Rate</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ borderTop: '1px dashed rgba(208,58,44,0.7)' }} /> Range bounds</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-red-600 rotate-45" /> Triggers</span>
        </div>
        <div className="w-full h-72 sm:h-80">
          <ResponsiveContainer>
            <ComposedChart data={rateChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#5C6470' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#5C6470' }} domain={['auto', 'auto']} tickFormatter={fmtRate} width={50} />
              <Tooltip formatter={(v: any) => (typeof v === 'number' ? fmtRate(v) : v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Line type="monotone" dataKey="upper" stroke="rgba(208,58,44,0.5)" strokeWidth={1} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="lower" stroke="rgba(208,58,44,0.5)" strokeWidth={1} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="rate" stroke="#001F5C" strokeWidth={2} dot={{ r: 3, fill: '#001F5C' }} isAnimationActive={false} />
              <Scatter dataKey="trigger" fill="#D03A2C" shape="diamond" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* P&L chart */}
      <Section label="Your monthly P&L">
        <div className="flex flex-wrap gap-3 text-xs text-gray-600 mb-2">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-emerald-700/70 rounded-sm" /> Premium earned</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-red-600/70 rounded-sm" /> Payouts to hedgers</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#001F5C]" /> Cumulative capital</span>
        </div>
        <div className="w-full h-80 sm:h-96">
          <ResponsiveContainer>
            <ComposedChart data={pnlChartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="rgba(0,0,0,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#5C6470' }} interval="preserveStartEnd" />
              <YAxis yAxisId="pnl" tick={{ fontSize: 10, fill: '#5C6470' }} tickFormatter={(v) => `$${NUM.format(v)}`} width={60} />
              <YAxis yAxisId="cum" orientation="right" tick={{ fontSize: 10, fill: '#5C6470' }} tickFormatter={(v) => `$${NUM.format(v)}`} width={60} />
              <Tooltip formatter={(v: any) => (typeof v === 'number' ? USD(v) : v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <ReferenceLine y={0} yAxisId="pnl" stroke="#cbd5e1" />
              <Bar yAxisId="pnl" dataKey="premium" fill="rgba(27,122,62,0.7)" stroke="#1B7A3E" />
              <Bar yAxisId="pnl" dataKey="payouts" fill="rgba(208,58,44,0.7)" stroke="#D03A2C" />
              <Line yAxisId="cum" type="monotone" dataKey="cumCapital" stroke="#001F5C" strokeWidth={2} dot={{ r: 2, fill: '#001F5C' }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* Monthly table */}
      <Section label="Monthly breakdown">
        <div className="overflow-x-auto -mx-2 sm:mx-0">
          <table className="w-full text-xs sm:text-[13px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.05em] text-gray-500 border-b border-gray-300">
                <th className="text-left py-2 pl-2 sm:pl-0 font-medium">Month</th>
                <th className="text-right py-2 font-medium">Rate</th>
                <th className="text-right py-2 font-medium">Change</th>
                <th className="text-right py-2 font-medium hidden sm:table-cell">Events</th>
                <th className="text-right py-2 font-medium hidden sm:table-cell">Triggers</th>
                <th className="text-right py-2 font-medium">Premium</th>
                <th className="text-right py-2 font-medium">Payouts</th>
                <th className="text-right py-2 pr-2 sm:pr-0 font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {result?.monthly.map((m) => (
                <tr key={m.period} className="border-b border-gray-100">
                  <td className="text-left py-2 pl-2 sm:pl-0">{m.label}</td>
                  <td className="text-right py-2 font-mono-data">{fmtRate(m.rate)}</td>
                  <td className={`text-right py-2 font-mono-data ${m.pctChange >= 0 ? 'text-red-600' : 'text-emerald-700'}`}>{PCT_SIGN(m.pctChange)}</td>
                  <td className="text-right py-2 hidden sm:table-cell font-mono-data">{NUM.format(m.events)}</td>
                  <td className="text-right py-2 hidden sm:table-cell font-mono-data">{NUM.format(m.triggers)}</td>
                  <td className="text-right py-2 font-mono-data">{USD(m.premium)}</td>
                  <td className={`text-right py-2 font-mono-data ${m.payouts > 0 ? 'text-red-600' : ''}`}>
                    {m.payouts > 0 ? USD(-m.payouts) : '—'}
                  </td>
                  <td className={`text-right py-2 pr-2 sm:pr-0 font-mono-data font-semibold ${m.net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{USD(m.net)}</td>
                </tr>
              ))}
              {result && (
                <tr className="border-t border-gray-300 font-semibold">
                  <td className="text-left py-2.5 pl-2 sm:pl-0">Total</td>
                  <td colSpan={2}></td>
                  <td className="text-right py-2.5 hidden sm:table-cell font-mono-data">{NUM.format(result.totalEvents)}</td>
                  <td className="text-right py-2.5 hidden sm:table-cell font-mono-data">{NUM.format(result.triggers)}</td>
                  <td className="text-right py-2.5 font-mono-data">{USD(result.cumulativePremium)}</td>
                  <td className="text-right py-2.5 font-mono-data text-red-600">{USD(-result.cumulativePayouts)}</td>
                  <td className={`text-right py-2.5 pr-2 sm:pr-0 font-mono-data ${result.totalNet >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{USD(result.totalNet)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────

export default function LiquidityProviderPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-[#FAFBFC]">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-gray-200/80">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <button
            onClick={() => setLocation('/')}
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors -ml-1 px-1.5 py-1 rounded-md"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back</span>
          </button>
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <img src={logoPath} alt="BlockFinaX" className="h-6 w-6 object-contain" />
              <span className="text-sm font-medium tracking-tight text-gray-900">BlockFinaX</span>
            </div>
          </Link>
          <Link href="/apply">
            <Button size="sm" className="h-9 rounded-full bg-gray-900 text-white hover:bg-gray-800 text-xs">
              Apply for access
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 pb-16">
        <div className="mb-6 sm:mb-8">
          <p className="text-[11px] uppercase tracking-[0.12em] text-[#0047BB] font-medium mb-2">Workbench</p>
          <h1 className="text-3xl sm:text-4xl lg:text-[44px] font-semibold tracking-tight text-gray-900 leading-[1.1]">
            Liquidity provider
          </h1>
          <p className="mt-3 text-sm sm:text-base text-gray-600 max-w-2xl leading-relaxed">
            Underwrite emerging-market FX risk for premium income. Backtest your terms against
            real history. Read what kind of capital partner this is — and isn't — before you
            commit.
          </p>
        </div>

        <Tabs defaultValue="backtest" className="space-y-4">
          <TabsList className="bg-white border border-gray-200 rounded-xl h-auto p-1 flex w-full sm:w-auto sm:inline-flex">
            <TabsTrigger value="backtest" className="rounded-lg flex-1 sm:flex-none data-[state=active]:bg-[#001F5C] data-[state=active]:text-white px-4 py-2 text-sm">
              Backtest
            </TabsTrigger>
            <TabsTrigger value="learn" className="rounded-lg flex-1 sm:flex-none data-[state=active]:bg-[#001F5C] data-[state=active]:text-white px-4 py-2 text-sm">
              How it works
            </TabsTrigger>
            <TabsTrigger value="currencies" className="rounded-lg flex-1 sm:flex-none data-[state=active]:bg-[#001F5C] data-[state=active]:text-white px-4 py-2 text-sm">
              Currencies
            </TabsTrigger>
          </TabsList>
          <TabsContent value="backtest" className="mt-4 space-y-4">
            <BacktestTab />
          </TabsContent>
          <TabsContent value="learn" className="mt-4">
            <HowItWorksTab />
          </TabsContent>
          <TabsContent value="currencies" className="mt-4">
            <CurrencyReferenceTab />
          </TabsContent>
        </Tabs>

        <footer className="mt-12 pt-6 border-t border-gray-200 text-center text-[11px] text-gray-500 leading-relaxed">
          <p>BlockFinaX · Liquidity provider workbench</p>
          <p className="mt-1">
            Exchange-rate data sourced from public end-of-month publications. Educational and
            illustrative. Not investment advice. Not an offer of securities.
          </p>
        </footer>
      </main>
    </div>
  );
}
