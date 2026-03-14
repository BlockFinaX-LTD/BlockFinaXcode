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
  gasPerEvent: number;          // on-chain gas per full hedge lifecycle (create→settle→claim)
  gasPerWallet: number;
  kycPerWallet: number;
  avgMonthlyTransferUSD: number; // avg monthly USDC transfer volume per active wallet
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
  gasPerEvent: 0.05,            // Lisk L2 (OP Stack): ~6 txns × ~$0.008 per txn = ~$0.05
  gasPerWallet: 3,
  kycPerWallet: 1.50,
  avgMonthlyTransferUSD: 500,
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

// ── 54-month input data (v3 — Revised CAC trajectory) ────────────────────────
// Assumptions:
//   • Events: 20 → 74,300/month over 4.5 years (unchanged)
//   • Avg notional: $8K → $15K (unchanged)
//   • Wallets: ~5M cumulative by Dec 2030 (unchanged — same wallet growth)
//   • CAC trajectory revised: $38–40 early → $4–5 by 2030.
//     H1 2028: CAC $21–26 — organic referrals begin replacing paid spend.
//     H2 2028 VIRAL TIPPING POINT: CAC drops to $10–15 as BoG sandbox
//     credibility + Series B deployment + crypto community flywheel hit
//     simultaneously. Comparable: Wave went from $38 CAC → $6 CAC in 18 months
//     once West Africa reached critical mass. OPay Nigeria: $40 → $5 in 24 mo.
//     H1 2029: CAC $10–14 — referrals now dominant channel.
//     2030: CAC $4–6 — steady-state platform/network effect acquisition.
//   • Break-even: ~Jul 2028 (Month 25) — under 2 years from launch.
//   • gasPerWallet: $3 (Lisk L2); Headcount: 5 → 71 (unchanged)
export const INITIAL_INPUTS: InputRow[] = [
  // H2 2026 — Beta/Pilot (months 1-6)
  { events:    20, avgNotional: 8000, walletPct: 5, newWallets:     65, headcount: 5, salaryPerFTE:4500, cac:40, legal:15000, infraCloud:  600, oracle:  300, ga: 1200 },
  { events:    35, avgNotional: 8000, walletPct: 5, newWallets:    110, headcount: 5, salaryPerFTE:4500, cac:40, legal:15000, infraCloud:  600, oracle:  300, ga: 1200 },
  { events:    60, avgNotional: 8500, walletPct: 5, newWallets:    200, headcount: 5, salaryPerFTE:4500, cac:38, legal:13000, infraCloud:  800, oracle:  400, ga: 1500 },
  { events:    95, avgNotional: 8500, walletPct: 5, newWallets:    300, headcount: 6, salaryPerFTE:4500, cac:38, legal:13000, infraCloud:  800, oracle:  400, ga: 1500 },
  { events:   140, avgNotional: 9000, walletPct: 5, newWallets:    430, headcount: 6, salaryPerFTE:4500, cac:36, legal:12000, infraCloud: 1000, oracle:  500, ga: 1800 },
  { events:   200, avgNotional: 9000, walletPct: 5, newWallets:    600, headcount: 6, salaryPerFTE:4500, cac:36, legal:12000, infraCloud: 1000, oracle:  500, ga: 1800 },
  // H1 2027 — Early Traction, Series A prep (months 7-12)
  { events:   280, avgNotional: 9500, walletPct: 6, newWallets:    800, headcount: 9, salaryPerFTE:5000, cac:38, legal:18000, infraCloud: 1800, oracle:  900, ga: 3500 },
  { events:   380, avgNotional: 9500, walletPct: 6, newWallets:  1_050, headcount: 9, salaryPerFTE:5000, cac:38, legal:18000, infraCloud: 1800, oracle:  900, ga: 3500 },
  { events:   500, avgNotional:10000, walletPct: 6, newWallets:  1_400, headcount:10, salaryPerFTE:5000, cac:38, legal:19000, infraCloud: 2200, oracle: 1100, ga: 4000 },
  { events:   650, avgNotional:10000, walletPct: 6, newWallets:  1_800, headcount:10, salaryPerFTE:5000, cac:38, legal:19000, infraCloud: 2200, oracle: 1100, ga: 4000 },
  { events:   840, avgNotional:10000, walletPct: 7, newWallets:  2_200, headcount:11, salaryPerFTE:5000, cac:37, legal:20000, infraCloud: 2600, oracle: 1300, ga: 4500 },
  { events:  1080, avgNotional:10000, walletPct: 7, newWallets:  2_800, headcount:11, salaryPerFTE:5000, cac:37, legal:20000, infraCloud: 2600, oracle: 1300, ga: 4500 },
  // H2 2027 — Series A deployed, Ghana + Nigeria expansion (months 13-18)
  { events:  1380, avgNotional:10500, walletPct: 7, newWallets:  4_000, headcount:16, salaryPerFTE:5200, cac:37, legal:24000, infraCloud: 5000, oracle: 2500, ga: 7000 },
  { events:  1730, avgNotional:10500, walletPct: 7, newWallets:  4_900, headcount:16, salaryPerFTE:5200, cac:37, legal:24000, infraCloud: 5000, oracle: 2500, ga: 7000 },
  { events:  2100, avgNotional:11000, walletPct: 8, newWallets:  5_900, headcount:18, salaryPerFTE:5200, cac:36, legal:25000, infraCloud: 5500, oracle: 2800, ga: 7500 },
  { events:  2500, avgNotional:11000, walletPct: 8, newWallets:  7_100, headcount:18, salaryPerFTE:5200, cac:36, legal:25000, infraCloud: 5500, oracle: 2800, ga: 7500 },
  { events:  2950, avgNotional:11000, walletPct: 8, newWallets:  8_500, headcount:20, salaryPerFTE:5200, cac:35, legal:26000, infraCloud: 6000, oracle: 3000, ga: 8000 },
  { events:  3450, avgNotional:11500, walletPct: 8, newWallets: 10_200, headcount:20, salaryPerFTE:5200, cac:35, legal:26000, infraCloud: 6000, oracle: 3000, ga: 8000 },
  // H1 2028 — Scaling multi-country; organic referrals beginning to displace paid (months 19-24)
  { events:  4000, avgNotional:11500, walletPct: 9, newWallets: 14_000, headcount:25, salaryPerFTE:5600, cac:26, legal:30000, infraCloud: 9000, oracle: 4500, ga:11000 },
  { events:  4600, avgNotional:12000, walletPct: 9, newWallets: 16_500, headcount:25, salaryPerFTE:5600, cac:25, legal:30000, infraCloud: 9500, oracle: 4500, ga:11000 },
  { events:  5250, avgNotional:12000, walletPct: 9, newWallets: 19_000, headcount:27, salaryPerFTE:5600, cac:24, legal:32000, infraCloud:10000, oracle: 5000, ga:11500 },
  { events:  5950, avgNotional:12000, walletPct: 9, newWallets: 22_000, headcount:27, salaryPerFTE:5600, cac:23, legal:32000, infraCloud:10000, oracle: 5000, ga:11500 },
  { events:  6700, avgNotional:12500, walletPct:10, newWallets: 25_500, headcount:30, salaryPerFTE:5600, cac:22, legal:34000, infraCloud:11000, oracle: 5500, ga:12000 },
  { events:  7500, avgNotional:12500, walletPct:10, newWallets: 29_500, headcount:30, salaryPerFTE:5600, cac:21, legal:34000, infraCloud:11000, oracle: 5500, ga:12000 },
  // H2 2028 — Series B deployed; VIRAL TIPPING POINT — BoG sandbox live, B2B referrals dominate (months 25-30)
  // CAC drops sharply: institutional credibility + crypto community flywheel + partner integrations
  { events:  8400, avgNotional:13000, walletPct:10, newWallets: 34_000, headcount:34, salaryPerFTE:5800, cac:15, legal:36000, infraCloud:14000, oracle: 7000, ga:14000 },
  { events:  9350, avgNotional:13000, walletPct:10, newWallets: 39_000, headcount:34, salaryPerFTE:5800, cac:14, legal:36000, infraCloud:14500, oracle: 7000, ga:14000 },
  { events: 10350, avgNotional:13000, walletPct:10, newWallets: 44_500, headcount:36, salaryPerFTE:5800, cac:13, legal:38000, infraCloud:15000, oracle: 7500, ga:15000 },
  { events: 11400, avgNotional:13500, walletPct:10, newWallets: 50_500, headcount:36, salaryPerFTE:5800, cac:12, legal:38000, infraCloud:15500, oracle: 7500, ga:15000 },
  { events: 12500, avgNotional:13500, walletPct:11, newWallets: 57_000, headcount:38, salaryPerFTE:5800, cac:11, legal:40000, infraCloud:16000, oracle: 8000, ga:16000 },
  { events: 13700, avgNotional:13500, walletPct:11, newWallets: 64_000, headcount:38, salaryPerFTE:5800, cac:10, legal:40000, infraCloud:16500, oracle: 8000, ga:16000 },
  // H1 2029 — East + West Africa full rollout; referrals now primary channel (months 31-36)
  { events: 15000, avgNotional:14000, walletPct:11, newWallets: 72_000, headcount:43, salaryPerFTE:6000, cac:14, legal:44000, infraCloud:21000, oracle:10500, ga:19000 },
  { events: 16400, avgNotional:14000, walletPct:11, newWallets: 80_000, headcount:43, salaryPerFTE:6000, cac:13, legal:44000, infraCloud:21500, oracle:10500, ga:19000 },
  { events: 17900, avgNotional:14000, walletPct:11, newWallets: 89_000, headcount:46, salaryPerFTE:6000, cac:12, legal:46000, infraCloud:22000, oracle:11000, ga:20000 },
  { events: 19500, avgNotional:14500, walletPct:11, newWallets: 99_000, headcount:46, salaryPerFTE:6000, cac:11, legal:46000, infraCloud:22500, oracle:11000, ga:20000 },
  { events: 21200, avgNotional:14500, walletPct:12, newWallets:109_000, headcount:49, salaryPerFTE:6000, cac:10, legal:48000, infraCloud:23000, oracle:11500, ga:21000 },
  { events: 23000, avgNotional:14500, walletPct:12, newWallets:120_000, headcount:49, salaryPerFTE:6000, cac:10, legal:48000, infraCloud:23500, oracle:11500, ga:21000 },
  // H2 2029 — Commodities & crypto verticals live; platform-effect acquisition (months 37-42)
  { events: 25000, avgNotional:14500, walletPct:12, newWallets:132_000, headcount:53, salaryPerFTE:6300, cac:10, legal:52000, infraCloud:29000, oracle:14500, ga:24000 },
  { events: 27100, avgNotional:15000, walletPct:12, newWallets:145_000, headcount:53, salaryPerFTE:6300, cac: 9, legal:52000, infraCloud:30000, oracle:14500, ga:24000 },
  { events: 29300, avgNotional:15000, walletPct:12, newWallets:158_000, headcount:56, salaryPerFTE:6300, cac: 9, legal:54000, infraCloud:31000, oracle:15000, ga:25000 },
  { events: 31600, avgNotional:15000, walletPct:12, newWallets:172_000, headcount:56, salaryPerFTE:6300, cac: 8, legal:54000, infraCloud:32000, oracle:15000, ga:25000 },
  { events: 34000, avgNotional:15000, walletPct:12, newWallets:187_000, headcount:59, salaryPerFTE:6300, cac: 8, legal:56000, infraCloud:33000, oracle:15500, ga:26000 },
  { events: 36500, avgNotional:15000, walletPct:12, newWallets:202_000, headcount:59, salaryPerFTE:6300, cac: 7, legal:56000, infraCloud:34000, oracle:15500, ga:26000 },
  // H1 2030 — Maturity phase; network effect dominant (months 43-48)
  // walletPct = % of cumulative wallets active as transferors each month (rising as platform matures)
  { events: 39100, avgNotional:15000, walletPct:13, newWallets:218_000, headcount:62, salaryPerFTE:6600, cac: 6, legal:60000, infraCloud:40000, oracle:20000, ga:30000 },
  { events: 41800, avgNotional:15000, walletPct:13, newWallets:235_000, headcount:62, salaryPerFTE:6600, cac: 5, legal:60000, infraCloud:41000, oracle:20000, ga:30000 },
  { events: 44600, avgNotional:15000, walletPct:14, newWallets:252_000, headcount:64, salaryPerFTE:6600, cac: 5, legal:62000, infraCloud:42000, oracle:21000, ga:31000 },
  { events: 47500, avgNotional:15000, walletPct:14, newWallets:270_000, headcount:64, salaryPerFTE:6600, cac: 5, legal:62000, infraCloud:43000, oracle:21000, ga:31000 },
  { events: 50500, avgNotional:15000, walletPct:14, newWallets:288_000, headcount:65, salaryPerFTE:6600, cac: 5, legal:64000, infraCloud:44000, oracle:22000, ga:32000 },
  { events: 53600, avgNotional:15000, walletPct:15, newWallets:307_000, headcount:65, salaryPerFTE:6600, cac: 5, legal:64000, infraCloud:45000, oracle:22000, ga:32000 },
  // H2 2030 — Sustained growth (months 49-54)
  { events: 56800, avgNotional:15000, walletPct:15, newWallets:326_000, headcount:67, salaryPerFTE:6800, cac: 5, legal:66000, infraCloud:47000, oracle:23500, ga:33000 },
  { events: 60100, avgNotional:15000, walletPct:15, newWallets:346_000, headcount:67, salaryPerFTE:6800, cac: 5, legal:66000, infraCloud:48000, oracle:23500, ga:33000 },
  { events: 63500, avgNotional:15000, walletPct:16, newWallets:367_000, headcount:69, salaryPerFTE:6800, cac: 4, legal:68000, infraCloud:49000, oracle:24000, ga:34000 },
  { events: 67000, avgNotional:15000, walletPct:16, newWallets:388_000, headcount:69, salaryPerFTE:6800, cac: 4, legal:68000, infraCloud:50000, oracle:24000, ga:34000 },
  { events: 70600, avgNotional:15000, walletPct:16, newWallets:410_000, headcount:71, salaryPerFTE:6800, cac: 4, legal:70000, infraCloud:51000, oracle:24500, ga:35000 },
  { events: 74300, avgNotional:15000, walletPct:17, newWallets:433_000, headcount:71, salaryPerFTE:6800, cac: 4, legal:70000, infraCloud:52000, oracle:24500, ga:35000 },
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
    // Wallet transfer fees scale with the cumulative wallet base:
    // walletPct = % of cumulative wallets active as transferors each month
    // Revenue = cumWallets × activeRate × avgMonthlyTransfer × 0.3% fee
    const walletFees        = Math.round(cumWallets * (inp.walletPct / 100) * c.avgMonthlyTransferUSD * 0.003);
    const totalRevenue      = hedgeFees + eventCreationFees + walletFees;

    // Gas: wallet onboarding gas + hedge lifecycle execution gas (scales with events)
    const gasCost        = Math.round(inp.newWallets * c.gasPerWallet + inp.events * c.gasPerEvent);
    const oracleCost     = inp.oracle;
    // Creator loyalty: 5% of hedge fees paid out to event creators — scales with hedge revenue
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
