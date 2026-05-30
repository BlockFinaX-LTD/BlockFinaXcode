/**
 * hedger.tsx — Hedger workbench.
 *
 * Responsive React port of the standalone hedger HTML tool. Same simulation
 * model, same FX history, same presets, same explanatory content — rebuilt
 * as a real component with Recharts and the rest of the app's design
 * system. Mobile-first, no external script tags.
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
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Scatter,
} from 'recharts';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import logoPath from '@/assets/logo.png';

// ── Data ────────────────────────────────────────────────────────────────

interface CurrencyData {
  label: string;
  short: string;
  name: string;
  decimals: number;
  rates: Record<string, number>;
  recommended: { premium: number; range: number; cap: number };
}

const DATA: Record<string, CurrencyData> = {
  ghs: {
    label: 'USD / GHS — Ghana cedi', short: 'GHS', name: 'Ghana cedi', decimals: 2,
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
    recommended: { premium: 2.5, range: 8, cap: 4.5 },
  },
  ngn: {
    label: 'USD / NGN — Nigerian naira', short: 'NGN', name: 'Nigerian naira', decimals: 0,
    rates: {
      '2018-12': 364, '2019-12': 364, '2020-06': 386, '2020-12': 394,
      '2021-06': 411, '2021-12': 415, '2022-06': 415, '2022-12': 460,
      '2023-03': 461, '2023-06': 770, '2023-09': 770, '2023-12': 899,
      '2024-03': 1450, '2024-06': 1485, '2024-09': 1675, '2024-12': 1535,
      '2025-03': 1530, '2025-06': 1530, '2025-09': 1490, '2025-12': 1460,
      '2026-03': 1380, '2026-05': 1378,
    },
    recommended: { premium: 4.0, range: 12, cap: 7 },
  },
  kes: {
    label: 'USD / KES — Kenya shilling', short: 'KES', name: 'Kenya shilling', decimals: 2,
    rates: {
      '2018-12': 101.85, '2019-12': 101.27, '2020-06': 106.50, '2020-12': 109.20,
      '2021-06': 107.85, '2021-12': 113.13, '2022-06': 117.85, '2022-12': 123.39,
      '2023-03': 132.66, '2023-06': 140.27, '2023-09': 148.07, '2023-12': 157.00,
      '2024-03': 131.18, '2024-06': 128.50, '2024-09': 128.92, '2024-12': 129.50,
      '2025-03': 129.20, '2025-06': 129.30, '2025-09': 129.05, '2025-12': 129.10,
      '2026-03': 129.20, '2026-05': 129.35,
    },
    recommended: { premium: 1.5, range: 6, cap: 3 },
  },
  etb: {
    label: 'USD / ETB — Ethiopian birr', short: 'ETB', name: 'Ethiopian birr', decimals: 1,
    rates: {
      '2018-12': 28.07, '2019-12': 31.84, '2020-06': 34.50, '2020-12': 39.66,
      '2021-06': 43.55, '2021-12': 49.50, '2022-06': 51.92, '2022-12': 53.40,
      '2023-06': 54.55, '2023-12': 55.95, '2024-03': 56.50, '2024-06': 57.30,
      '2024-09': 122.5, '2024-12': 127.05, '2025-03': 132.0, '2025-06': 136.5,
      '2025-09': 141.8, '2025-12': 146.5, '2026-03': 157.0, '2026-05': 156.5,
    },
    recommended: { premium: 5.0, range: 15, cap: 10 },
  },
  egp: {
    label: 'USD / EGP — Egyptian pound', short: 'EGP', name: 'Egyptian pound', decimals: 2,
    rates: {
      '2018-12': 17.93, '2019-12': 16.07, '2020-12': 15.66, '2021-12': 15.71,
      '2022-03': 18.30, '2022-06': 18.66, '2022-09': 19.32, '2022-12': 24.70,
      '2023-03': 30.83, '2023-06': 30.85, '2023-09': 30.85, '2023-12': 30.93,
      '2024-03': 47.42, '2024-06': 48.05, '2024-09': 49.10, '2024-12': 50.83,
      '2025-03': 50.50, '2025-06': 49.65, '2025-09': 48.20, '2025-12': 50.70,
      '2026-03': 52.80, '2026-05': 52.25,
    },
    recommended: { premium: 3.5, range: 10, cap: 6 },
  },
  zar: {
    label: 'USD / ZAR — South African rand', short: 'ZAR', name: 'South African rand', decimals: 2,
    rates: {
      '2018-12': 14.36, '2019-12': 14.04, '2020-06': 17.33, '2020-12': 14.62,
      '2021-06': 14.27, '2021-12': 15.95, '2022-06': 16.27, '2022-12': 17.04,
      '2023-06': 18.83, '2023-12': 18.42, '2024-06': 18.20, '2024-12': 18.91,
      '2025-06': 17.90, '2025-12': 16.57, '2026-03': 16.30, '2026-05': 16.39,
    },
    recommended: { premium: 2.0, range: 7, cap: 4 },
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
}

const PRESETS: Preset[] = [
  { label: 'Cedi 2022–2023', pair: 'ghs', start: '2022-03', end: '2023-12' },
  { label: 'Naira 2023–2024', pair: 'ngn', start: '2023-06', end: '2024-12' },
  { label: 'EGP 2022–2024', pair: 'egp', start: '2022-03', end: '2024-12' },
  { label: 'ETB 2024 float', pair: 'etb', start: '2024-03', end: '2025-12' },
  { label: 'Cedi 2020–2021', pair: 'ghs', start: '2020-03', end: '2021-12' },
  { label: 'Shilling 2022–2023', pair: 'kes', start: '2022-03', end: '2023-12' },
];

// ── Formatting ──────────────────────────────────────────────────────────

const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const NUM2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const USD = (v: number) => {
  if (Math.abs(v) < 1000 && v !== 0) return (v < 0 ? '-' : '') + '$' + NUM2.format(Math.abs(v));
  return (v < 0 ? '-' : '') + '$' + NUM.format(Math.round(Math.abs(v)));
};
const PCT_SIGN = (v: number) => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';

// ── Simulation ──────────────────────────────────────────────────────────

interface HedgerState {
  notional: number;
  pair: string;
  start: string;
  end: string;
  tenor: number;
  premium: number;
  range: number;
  cap: number;
}

interface MonthlyRow {
  period: string;
  label: string;
  rate: number;
  pctChange: number;
  premium: number;
  triggered: boolean;
  payout: number;
  net: number;
  unprotectedLoss: number;
}

interface SimulationResult {
  series: { period: string; rate: number; label: string }[];
  monthly: MonthlyRow[];
  totalPremium: number;
  totalPayouts: number;
  netValue: number;
  triggers: number;
  months: number;
  triggerRate: number;
  totalRateChange: number;
  totalUnprotectedLoss: number;
}

function runSimulation(s: HedgerState): SimulationResult | null {
  const data = DATA[s.pair].rates;
  const periods = Object.keys(data).sort();
  const startIdx = periods.indexOf(s.start);
  const endIdx = periods.indexOf(s.end);
  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) return null;

  const series = periods.slice(startIdx, endIdx + 1).map((p) => ({
    period: p,
    rate: data[p],
    label: periodLabel(p),
  }));

  const premiumRate = s.premium / 100;
  const rangePct = s.range / 100;
  const capPct = s.cap / 100;

  let totalPremium = 0;
  let totalPayouts = 0;
  let totalUnprotectedLoss = 0;
  let triggers = 0;
  const monthly: MonthlyRow[] = [];

  for (let i = 0; i < series.length - 1; i++) {
    const startRate = series[i].rate;
    const endRate = series[i + 1].rate;
    const pctChange = (endRate - startRate) / startRate;
    const premium = s.notional * premiumRate;
    totalPremium += premium;
    let payout = 0;
    let triggered = false;
    if (Math.abs(pctChange) > rangePct) {
      triggered = true;
      triggers += 1;
      payout = s.notional * capPct;
      totalPayouts += payout;
    }
    // Unprotected loss: adverse moves only (importer paying USD = local weakens).
    const unprotectedLoss = pctChange > 0 ? s.notional * pctChange : 0;
    totalUnprotectedLoss += unprotectedLoss;
    monthly.push({
      period: series[i + 1].period,
      label: series[i + 1].label,
      rate: endRate,
      pctChange,
      premium,
      triggered,
      payout,
      net: payout - premium,
      unprotectedLoss,
    });
  }

  const netValue = totalPayouts - totalPremium;
  const months = series.length - 1;
  const triggerRate = months > 0 ? triggers / months : 0;
  const totalRateChange = (series[series.length - 1].rate - series[0].rate) / series[0].rate;

  return {
    series, monthly,
    totalPremium, totalPayouts, netValue,
    triggers, months, triggerRate, totalRateChange, totalUnprotectedLoss,
  };
}

// ── UI primitives ───────────────────────────────────────────────────────

function Section({ label, children, className = '' }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-white border border-gray-200/80 rounded-2xl p-4 sm:p-6 ${className}`}>
      {label && (
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#0047BB] mb-4">{label}</p>
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
    tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-red-600' : 'text-gray-900';
  return (
    <div className={`rounded-xl p-4 ${highlight ? 'bg-[#EDF1F8] border-2 border-[#0047BB]' : 'bg-gray-50 border border-transparent'}`}>
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">{label}</p>
      <p className={`text-2xl sm:text-[26px] font-semibold tracking-tight mt-2 ${valueColor} font-mono-data`}>{value}</p>
      {detail && <p className="text-xs text-gray-500 mt-1">{detail}</p>}
    </div>
  );
}

function SliderRow({
  label, value, display, onChange, min, max, step,
}: {
  label: string; value: number; display: string;
  onChange: (v: number) => void; min: number; max: number; step: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-gray-600">{label}</span>
        <span className="text-[13px] font-semibold text-[#001F5C] font-mono-data">{display}</span>
      </div>
      <Slider value={[value]} onValueChange={(v) => onChange(v[0])} min={min} max={max} step={step} className="touch-pan-y" />
    </div>
  );
}

function ExampleBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3.5 mt-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0047BB] mb-1.5">{label}</p>
      <p className="text-[13px] text-gray-700 leading-relaxed">{children}</p>
    </div>
  );
}

function Lesson({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-[#0047BB] text-white text-xs font-bold">{n}</span>
        <h3 className="text-[15px] font-semibold text-[#001F5C]">{title}</h3>
      </div>
      <div className="pl-8 space-y-2">{children}</div>
    </div>
  );
}

// ── Simulate tab ────────────────────────────────────────────────────────

function SimulateTab() {
  const [s, setS] = useState<HedgerState>({
    notional: 50000,
    pair: 'ghs',
    start: '2022-03',
    end: '2023-12',
    tenor: 30,
    premium: 2.5,
    range: 8,
    cap: 4.5,
  });
  const [notionalInput, setNotionalInput] = useState(String(s.notional));

  const periodsForPair = useMemo(() => Object.keys(DATA[s.pair].rates).sort(), [s.pair]);
  const result = useMemo(() => runSimulation(s), [s]);

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

  const onNotionalChange = (raw: string) => {
    setNotionalInput(raw);
    const v = parseFloat(raw);
    if (!isNaN(v) && v >= 100) setS((prev) => ({ ...prev, notional: v }));
  };

  const setNotional = (v: number) => {
    setS((prev) => ({ ...prev, notional: v }));
    setNotionalInput(String(v));
  };

  const insight = useMemo(() => {
    if (!result) return 'Pick a valid period (end must be after start).';
    const direction = result.totalRateChange >= 0 ? 'weakened' : 'strengthened';
    const directionPct = Math.abs(result.totalRateChange * 100).toFixed(1);
    const short = DATA[s.pair].short;
    let msg = `Over this period, the **${short}** ${direction} **${directionPct}%**. `;
    if (result.netValue > 0 && result.totalUnprotectedLoss > result.totalPremium) {
      msg += `Protection would have netted you ${USD(result.netValue)} on this trade — payouts of ${USD(result.totalPayouts)} against ${USD(result.totalPremium)} in premium. You absorbed ${USD(result.totalUnprotectedLoss)} of FX loss going unprotected. Protection would have flipped that into a gain.`;
    } else if (result.netValue > 0) {
      msg += `Protection would have paid out and put you ahead. The bigger value, though, was certainty — knowing your maximum FX exposure when you set the price.`;
    } else if (result.totalUnprotectedLoss > result.totalPremium * 2) {
      msg += `Premium of ${USD(result.totalPremium)} would have shielded you from a ${USD(result.totalUnprotectedLoss)} FX loss. The bounded payouts kept the cost predictable while covering most of the move.`;
    } else if (result.totalUnprotectedLoss > 0) {
      msg += `You absorbed ${USD(result.totalUnprotectedLoss)} in FX loss on this trade. Premium of ${USD(result.totalPremium)} would have held that exposure to a known number.`;
    } else {
      msg += `The rate moved in your favor or barely moved. Premium would have been the cost of certainty — you'd have known your max exposure when you set prices.`;
    }
    return msg;
  }, [result, s.pair]);

  const pairDecimals = DATA[s.pair].decimals;
  const fmtRate = (v: number) => v.toFixed(pairDecimals);

  // Rate chart data: rate path, range bounds (relative to previous month's rate),
  // and trigger markers where the band was breached.
  const rateChartData = useMemo(() => {
    if (!result) return [];
    return result.series.map((p, i) => {
      const prevRate = i === 0 ? p.rate : result.series[i - 1].rate;
      const upper = prevRate * (1 + s.range / 100);
      const lower = prevRate * (1 - s.range / 100);
      const change = i === 0 ? 0 : Math.abs((p.rate - prevRate) / prevRate);
      const triggered = change > s.range / 100;
      return {
        label: p.label.replace(' 20', " '").replace(' 19', " '"),
        rate: p.rate,
        upper,
        lower,
        trigger: triggered ? p.rate : null,
      };
    });
  }, [result, s.range]);

  return (
    <div className="space-y-4">
      {/* Explainer */}
      <div className="bg-gradient-to-b from-[#EDF1F8] to-white border border-gray-200/80 rounded-2xl p-5 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight">
          Replay your trade. See what protection would have changed.
        </h2>
        <p className="text-sm text-gray-700 mt-2 leading-relaxed">
          If you imported goods, paid a foreign supplier, or transferred money
          abroad recently, you already paid for FX volatility through your
          margin. This tool replays the rate path and shows you the trade three
          ways: what protection would have cost, what payouts you would have
          received, and what loss you absorbed without it.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          {[
            ['1', 'You had a payment to make', '$50K due to a supplier in 30 days. Cedi rate was 11.00 when you set the price.'],
            ['2', 'You could have bought protection', 'Paying 2.5% of $50K ($1,250) protects against the rate moving more than 8% in 30 days.'],
            ['3', 'If the rate had held', 'Your costs would have landed where you planned. The premium was the cost of certainty.'],
            ['4', 'If the rate broke', 'When the cedi dropped 15%, the 4.5% capped payout ($2,250) offsets a big share of the FX loss.'],
          ].map(([n, title, body]) => (
            <div key={n} className="bg-white border border-gray-200/80 rounded-xl p-3.5">
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-[#0047BB] text-white text-[11px] font-bold">{n}</span>
              <p className="text-[13px] font-semibold text-[#001F5C] mt-2">{title}</p>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Step 1 — trade */}
      <Section label="Step 1 — your trade">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-gray-600">Your payment amount</p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <Input
                type="number"
                value={notionalInput}
                onChange={(e) => onNotionalChange(e.target.value)}
                onBlur={() => {
                  const v = parseFloat(notionalInput);
                  if (isNaN(v) || v < 100) setNotional(100);
                }}
                className="h-10 pl-7 rounded-lg border-gray-200 font-mono-data"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {[1000, 5000, 10000, 25000, 50000, 100000, 500000].map((v) => (
                <button
                  key={v}
                  onClick={() => setNotional(v)}
                  className="px-2.5 py-1 rounded-full text-[11px] bg-gray-100 text-gray-700 hover:bg-[#EDF1F8] hover:text-[#001F5C] border border-gray-200 transition-colors"
                >
                  ${v >= 1000000 ? `${v / 1000000}M` : v >= 1000 ? `${v / 1000}K` : v}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-gray-600">Currency pair</p>
            <Select value={s.pair} onValueChange={onPairChange}>
              <SelectTrigger className="h-10 rounded-lg border-gray-200"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAIRS.map((p) => <SelectItem key={p} value={p}>{DATA[p].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <SliderRow
            label="Days you needed to wait for payment"
            value={s.tenor}
            display={String(s.tenor)}
            onChange={(v) => setS((p) => ({ ...p, tenor: v }))}
            min={14} max={90} step={1}
          />
        </div>
      </Section>

      {/* Step 2 — when */}
      <Section label="Step 2 — when did this happen">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-gray-600">Start date</p>
            <Select value={s.start} onValueChange={(v) => setS((p) => ({ ...p, start: v }))}>
              <SelectTrigger className="h-10 rounded-lg border-gray-200"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {periodsForPair.map((p) => <SelectItem key={p} value={p}>{periodLabel(p)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-gray-600">End date</p>
            <Select value={s.end} onValueChange={(v) => setS((p) => ({ ...p, end: v }))}>
              <SelectTrigger className="h-10 rounded-lg border-gray-200"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {periodsForPair.map((p) => <SelectItem key={p} value={p}>{periodLabel(p)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-4 mb-2">
          Or replay a real historical window:
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 bg-gray-50 text-gray-700 hover:bg-[#EDF1F8] hover:border-[#0047BB] hover:text-[#001F5C] transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Step 3 — terms */}
      <Section label="Step 3 — protection terms">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
          <SliderRow
            label="Premium offered"
            value={s.premium}
            display={`${s.premium.toFixed(1)}%`}
            onChange={(v) => setS((p) => ({ ...p, premium: v }))}
            min={0.5} max={8} step={0.1}
          />
          <SliderRow
            label="Protection band"
            value={s.range}
            display={`${s.range.toFixed(1)}%`}
            onChange={(v) => setS((p) => ({ ...p, range: v }))}
            min={2} max={25} step={0.5}
          />
          <SliderRow
            label="Maximum payout (cap)"
            value={s.cap}
            display={`${s.cap.toFixed(1)}%`}
            onChange={(v) => setS((p) => ({ ...p, cap: v }))}
            min={1} max={15} step={0.5}
          />
        </div>
      </Section>

      {/* Step 4 — results */}
      <Section label="Step 4 — what protection would have changed">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Net of protection"
            value={result ? USD(result.netValue) : '—'}
            detail={result ? (result.netValue >= 0 ? 'Payouts exceeded premium' : 'Premium bought certainty') : 'Pick a period'}
            tone={result ? (result.netValue >= 0 ? 'positive' : 'negative') : 'neutral'}
            highlight
          />
          <StatCard
            label="Premium you'd have paid"
            value={result ? USD(result.totalPremium) : '—'}
            detail="Total cost of protection"
          />
          <StatCard
            label="Payouts you'd have received"
            value={result ? USD(result.totalPayouts) : '—'}
            detail={result ? `${result.triggers} of ${result.months} months triggered` : 'When band broke'}
          />
          <StatCard
            label="Loss without protection"
            value={result ? USD(-result.totalUnprotectedLoss) : '—'}
            detail="What flowed through margin"
            tone={result && result.totalUnprotectedLoss > 0 ? 'negative' : 'neutral'}
          />
        </div>
        <div className="mt-4 text-[13px] text-[#001F5C] bg-[#EDF1F8] border-l-[3px] border-[#0047BB] rounded-r-md py-2.5 px-3.5 leading-relaxed">
          <span dangerouslySetInnerHTML={{ __html: insight.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
        </div>
      </Section>

      {/* Rate chart */}
      <Section label="Currency path during your period">
        <div className="flex flex-wrap gap-3 text-xs text-gray-600 mb-2">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#001F5C]" /> Rate</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ borderTop: '1px dashed rgba(208,58,44,0.7)' }} /> Protection band</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 bg-red-600 rotate-45" /> Months when triggered</span>
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

      {/* Monthly table */}
      <Section label="Monthly breakdown">
        <div className="overflow-x-auto -mx-2 sm:mx-0">
          <table className="w-full text-xs sm:text-[13px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.05em] text-gray-500 border-b border-gray-300">
                <th className="text-left py-2 pl-2 sm:pl-0 font-medium">Month</th>
                <th className="text-right py-2 font-medium">Rate</th>
                <th className="text-right py-2 font-medium">Change</th>
                <th className="text-right py-2 font-medium">Premium</th>
                <th className="text-right py-2 font-medium hidden sm:table-cell">Triggered?</th>
                <th className="text-right py-2 font-medium">Payout</th>
                <th className="text-right py-2 pr-2 sm:pr-0 font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {result?.monthly.map((m) => (
                <tr key={m.period} className={`border-b border-gray-100 ${m.triggered ? 'bg-emerald-50/40' : ''}`}>
                  <td className="text-left py-2 pl-2 sm:pl-0">{m.label}</td>
                  <td className="text-right py-2 font-mono-data">{fmtRate(m.rate)}</td>
                  <td className={`text-right py-2 font-mono-data ${m.pctChange >= 0 ? 'text-red-600' : 'text-emerald-700'}`}>{PCT_SIGN(m.pctChange)}</td>
                  <td className="text-right py-2 font-mono-data">{USD(-m.premium)}</td>
                  <td className="text-right py-2 hidden sm:table-cell font-mono-data">{m.triggered ? <span className="text-emerald-700 font-semibold">yes</span> : <span className="text-gray-400">—</span>}</td>
                  <td className={`text-right py-2 font-mono-data ${m.payout > 0 ? 'text-emerald-700' : ''}`}>{m.payout > 0 ? USD(m.payout) : '—'}</td>
                  <td className={`text-right py-2 pr-2 sm:pr-0 font-mono-data font-semibold ${m.net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{USD(m.net)}</td>
                </tr>
              ))}
              {result && (
                <tr className="border-t border-gray-300 font-semibold">
                  <td className="text-left py-2.5 pl-2 sm:pl-0">Total</td>
                  <td colSpan={2}></td>
                  <td className="text-right py-2.5 font-mono-data">{USD(-result.totalPremium)}</td>
                  <td className="text-right py-2.5 hidden sm:table-cell font-mono-data">{result.triggers} / {result.months}</td>
                  <td className="text-right py-2.5 font-mono-data text-emerald-700">{USD(result.totalPayouts)}</td>
                  <td className={`text-right py-2.5 pr-2 sm:pr-0 font-mono-data ${result.netValue >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{USD(result.netValue)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

// ── Learn tab ───────────────────────────────────────────────────────────

function LearnTab() {
  return (
    <div className="space-y-4">
      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-3">
          Why protect cross-border payments
        </h2>
        <p className="text-sm text-gray-700 mb-3 leading-relaxed">
          If you import goods, pay foreign suppliers, send money abroad for
          education or property, or run a business that earns in local currency
          and spends in dollars, the exchange rate at settlement is rarely the
          rate you planned around. The gap between those two rates flows directly
          through your business — into your margin, into your customer pricing,
          into your cash flow planning.
        </p>
        <p className="text-sm text-gray-700 mb-3 leading-relaxed">
          African currencies are particularly active. Between 2022 and 2023 the
          cedi moved roughly 90% in 18 months. Parametric protection turns that
          movement from an unknown into a planned number — a small, predictable
          premium in exchange for a bounded outcome regardless of which way the
          rate goes.
        </p>
        <p className="text-sm text-gray-700 leading-relaxed">
          Bank forwards do something similar but are out of reach for most SMEs:
          they need credit lines, large minimum sizes, and active relationships
          with the FX desk. Parametric protection works for any size from $1K,
          settles instantly, and doesn't require a banking relationship.
        </p>
      </Section>

      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-4">
          How parametric protection works
        </h2>
        <div className="space-y-5">
          <Lesson n={1} title="You define what you need protected">
            <p className="text-sm text-gray-700">
              Tell the protocol: "I have a $50,000 payment due in 30 days." That
              defines your notional and tenor. The protocol then offers protection
              terms — a premium price, a range, and a cap.
            </p>
          </Lesson>
          <Lesson n={2} title="You pay a premium upfront for certainty">
            <p className="text-sm text-gray-700">
              The premium is a percentage of your notional — typically 1.5% to 5%
              depending on the currency. For a $50,000 hedge at 2.5%, you pay
              $1,250 today.
            </p>
            <p className="text-sm text-gray-700">
              That premium buys the protection. From the moment you pay it, you
              know your maximum exposure for the protection period — no
              surprises, no margin calls, no calendar anxiety.
            </p>
          </Lesson>
          <Lesson n={3} title="The rate either moves or doesn't">
            <p className="text-sm text-gray-700">
              If the rate stays inside the agreed band (e.g., within 8% of the
              starting rate), your exposure held flat. If the rate exits the
              band, protection pays out — bounded by the cap.
            </p>
          </Lesson>
          <Lesson n={4} title="Payout structure: bounded and predictable">
            <p className="text-sm text-gray-700">
              Parametric means automatic. There's no claims process, no
              adjuster, no negotiation. The cap bounds the maximum payout — a
              4.5% cap on $50,000 = $2,250 maximum, regardless of how far the
              rate moves.
            </p>
          </Lesson>
        </div>
      </Section>

      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-3">
          Parametric protection vs bank forwards
        </h2>
        <ExampleBox label="Comparison">
          <strong>Bank forwards:</strong> Lock a future rate today. Full coverage of any
          move but requires credit lines, minimums typically $100K+, takes days to set up,
          and banks may decline volatile pairs entirely.
          <br /><br />
          <strong>Parametric protection:</strong> Pay premium upfront, receive bounded
          protection. Available from $1K, instant setup, no credit line needed, works for
          currencies banks won't quote. The cap means a 30% move and a 10% move can result
          in the same payout — much lower cost in exchange.
        </ExampleBox>
        <p className="text-sm text-gray-700 mt-3 leading-relaxed">
          Different tools for different jobs. Forwards are the right answer
          when you can get them and need full coverage. Parametric is the right
          answer when you need speed, smaller sizes, broader currency coverage,
          or simply don't have the credit relationship to access forwards.
        </p>
      </Section>
    </div>
  );
}

// ── Use cases tab ───────────────────────────────────────────────────────

function UseCasesTab() {
  const [openQa, setOpenQa] = useState<number | null>(null);
  const qa = [
    {
      q: 'What if the rate moves a lot — am I fully covered?',
      a: 'Parametric protection has a payout cap. If the cap is 4.5% and the rate moves 20%, you receive a payout covering 4.5% of your notional. The cap keeps protection affordable and broadly available, even for volatile currencies. For full coverage of any move, bank forwards are the right tool — when you can access them.',
    },
    {
      q: 'Why is the premium higher for some currencies?',
      a: 'Premium reflects the underlying volatility. The Ethiopian birr after the July 2024 float regularly moves 10%+ per month — protection costs more than on the rand, which moves 2–3% per month.',
    },
    {
      q: 'How fast can I get protection?',
      a: 'Instant. No underwriting interview, no credit check. You pick your notional, your terms, you pay the premium, and the protection is live. One of the biggest differences from bank forwards.',
    },
    {
      q: 'What happens at expiry — do I need to do anything?',
      a: 'No. Settlement is automatic. If the rate breaches the band by expiry, the payout is sent to your wallet. If the rate stays inside, the protection simply expires.',
    },
    {
      q: 'Can I buy protection for any currency?',
      a: 'BlockFinaX currently supports USD/GHS, USD/NGN, USD/KES, USD/ETB, USD/EGP, and USD/ZAR. Additional pairs roll out based on validated SME demand. If your corridor isn\'t listed, get in touch.',
    },
  ];

  return (
    <div className="space-y-4">
      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-3">
          Who uses parametric FX protection?
        </h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          Anyone with a future foreign-currency exposure they can't fully pass
          through to their customers. The most common users on BlockFinaX are
          SME importers and exporters, foreign-school payers, and businesses
          serving cross-border supply chains. Each one uses protection slightly
          differently.
        </p>
      </Section>

      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-4">
          Common use cases
        </h2>
        <div className="space-y-5">
          <Lesson n={1} title="Importer paying a foreign supplier">
            <p className="text-sm text-gray-700">
              A Ghanaian electronics importer agrees to buy $40,000 of inventory
              from a Shenzhen supplier with 60-day payment terms. They quote
              their retail customers in cedi based on today's rate.
            </p>
            <p className="text-sm text-gray-700">
              Protection of 2.5% premium ($1,000) covers a 60-day window with up
              to 4.5% payout. If the cedi weakens more than 8% during those 60
              days, the payout offsets a meaningful share of the FX move.
            </p>
          </Lesson>
          <Lesson n={2} title="Exporter waiting on a foreign receivable">
            <p className="text-sm text-gray-700">
              A Ghanaian cocoa exporter ships $80,000 of beans to a European
              buyer. Payment arrives 90 days after shipment. Their costs were in
              cedi; their revenue is in dollars.
            </p>
            <p className="text-sm text-gray-700">
              If the cedi strengthens during those 90 days, the exporter
              receives fewer cedis from the same dollar receivable. Protection in
              the opposite direction caps that exposure.
            </p>
          </Lesson>
          <Lesson n={3} title="Cross-border education payments">
            <p className="text-sm text-gray-700">
              A family in Lagos sends a child to university in London. Annual
              tuition is £15,000 paid in two installments. They want to know
              what each installment will cost in naira before they commit.
            </p>
            <p className="text-sm text-gray-700">
              Protection for each installment locks the maximum naira exposure
              for a defined window. Less stress, easier budgeting, no surprises
              when the payment date arrives.
            </p>
          </Lesson>
          <Lesson n={4} title="Project deposit on imported equipment">
            <p className="text-sm text-gray-700">
              A Nigerian agribusiness puts down a $200,000 deposit on imported
              equipment with delivery in 6 months. They've quoted their bank
              financing based on today's exchange rate.
            </p>
            <p className="text-sm text-gray-700">
              Rolling 60-day protections through the delivery window keep the FX
              exposure bounded across the project.
            </p>
          </Lesson>
        </div>
      </Section>

      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-3">
          Practical guidelines
        </h2>
        <ul className="list-disc pl-5 space-y-2">
          {[
            ['Match your protection tenor to your payment window.', 'If you pay in 45 days, use 60-day protection. A buffer of a couple of weeks for shipping or invoice timing.'],
            ['Protect on the obligation, not the inventory.', 'Buy protection when you commit to pay (e.g., signing the supplier PO), not when the goods arrive.'],
            ['For recurring payments, ladder your protections.', 'A family paying quarterly tuition can protect each installment separately rather than one big upfront hedge.'],
            ['Pricing reflects regime, not just currency.', 'The same currency costs more to protect in an active regime than in a calm one. Plan your hedging cost into your pricing.'],
          ].map(([bold, rest], i) => (
            <li key={i} className="text-sm text-gray-700">
              <strong>{bold}</strong> {rest}
            </li>
          ))}
        </ul>
      </Section>

      <Section>
        <h2 className="text-lg sm:text-xl font-semibold text-[#001F5C] tracking-tight mb-2">
          Common questions
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
                  <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 mt-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
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

// ── Page ────────────────────────────────────────────────────────────────

export default function HedgerPage() {
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
            Hedger
          </h1>
          <p className="mt-3 text-sm sm:text-base text-gray-600 max-w-2xl leading-relaxed">
            Plug in a trade you actually made. Replay the rate path that happened.
            See what protection would have cost, what payouts you would have
            received, and what loss flowed through your margin without it.
          </p>
        </div>

        <Tabs defaultValue="simulate" className="space-y-4">
          <TabsList className="bg-white border border-gray-200 rounded-xl h-auto p-1 flex w-full sm:w-auto sm:inline-flex">
            <TabsTrigger value="simulate" className="rounded-lg flex-1 sm:flex-none data-[state=active]:bg-[#001F5C] data-[state=active]:text-white px-4 py-2 text-sm">
              Simulate
            </TabsTrigger>
            <TabsTrigger value="learn" className="rounded-lg flex-1 sm:flex-none data-[state=active]:bg-[#001F5C] data-[state=active]:text-white px-4 py-2 text-sm">
              How protection works
            </TabsTrigger>
            <TabsTrigger value="cases" className="rounded-lg flex-1 sm:flex-none data-[state=active]:bg-[#001F5C] data-[state=active]:text-white px-4 py-2 text-sm">
              Use cases
            </TabsTrigger>
          </TabsList>
          <TabsContent value="simulate" className="mt-4 space-y-4">
            <SimulateTab />
          </TabsContent>
          <TabsContent value="learn" className="mt-4">
            <LearnTab />
          </TabsContent>
          <TabsContent value="cases" className="mt-4">
            <UseCasesTab />
          </TabsContent>
        </Tabs>

        <footer className="mt-12 pt-6 border-t border-gray-200 text-center text-[11px] text-gray-500 leading-relaxed">
          <p>BlockFinaX · Hedger workbench</p>
          <p className="mt-1">
            Exchange-rate data sourced from public end-of-month publications.
            Educational and illustrative. Not investment advice. Not an offer of
            any financial product.
          </p>
        </footer>
      </main>
    </div>
  );
}
