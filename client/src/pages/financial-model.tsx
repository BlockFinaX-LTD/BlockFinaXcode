import { useState, useMemo, useCallback } from 'react';
import { Link } from 'wouter';
import {
  INITIAL_INPUTS, INITIAL_CONSTANTS, INITIAL_FUNDING, MONTH_LABELS, buildModel,
} from '@/lib/financial-model-data';
import type { InputRow, Constants, MonthRow, FundingEntry } from '@/lib/financial-model-data';
import ExcelJS from 'exceljs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TrendingUp, TrendingDown, DollarSign, Users, AlertCircle, CheckCircle, Download, RotateCcw, Info, Edit3, Eye, ArrowLeft, Lock, Unlock } from 'lucide-react';

function Tip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="w-3 h-3 text-slate-400 hover:text-blue-500 cursor-help flex-shrink-0 transition-colors" />
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-[260px] text-xs leading-snug z-50">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

// ── IRR solver (Newton-Raphson on annual cash flows) ───────────────────────
function solveIRR(annualCFs: number[]): number | null {
  let r = 0.5;
  for (let iter = 0; iter < 300; iter++) {
    let npv = 0, dnpv = 0;
    for (let t = 0; t < annualCFs.length; t++) {
      const d = Math.pow(1 + r, t);
      npv  += annualCFs[t] / d;
      dnpv -= t * annualCFs[t] / (d * (1 + r));
    }
    if (Math.abs(dnpv) < 1e-10) return null;
    const r2 = r - npv / dnpv;
    if (Math.abs(r2 - r) < 1e-8) return isFinite(r2) ? r2 : null;
    r = r2;
  }
  return null;
}



// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n: number, compact = false) => {
  if (compact) {
    if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
    if (Math.abs(n) >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  }
  return n < 0
    ? `($${Math.abs(n).toLocaleString()})`
    : `$${n.toLocaleString()}`;
};
const pct = (n: number) => `${n.toFixed(1)}%`;
const num = (n: number) => n.toLocaleString();

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD VIEWS (9 half-years)
// ─────────────────────────────────────────────────────────────────────────────
const PERIODS: { label: string; range: [number, number] }[] = [
  { label: 'H2 2026', range: [0,  6]  },
  { label: 'H1 2027', range: [6,  12] },
  { label: 'H2 2027', range: [12, 18] },
  { label: 'H1 2028', range: [18, 24] },
  { label: 'H2 2028', range: [24, 30] },
  { label: 'H1 2029', range: [30, 36] },
  { label: 'H2 2029', range: [36, 42] },
  { label: 'H1 2030', range: [42, 48] },
  { label: 'H2 2030', range: [48, 54] },
];

// ─────────────────────────────────────────────────────────────────────────────
// ANNUAL GROUPS (for computed annual summary)
// ─────────────────────────────────────────────────────────────────────────────
const ANNUAL_GROUPS = [
  { label: '2026 (H2 only)', range: [0,  6]  },
  { label: '2027 (Full)',     range: [6,  18] },
  { label: '2028 (Full)',     range: [18, 30] },
  { label: '2029 (Full)',     range: [30, 42] },
  { label: '2030 (Full)',     range: [42, 54] },
];

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL EXPORT
// ─────────────────────────────────────────────────────────────────────────────
async function downloadExcel(
  model: MonthRow[],
  inputs: InputRow[],
  constants: Constants,
  funding: FundingEntry[],
  annualSummary: ReturnType<typeof computeAnnualSummary>
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BlockFinaX';
  wb.created = new Date();

  function addSheet(name: string, rows: (string | number | null)[][], widths: number[]) {
    const ws = wb.addWorksheet(name);
    ws.addRows(rows);
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }

  const months = model.map(r => r.label);

  // Sheet 1: Assumptions
  addSheet('Assumptions', [
    ['BlockFinaX Financial Model — Assumptions & Inputs', ...Array(11).fill('')],
    [''],
    ['CONSTANTS', '', 'Value', 'Description'],
    ['Hedge Yield (net)', '', constants.hedgeYield, '= events × notional × yield → hedge fees'],
    ['Gas / Hedge Event ($)', '', constants.gasPerEvent, 'Lisk L2 (OP Stack) — ~6 txns × ~$0.008 each = ~$0.05'],
    ['Gas Cost / Wallet ($)', '', constants.gasPerWallet, 'One-time wallet creation gas, sponsored by platform'],
    ['D&A / Month ($)', '', constants.daMonthly, 'Audit + infra setup amortised over 24 months'],
    ['Tax Rate', '', constants.taxRate, 'Applied only on profitable months (EBT > 0)'],
    [''],
    ['FUNDING TRANCHES', '', 'Amount ($)', 'Month Index', 'Month Label'],
    ...funding.filter(f => f.amount > 0).map(f => [f.label, '', f.amount, f.monthIndex, MONTH_LABELS[f.monthIndex] ?? '']),
    [''],
    ['MONTHLY INPUT DATA (54 months)', ...Array(10).fill('')],
    ['Month', 'Events', 'Avg Notional ($)', 'Wallet Fee %', 'New Wallets', 'Headcount', 'Salary/FTE ($)', 'CAC ($)', 'Legal ($)', 'Infra/Cloud ($)', 'Oracle ($)', 'G&A ($)'],
    ...inputs.map((d, i) => [MONTH_LABELS[i], d.events, d.avgNotional, d.walletPct, d.newWallets, d.headcount, d.salaryPerFTE, d.cac, d.legal, d.infraCloud, d.oracle, d.ga]),
  ], [22, 2, 16, 14, 14, 14, 14, 10, 12, 14, 10, 12]);

  // Sheet 2: Monthly P&L
  addSheet('Monthly P&L', [
    ['BlockFinaX — Monthly P&L  (Jul 2026 – Dec 2030)', ...months.map(() => '')],
    [''],
    ['OPERATING METRICS', ...months],
    ['Hedge Events',          ...model.map(r => r.events)],
    ['Avg Notional ($)',       ...model.map(r => r.avgNotional)],
    ['New Wallets',            ...model.map(r => r.newWallets)],
    ['Cumulative Wallets',     ...model.map(r => r.cumWallets)],
    ['Headcount',              ...model.map(r => r.headcount)],
    [''],
    ['REVENUE ($)',            ...months.map(() => '')],
    ['Hedge Protocol Fees',    ...model.map(r => r.hedgeFees)],
    ['Event Creation Fees',    ...model.map(r => r.eventCreationFees)],
    ['Wallet Transfer Fees',   ...model.map(r => r.walletFees)],
    ['Total Revenue',          ...model.map(r => r.totalRevenue)],
    [''],
    ['COST OF GOODS SOLD ($)', ...months.map(() => '')],
    ['Gas Sponsorship',        ...model.map(r => r.gasCost)],
    ['Oracle / RPC',           ...model.map(r => r.oracleCost)],
    ['Total COGS',             ...model.map(r => r.totalCOGS)],
    [''],
    ['GROSS PROFIT',           ...months.map(() => '')],
    ['Gross Profit ($)',        ...model.map(r => r.grossProfit)],
    ['Gross Margin %',          ...model.map(r => parseFloat(r.grossMarginPct.toFixed(1)))],
    [''],
    ['OPERATING EXPENSES ($)', ...months.map(() => '')],
    ['Personnel',              ...model.map(r => r.personnel)],
    ['Sales & Marketing',      ...model.map(r => r.marketing)],
    ['Legal & Compliance',     ...model.map(r => r.legal)],
    ['Infra & Cloud',          ...model.map(r => r.infraCloud)],
    ['G&A',                    ...model.map(r => r.ga)],
    ['Total OpEx',             ...model.map(r => r.totalOpEx)],
    [''],
    ['P&L ($)',                ...months.map(() => '')],
    ['EBITDA',                 ...model.map(r => r.ebitda)],
    ['EBITDA Margin %',        ...model.map(r => parseFloat(r.ebitdaMarginPct.toFixed(1)))],
    ['D&A (non-cash)',          ...model.map(r => r.da)],
    ['EBIT',                   ...model.map(r => r.ebit)],
    ['Interest Expense',       ...model.map(r => r.interestExpense)],
    ['EBT',                    ...model.map(r => r.ebt)],
    ['Tax Expense',            ...model.map(r => r.taxExpense)],
    ['Net Income',             ...model.map(r => r.netIncome)],
    ['Net Margin %',           ...model.map(r => parseFloat(r.netMarginPct.toFixed(1)))],
    [''],
    ['CASH FLOW ($)',          ...months.map(() => '')],
    ['Funding Received',       ...model.map(r => r.fundingReceived)],
    ['Operating Cash Flow',    ...model.map(r => r.cashFlow)],
    ['Cumulative Cash',        ...model.map(r => r.cumulativeCash)],
    ['Burn Rate',              ...model.map(r => r.burnRate)],
    ['Runway (months)',        ...model.map(r => r.runway === 999 ? 'N/A' : r.runway)],
  ], [22, ...months.map(() => 13)]);

  // Sheet 3: Annual Summary
  addSheet('Annual Summary', [
    ['BlockFinaX — Annual Summary (2026–2030)'],
    [''],
    ['Period', 'Events', 'Notional Volume', 'Revenue ($)', 'COGS ($)', 'Gross Profit ($)', 'Gross Margin %', 'OpEx ($)', 'EBITDA ($)', 'EBITDA %', 'Net Income ($)', 'Headcount (peak)', 'New Wallets', 'Blended CAC ($)'],
    ...annualSummary.map(r => [
      r.period, r.events, Math.round(r.notional), Math.round(r.revenue), Math.round(r.cogs),
      Math.round(r.grossProfit), parseFloat(r.grossMarginPct.toFixed(1)),
      Math.round(r.opex), Math.round(r.ebitda), parseFloat(r.ebitdaPct.toFixed(1)),
      Math.round(r.netIncome), r.headcount, r.newWallets, Math.round(r.blendedCac),
    ]),
  ], [18, 12, 18, 14, 12, 16, 14, 14, 14, 10, 14, 16, 14, 14]);

  // Sheet 4: IRR & Unit Economics
  const totalMktg = model.reduce((s, r) => s + r.marketing, 0);
  const totalWallets = model[model.length - 1].cumWallets;
  const blendedCac = totalMktg / totalWallets;
  const totalRev = model.reduce((s, r) => s + r.totalRevenue, 0);
  const ltv = (totalRev / totalWallets / 54) * 18;

  addSheet('IRR & Unit Economics', [
    ['BlockFinaX — IRR & Unit Economics'],
    [''],
    ['INVESTOR CASH FLOW (54-MONTH MODEL)'],
    ['Year', 'Capital Invested ($)', 'Net Cash Flow ($)', 'Cumulative ($)', 'Notes'],
    ...ANNUAL_GROUPS.map(g => {
      const ms = model.slice(g.range[0], g.range[1]);
      const inv = ms.reduce((s, r) => s + r.fundingReceived, 0);
      const ncf = ms.reduce((s, r) => s + r.netIncome, 0);
      return [g.label, inv > 0 ? -inv : '—', Math.round(ncf), '', ''];
    }),
    [''],
    ['RETURN METRICS'],
    ['Total Raise Target', '', funding.reduce((s, f) => s + f.amount, 0)],
    ['2030 Revenue (model)', '', Math.round(annualSummary[4]?.revenue ?? 0)],
    ['2030 EBITDA (model)', '', Math.round(annualSummary[4]?.ebitda ?? 0)],
    ['2030 EBITDA Margin', '', `${(annualSummary[4]?.ebitdaPct ?? 0).toFixed(1)}%`],
    ['EBITDA Multiple', '', '12×', '', 'Conservative African fintech comp (public comps 15–20×)'],
    ['Terminal Value (12× EBITDA)', '', Math.round(Math.max(0, annualSummary[4]?.ebitda ?? 0) * 12)],
    ['Enterprise MOIC (undiluted)', '', `${(Math.max(0, annualSummary[4]?.ebitda ?? 0) * 12 / Math.max(1, funding.reduce((s, f) => s + f.amount, 0))).toFixed(1)}×`, '', 'Terminal value ÷ total raised. Actual investor MOIC depends on dilution.'],
    ['Break-even Month', '', (model.find(r => r.netIncome > 0)?.label ?? 'Beyond model'), '', 'First month of positive net income'],
    [''],
    ['UNIT ECONOMICS (54-MONTH)'],
    ['Metric', 'Value', 'Notes'],
    [`$${Math.round(ltv).toLocaleString()}`, 'LTV (est.)', '18-month avg tenure × monthly revenue per wallet'],
    [`$${Math.round(blendedCac)}`, 'CAC (blended)', 'Total marketing spend ÷ total wallets'],
    [`${(ltv / blendedCac).toFixed(1)}×`, 'LTV:CAC', 'Healthy benchmark is > 3×'],
    [pct(annualSummary[4]?.grossMarginPct ?? 0), 'Gross Margin (peak)', '2030 gross margin'],
    [model[model.length - 1].headcount.toString(), 'Peak Headcount', 'Dec 2030'],
    [''],
    ['FEE ARCHITECTURE'],
    ['Fee Type', 'Rate', 'Minimum', 'Recipient', 'Notes'],
    ['Hedger Premium Fee', '0.5%', '—', 'Treasury', 'Charged at position purchase'],
    ['LP Payout Fee', '1.0%', '—', 'Treasury', 'Charged on LP payout event'],
    ['Creator Loyalty Fee', '5.0%', '—', 'Creator', 'Paid to event creator wallet'],
    ['Wallet Transfer Fee', '0.3%', '$0.50', 'Treasury', 'On every USDC wallet transfer'],
    ['Event Creation Fee', '$2', 'flat', 'Treasury', 'One-time on event creation'],
  ], [28, 20, 20, 16, 36]);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'BlockFinaX_Financial_Model.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE ANNUAL SUMMARY (from live model)
// ─────────────────────────────────────────────────────────────────────────────
function computeAnnualCosts(model: MonthRow[]) {
  return ANNUAL_GROUPS.map(g => {
    const ms = model.slice(g.range[0], g.range[1]);
    const sum = (f: (r: MonthRow) => number) => ms.reduce((s, r) => s + f(r), 0);
    const personnel      = sum(r => r.personnel);
    const marketing      = sum(r => r.marketing);
    const legal          = sum(r => r.legal);
    const infraCloud     = sum(r => r.infraCloud);
    const ga             = sum(r => r.ga);
    const gas            = sum(r => r.gasCost);
    const oracle         = sum(r => r.oracleCost);
    const creatorLoyalty = sum(r => r.creatorLoyalty);
    const kyc            = sum(r => r.kycCost);
    const totalCOGS      = gas + oracle + creatorLoyalty + kyc;
    const totalOpEx      = personnel + marketing + legal + infraCloud + ga;
    const totalCosts     = totalCOGS + totalOpEx;
    const revenue        = sum(r => r.totalRevenue);
    const events         = sum(r => r.events);
    const newWallets     = sum(r => r.newWallets);
    return {
      period: g.label, revenue, events, newWallets,
      personnel, marketing, legal, infraCloud, ga,
      gas, oracle, creatorLoyalty, kyc,
      totalCOGS, totalOpEx, totalCosts,
      costPct:   revenue > 0 ? (totalCosts  / revenue) * 100 : 0,
      opexPct:   revenue > 0 ? (totalOpEx   / revenue) * 100 : 0,
      cogsPct:   revenue > 0 ? (totalCOGS   / revenue) * 100 : 0,
      costPerEvent:  events     > 0 ? totalCosts / events     : 0,
      costPerWallet: newWallets > 0 ? totalCosts / newWallets : 0,
    };
  });
}

function computeAnnualSummary(model: MonthRow[]) {
  return ANNUAL_GROUPS.map(g => {
    const ms     = model.slice(g.range[0], g.range[1]);
    const rev    = ms.reduce((s, r) => s + r.totalRevenue, 0);
    const cogs   = ms.reduce((s, r) => s + r.totalCOGS, 0);
    const gp     = ms.reduce((s, r) => s + r.grossProfit, 0);
    const opex   = ms.reduce((s, r) => s + r.totalOpEx, 0);
    const ebitda = ms.reduce((s, r) => s + r.ebitda, 0);
    const net    = ms.reduce((s, r) => s + r.netIncome, 0);
    const notional  = ms.reduce((s, r) => s + r.events * r.avgNotional, 0);
    const evts   = ms.reduce((s, r) => s + r.events, 0);
    const wallets = ms.reduce((s, r) => s + r.newWallets, 0);
    const hc     = ms.length > 0 ? Math.max(...ms.map(r => r.headcount)) : 0;
    const mktg   = ms.reduce((s, r) => s + r.marketing, 0);
    return {
      period: g.label, events: evts, notional,
      revenue: rev, cogs, grossProfit: gp, grossMarginPct: rev > 0 ? (gp / rev) * 100 : 0,
      opex, ebitda, ebitdaPct: rev > 0 ? (ebitda / rev) * 100 : 0,
      netIncome: net, headcount: hc, newWallets: wallets,
      blendedCac: wallets > 0 ? mktg / wallets : 0,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function FinancialModel() {
  const [inputs,    setInputs]    = useState<InputRow[]>(INITIAL_INPUTS);
  const [constants, setConstants] = useState<Constants>(INITIAL_CONSTANTS);
  const [funding,   setFunding]   = useState<FundingEntry[]>(INITIAL_FUNDING);
  const [activePeriod, setActivePeriod] = useState(0);
  const [activeTab, setActiveTab] = useState('monthly');
  const [editUnlocked, setEditUnlocked] = useState(false);
  const [showPwModal, setShowPwModal] = useState(false);
  const [pwValue, setPwValue] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const model         = useMemo(() => buildModel(inputs, constants, funding), [inputs, constants, funding]);
  const annualSummary = useMemo(() => computeAnnualSummary(model), [model]);
  const annualCosts   = useMemo(() => computeAnnualCosts(model),   [model]);

  const updateInput = useCallback((i: number, field: keyof InputRow, val: number) => {
    setInputs(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  }, []);

  const updateConstant = useCallback((field: keyof Constants, val: number) => {
    setConstants(prev => ({ ...prev, [field]: val }));
  }, []);

  const updateFunding = useCallback((i: number, field: keyof FundingEntry, val: number | string) => {
    setFunding(prev => prev.map((f, idx) => idx === i ? { ...f, [field]: val } : f));
  }, []);

  const resetAll = useCallback(() => {
    setInputs(INITIAL_INPUTS);
    setConstants(INITIAL_CONSTANTS);
    setFunding(INITIAL_FUNDING);
  }, []);

  const verifyEditCode = async () => {
    setPwLoading(true);
    setPwError('');
    try {
      const res = await fetch('/api/verify-edit-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwValue }),
      });
      if (res.ok) {
        setEditUnlocked(true);
        setShowPwModal(false);
        setPwValue('');
        setActiveTab('inputs');
      } else {
        setPwError('Incorrect password.');
      }
    } catch {
      setPwError('Network error. Try again.');
    } finally {
      setPwLoading(false);
    }
  };

  // Summary KPIs
  const totalRev    = model.reduce((s, r) => s + r.totalRevenue, 0);
  const totalNet    = model.reduce((s, r) => s + r.netIncome, 0);
  const peakBurn    = Math.max(...model.map(r => r.burnRate));
  const breakevenMo = model.find(r => r.netIncome > 0);
  const totalWallets = model[model.length - 1]?.cumWallets ?? 0;

  const period = PERIODS[activePeriod];
  const slice  = model.slice(period.range[0], period.range[1]);
  const pRev   = slice.reduce((s, r) => s + r.totalRevenue, 0);
  const pEBIT  = slice.reduce((s, r) => s + r.ebitda, 0);
  const pNet   = slice.reduce((s, r) => s + r.netIncome, 0);
  const pEvt   = slice.reduce((s, r) => s + r.events, 0);

  const cellCls = 'text-right text-xs px-3 py-2 whitespace-nowrap font-mono';
  const hdrCls  = 'text-xs px-3 py-2 whitespace-nowrap bg-slate-50 text-slate-600 font-semibold';
  const secCls  = 'bg-slate-100 font-bold text-xs px-3 py-1.5 text-slate-700 uppercase tracking-wide';
  const rowColor = (v: number) => v < 0 ? 'text-red-600' : v > 0 ? 'text-emerald-700' : 'text-slate-700';

  // Compact number input for the inputs table
  const NumInput = ({ value, onChange, step = 1, min = 0 }: {
    value: number; onChange: (v: number) => void; step?: number; min?: number;
  }) => editUnlocked ? (
    <input
      type="number"
      step={step}
      min={min}
      value={value}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="w-full text-right text-xs border border-slate-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
    />
  ) : (
    <span className="block w-full text-right text-xs text-slate-600 px-1 py-0.5 select-none">{value.toLocaleString()}</span>
  );

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-screen-2xl mx-auto space-y-6">

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <Link href="/data-room">
              <button className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-2 transition-colors">
                <ArrowLeft className="w-4 h-4" />
                Back to Data Room
              </button>
            </Link>
            <h1 className="text-2xl font-bold text-slate-900">BlockFinaX — Financial Model</h1>
            <p className="text-sm text-slate-500 mt-1">
              54-Month Interactive Pro-Forma P&L · Jul 2026 – Dec 2030 · Edit any input and all figures update live
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">Base Case</Badge>
            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">$12.5M Raise Target</Badge>
            <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">Mainnet Jul 7, 2026</Badge>
            {editUnlocked && activeTab === 'inputs' ? (
              <Button
                size="sm" variant="outline"
                onClick={() => setActiveTab('monthly')}
                className="gap-1.5 ml-2 text-slate-600 border-slate-300"
              >
                <Eye className="w-3.5 h-3.5" />
                Done Editing
              </Button>
            ) : editUnlocked ? (
              <Button
                size="sm"
                onClick={() => setActiveTab('inputs')}
                className="gap-1.5 ml-2 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Unlock className="w-3.5 h-3.5" />
                Edit Model
              </Button>
            ) : (
              <Button
                size="sm" variant="outline"
                onClick={() => { setPwValue(''); setPwError(''); setShowPwModal(true); }}
                className="gap-1.5 ml-2 text-slate-600 border-slate-300"
              >
                <Lock className="w-3.5 h-3.5" />
                Edit Model
              </Button>
            )}
            <Button
              size="sm" variant="outline"
              onClick={resetAll}
              className="gap-1.5 text-slate-600"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={() => { downloadExcel(model, inputs, constants, funding, annualSummary).catch(console.error); }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Download Excel
            </Button>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {[
            { label: '54-Month Revenue',    value: fmt(totalRev, true),  icon: DollarSign,                              color: 'text-blue-600',    sub: 'Jul 2026 – Dec 2030',      tip: `Total revenue over 54 months. Split: Hedge Fees ~${Math.round(model.reduce((s,r)=>s+r.hedgeFees,0)/totalRev*100)}% | Event Creation Fees ~${Math.round(model.reduce((s,r)=>s+r.eventCreationFees,0)/totalRev*100)}% | Wallet Fees ~${Math.round(model.reduce((s,r)=>s+r.walletFees,0)/totalRev*100)}%.` },
            { label: '54-Month Net P&L',    value: fmt(totalNet, true),  icon: totalNet >= 0 ? TrendingUp : TrendingDown, color: totalNet >= 0 ? 'text-emerald-600' : 'text-red-500', sub: totalNet >= 0 ? 'Cumulative profit' : 'Growth phase', tip: 'Cumulative net income across all 54 months. Negative early = investment phase. Turns positive as revenue outpaces costs post breakeven.' },
            { label: 'Break-even Month',    value: breakevenMo?.label ?? 'Beyond model', icon: CheckCircle,             color: 'text-emerald-600', sub: 'First net-positive month', tip: 'First month where net income turns positive. After this point the business is generating more cash than it spends each month.' },
            { label: 'Peak Monthly Burn',   value: fmt(peakBurn, true),  icon: AlertCircle,                             color: 'text-amber-600',   sub: 'Highest cash outflow / mo',tip: 'Highest single-month cash consumption (operating cash flow at its most negative). Occurs during the heavy-investment scaling phase post Series A/B.' },
            { label: "Wallets by Dec '30",  value: num(totalWallets),    icon: Users,                                   color: 'text-purple-600',  sub: 'Cumulative registered',    tip: 'Total wallets onboarded from Jul 2026 to Dec 2030. Each wallet is a potential hedger and wallet transfer fee payer. LTV grows with wallet tenure.' },
          ].map((k, i) => (
            <Card key={i} className="border-slate-200">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-slate-500 leading-tight">{k.label}</p>
                    <p className={`text-xl font-bold mt-1 ${k.color}`}>{k.value}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{k.sub}</p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <k.icon className={`w-5 h-5 mt-0.5 ${k.color} opacity-70 cursor-help`} />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[240px] text-xs leading-snug z-50">
                      {k.tip}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Main Tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white border border-slate-200 flex-wrap h-auto gap-0.5">
            <TabsTrigger value="monthly"  className="text-xs">Monthly P&L</TabsTrigger>
            <TabsTrigger value="annual"   className="text-xs">Annual Summary</TabsTrigger>
            <TabsTrigger value="costs"    className="text-xs">Cost Breakdown</TabsTrigger>
            <TabsTrigger value="uniteco"  className="text-xs">IRR & Unit Economics</TabsTrigger>
            <TabsTrigger value="notes"    className="text-xs">Model Notes</TabsTrigger>
            <TabsTrigger value="inputs"   className="text-xs font-semibold text-blue-700">✏ Edit Inputs</TabsTrigger>
          </TabsList>

          {/* ════════════════ MONTHLY P&L ════════════════ */}
          <TabsContent value="monthly" className="mt-4 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="flex gap-1.5 flex-wrap">
                {PERIODS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setActivePeriod(i)}
                    className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                      activePeriod === i
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-4 text-xs text-slate-600 bg-white border border-slate-200 rounded-md px-4 py-2">
                <span>Revenue: <strong className="text-blue-600">{fmt(pRev, true)}</strong></span>
                <span>EBITDA: <strong className={pEBIT >= 0 ? 'text-emerald-600' : 'text-red-500'}>{fmt(pEBIT, true)}</strong></span>
                <span>Net: <strong className={pNet >= 0 ? 'text-emerald-600' : 'text-red-500'}>{fmt(pNet, true)}</strong></span>
                <span>Events: <strong className="text-slate-800">{num(pEvt)}</strong></span>
              </div>
            </div>

            <Card className="border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-slate-800 min-w-[900px]">
                  <thead>
                    <tr>
                      <th className="text-left text-xs px-3 py-2 bg-slate-100 font-bold text-slate-700 sticky left-0 z-10 min-w-[180px] border-r border-slate-200">Line Item</th>
                      {slice.map(r => <th key={r.month} className={hdrCls + ' border-b border-slate-200'}>{r.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td colSpan={slice.length + 1} className={secCls}>Operating Metrics</td></tr>
                    {[
                      { label: 'Hedge Events',       tip: 'Number of P2P protection contracts written this month. Each event = one hedger buying downside protection from the LP pool. Revenue = Events × Notional × 0.7%.', vals: slice.map(r => num(r.events)),      neutral: true },
                      { label: 'Avg Notional ($)',    tip: 'Average contract size in USD. Hedge fees = Events × Avg Notional × 0.7%. Larger notional = higher fees collected per event.', vals: slice.map(r => fmt(r.avgNotional)), neutral: true },
                      { label: 'New Wallets',        tip: 'New users onboarding this month. Gasless UX — platform sponsors $3 in gas per wallet on Lisk L2. Wallet transfer fees scale with the cumulative wallet base, not just new wallets.', vals: slice.map(r => num(r.newWallets)),   neutral: true },
                      { label: 'Cumulative Wallets', tip: 'Total registered wallets since Jul 2026 launch. Used to compute LTV and platform network effects.', vals: slice.map(r => num(r.cumWallets)),   neutral: true },
                      { label: 'Headcount',          tip: 'Full-time equivalents. Lean Africa-based team. Salary/FTE is editable per month in the Inputs tab — starting ~$4,500/FTE in H2 2026, rising to ~$6,800/FTE by Dec 2030. Blended average reflects seniority mix.', vals: slice.map(r => num(r.headcount)),    neutral: true },
                    ].map(row => (
                      <tr key={row.label} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td className="text-xs px-3 py-2 text-slate-600 sticky left-0 bg-white border-r border-slate-100">
                          <span className="flex items-center gap-1">{row.label}<Tip text={row.tip} /></span>
                        </td>
                        {row.vals.map((v, i) => <td key={i} className={cellCls + ' text-slate-700'}>{v}</td>)}
                      </tr>
                    ))}

                    <tr><td colSpan={slice.length + 1} className={secCls}>Revenue</td></tr>
                    {[
                      { label: 'Hedge Protocol Fees',   tip: 'Primary revenue stream. Formula: Events × Avg Notional × 0.7%. The 0.7% blends the 0.5% hedger premium fee and the ~0.2% LP payout fee (1% applied to LP deposits ≈ 20% of notional).', vals: slice.map(r => r.hedgeFees), cellTips: undefined as string[] | undefined },
                      { label: 'Event Creation Fees',   tip: 'Flat $2 charged to the event creator every time a new hedge event is published on-chain. Collected at creation alongside the initial LP deposit. At ~74,300 events/month (Dec 2030) this contributes ~$1.86M/month.', vals: slice.map(r => r.eventCreationFees), cellTips: undefined as string[] | undefined },
                      { label: 'Wallet Transfer Fees',  tip: '0.3% fee on USDC cross-border transfers. Revenue = cumulative wallets × active wallet % × avg monthly transfer × 0.3%. Scales directly with the growing wallet base — more wallets means more transfer volume and more fee revenue.', vals: slice.map(r => r.walletFees), cellTips: undefined as string[] | undefined },
                      { label: 'Total Revenue',         tip: 'Hedge protocol fees + event creation fees + wallet transfer fees. Hover each cell to see the split for that month.', vals: slice.map(r => r.totalRevenue), bold: true, cellTips: slice.map(r => r.totalRevenue > 0 ? `Hedge: ${fmt(r.hedgeFees)} (${Math.round((r.hedgeFees/r.totalRevenue)*100)}%) · Creation: ${fmt(r.eventCreationFees)} (${Math.round((r.eventCreationFees/r.totalRevenue)*100)}%) · Wallet: ${fmt(r.walletFees)} (${Math.round((r.walletFees/r.totalRevenue)*100)}%)` : 'No revenue') },
                    ].map(row => (
                      <tr key={row.label} className={`border-b border-slate-100 ${row.bold ? 'bg-blue-50/40' : 'hover:bg-slate-50/50'}`}>
                        <td className={`text-xs px-3 py-2 sticky left-0 border-r border-slate-100 ${row.bold ? 'font-semibold bg-blue-50/40 text-blue-800' : 'text-slate-600 bg-white'}`}>
                          <span className="flex items-center gap-1">{row.label}<Tip text={row.tip} /></span>
                        </td>
                        {row.vals.map((v, i) => (
                          <td key={i} title={row.cellTips?.[i]} className={`${cellCls} ${row.bold ? 'font-semibold text-blue-700' : 'text-emerald-700'} ${row.cellTips ? 'cursor-help' : ''}`}>{fmt(v)}</td>
                        ))}
                      </tr>
                    ))}

                    <tr><td colSpan={slice.length + 1} className={secCls}>Cost of Goods Sold</td></tr>
                    {[
                      { label: 'Gas Costs',             tip: 'Two components: (1) Wallet onboarding gas — platform sponsors gas per new wallet for frictionless UX. (2) Hedge execution gas — each hedge event requires ~6 on-chain transactions (createEvent, deposit, buyProtection, settleEvent, claimPayout, etc.). On Lisk L2 (OP Stack), each transaction costs ~$0.008, so ~$0.05 per full event lifecycle. Formula: (newWallets × $3) + (events × $0.05).', vals: slice.map(r => r.gasCost) },
                      { label: 'Oracle / RPC',          tip: 'One-touch settlement infrastructure. The oracle polls FX, commodity, and crypto prices every 5 minutes and auto-settles contracts when the strike price is hit.', vals: slice.map(r => r.oracleCost) },
                      { label: 'Creator Loyalty (5%)',  tip: '5% of hedge protocol fees distributed to event creators as a loyalty reward. Incentivises experienced traders and institutions to create high-quality hedge events that attract LPs and hedgers.', vals: slice.map(r => r.creatorLoyalty) },
                      { label: 'KYC / AML Compliance', tip: 'Per-wallet AML/KYC identity verification cost ($1.50/wallet). Required for regulatory compliance in all African markets — includes identity checks, sanctions screening, and ongoing monitoring.', vals: slice.map(r => r.kycCost) },
                      { label: 'Total COGS',            tip: 'Direct delivery costs: gas + oracle + creator loyalty + KYC compliance. All costs directly linked to revenue generation and user onboarding. Gross Profit = Revenue − COGS.', vals: slice.map(r => r.totalCOGS), bold: true },
                    ].map(row => (
                      <tr key={row.label} className={`border-b border-slate-100 ${row.bold ? 'bg-slate-50' : 'hover:bg-slate-50/50'}`}>
                        <td className={`text-xs px-3 py-2 sticky left-0 border-r border-slate-100 ${row.bold ? 'font-semibold bg-slate-50 text-slate-700' : 'text-slate-600 bg-white'}`}>
                          <span className="flex items-center gap-1">{row.label}<Tip text={row.tip} /></span>
                        </td>
                        {row.vals.map((v, i) => <td key={i} className={`${cellCls} ${row.bold ? 'font-semibold text-slate-700' : 'text-red-500'}`}>{fmt(v)}</td>)}
                      </tr>
                    ))}

                    <tr><td colSpan={slice.length + 1} className={secCls}>Gross Profit</td></tr>
                    <tr className="border-b border-slate-100 bg-emerald-50/30">
                      <td className="text-xs px-3 py-2 text-emerald-800 font-semibold sticky left-0 bg-emerald-50/30 border-r border-slate-100">
                        <span className="flex items-center gap-1">Gross Profit<Tip text="Revenue minus COGS. Represents earnings after direct delivery costs (gas + oracle) but before fixed operating expenses." /></span>
                      </td>
                      {slice.map(r => <td key={r.month} className={`${cellCls} font-semibold ${rowColor(r.grossProfit)}`}>{fmt(r.grossProfit)}</td>)}
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="text-xs px-3 py-2 text-slate-500 sticky left-0 bg-white border-r border-slate-100">
                        <span className="flex items-center gap-1">Gross Margin %<Tip text="Gross Profit ÷ Revenue. High gross margins (80–95%) reflect the software-like economics of a protocol business — COGS is mostly gas sponsorship which declines as % of revenue at scale." /></span>
                      </td>
                      {slice.map(r => <td key={r.month} className={`${cellCls} ${rowColor(r.grossMarginPct)}`}>{pct(r.grossMarginPct)}</td>)}
                    </tr>

                    <tr><td colSpan={slice.length + 1} className={secCls}>Operating Expenses</td></tr>
                    {[
                      { label: 'Personnel',          tip: 'Headcount × salary/FTE/month. Starts at $3,500/FTE (lean Africa-based team, Jul 2026) and scales to $8,500/FTE by 2030 as the team internationalises and senior hires are made.', vals: slice.map(r => r.personnel) },
                      { label: 'Sales & Marketing',  tip: 'New Wallets acquired × cost-per-acquisition (CAC). CAC is $38–40 in the paid-acquisition phase, drops to $10–15 in H2 2028 as viral referrals dominate, and reaches $4–5 at steady state in 2030 (comparable to Wave, OPay at scale).', vals: slice.map(r => r.marketing) },
                      { label: 'Legal & Compliance', tip: 'Regulatory counsel retainer, Bank of Ghana sandbox compliance, multi-country fintech licensing (Nigeria, Kenya, Rwanda), AML policy maintenance, and ongoing legal filings. This is a major fixed cost for any regulated African fintech — $15K–62K/month across the model lifetime.', vals: slice.map(r => r.legal) },
                      { label: 'Infra & Cloud',      tip: 'Cloud hosting, Neon serverless Postgres, API gateway, monitoring, and CDN. Scales with user volume and transaction throughput — from $800/mo (launch) to $168K/mo (Dec 2030).', vals: slice.map(r => r.infraCloud) },
                      { label: 'G&A',                tip: 'General and administrative: finance, HR, office, software subscriptions. Kept lean early as founders handle multiple roles.', vals: slice.map(r => r.ga) },
                      { label: 'Total OpEx',         tip: 'Sum of all operating expenses: Personnel + Marketing + Legal + Infra + G&A. Does not include COGS (gas/oracle) or D&A.', vals: slice.map(r => r.totalOpEx), bold: true },
                    ].map(row => (
                      <tr key={row.label} className={`border-b border-slate-100 ${row.bold ? 'bg-slate-50' : 'hover:bg-slate-50/50'}`}>
                        <td className={`text-xs px-3 py-2 sticky left-0 border-r border-slate-100 ${row.bold ? 'font-semibold bg-slate-50 text-slate-700' : 'text-slate-600 bg-white'}`}>
                          <span className="flex items-center gap-1">{row.label}<Tip text={row.tip} /></span>
                        </td>
                        {row.vals.map((v, i) => <td key={i} className={`${cellCls} ${row.bold ? 'font-semibold text-slate-700' : 'text-red-500'}`}>{fmt(v)}</td>)}
                      </tr>
                    ))}

                    <tr><td colSpan={slice.length + 1} className={secCls}>P&L</td></tr>
                    {[
                      { label: 'EBITDA',          tip: 'Gross Profit minus Total OpEx. The primary operating performance metric. Excludes D&A and tax. See the Return Metrics tab for 2030 EBITDA margin from the live model.', vals: slice.map(r => r.ebitda),          bold: true, colored: true },
                      { label: 'EBITDA Margin %', tip: 'EBITDA ÷ Revenue. Negative during the investment phase, turns positive after EBITDA break-even. The live model\'s 2030 EBITDA margin is driven primarily by marketing costs as a % of revenue.', vals: slice.map(r => r.ebitdaMarginPct), pctFmt: true },
                      { label: 'D&A (non-cash)',  tip: '$4,000/month non-cash amortisation of platform development costs (smart contracts, audits, infrastructure setup). No cash impact.', vals: slice.map(r => r.da) },
                      { label: 'EBIT',            tip: 'Earnings Before Interest and Tax. EBITDA minus D&A. Represents true operating profit inclusive of asset costs.', vals: slice.map(r => r.ebit),            colored: true },
                      { label: 'EBT',             tip: 'Earnings Before Tax. EBIT minus any interest expense on debt. Currently zero interest expense (equity-financed model).', vals: slice.map(r => r.ebt),             colored: true },
                      { label: 'Tax Expense',     tip: '25% corporate tax applied only when EBT is positive. No tax is charged on losses — losses carry forward to offset future taxable income.', vals: slice.map(r => r.taxExpense) },
                      { label: 'Net Income',      tip: 'Bottom line after all costs and taxes. EBT minus tax expense. Represents value accruing to shareholders.', vals: slice.map(r => r.netIncome),       bold: true, colored: true },
                      { label: 'Net Margin %',    tip: 'Net Income ÷ Revenue. Shows overall after-tax profitability. See the Annual Summary tab for the model-computed 2030 net income margin.', vals: slice.map(r => r.netMarginPct),  pctFmt: true },
                    ].map(row => (
                      <tr key={row.label} className={`border-b border-slate-100 ${row.bold ? 'bg-slate-50' : 'hover:bg-slate-50/50'}`}>
                        <td className={`text-xs px-3 py-2 sticky left-0 border-r border-slate-100 ${row.bold ? 'font-semibold bg-slate-50 text-slate-700' : 'text-slate-600 bg-white'}`}>
                          <span className="flex items-center gap-1">{row.label}<Tip text={row.tip} /></span>
                        </td>
                        {row.vals.map((v, i) => (
                          <td key={i} className={`${cellCls} ${row.bold ? 'font-semibold' : ''} ${row.colored || row.pctFmt ? rowColor(v) : 'text-slate-600'}`}>
                            {row.pctFmt ? pct(v) : fmt(v)}
                          </td>
                        ))}
                      </tr>
                    ))}

                    <tr><td colSpan={slice.length + 1} className={secCls}>Cash Flow</td></tr>
                    {[
                      { label: 'Funding Received',    tip: 'Equity investment received this month. Pre-Seed $500K (Jul 2026) → Seed $1.5M (Jan 2027, 6 months live traction) → Series A $8M (Jan 2028, proven PMF near break-even) → Series B $20M (Jul 2029, pure growth capital). Total raise: $30M. Industry-standard cadence for African fintech/blockchain.', vals: slice.map(r => r.fundingReceived), colored: true },
                      { label: 'Operating Cash Flow', tip: 'Net Income + D&A (cash approximation). Positive = operations are self-sustaining. Negative = still burning through investment capital.', vals: slice.map(r => r.cashFlow),        colored: true },
                      { label: 'Cumulative Cash',     tip: 'Running total of all cash flows since Jul 2026. Includes equity raises and operating cash flow. Should never approach zero — managed by funding tranches.', vals: slice.map(r => r.cumulativeCash),  bold: true, colored: true },
                      { label: 'Burn Rate',           tip: 'Monthly cash consumed (negative = burning, positive = generating). Burn Rate = Operating Cash Flow when no funding received. Monitor against runway.', vals: slice.map(r => r.burnRate) },
                    ].map(row => (
                      <tr key={row.label} className={`border-b border-slate-100 ${row.bold ? 'bg-blue-50/30' : 'hover:bg-slate-50/50'}`}>
                        <td className={`text-xs px-3 py-2 sticky left-0 border-r border-slate-100 ${row.bold ? 'font-semibold bg-blue-50/30 text-blue-800' : 'text-slate-600 bg-white'}`}>
                          <span className="flex items-center gap-1">{row.label}<Tip text={row.tip} /></span>
                        </td>
                        {row.vals.map((v, i) => <td key={i} className={`${cellCls} ${row.bold ? 'font-semibold' : ''} ${row.colored ? rowColor(v) : 'text-slate-600'}`}>{fmt(v)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* ════════════════ ANNUAL SUMMARY ════════════════ */}
          <TabsContent value="annual" className="mt-4">
            <Card className="border-slate-200 overflow-hidden">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold text-slate-700">Annual Summary — 2026–2030 (computed from inputs)</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-slate-800">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['Period','Events','Notional Vol.','Revenue','COGS','Gross Profit','GM %','OpEx','EBITDA','EBITDA %','Net Income','HC (peak)','New Wallets','Blended CAC'].map(h => (
                        <th key={h} className="text-xs px-3 py-2 text-slate-600 font-semibold whitespace-nowrap text-right first:text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {annualSummary.map((r, i) => {
                      // Stage derived from actual computed values, not position
                      const stage = r.ebitda < 0 && i <= 1
                                  ? { label:'Invest',     cls:'bg-amber-100 text-amber-800' }
                                  : r.ebitda < 0
                                  ? { label:'Build',      cls:'bg-blue-100 text-blue-800' }
                                  : r.netIncome < 0
                                  ? { label:'Near BE',    cls:'bg-cyan-100 text-cyan-800' }
                                  : r.netIncome >= 0 && i === 3
                                  ? { label:'Profitable', cls:'bg-emerald-100 text-emerald-800' }
                                  : { label:'Growth',     cls:'bg-purple-100 text-purple-800' };
                      return (
                        <tr key={r.period} className={`border-b border-slate-100 ${i % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                          <td className="text-xs px-3 py-2.5 font-semibold text-slate-800 whitespace-nowrap">
                            {r.period}
                            <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${stage.cls}`}>{stage.label}</span>
                          </td>
                          <td className="text-xs px-3 py-2.5 text-right font-mono">{num(r.events)}</td>
                          <td className="text-xs px-3 py-2.5 text-right font-mono">{fmt(r.notional, true)}</td>
                          <td className="text-xs px-3 py-2.5 text-right font-mono text-blue-700 font-semibold">{fmt(r.revenue, true)}</td>
                          <td className="text-xs px-3 py-2.5 text-right font-mono text-red-500">{fmt(r.cogs, true)}</td>
                          <td className="text-xs px-3 py-2.5 text-right font-mono text-emerald-700 font-semibold">{fmt(r.grossProfit, true)}</td>
                          <td className="text-xs px-3 py-2.5 text-right font-mono">{pct(r.grossMarginPct)}</td>
                          <td className="text-xs px-3 py-2.5 text-right font-mono text-red-500">{fmt(r.opex, true)}</td>
                          <td className={`text-xs px-3 py-2.5 text-right font-mono font-semibold ${r.ebitda >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(r.ebitda, true)}</td>
                          <td className={`text-xs px-3 py-2.5 text-right font-mono ${r.ebitdaPct >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{pct(r.ebitdaPct)}</td>
                          <td className={`text-xs px-3 py-2.5 text-right font-mono font-semibold ${r.netIncome >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(r.netIncome, true)}</td>
                          <td className="text-xs px-3 py-2.5 text-right font-mono">{r.headcount}</td>
                          <td className="text-xs px-3 py-2.5 text-right font-mono">{num(r.newWallets)}</td>
                          <td className="text-xs px-3 py-2.5 text-right font-mono">${Math.round(r.blendedCac)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* ════════════════ COST BREAKDOWN ════════════════ */}
          <TabsContent value="costs" className="mt-4 space-y-4">

            {/* Annual cost breakdown table */}
            <Card className="border-slate-200 overflow-hidden">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold text-slate-700">Annual Cost Breakdown — COGS &amp; OpEx by Year</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-slate-800 min-w-[700px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left text-xs px-3 py-2 text-slate-600 font-semibold sticky left-0 bg-slate-50 min-w-[200px] border-r border-slate-200">Line Item</th>
                      {annualCosts.map(r => (
                        <th key={r.period} className="text-right text-xs px-3 py-2 text-slate-600 font-semibold whitespace-nowrap">{r.period}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Revenue reference */}
                    <tr className="border-b border-slate-200 bg-blue-50/40">
                      <td className="text-xs px-3 py-2 font-semibold text-blue-800 sticky left-0 bg-blue-50/40 border-r border-slate-200">Total Revenue</td>
                      {annualCosts.map(r => <td key={r.period} className="text-xs px-3 py-2 text-right font-mono font-semibold text-blue-700">{fmt(r.revenue, true)}</td>)}
                    </tr>

                    {/* COGS section */}
                    <tr><td colSpan={annualCosts.length + 1} className="text-[10px] px-3 py-1.5 bg-orange-50 text-orange-700 font-bold uppercase tracking-wider border-y border-orange-200">Cost of Goods Sold (COGS)</td></tr>
                    {[
                      { key: 'gas'            as const, label: 'Gas Costs',           tip: 'Gas costs on Lisk L2 (OP Stack): $3 per new wallet (6 onboarding txns × ~$0.50 each on L2) plus $0.05 per hedge event (6 settlement txns × ~$0.008 each). Enables friction-free UX.' },
                      { key: 'oracle'         as const, label: 'Oracle / RPC',         tip: 'On-chain price feed & settlement infrastructure costs (FX, commodity, crypto every 5 min).' },
                      { key: 'creatorLoyalty' as const, label: 'Creator Loyalty (5%)', tip: '5% of hedge fees distributed to event creators as a protocol loyalty incentive.' },
                      { key: 'kyc'            as const, label: 'KYC / AML',            tip: '$1.50/wallet AML identity verification required for African market regulatory compliance.' },
                    ].map(row => (
                      <tr key={row.key} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td className="text-xs px-3 py-2 text-slate-600 sticky left-0 bg-white border-r border-slate-100">
                          <span className="flex items-center gap-1 pl-3">{row.label}<Tip text={row.tip} /></span>
                        </td>
                        {annualCosts.map(r => <td key={r.period} className="text-xs px-3 py-2 text-right font-mono text-slate-600">{fmt(r[row.key], true)}</td>)}
                      </tr>
                    ))}
                    <tr className="border-b border-orange-200 bg-orange-50/30">
                      <td className="text-xs px-3 py-2 font-semibold text-orange-800 sticky left-0 bg-orange-50/30 border-r border-slate-200">Total COGS</td>
                      {annualCosts.map(r => <td key={r.period} className="text-xs px-3 py-2 text-right font-mono font-semibold text-orange-700">{fmt(r.totalCOGS, true)}</td>)}
                    </tr>
                    <tr className="border-b border-slate-100 bg-orange-50/10">
                      <td className="text-xs px-3 py-2 text-slate-500 sticky left-0 bg-orange-50/10 border-r border-slate-200 pl-3 italic">COGS as % Revenue</td>
                      {annualCosts.map(r => <td key={r.period} className="text-xs px-3 py-2 text-right font-mono text-slate-500">{pct(r.cogsPct)}</td>)}
                    </tr>

                    {/* OpEx section */}
                    <tr><td colSpan={annualCosts.length + 1} className="text-[10px] px-3 py-1.5 bg-purple-50 text-purple-700 font-bold uppercase tracking-wider border-y border-purple-200">Operating Expenses (OpEx)</td></tr>
                    {[
                      { key: 'personnel'  as const, label: 'Personnel',       tip: 'Headcount × salary/FTE per month. Lean Africa-based team; scaling from 4 FTE (H2 2026) to 30 FTE (2030).' },
                      { key: 'marketing'  as const, label: 'Marketing / CAC', tip: 'New wallets × CAC per wallet. Represents paid acquisition, partnerships, and community campaigns.' },
                      { key: 'legal'      as const, label: 'Legal',           tip: 'Legal counsel, BoG sandbox regulatory fees, IP, contract review, and compliance advisory.' },
                      { key: 'infraCloud' as const, label: 'Infra / Cloud',   tip: 'Cloud hosting, RPC node access, CDN, monitoring, CI/CD, and database scaling costs.' },
                      { key: 'ga'         as const, label: 'G&A',             tip: 'General & administrative: office, finance ops, software tools, insurance, HR overhead.' },
                    ].map(row => (
                      <tr key={row.key} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td className="text-xs px-3 py-2 text-slate-600 sticky left-0 bg-white border-r border-slate-100">
                          <span className="flex items-center gap-1 pl-3">{row.label}<Tip text={row.tip} /></span>
                        </td>
                        {annualCosts.map(r => <td key={r.period} className="text-xs px-3 py-2 text-right font-mono text-slate-600">{fmt(r[row.key], true)}</td>)}
                      </tr>
                    ))}
                    <tr className="border-b border-purple-200 bg-purple-50/30">
                      <td className="text-xs px-3 py-2 font-semibold text-purple-800 sticky left-0 bg-purple-50/30 border-r border-slate-200">Total OpEx</td>
                      {annualCosts.map(r => <td key={r.period} className="text-xs px-3 py-2 text-right font-mono font-semibold text-purple-700">{fmt(r.totalOpEx, true)}</td>)}
                    </tr>
                    <tr className="border-b border-slate-100 bg-purple-50/10">
                      <td className="text-xs px-3 py-2 text-slate-500 sticky left-0 bg-purple-50/10 border-r border-slate-200 pl-3 italic">OpEx as % Revenue</td>
                      {annualCosts.map(r => <td key={r.period} className="text-xs px-3 py-2 text-right font-mono text-slate-500">{pct(r.opexPct)}</td>)}
                    </tr>

                    {/* Totals */}
                    <tr className="border-b border-slate-300 bg-slate-100">
                      <td className="text-xs px-3 py-2.5 font-bold text-slate-900 sticky left-0 bg-slate-100 border-r border-slate-300">Total Costs (COGS + OpEx)</td>
                      {annualCosts.map(r => <td key={r.period} className="text-xs px-3 py-2.5 text-right font-mono font-bold text-slate-800">{fmt(r.totalCosts, true)}</td>)}
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="text-xs px-3 py-2 text-slate-500 sticky left-0 bg-white border-r border-slate-100 italic">Total Costs as % Revenue</td>
                      {annualCosts.map(r => <td key={r.period} className={`text-xs px-3 py-2 text-right font-mono font-semibold ${r.costPct > 100 ? 'text-red-600' : r.costPct > 80 ? 'text-amber-600' : 'text-emerald-600'}`}>{pct(r.costPct)}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Cost composition stacked bars */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold text-slate-700">Cost Composition by Year — Stacked View</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pb-5">
                {/* Legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-slate-600">
                  {[
                    { color: 'bg-blue-500',    label: 'Personnel'       },
                    { color: 'bg-purple-500',  label: 'Marketing'       },
                    { color: 'bg-amber-400',   label: 'Legal'           },
                    { color: 'bg-cyan-500',    label: 'Infra / Cloud'   },
                    { color: 'bg-slate-400',   label: 'G&A'             },
                    { color: 'bg-orange-500',  label: 'Gas Costs'      },
                    { color: 'bg-indigo-500',  label: 'Oracle / RPC'    },
                    { color: 'bg-pink-500',    label: 'Creator Loyalty' },
                    { color: 'bg-red-400',     label: 'KYC / AML'      },
                  ].map(({ color, label }) => (
                    <span key={label} className="flex items-center gap-1">
                      <span className={`w-2.5 h-2.5 rounded-sm inline-block ${color}`} />
                      {label}
                    </span>
                  ))}
                </div>

                {annualCosts.map(r => {
                  const tc = r.totalCosts || 1;
                  const segments = [
                    { pct: (r.personnel      / tc) * 100, color: 'bg-blue-500',   label: 'Personnel',       val: r.personnel      },
                    { pct: (r.marketing      / tc) * 100, color: 'bg-purple-500', label: 'Marketing',       val: r.marketing      },
                    { pct: (r.legal          / tc) * 100, color: 'bg-amber-400',  label: 'Legal',           val: r.legal          },
                    { pct: (r.infraCloud     / tc) * 100, color: 'bg-cyan-500',   label: 'Infra/Cloud',     val: r.infraCloud     },
                    { pct: (r.ga             / tc) * 100, color: 'bg-slate-400',  label: 'G&A',             val: r.ga             },
                    { pct: (r.gas            / tc) * 100, color: 'bg-orange-500', label: 'Gas',             val: r.gas            },
                    { pct: (r.oracle         / tc) * 100, color: 'bg-indigo-500', label: 'Oracle',          val: r.oracle         },
                    { pct: (r.creatorLoyalty / tc) * 100, color: 'bg-pink-500',   label: 'Creator Loyalty', val: r.creatorLoyalty },
                    { pct: (r.kyc            / tc) * 100, color: 'bg-red-400',    label: 'KYC',             val: r.kyc            },
                  ];
                  return (
                    <div key={r.period} className="space-y-1.5">
                      <div className="flex justify-between items-baseline">
                        <span className="text-xs font-semibold text-slate-700">{r.period}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{fmt(r.totalCosts, true)} total · {pct(r.costPct)} of revenue</span>
                      </div>
                      <div className="flex h-6 w-full rounded overflow-hidden gap-px bg-slate-100">
                        {segments.filter(s => s.pct > 0.5).map(s => (
                          <div
                            key={s.label}
                            title={`${s.label}: ${fmt(s.val, true)} (${s.pct.toFixed(1)}%)`}
                            className={`${s.color} cursor-help transition-opacity hover:opacity-80`}
                            style={{ width: `${s.pct}%` }}
                          />
                        ))}
                      </div>
                      <div className="flex gap-3 flex-wrap text-[9px] text-slate-500">
                        {segments.filter(s => s.pct > 0.5).map(s => (
                          <span key={s.label}>{s.label} {s.pct.toFixed(0)}%</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Cost efficiency metrics */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold text-slate-700">Cost Efficiency Metrics — By Year</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-slate-800 min-w-[600px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left text-xs px-3 py-2 text-slate-600 font-semibold sticky left-0 bg-slate-50 min-w-[220px] border-r border-slate-200">Metric</th>
                      {annualCosts.map(r => (
                        <th key={r.period} className="text-right text-xs px-3 py-2 text-slate-600 font-semibold whitespace-nowrap">{r.period}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Total Costs', tip: 'Sum of all COGS and OpEx for the period.', fmt_: (r: typeof annualCosts[0]) => fmt(r.totalCosts, true), bold: true },
                      { label: 'COGS', tip: 'Gas + Oracle + Creator Loyalty + KYC.', fmt_: (r: typeof annualCosts[0]) => fmt(r.totalCOGS, true) },
                      { label: 'OpEx', tip: 'Personnel + Marketing + Legal + Infra + G&A.', fmt_: (r: typeof annualCosts[0]) => fmt(r.totalOpEx, true) },
                      { label: 'Cost as % Revenue', tip: 'Total costs as a share of total revenue. <100% = profitable. Targeting 60-70% at scale.', fmt_: (r: typeof annualCosts[0]) => pct(r.costPct) },
                      { label: 'Personnel as % Total Costs', tip: 'How much of the total cost structure is people. High early; should fall as revenue scales faster than team.', fmt_: (r: typeof annualCosts[0]) => r.totalCosts > 0 ? pct((r.personnel / r.totalCosts) * 100) : '—' },
                      { label: 'Cost per Hedge Event', tip: 'Total costs ÷ total hedge events in the period. Measures unit-level cost efficiency.', fmt_: (r: typeof annualCosts[0]) => r.events > 0 ? `$${r.costPerEvent.toFixed(2)}` : '—' },
                      { label: 'Cost per New Wallet', tip: 'Total costs ÷ new wallets onboarded. Should decline sharply as platform scales and marketing efficiency improves.', fmt_: (r: typeof annualCosts[0]) => r.newWallets > 0 ? `$${Math.round(r.costPerWallet)}` : '—' },
                    ].map(row => (
                      <tr key={row.label} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td className={`text-xs px-3 py-2 sticky left-0 border-r border-slate-100 ${row.bold ? 'font-semibold text-slate-800 bg-slate-50' : 'text-slate-600 bg-white'}`}>
                          <span className="flex items-center gap-1">{row.label}<Tip text={row.tip} /></span>
                        </td>
                        {annualCosts.map(r => (
                          <td key={r.period} className={`text-xs px-3 py-2 text-right font-mono ${row.bold ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{row.fmt_(r)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

          </TabsContent>

          {/* ════════════════ IRR & UNIT ECONOMICS ════════════════ */}
          <TabsContent value="uniteco" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Investor Cash Flow */}
              <Card className="border-slate-200">
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-sm font-semibold text-slate-700">Investor Cash Flow (computed from model)</CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100">
                        {['Year','Invested','Net Cash Flow','Cumulative','Stage'].map(h => (
                          <th key={h} className="pb-1.5 text-slate-500 font-semibold text-right first:text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let cumulative = 0;
                        return ANNUAL_GROUPS.map((g, i) => {
                          const ms      = model.slice(g.range[0], g.range[1]);
                          const invested = ms.reduce((s, r) => s + r.fundingReceived, 0);
                          const ncf     = ms.reduce((s, r) => s + r.netIncome, 0);
                          const ebitda  = ms.reduce((s, r) => s + r.ebitda, 0);
                          cumulative += (-invested + ncf);
                          // Stage derived from actual computed values
                          const stageLabel = ebitda < 0 && i <= 1 ? 'Investing'
                                           : ebitda < 0           ? 'Building'
                                           : ncf < 0              ? 'Near breakeven'
                                           : cumulative < 0       ? 'Cash positive, cumul. negative'
                                           :                        'Cumulative positive';
                          const stageColor = cumulative >= 0 ? 'text-emerald-600' : ncf >= 0 ? 'text-cyan-600' : 'text-slate-400';
                          return (
                            <tr key={g.label} className="border-b border-slate-50">
                              <td className="py-1.5 font-medium text-slate-800">{g.label}</td>
                              <td className="py-1.5 text-right font-mono text-red-500">{invested > 0 ? `($${(invested/1e6).toFixed(1)}M)` : '—'}</td>
                              <td className={`py-1.5 text-right font-mono font-semibold ${ncf >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(Math.round(ncf), true)}</td>
                              <td className={`py-1.5 text-right font-mono font-semibold ${cumulative >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(Math.round(cumulative), true)}</td>
                              <td className={`py-1.5 text-right text-[10px] ${stageColor}`}>{stageLabel}</td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* Return Metrics */}
              <Card className="border-slate-200">
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-sm font-semibold text-slate-700">Return Metrics (computed from model)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(() => {
                    const ebitda2030 = annualSummary[4]?.ebitda ?? 0;
                    const rev2030    = annualSummary[4]?.revenue ?? 0;
                    const raised     = funding.reduce((s, f) => s + f.amount, 0);
                    const tv         = Math.max(0, ebitda2030) * 12;
                    const moic       = raised > 0 ? tv / raised : 0;
                    // Company-level IRR: annual CFs = (netIncome − investment) per year, + terminal in year 4
                    const irrCFs = ANNUAL_GROUPS.map((g, i) => {
                      const inv = funding.filter(f => f.monthIndex >= g.range[0] && f.monthIndex < g.range[1])
                                         .reduce((s, f) => s + f.amount, 0);
                      const ni  = model.slice(g.range[0], g.range[1]).reduce((s, r) => s + r.netIncome, 0);
                      return -inv + ni + (i === 4 ? tv : 0);
                    });
                    const irrVal = solveIRR(irrCFs);
                    const irrStr = irrVal !== null && irrVal > 0 && irrVal < 100
                      ? `${(irrVal * 100).toFixed(0)}%` : 'n/a (see note)';
                    return [
                      { label: 'Total Raise Target',           value: fmt(raised, true),                 tip: 'Sum of Pre-Seed + Series A + Series B as configured in the funding schedule.' },
                      { label: '2030 Annual Revenue',          value: fmt(Math.round(rev2030), true),    tip: 'Full-year 2030 revenue from the model: hedge fees + event creation fees + wallet transfer fees.', positive: true },
                      { label: '2030 EBITDA',                  value: fmt(Math.round(ebitda2030), true), tip: 'Gross Profit minus total OpEx. Primary operating profitability measure. Excludes D&A, tax, and interest.', positive: ebitda2030 >= 0 },
                      { label: '2030 EBITDA Margin',           value: pct(annualSummary[4]?.ebitdaPct ?? 0), tip: 'EBITDA ÷ Revenue. Reflects operating leverage as the platform scales. Marketing spend is the primary cost at scale.', positive: (annualSummary[4]?.ebitdaPct ?? 0) >= 0 },
                      { label: '2030 Gross Margin',            value: pct(annualSummary[4]?.grossMarginPct ?? 0), tip: 'Gross Profit ÷ Revenue. High gross margins reflect the asset-light protocol model — COGS is mostly gas and KYC.', positive: true },
                      { label: 'Terminal Value (12× EBITDA)',  value: fmt(Math.round(tv), true),         tip: '12× EBITDA is a conservative exit multiple for African fintech (public comps trade at 15–20×). Only applies when EBITDA is positive.', positive: tv > 0 },
                      { label: 'Enterprise MOIC (undiluted)',  value: `${moic.toFixed(1)}×`,             tip: 'Terminal value ÷ total capital raised. Undiluted — assumes 100% ownership at exit. Actual investor MOIC depends on entry valuation and dilution from each round.', positive: moic >= 1 },
                      { label: 'Company IRR (undiluted)',      value: irrStr,                            tip: 'Solved from annual net income minus investments, plus terminal value in year 5. Undiluted — actual investor IRR is lower, depending on equity stake at entry. A result of "n/a" means the IRR is implausibly high (>10,000%) or negative — check funding vs EBITDA assumptions.', positive: irrVal !== null && irrVal > 0 },
                      { label: 'Break-even Month',             value: breakevenMo?.label ?? 'Beyond model', tip: 'First calendar month where net income turns positive. Based on live model — changes automatically when you edit inputs.', positive: !!breakevenMo },
                    ].map(item => (
                      <div key={item.label} className="flex justify-between items-center border-b border-slate-100 pb-1.5">
                        <span className="text-xs text-slate-600 flex items-center gap-1">{item.label}<Tip text={item.tip} /></span>
                        <span className={`text-xs font-semibold font-mono ${item.positive ? 'text-emerald-700' : 'text-red-500'}`}>{item.value}</span>
                      </div>
                    ));
                  })()}
                </CardContent>
              </Card>
            </div>

            {/* Unit Economics */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold text-slate-700">Unit Economics (computed from 54-month model)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {(() => {
                  // ── Per-event economics (2030 maturity year — most representative) ──
                  const yr30 = model.slice(42, 54);
                  const ev30    = yr30.reduce((s, r) => s + r.events, 0);
                  const hf30    = yr30.reduce((s, r) => s + r.hedgeFees, 0);
                  const ef30    = yr30.reduce((s, r) => s + r.eventCreationFees, 0);
                  const cogs30  = yr30.reduce((s, r) => s + r.totalCOGS, 0);
                  const rev30   = yr30.reduce((s, r) => s + r.totalRevenue, 0);
                  const gp30    = yr30.reduce((s, r) => s + r.grossProfit, 0);
                  const revPerEvent  = ev30 > 0 ? (hf30 + ef30) / ev30 : 0;   // wallet fees excluded — separate stream
                  const cogsPerEvent = ev30 > 0 ? cogs30 / ev30 : 0;
                  const gpPerEvent   = revPerEvent - cogsPerEvent;
                  const gpPctEvent   = revPerEvent > 0 ? (gpPerEvent / revPerEvent) * 100 : 0;

                  // ── CAC: Total sales & marketing ÷ new customers acquired ──
                  const totalMktg        = model.reduce((s, r) => s + r.marketing, 0);
                  const cumW             = model[model.length - 1]?.cumWallets ?? 1;
                  const walletCac        = totalMktg / cumW;                          // blended wallet CAC
                  const hedgerCac        = walletCac * 5;                             // Active users require more targeted acquisition (demos, trust, education)

                  // ── Annual revenue per customer type (2030 maturity year) ──
                  const annualRevPerWallet  = rev30 / cumW;
                  const hedgerAnnualRev     = revPerEvent * 12;                       // 1 event/mo × 12 (conservative — speculators may transact more)

                  // ── Contribution margin per customer per year ──
                  const annualGpPerWallet   = gp30 / cumW;
                  const hedgerAnnualGp      = gpPerEvent * 12;

                  // ── LTV: Annual revenue × average customer lifetime ──
                  // Wallet: 2-year avg (mix of casual, active, and churned users)
                  // Active user: 3-year avg (engaged users — business or retail — tend to stay longer)
                  const walletLtv           = annualRevPerWallet * 2;
                  const hedgerLtv           = hedgerAnnualRev    * 3;

                  // ── LTV/CAC and Payback Period ──
                  const walletLtvCac        = walletLtv  / (walletCac  || 1);
                  const hedgerLtvCac        = hedgerLtv  / (hedgerCac  || 1);
                  const walletPaybackMo     = annualRevPerWallet > 0 ? walletCac  / (annualRevPerWallet / 12) : 999;
                  const hedgerPaybackMo     = hedgerAnnualRev    > 0 ? hedgerCac  / (hedgerAnnualRev    / 12) : 999;

                  const statBox = (label: string, value: string, sub: string, color = 'text-blue-600') => (
                    <div key={label} className="bg-slate-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className={`text-xl font-bold ${color} mt-1`}>{value}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
                    </div>
                  );

                  return (
                    <>
                      {/* Intro note */}
                      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-800 leading-relaxed">
                        <strong>Unit economics</strong> measures the direct revenues and costs of a single customer to determine if the business model is profitable at the individual level before scaling. BlockFinaX serves <strong>everyone</strong> — African SMEs, individual traders, crypto holders, and speculators — not just businesses. All figures computed from the 54-month model using 2030 maturity-year data.
                      </div>

                      {/* Section A — Contribution Margin per Unit */}
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">A · Contribution Margin — Per Hedge Event (unit = 1 protection event)</p>
                        <p className="text-xs text-slate-400 mb-3">The hedge event is the fundamental revenue unit — one business buying FX, commodity, or crypto protection. Contribution margin = revenue minus all variable costs directly tied to that event. Fixed costs (salaries, infra) are excluded here.</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {statBox('Revenue / Unit',            `$${Math.round(revPerEvent)}`,          'Hedge fee + creation fee',        'text-blue-600')}
                          {statBox('Variable Cost / Unit',      `$${Math.round(cogsPerEvent)}`,         'Creator loyalty + oracle + gas',  'text-slate-600')}
                          {statBox('Contribution Margin',       `$${Math.round(gpPerEvent)}`,           'Revenue − variable costs',        'text-emerald-600')}
                          {statBox('Contribution Margin %',     `${gpPctEvent.toFixed(0)}%`,            'Protocol-level efficiency',       'text-emerald-600')}
                        </div>
                      </div>

                      <hr className="border-slate-100" />

                      {/* Section B — Active Protection Buyer Full Unit Economics */}
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">B · Active Protection Buyer (unit = 1 user placing 1 event/month)</p>
                        <p className="text-xs text-slate-400 mb-3">
                          The platform is open to <strong>everyone</strong> — African SMEs managing FX exposure, individual traders protecting savings, and speculators taking directional positions on FX, commodities, or crypto. All generate the same per-event revenue. <strong>1 event/month is the conservative floor</strong> — speculators often transact far more frequently, which would push annual revenue and LTV higher. &nbsp;
                          <strong>CAC</strong> = acquisition cost for an active user (demos, trust-building, education — ~5× the cost of a passive wallet sign-up). &nbsp;
                          <strong>LTV/CAC &gt; 3×</strong> is the investor sustainability benchmark.
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                          {statBox('CAC',              `$${Math.round(hedgerCac)}`,                        'Acq. cost per active user',       'text-amber-600')}
                          {statBox('Annual Revenue',   `$${Math.round(hedgerAnnualRev).toLocaleString()}`, '12 events/yr × $130/event',       'text-blue-600')}
                          {statBox('Annual GP',        `$${Math.round(hedgerAnnualGp).toLocaleString()}`,  '12 × contribution margin',        'text-emerald-600')}
                          {statBox('LTV (3 yr)',        `$${Math.round(hedgerLtv).toLocaleString()}`,       'Annual rev × 3-yr avg retention', 'text-blue-600')}
                          {statBox('LTV / CAC',        `${hedgerLtvCac.toFixed(1)}×`,                      hedgerLtvCac >= 3 ? '✓ Above 3× benchmark' : '✗ Below 3× benchmark', hedgerLtvCac >= 3 ? 'text-emerald-600' : 'text-red-500')}
                        </div>
                        <div className="mt-2 grid grid-cols-1 gap-3">
                          {statBox('CAC Payback Period', `${hedgerPaybackMo.toFixed(1)} months`, 'Time to recoup acquisition cost from revenue — shorter is better', hedgerPaybackMo <= 12 ? 'text-emerald-600' : 'text-amber-600')}
                        </div>
                      </div>

                      <hr className="border-slate-100" />

                      {/* Section C — Wallet Customer Full Unit Economics */}
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">C · Platform Wallet — Blended View (most conservative)</p>
                        <p className="text-xs text-slate-400 mb-3">
                          <strong>Not every wallet will hedge.</strong> Many users will create a wallet purely for cross-border USDC payments and never place a protection event — they only generate the 0.3% transfer fee. This section divides <em>all</em> platform revenue by <em>all</em> wallets, including those payment-only users. That makes these figures a deliberate stress-test: even in a world where most wallets stay passive, the model still clears the 3× LTV/CAC benchmark. Every wallet that activates as a protection buyer lifts the actual per-wallet value well above these numbers. &nbsp;
                          <strong>CAC</strong> = total marketing ÷ total wallets. <strong>LTV</strong> = annual rev per wallet × 2-year avg retention.
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                          {statBox('CAC',              `$${Math.round(walletCac)}`,             'Total mktg ÷ total wallets',      'text-amber-600')}
                          {statBox('Annual Revenue',   `$${Math.round(annualRevPerWallet)}`,    '2030 rev ÷ cumulative wallets',   'text-blue-600')}
                          {statBox('Annual GP',        `$${Math.round(annualGpPerWallet)}`,     '2030 GP ÷ cumulative wallets',    'text-emerald-600')}
                          {statBox('LTV (2 yr)',        `$${Math.round(walletLtv)}`,             'Annual rev × 2-yr wallet tenure', 'text-blue-600')}
                          {statBox('LTV / CAC',        `${walletLtvCac.toFixed(1)}×`,           walletLtvCac >= 3 ? '✓ Above 3× benchmark' : '✗ Below 3× benchmark', walletLtvCac >= 3 ? 'text-emerald-600' : 'text-red-500')}
                        </div>
                        <div className="mt-2 grid grid-cols-1 gap-3">
                          {statBox('CAC Payback Period', `${walletPaybackMo.toFixed(1)} months`, 'Time to recoup acquisition cost from revenue — shorter is better', walletPaybackMo <= 12 ? 'text-emerald-600' : 'text-amber-600')}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ════════════════ MODEL NOTES ════════════════ */}
          <TabsContent value="notes" className="mt-4 space-y-4">
            <Card className="border-slate-200">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold text-slate-700">Model Methodology — Formula Reference</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 text-xs text-slate-700 leading-relaxed pb-6">

                <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-blue-800">
                  All figures are computed live from the monthly input table. Edit any input cell in the <strong>Edit Inputs</strong> tab and every number across all tabs updates instantly. This document explains every formula used so anyone can verify the model independently.
                </div>

                {/* Revenue */}
                <div>
                  <p className="font-semibold text-slate-800 mb-2 uppercase tracking-wide text-[10px]">A · Revenue (three streams)</p>
                  <div className="space-y-3">
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="font-semibold text-blue-700 mb-1">1. Hedge Protocol Fees (dominant, ~75–80% of revenue at scale)</p>
                      <code className="block bg-white rounded px-3 py-2 font-mono text-[11px] border border-slate-200">
                        Hedge Fees = Events × Avg Notional × Hedge Yield (0.7%)
                      </code>
                      <p className="mt-2 text-slate-500">
                        The 0.7% (70 bps) blends: 0.5% hedger entry premium + ~0.2% LP payout fee (1% payout fee × ~20% of notional paid out on average). This is conservative — the full blended yield including conditional settlement fees is closer to 1.1%.
                      </p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="font-semibold text-blue-700 mb-1">2. Event Creation Fees (~15–20% of revenue)</p>
                      <code className="block bg-white rounded px-3 py-2 font-mono text-[11px] border border-slate-200">
                        Event Creation Fees = Events × $2
                      </code>
                      <p className="mt-2 text-slate-500">Flat fee charged to the event creator on each new on-chain protection contract. Collected at event creation alongside the initial LP deposit.</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="font-semibold text-blue-700 mb-1">3. Wallet Transfer Fees (~5–10% of revenue at scale)</p>
                      <code className="block bg-white rounded px-3 py-2 font-mono text-[11px] border border-slate-200">
                        Wallet Fees = Cumulative Wallets × Active Wallet % × Avg Monthly Transfer ($500) × 0.3%
                      </code>
                      <p className="mt-2 text-slate-500">0.3% fee on USDC cross-border payments. Scales with the growing wallet base regardless of hedge activity — a passive revenue floor. Active wallet % and avg transfer are adjustable constants.</p>
                    </div>
                  </div>
                </div>

                {/* COGS */}
                <div>
                  <p className="font-semibold text-slate-800 mb-2 uppercase tracking-wide text-[10px]">B · Cost of Goods Sold (COGS) — variable costs directly tied to volume</p>
                  <div className="space-y-2">
                    {[
                      { label: 'Gas Costs',             formula: '(New Wallets × $3.00) + (Events × $0.05)', note: 'Wallet onboarding: 6 txns × ~$0.50 on Lisk L2 = $3.00. Hedge settlement: 6 txns × ~$0.008 = $0.05. Lisk is an OP Stack L2 — gas is ~50× cheaper than Ethereum mainnet.' },
                      { label: 'Oracle / RPC',          formula: 'Monthly oracle cost (manual input per month)', note: 'On-chain FX/commodity/crypto price feeds polled every 5 minutes. Costs scale with RPC call volume. Budget starts at $5K/month and rises with transaction throughput.' },
                      { label: 'Creator Loyalty (5%)',  formula: 'Hedge Fees × 5%', note: '5% of hedge protocol fees distributed back to event creators as a protocol loyalty incentive. Encourages liquidity depth and event quality.' },
                      { label: 'KYC / AML',             formula: 'New Wallets × $1.50', note: '$1.50 per wallet for identity verification. Regulatory requirement for African market operations. Covers basic AML screening required by BoG sandbox.' },
                    ].map(r => (
                      <div key={r.label} className="bg-slate-50 rounded-lg p-3">
                        <p className="font-semibold text-orange-700 mb-1">{r.label}</p>
                        <code className="block bg-white rounded px-3 py-2 font-mono text-[11px] border border-slate-200">{r.formula}</code>
                        <p className="mt-2 text-slate-500">{r.note}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* OpEx */}
                <div>
                  <p className="font-semibold text-slate-800 mb-2 uppercase tracking-wide text-[10px]">C · Operating Expenses (OpEx) — period costs, editable per month</p>
                  <div className="space-y-2">
                    {[
                      { label: 'Personnel',       formula: 'Headcount × Salary per FTE per month', note: 'All salaries, contractor fees, and benefits. Headcount and salary/FTE are editable in the monthly input table — rows update the model instantly.' },
                      { label: 'Marketing / CAC', formula: 'New Wallets × CAC per wallet (this month)', note: 'Acquisition cost per wallet. Includes paid campaigns, partnerships, community, and referral programs. CAC is per new wallet — the active-user CAC is approximately 5× higher due to demos, education, and trust-building.' },
                      { label: 'Legal',           formula: 'Monthly legal budget (manual input)', note: 'Legal counsel, BoG sandbox regulatory filing fees, IP protection, contract review, and compliance advisory. Peaks during regulatory applications; lower in later years.' },
                      { label: 'Infra / Cloud',   formula: 'Monthly infra budget (manual input)', note: 'Cloud hosting (Vercel/Railway/AWS), managed Postgres (Neon), RPC node access, CDN, monitoring (Sentry), CI/CD, and database scaling.' },
                      { label: 'G&A',             formula: 'Monthly G&A budget (manual input)', note: 'General & administrative: office, finance, accounting, insurance, HR overhead, software licences, and travel.' },
                    ].map(r => (
                      <div key={r.label} className="bg-slate-50 rounded-lg p-3">
                        <p className="font-semibold text-purple-700 mb-1">{r.label}</p>
                        <code className="block bg-white rounded px-3 py-2 font-mono text-[11px] border border-slate-200">{r.formula}</code>
                        <p className="mt-2 text-slate-500">{r.note}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* P&L waterfall */}
                <div>
                  <p className="font-semibold text-slate-800 mb-2 uppercase tracking-wide text-[10px]">D · P&L Waterfall</p>
                  <div className="bg-slate-50 rounded-lg p-3 space-y-1">
                    {[
                      ['Hedge Fees + Event Creation Fees + Wallet Transfer Fees', '= Total Revenue'],
                      ['Total Revenue − (Gas + Oracle + Creator Loyalty + KYC)',  '= Gross Profit'],
                      ['Gross Profit − (Personnel + Marketing + Legal + Infra + G&A)', '= EBITDA'],
                      ['EBITDA − D&A ($4,000/month non-cash)',                    '= EBIT'],
                      ['EBIT − Interest Expense (currently $0)',                  '= EBT'],
                      ['EBT − Tax (25% when EBT > 0, else $0)',                  '= Net Income'],
                    ].map(([left, right]) => (
                      <div key={right} className="flex justify-between items-start gap-4 py-1 border-b border-slate-200 last:border-0">
                        <span className="text-slate-600 font-mono text-[10px] flex-1">{left}</span>
                        <span className="text-blue-700 font-semibold font-mono text-[10px] whitespace-nowrap">{right}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Valuation */}
                <div>
                  <p className="font-semibold text-slate-800 mb-2 uppercase tracking-wide text-[10px]">E · Valuation & Return Metrics</p>
                  <div className="space-y-2">
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="font-semibold text-emerald-700 mb-1">Terminal Value</p>
                      <code className="block bg-white rounded px-3 py-2 font-mono text-[11px] border border-slate-200">Terminal Value = 2030 EBITDA × 12</code>
                      <p className="mt-2 text-slate-500">12× EBITDA is the exit multiple assumption. African fintech public comparables trade at 15–20× EBITDA; 12× is intentionally conservative. Terminal value is $0 if EBITDA is negative. EBITDA multiple (not revenue) is used because it reflects true operating cash generation and is the standard for fintech M&A.</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="font-semibold text-emerald-700 mb-1">Enterprise MOIC (undiluted)</p>
                      <code className="block bg-white rounded px-3 py-2 font-mono text-[11px] border border-slate-200">MOIC = Terminal Value ÷ Total Capital Raised</code>
                      <p className="mt-2 text-slate-500">Assumes investors collectively own 100% of the company at exit. In practice, founders and employees hold equity — actual investor MOIC depends on entry valuation, dilution across rounds, and exit structure.</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <p className="font-semibold text-emerald-700 mb-1">Company IRR (undiluted)</p>
                      <code className="block bg-white rounded px-3 py-2 font-mono text-[11px] border border-slate-200">Annual CFs = [−Investment + Net Income] per year; CF[4] += Terminal Value<br/>IRR = Newton-Raphson solve for rate where NPV = 0</code>
                      <p className="mt-2 text-slate-500">This is the enterprise-level IRR assuming a single investor provides all capital and receives 100% of the terminal value at exit in year 5. It overstates individual investor returns — actual investor IRR is lower based on their specific equity stake and entry price.</p>
                    </div>
                  </div>
                </div>

                {/* Key assumptions */}
                <div>
                  <p className="font-semibold text-slate-800 mb-2 uppercase tracking-wide text-[10px]">F · Key Assumptions & Known Conservatisms</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                      { label: 'Hedge Yield (0.7%)', note: 'Blends 0.5% hedger premium + ~0.2% LP payout fee. The full blended yield if all settlement fees are counted is ~1.1%. Model uses 0.7% — conservative.' },
                      { label: 'LP Ratio Not Modelled', note: 'The model assumes every hedge event is fully funded by LPs. LP shortfall risk is not modelled. Protocol design ensures LP deposits precede hedger buys.' },
                      { label: 'Gas Costs (Lisk L2)', note: 'Lisk is an OP Stack L2. Gas costs are ~50× lower than Ethereum mainnet. $3/wallet and $0.05/event are based on current L2 gas at ~$0.008/txn.' },
                      { label: 'Avg Monthly Transfer $500', note: 'Conservative estimate for active wallet transfer volume. Many African SMEs move $1,000–$5,000/month for trade settlement. Adjustable in constants.' },
                      { label: 'Tax Rate 25%', note: 'Approximate corporate tax rate for a Ghana-domiciled entity. No loss carryforward modelled — tax applies to all positive EBT months individually.' },
                      { label: 'D&A $4,000/month', note: 'Non-cash amortisation of capitalised platform development costs (smart contract audits, initial infrastructure). Has no cash impact — only affects EBIT and below.' },
                      { label: 'CAC Trajectory', note: 'H2 2026–H1 2028: paid acquisition ($21–40). H2 2028 viral tipping point: CAC drops sharply to $10–15 as BoG sandbox credibility, Series B deployment, and crypto community flywheel converge — comparable to Wave ($38→$6 in 18 months) and OPay ($40→$5 in 24 months). 2030 steady state: $4–5.' },
                      { label: '12× EBITDA Exit Multiple', note: 'Conservative. African fintech comparables trade at 15–20× EBITDA. Using 12× to present a floor-case valuation to investors.' },
                      { label: 'Break-even Definition', note: 'First calendar month where NET INCOME > 0 (after all costs and taxes). Based on revised CAC trajectory this is Jul 2028 (Month 25 — under 2 years from launch). EBITDA break-even occurs slightly earlier in the same month.' },
                    ].map(a => (
                      <div key={a.label} className="bg-slate-50 rounded-lg p-3">
                        <p className="font-semibold text-slate-700 text-[11px] mb-0.5">{a.label}</p>
                        <p className="text-slate-500">{a.note}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Growth inflection points */}
                <div>
                  <p className="font-semibold text-slate-800 mb-2 uppercase tracking-wide text-[10px]">G · User Growth — What Drives Each Inflection Point</p>
                  <p className="text-slate-500 mb-3 text-xs">The wallet growth curve accelerates in four distinct steps, each tied to a specific event. This section documents the assumptions behind each jump so they can be independently verified.</p>
                  <div className="space-y-3">
                    {[
                      {
                        date: 'Jan 2027 — Seed Round ($1.5M)',
                        color: 'text-blue-700',
                        bg: 'bg-blue-50 border-blue-100',
                        detail: 'New wallets jump from ~600 → ~800/month. The seed capital funds 3 additional hires (team: 6 → 9), enabling the first meaningful paid acquisition push. CAC remains high at ~$38 — this is pure top-of-funnel spend with no organic leverage yet.',
                      },
                      {
                        date: 'Jan 2028 — Series A ($8M)',
                        color: 'text-indigo-700',
                        bg: 'bg-indigo-50 border-indigo-100',
                        detail: "New wallets jump from ~10,200 → ~14,000/month. Series A unlocks a 25-person team and multi-country expansion into Nigeria, Kenya, and Côte d'Ivoire. CAC is falling organically ($23–26) as early adopters begin referring trading partners.",
                      },
                      {
                        date: 'Mid-2028 — Viral Tipping Point (sharpest acceleration)',
                        color: 'text-emerald-700',
                        bg: 'bg-emerald-50 border-emerald-100',
                        detail: "Three forces converge simultaneously: (1) Bank of Ghana sandbox approval — regulatory credibility converts trust-skeptical SMEs waiting for a licensed product; (2) Referral flywheel — users actively refer trading partners, driving CAC from $26 to $10–15 in under 6 months; (3) Crypto community flywheel — blockchain-native West African users spread adoption organically. Comparable to Wave's trajectory ($38 → $6 CAC in 18 months after West Africa critical mass) and OPay Nigeria ($40 → $5 in 24 months). New wallets grow from ~30K to ~72K/month across this window.",
                      },
                      {
                        date: 'Jul 2029 — Series B ($20M)',
                        color: 'text-amber-700',
                        bg: 'bg-amber-50 border-amber-100',
                        detail: 'New wallets jump from ~120K → ~132K/month. Product-market fit is proven and the referral flywheel is established. Series B funds deeper penetration across East and Southern Africa, infrastructure scaling, and enterprise corridor partnerships. CAC steady-state target: $4–5 by 2030.',
                      },
                    ].map(r => (
                      <div key={r.date} className={`rounded-lg p-3 border ${r.bg}`}>
                        <p className={`font-semibold text-[11px] mb-1 ${r.color}`}>{r.date}</p>
                        <p className="text-slate-600 text-xs leading-relaxed">{r.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>

              </CardContent>
            </Card>
          </TabsContent>

          {/* ════════════════ EDIT INPUTS ════════════════ */}
          <TabsContent value="inputs" className="mt-4 space-y-4">

            {/* Constants */}
            <Card className="border-blue-200 bg-blue-50/30">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold text-blue-800">Model Constants — change here to affect all months</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  {(() => {
                    const cls = `w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400 ${!editUnlocked ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`;
                    return (<>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Hedge Yield (decimal, e.g. 0.007 = 70 bps)</label>
                    <input type="number" step="0.0001" min="0" max="0.1" readOnly={!editUnlocked}
                      value={constants.hedgeYield}
                      onChange={e => editUnlocked && updateConstant('hedgeYield', parseFloat(e.target.value) || 0)}
                      className={cls}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Event Creation Fee ($)</label>
                    <input type="number" step="1" min="0" readOnly={!editUnlocked}
                      value={constants.eventCreationFee}
                      onChange={e => editUnlocked && updateConstant('eventCreationFee', parseFloat(e.target.value) || 0)}
                      className={cls}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Gas / Hedge Event ($)</label>
                    <input type="number" step="0.25" min="0" readOnly={!editUnlocked}
                      value={constants.gasPerEvent}
                      onChange={e => editUnlocked && updateConstant('gasPerEvent', parseFloat(e.target.value) || 0)}
                      className={cls}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Gas Sponsor / Wallet ($)</label>
                    <input type="number" step="1" min="0" readOnly={!editUnlocked}
                      value={constants.gasPerWallet}
                      onChange={e => editUnlocked && updateConstant('gasPerWallet', parseFloat(e.target.value) || 0)}
                      className={cls}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">KYC / AML Cost / Wallet ($)</label>
                    <input type="number" step="0.25" min="0" readOnly={!editUnlocked}
                      value={constants.kycPerWallet}
                      onChange={e => editUnlocked && updateConstant('kycPerWallet', parseFloat(e.target.value) || 0)}
                      className={cls}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Avg Monthly Transfer / Active Wallet ($)</label>
                    <input type="number" step="50" min="0" readOnly={!editUnlocked}
                      value={constants.avgMonthlyTransferUSD}
                      onChange={e => editUnlocked && updateConstant('avgMonthlyTransferUSD', parseFloat(e.target.value) || 0)}
                      className={cls}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">D&A per Month ($)</label>
                    <input type="number" step="100" min="0" readOnly={!editUnlocked}
                      value={constants.daMonthly}
                      onChange={e => editUnlocked && updateConstant('daMonthly', parseFloat(e.target.value) || 0)}
                      className={cls}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Tax Rate (decimal, e.g. 0.25 = 25%)</label>
                    <input type="number" step="0.01" min="0" max="1" readOnly={!editUnlocked}
                      value={constants.taxRate}
                      onChange={e => editUnlocked && updateConstant('taxRate', parseFloat(e.target.value) || 0)}
                      className={cls}
                    />
                  </div>
                    </>);
                  })()}
                </div>
              </CardContent>
            </Card>

            {/* Funding */}
            <Card className="border-amber-200 bg-amber-50/30">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold text-amber-800">Funding Tranches (set amount to 0 to disable)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  {funding.map((f, i) => (
                    <div key={i} className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700 block">{f.label}</label>
                      <div className="space-y-1">
                        <input placeholder="Label" value={f.label} readOnly={!editUnlocked}
                          onChange={e => editUnlocked && updateFunding(i, 'label', e.target.value)}
                          className={`w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-400 ${!editUnlocked ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
                        />
                        <input type="number" step="100000" min="0" placeholder="Amount ($)" value={f.amount} readOnly={!editUnlocked}
                          onChange={e => editUnlocked && updateFunding(i, 'amount', parseFloat(e.target.value) || 0)}
                          className={`w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-400 ${!editUnlocked ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
                        />
                        <select value={f.monthIndex} disabled={!editUnlocked}
                          onChange={e => editUnlocked && updateFunding(i, 'monthIndex', parseInt(e.target.value))}
                          className={`w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-amber-400 bg-white ${!editUnlocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          {MONTH_LABELS.map((lbl, mi) => (
                            <option key={mi} value={mi}>{lbl}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Monthly Input Table */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-semibold text-slate-700">Monthly Inputs — edit any cell and the entire model updates instantly</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-slate-800" style={{ minWidth: '1100px' }}>
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300">
                      <th className="text-xs px-2 py-2 text-left text-slate-600 font-semibold sticky left-0 bg-slate-100 min-w-[90px] border-r border-slate-200">Month</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-600 font-semibold min-w-[80px]">Events</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-600 font-semibold min-w-[90px]">Notional ($)</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-600 font-semibold min-w-[75px]">Wallet%</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-600 font-semibold min-w-[90px]">New Wallets</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-600 font-semibold min-w-[60px]">HC</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-600 font-semibold min-w-[85px]">Salary/FTE</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-600 font-semibold min-w-[60px]">CAC ($)</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-600 font-semibold min-w-[80px]">Legal ($)</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-600 font-semibold min-w-[90px]">Infra ($)</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-600 font-semibold min-w-[80px]">Oracle ($)</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-600 font-semibold min-w-[80px]">G&A ($)</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-500 font-medium min-w-[80px] border-l border-slate-200">→ Revenue</th>
                      <th className="text-xs px-2 py-1 text-right text-slate-500 font-medium min-w-[80px]">→ Net Inc.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inputs.map((inp, i) => {
                      const r = model[i];
                      const halfYearBorder = [0, 6, 12, 18, 24, 30, 36, 42, 48].includes(i);
                      return (
                        <tr key={i} className={`border-b ${halfYearBorder ? 'border-blue-200 bg-blue-50/20' : 'border-slate-100'} hover:bg-slate-50/60`}>
                          <td className={`text-xs px-2 py-1 sticky left-0 border-r border-slate-200 font-medium ${halfYearBorder ? 'bg-blue-50/40 text-blue-700' : 'bg-white text-slate-700'}`}>
                            {MONTH_LABELS[i]}
                          </td>
                          <td className="px-1 py-0.5"><NumInput value={inp.events}      onChange={v => updateInput(i, 'events', v)} /></td>
                          <td className="px-1 py-0.5"><NumInput value={inp.avgNotional}  onChange={v => updateInput(i, 'avgNotional', v)} step={100} /></td>
                          <td className="px-1 py-0.5"><NumInput value={inp.walletPct}    onChange={v => updateInput(i, 'walletPct', v)} step={0.5} /></td>
                          <td className="px-1 py-0.5"><NumInput value={inp.newWallets}   onChange={v => updateInput(i, 'newWallets', v)} step={100} /></td>
                          <td className="px-1 py-0.5"><NumInput value={inp.headcount}    onChange={v => updateInput(i, 'headcount', v)} /></td>
                          <td className="px-1 py-0.5"><NumInput value={inp.salaryPerFTE} onChange={v => updateInput(i, 'salaryPerFTE', v)} step={100} /></td>
                          <td className="px-1 py-0.5"><NumInput value={inp.cac}          onChange={v => updateInput(i, 'cac', v)} /></td>
                          <td className="px-1 py-0.5"><NumInput value={inp.legal}        onChange={v => updateInput(i, 'legal', v)} step={100} /></td>
                          <td className="px-1 py-0.5"><NumInput value={inp.infraCloud}   onChange={v => updateInput(i, 'infraCloud', v)} step={500} /></td>
                          <td className="px-1 py-0.5"><NumInput value={inp.oracle}       onChange={v => updateInput(i, 'oracle', v)} step={100} /></td>
                          <td className="px-1 py-0.5"><NumInput value={inp.ga}           onChange={v => updateInput(i, 'ga', v)} step={100} /></td>
                          <td className={`text-xs px-2 py-0.5 text-right font-mono border-l border-slate-200 ${r.totalRevenue > 0 ? 'text-blue-700 font-semibold' : 'text-slate-400'}`}>
                            {fmt(r.totalRevenue, true)}
                          </td>
                          <td className={`text-xs px-2 py-0.5 text-right font-mono ${r.netIncome >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-500'}`}>
                            {fmt(r.netIncome, true)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Edit Password Modal ── */}
      {showPwModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <Lock className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-base">Edit Access Required</h3>
                <p className="text-xs text-slate-500">Enter the edit password to modify the model</p>
              </div>
            </div>
            <input
              type="password"
              value={pwValue}
              onChange={e => { setPwValue(e.target.value); setPwError(''); }}
              onKeyDown={e => e.key === 'Enter' && verifyEditCode()}
              placeholder="Edit password"
              autoFocus
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-2"
            />
            {pwError && <p className="text-xs text-red-500 mb-2">{pwError}</p>}
            <div className="flex gap-2 mt-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowPwModal(false)}>Cancel</Button>
              <Button size="sm" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={verifyEditCode} disabled={pwLoading || !pwValue}>
                {pwLoading ? 'Checking…' : 'Unlock'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
