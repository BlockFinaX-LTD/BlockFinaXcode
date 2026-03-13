// Shared financial model — single source of truth used by both
// the interactive financial model page and the data room documents.

export type InputRow = {
  events: number;
  avgNotional: number;
  walletPct: number;
  newWallets: number;
  headcount: number;
  salaryPerFTE: number;
  cac: number;
  legal: number;
  infraCloud: number;
  oracle: number;
  ga: number;
};

export type Constants = {
  hedgeYield: number;
  eventCreationFee: number;
  gasPerWallet: number;
  kycPerWallet: number;
  daMonthly: number;
  taxRate: number;
};

export type FundingEntry = { monthIndex: number; amount: number; label: string };

export type MonthRow = {
  month: number; label: string;
  events: number; avgNotional: number; newWallets: number; headcount: number; cac: number; cumWallets: number;
  hedgeFees: number; eventCreationFees: number; walletFees: number; totalRevenue: number;
  gasCost: number; oracleCost: number; creatorLoyalty: number; kycCost: number; totalCOGS: number;
  grossProfit: number; grossMarginPct: number;
  personnel: number; marketing: number; legal: number; infraCloud: number; ga: number; totalOpEx: number;
  ebitda: number; ebitdaMarginPct: number;
  da: number; ebit: number; interestExpense: number; ebt: number;
  taxExpense: number; netIncome: number; netMarginPct: number;
  cashFlow: number; fundingReceived: number; cumulativeCash: number; burnRate: number; runway: number;
};

export type AnnualRow = {
  year: string;
  months: number[];
  totalRevenue: number;
  hedgeFees: number;
  eventCreationFees: number;
  walletFees: number;
  gasCost: number;
  oracleCost: number;
  creatorLoyalty: number;
  kycCost: number;
  totalCOGS: number;
  personnel: number;
  marketing: number;
  legal: number;
  infraCloud: number;
  ga: number;
  totalOpEx: number;
  totalCosts: number;
  grossProfit: number;
  ebitda: number;
  netIncome: number;
  notionalHedged: number;
  totalEvents: number;
  totalNewWallets: number;
};

// ── Month labels (54 months: Jul 2026 – Dec 2030) ────────────────────────────
export const MONTH_LABELS = [
  'Jul 2026','Aug 2026','Sep 2026','Oct 2026','Nov 2026','Dec 2026',
  'Jan 2027','Feb 2027','Mar 2027','Apr 2027','May 2027','Jun 2027',
  'Jul 2027','Aug 2027','Sep 2027','Oct 2027','Nov 2027','Dec 2027',
  'Jan 2028','Feb 2028','Mar 2028','Apr 2028','May 2028','Jun 2028',
  'Jul 2028','Aug 2028','Sep 2028','Oct 2028','Nov 2028','Dec 2028',
  'Jan 2029','Feb 2029','Mar 2029','Apr 2029','May 2029','Jun 2029',
  'Jul 2029','Aug 2029','Sep 2029','Oct 2029','Nov 2029','Dec 2029',
  'Jan 2030','Feb 2030','Mar 2030','Apr 2030','May 2030','Jun 2030',
  'Jul 2030','Aug 2030','Sep 2030','Oct 2030','Nov 2030','Dec 2030',
];

// ── Default constants ─────────────────────────────────────────────────────────
export const INITIAL_CONSTANTS: Constants = {
  hedgeYield: 0.007,
  eventCreationFee: 25,
  gasPerWallet: 15,
  kycPerWallet: 1.50,
  daMonthly: 4000,
  taxRate: 0.25,
};

// ── Default funding schedule ──────────────────────────────────────────────────
export const INITIAL_FUNDING: FundingEntry[] = [
  { monthIndex: 0,  amount:   500_000, label: 'Pre-Seed' },
  { monthIndex: 12, amount: 5_000_000, label: 'Series A' },
  { monthIndex: 24, amount: 7_000_000, label: 'Series B' },
  { monthIndex: 36, amount: 0,         label: 'Series C (optional)' },
  { monthIndex: 48, amount: 0,         label: 'Tranche 5 (optional)' },
];

// ── 54-month input data ───────────────────────────────────────────────────────
export const INITIAL_INPUTS: InputRow[] = [
  // H2 2026 (months 1-6)
  { events:    50, avgNotional:14500, walletPct:10, newWallets:    50, headcount: 4, salaryPerFTE:3500, cac:15, legal:18000, infraCloud:  800, oracle:  400, ga: 1500 },
  { events:    80, avgNotional:14500, walletPct:10, newWallets:    80, headcount: 4, salaryPerFTE:3500, cac:15, legal:18000, infraCloud:  800, oracle:  400, ga: 1500 },
  { events:   120, avgNotional:14500, walletPct:10, newWallets:   120, headcount: 5, salaryPerFTE:3500, cac:15, legal:16000, infraCloud: 1000, oracle:  500, ga: 1800 },
  { events:   180, avgNotional:14500, walletPct:10, newWallets:   180, headcount: 5, salaryPerFTE:3500, cac:15, legal:16000, infraCloud: 1000, oracle:  500, ga: 1800 },
  { events:   260, avgNotional:14500, walletPct:10, newWallets:   260, headcount: 5, salaryPerFTE:3500, cac:15, legal:15000, infraCloud: 1200, oracle:  600, ga: 2000 },
  { events:   400, avgNotional:14500, walletPct:10, newWallets:   400, headcount: 5, salaryPerFTE:3500, cac:15, legal:15000, infraCloud: 1200, oracle:  600, ga: 2000 },
  // H1 2027 (months 7-12)
  { events:   600, avgNotional:15200, walletPct:12, newWallets:  1200, headcount: 8, salaryPerFTE:5000, cac:25, legal:20000, infraCloud: 3000, oracle: 1500, ga: 5000 },
  { events:   800, avgNotional:15200, walletPct:12, newWallets:  1500, headcount: 8, salaryPerFTE:5000, cac:25, legal:20000, infraCloud: 3000, oracle: 1500, ga: 5000 },
  { events:  1000, avgNotional:15500, walletPct:12, newWallets:  1800, headcount: 8, salaryPerFTE:5000, cac:25, legal:21000, infraCloud: 3500, oracle: 1800, ga: 5000 },
  { events:  1300, avgNotional:15500, walletPct:12, newWallets:  2200, headcount: 9, salaryPerFTE:5000, cac:25, legal:21000, infraCloud: 3500, oracle: 1800, ga: 5500 },
  { events:  1700, avgNotional:15800, walletPct:12, newWallets:  2800, headcount: 9, salaryPerFTE:5000, cac:25, legal:22000, infraCloud: 3500, oracle: 2000, ga: 5500 },
  { events:  2200, avgNotional:15800, walletPct:12, newWallets:  3500, headcount: 9, salaryPerFTE:5000, cac:25, legal:22000, infraCloud: 4000, oracle: 2000, ga: 6000 },
  // H2 2027 (months 13-18)
  { events:  3200, avgNotional:16000, walletPct:12, newWallets:  5000, headcount:13, salaryPerFTE:5500, cac:20, legal:24000, infraCloud: 7000, oracle: 3000, ga: 8000 },
  { events:  3700, avgNotional:16200, walletPct:12, newWallets:  5800, headcount:13, salaryPerFTE:5500, cac:20, legal:24000, infraCloud: 7000, oracle: 3000, ga: 8000 },
  { events:  4300, avgNotional:16200, walletPct:12, newWallets:  6500, headcount:14, salaryPerFTE:5500, cac:20, legal:25000, infraCloud: 7500, oracle: 3200, ga: 8500 },
  { events:  5000, avgNotional:16500, walletPct:12, newWallets:  7200, headcount:14, salaryPerFTE:5500, cac:20, legal:25000, infraCloud: 7500, oracle: 3200, ga: 8500 },
  { events:  5700, avgNotional:16500, walletPct:12, newWallets:  8000, headcount:15, salaryPerFTE:5500, cac:18, legal:26000, infraCloud: 8000, oracle: 3500, ga: 9000 },
  { events:  6500, avgNotional:17000, walletPct:12, newWallets:  9000, headcount:15, salaryPerFTE:5500, cac:18, legal:26000, infraCloud: 8000, oracle: 3500, ga: 9000 },
  // H1 2028 (months 19-24)
  { events:  5800, avgNotional:18000, walletPct:15, newWallets: 10000, headcount:18, salaryPerFTE:6000, cac:18, legal:28000, infraCloud:14000, oracle: 5500, ga:12000 },
  { events:  7200, avgNotional:18000, walletPct:15, newWallets: 11500, headcount:18, salaryPerFTE:6000, cac:18, legal:28000, infraCloud:14000, oracle: 5500, ga:12000 },
  { events:  8600, avgNotional:18000, walletPct:15, newWallets: 13000, headcount:20, salaryPerFTE:6000, cac:18, legal:30000, infraCloud:15000, oracle: 6000, ga:12500 },
  { events: 10000, avgNotional:18000, walletPct:15, newWallets: 14500, headcount:20, salaryPerFTE:6000, cac:16, legal:30000, infraCloud:15000, oracle: 6000, ga:12500 },
  { events: 12000, avgNotional:18000, walletPct:15, newWallets: 16500, headcount:22, salaryPerFTE:6000, cac:16, legal:32000, infraCloud:16000, oracle: 6500, ga:13000 },
  { events: 14000, avgNotional:18000, walletPct:15, newWallets: 18500, headcount:22, salaryPerFTE:6000, cac:16, legal:32000, infraCloud:16000, oracle: 6500, ga:13000 },
  // H2 2028 (months 25-30)
  { events: 15500, avgNotional:20000, walletPct:15, newWallets: 21000, headcount:26, salaryPerFTE:6500, cac:15, legal:34000, infraCloud:22000, oracle: 8500, ga:16000 },
  { events: 17000, avgNotional:20000, walletPct:15, newWallets: 23000, headcount:26, salaryPerFTE:6500, cac:15, legal:34000, infraCloud:23000, oracle: 8500, ga:16000 },
  { events: 18500, avgNotional:20500, walletPct:15, newWallets: 25000, headcount:28, salaryPerFTE:6500, cac:14, legal:36000, infraCloud:24000, oracle: 9000, ga:17000 },
  { events: 20000, avgNotional:20500, walletPct:15, newWallets: 27000, headcount:28, salaryPerFTE:6500, cac:14, legal:36000, infraCloud:25000, oracle: 9000, ga:17000 },
  { events: 22000, avgNotional:21000, walletPct:15, newWallets: 29000, headcount:30, salaryPerFTE:6500, cac:14, legal:38000, infraCloud:26000, oracle: 9500, ga:18000 },
  { events: 24000, avgNotional:21000, walletPct:15, newWallets: 31000, headcount:30, salaryPerFTE:6500, cac:14, legal:38000, infraCloud:26000, oracle: 9500, ga:18000 },
  // H1 2029 (months 31-36)
  { events: 21000, avgNotional:22000, walletPct:18, newWallets: 33000, headcount:36, salaryPerFTE:7000, cac:13, legal:40000, infraCloud:36000, oracle:13000, ga:22000 },
  { events: 24000, avgNotional:22000, walletPct:18, newWallets: 36000, headcount:36, salaryPerFTE:7000, cac:13, legal:40000, infraCloud:38000, oracle:13000, ga:22000 },
  { events: 27000, avgNotional:22000, walletPct:18, newWallets: 39000, headcount:40, salaryPerFTE:7000, cac:13, legal:42000, infraCloud:40000, oracle:14000, ga:24000 },
  { events: 30000, avgNotional:22000, walletPct:18, newWallets: 42000, headcount:40, salaryPerFTE:7000, cac:12, legal:42000, infraCloud:42000, oracle:14000, ga:24000 },
  { events: 34000, avgNotional:22000, walletPct:18, newWallets: 46000, headcount:44, salaryPerFTE:7000, cac:12, legal:44000, infraCloud:44000, oracle:15000, ga:26000 },
  { events: 38000, avgNotional:22000, walletPct:18, newWallets: 50000, headcount:44, salaryPerFTE:7000, cac:12, legal:44000, infraCloud:46000, oracle:15000, ga:26000 },
  // H2 2029 (months 37-42)
  { events: 42000, avgNotional:23000, walletPct:18, newWallets: 54000, headcount:48, salaryPerFTE:7500, cac:11, legal:46000, infraCloud:60000, oracle:19000, ga:30000 },
  { events: 46000, avgNotional:23000, walletPct:18, newWallets: 58000, headcount:48, salaryPerFTE:7500, cac:11, legal:46000, infraCloud:63000, oracle:19000, ga:30000 },
  { events: 50000, avgNotional:23000, walletPct:18, newWallets: 62000, headcount:52, salaryPerFTE:7500, cac:11, legal:48000, infraCloud:66000, oracle:20000, ga:32000 },
  { events: 54000, avgNotional:23000, walletPct:18, newWallets: 66000, headcount:52, salaryPerFTE:7500, cac:10, legal:48000, infraCloud:69000, oracle:20000, ga:32000 },
  { events: 58000, avgNotional:23000, walletPct:18, newWallets: 70000, headcount:56, salaryPerFTE:7500, cac:10, legal:50000, infraCloud:72000, oracle:21000, ga:34000 },
  { events: 63000, avgNotional:23000, walletPct:18, newWallets: 74000, headcount:56, salaryPerFTE:7500, cac:10, legal:50000, infraCloud:75000, oracle:21000, ga:34000 },
  // H1 2030 (months 43-48)
  { events:  48000, avgNotional:24000, walletPct:20, newWallets:  85000, headcount:62, salaryPerFTE:8000, cac: 9, legal:52000, infraCloud: 92000, oracle:30000, ga:42000 },
  { events:  58000, avgNotional:24000, walletPct:20, newWallets:  92000, headcount:62, salaryPerFTE:8000, cac: 9, legal:52000, infraCloud: 97000, oracle:30000, ga:42000 },
  { events:  68000, avgNotional:24000, walletPct:20, newWallets: 100000, headcount:68, salaryPerFTE:8000, cac: 9, legal:54000, infraCloud:102000, oracle:32000, ga:45000 },
  { events:  78000, avgNotional:24000, walletPct:20, newWallets: 108000, headcount:68, salaryPerFTE:8000, cac: 8, legal:54000, infraCloud:107000, oracle:32000, ga:45000 },
  { events:  92000, avgNotional:24000, walletPct:20, newWallets: 118000, headcount:74, salaryPerFTE:8000, cac: 8, legal:56000, infraCloud:115000, oracle:34000, ga:48000 },
  { events: 107000, avgNotional:24000, walletPct:20, newWallets: 128000, headcount:74, salaryPerFTE:8000, cac: 8, legal:56000, infraCloud:120000, oracle:34000, ga:48000 },
  // H2 2030 (months 49-54)
  { events: 120000, avgNotional:25000, walletPct:20, newWallets: 138000, headcount:80, salaryPerFTE:8500, cac: 8, legal:58000, infraCloud:136000, oracle:40000, ga:55000 },
  { events: 135000, avgNotional:25000, walletPct:20, newWallets: 148000, headcount:80, salaryPerFTE:8500, cac: 7, legal:58000, infraCloud:142000, oracle:40000, ga:55000 },
  { events: 150000, avgNotional:25000, walletPct:20, newWallets: 158000, headcount:86, salaryPerFTE:8500, cac: 7, legal:60000, infraCloud:148000, oracle:42000, ga:58000 },
  { events: 162000, avgNotional:25000, walletPct:20, newWallets: 168000, headcount:86, salaryPerFTE:8500, cac: 7, legal:60000, infraCloud:154000, oracle:42000, ga:58000 },
  { events: 173000, avgNotional:25000, walletPct:20, newWallets: 180000, headcount:92, salaryPerFTE:8500, cac: 7, legal:62000, infraCloud:162000, oracle:44000, ga:62000 },
  { events: 174000, avgNotional:25000, walletPct:20, newWallets: 190000, headcount:92, salaryPerFTE:8500, cac: 7, legal:62000, infraCloud:168000, oracle:44000, ga:62000 },
];

// ── Core model computation ────────────────────────────────────────────────────
export function buildModel(inputs: InputRow[], c: Constants, funding: FundingEntry[]): MonthRow[] {
  const fundingMap: Record<number, number> = {};
  funding.forEach(f => { if (f.amount > 0) fundingMap[f.monthIndex] = (fundingMap[f.monthIndex] ?? 0) + f.amount; });

  let cumulativeCash = 0;
  let cumWallets = 0;

  return inputs.map((inp, i) => {
    const received = fundingMap[i] ?? 0;
    cumulativeCash += received;
    cumWallets += inp.newWallets;

    const hedgeFees         = Math.round(inp.events * inp.avgNotional * c.hedgeYield);
    const eventCreationFees = Math.round(inp.events * c.eventCreationFee);
    const walletFees        = Math.round(hedgeFees * (inp.walletPct / 100));
    const totalRevenue      = hedgeFees + eventCreationFees + walletFees;

    const gasCost        = inp.newWallets * c.gasPerWallet;
    const oracleCost     = inp.oracle;
    const creatorLoyalty = Math.round(hedgeFees * 0.05);
    const kycCost        = Math.round(inp.newWallets * c.kycPerWallet);
    const totalCOGS      = gasCost + oracleCost + creatorLoyalty + kycCost;

    const grossProfit    = totalRevenue - totalCOGS;
    const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    const personnel  = inp.headcount * inp.salaryPerFTE;
    const marketing  = inp.newWallets * inp.cac;
    const totalOpEx  = personnel + marketing + inp.legal + inp.infraCloud + inp.ga;

    const ebitda          = grossProfit - totalOpEx;
    const ebitdaMarginPct = totalRevenue > 0 ? (ebitda / totalRevenue) * 100 : 0;

    const ebit            = ebitda - c.daMonthly;
    const interestExpense = 0;
    const ebt             = ebit - interestExpense;
    const taxExpense      = ebt > 0 ? Math.round(ebt * c.taxRate) : 0;
    const netIncome       = ebt - taxExpense;
    const netMarginPct    = totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0;

    const cashFlow = netIncome + c.daMonthly;
    cumulativeCash += cashFlow;
    const burnRate = cashFlow < 0 ? Math.abs(cashFlow) : 0;
    const runway   = burnRate > 0 ? Math.round(cumulativeCash / burnRate) : 999;

    return {
      month: i + 1, label: MONTH_LABELS[i],
      events: inp.events, avgNotional: inp.avgNotional, newWallets: inp.newWallets,
      headcount: inp.headcount, cac: inp.cac, cumWallets,
      hedgeFees, eventCreationFees, walletFees, totalRevenue,
      gasCost, oracleCost, creatorLoyalty, kycCost, totalCOGS,
      grossProfit, grossMarginPct,
      personnel, marketing, legal: inp.legal, infraCloud: inp.infraCloud, ga: inp.ga, totalOpEx,
      ebitda, ebitdaMarginPct,
      da: c.daMonthly, ebit, interestExpense, ebt,
      taxExpense, netIncome, netMarginPct,
      cashFlow, fundingReceived: received, cumulativeCash, burnRate, runway,
    };
  });
}

// ── Sum monthly rows for a slice of months ────────────────────────────────────
function sumSlice(rows: MonthRow[], start: number, end: number): AnnualRow & { year: string; months: number[] } {
  const slice = rows.slice(start, end);
  const sum = <K extends keyof MonthRow>(key: K): number =>
    slice.reduce((acc, r) => acc + (r[key] as number), 0);

  return {
    year: '',
    months: slice.map(r => r.month),
    totalRevenue:      sum('totalRevenue'),
    hedgeFees:         sum('hedgeFees'),
    eventCreationFees: sum('eventCreationFees'),
    walletFees:        sum('walletFees'),
    gasCost:           sum('gasCost'),
    oracleCost:        sum('oracleCost'),
    creatorLoyalty:    sum('creatorLoyalty'),
    kycCost:           sum('kycCost'),
    totalCOGS:         sum('totalCOGS'),
    personnel:         sum('personnel'),
    marketing:         sum('marketing'),
    legal:             sum('legal'),
    infraCloud:        sum('infraCloud'),
    ga:                sum('ga'),
    totalOpEx:         sum('totalOpEx'),
    totalCosts:        sum('totalCOGS') + sum('totalOpEx'),
    grossProfit:       sum('grossProfit'),
    ebitda:            sum('ebitda'),
    netIncome:         sum('netIncome'),
    notionalHedged:    slice.reduce((acc, r) => acc + r.events * r.avgNotional, 0),
    totalEvents:       sum('events'),
    totalNewWallets:   sum('newWallets'),
  };
}

// ── Pre-computed default annual aggregates (using default inputs & constants) ─
function computeDefaultAnnuals(): AnnualRow[] {
  const rows = buildModel(INITIAL_INPUTS, INITIAL_CONSTANTS, INITIAL_FUNDING);
  const slices: Array<[string, number, number]> = [
    ['2026 (H2 only)', 0, 6],
    ['2027 (Full Year)', 6, 18],
    ['2028 (Full Year)', 18, 30],
    ['2029 (Full Year)', 30, 42],
    ['2030 (Full Year)', 42, 54],
  ];
  return slices.map(([year, start, end]) => ({ ...sumSlice(rows, start, end), year }));
}

export const DEFAULT_ANNUALS: AnnualRow[] = computeDefaultAnnuals();

// ── Formatting helpers ────────────────────────────────────────────────────────
export function fmtUSD(n: number, decimals = 0): string {
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)         return `$${(n / 1_000).toFixed(decimals === 0 ? 0 : 1)}K`;
  return `$${n.toFixed(decimals)}`;
}

export function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}
