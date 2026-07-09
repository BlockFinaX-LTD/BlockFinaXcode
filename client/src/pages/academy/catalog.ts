/**
 * catalog.ts — canonical lesson catalog.
 *
 * The sidebar tree, prev/next chain, /learn landing curriculum, and the
 * route dispatcher all read from this single array. Adding a lesson means
 * inserting one entry here and one lesson file — nothing else.
 *
 * Order matters: BlockFinaX product overview leads. Theory (hedging,
 * options, underwriting) sits behind it so newcomers can go straight to
 * "what am I looking at" without wading through derivatives-101.
 */

export interface Lesson {
  slug: string;                 // URL segment under /learn/<slug> (empty for /learn)
  title: string;
  blurb: string;                // one-line description for landing + sidebar tooltip
  group: string;                // sidebar group heading
  level: 'beginner' | 'intermediate' | 'advanced';
  readMin: number;              // estimated reading time
  toc: Array<{ id: string; label: string }>; // right-rail "in this lesson"
}

export const CATALOG: Lesson[] = [
  {
    slug: '',
    title: 'Start here',
    blurb: 'A short tour of the Academy and how to use it.',
    group: 'Introduction',
    level: 'beginner',
    readMin: 3,
    toc: [
      { id: 'why',   label: 'Why this exists' },
      { id: 'paths', label: 'Three ways in' },
      { id: 'map',   label: 'The full curriculum' },
    ],
  },
  {
    slug: 'how-blockfinax-works',
    title: 'How BlockFinaX works',
    blurb: 'The full lifecycle: creator opens a pool, LPs underwrite, hedgers buy protection, oracle settles.',
    group: 'How BlockFinaX works',
    level: 'beginner',
    readMin: 11,
    toc: [
      { id: 'shape',       label: 'The shape of the protocol' },
      { id: 'roles',       label: 'The four roles' },
      { id: 'lifecycle',   label: 'Lifecycle of a pool' },
      { id: 'solvency',    label: 'Why pools are always solvent' },
      { id: 'not-position',label: 'Why the protocol takes no position' },
    ],
  },
  {
    slug: 'range-product',
    title: 'The range product',
    blurb: 'Why we sell a call/put spread instead of a digital, and what changes because of it.',
    group: 'How BlockFinaX works',
    level: 'intermediate',
    readMin: 9,
    toc: [
      { id: 'digital',     label: 'Digital vs. range' },
      { id: 'geometry',    label: 'The geometry of the payoff' },
      { id: 'width',       label: 'Why range width is capped at 10×' },
      { id: 'legacy',      label: 'Legacy single-strike mode' },
    ],
  },
  {
    slug: 'oracle-settlement',
    title: 'Oracle & settlement',
    blurb: 'How a rate gets on-chain, why we settle only at expiry, and what consensus buys us.',
    group: 'How BlockFinaX works',
    level: 'intermediate',
    readMin: 10,
    toc: [
      { id: 'question',    label: 'What settlement has to answer' },
      { id: 'european',    label: 'Why settlement is European' },
      { id: 'consensus',   label: 'Multi-signer consensus' },
      { id: 'single-key',  label: 'The single-key path (and its retirement)' },
      { id: 'stale',       label: 'Stale submissions & tolerance' },
    ],
  },
  {
    slug: 'fees',
    title: 'Fees & incentives',
    blurb: 'Where the platform take comes from, why it is snapshotted at creation, and how creator loyalty works.',
    group: 'How BlockFinaX works',
    level: 'intermediate',
    readMin: 7,
    toc: [
      { id: 'streams',     label: 'The four streams' },
      { id: 'worked',      label: 'A worked example' },
      { id: 'snapshot',    label: 'Snapshot at creation' },
      { id: 'creator',     label: 'Creator loyalty' },
      { id: 'take',        label: 'What the protocol keeps' },
    ],
  },
  {
    slug: 'hedging-101',
    title: 'Hedging, from first principles',
    blurb: 'What a hedge is, why anyone bothers, and the geometry of protection.',
    group: 'Fundamentals',
    level: 'beginner',
    readMin: 8,
    toc: [
      { id: 'the-question',  label: 'The question a hedge answers' },
      { id: 'the-tools',     label: 'The three instruments' },
      { id: 'the-cost',      label: 'Why hedging always costs something' },
      { id: 'basis-risk',    label: 'The gap between hedge and exposure' },
      { id: 'when-not',      label: 'When not to hedge' },
    ],
  },
  {
    slug: 'options-basics',
    title: 'Options, in plain English',
    blurb: 'Calls, puts, strikes, expiry. Where an option is different from a bet.',
    group: 'Fundamentals',
    level: 'beginner',
    readMin: 10,
    toc: [
      { id: 'right-not-obligation', label: 'A right, not an obligation' },
      { id: 'strike-expiry',        label: 'Strike and expiry' },
      { id: 'premium',              label: 'The premium is the price of certainty' },
      { id: 'payoff',               label: 'Payoff diagrams' },
      { id: 'spreads',              label: 'Spreads: capping the tail' },
      { id: 'american-european',    label: 'When can you settle?' },
    ],
  },
  {
    slug: 'underwriting-101',
    title: 'Underwriting: the other side of the trade',
    blurb: 'What LPs actually do, why premiums exist, and how insurance-shaped payoffs work.',
    group: 'Fundamentals',
    level: 'beginner',
    readMin: 9,
    toc: [
      { id: 'who',        label: 'Who writes the cover' },
      { id: 'analogy',    label: 'The insurance analogy — and its limits' },
      { id: 'capital',    label: 'Reserved capital vs. earned premium' },
      { id: 'edge',       label: 'Where an LP’s edge comes from' },
      { id: 'ruin',       label: 'The one number you must not ignore' },
    ],
  },
  {
    slug: 'lp-risk',
    title: 'LP risk & sizing',
    blurb: 'Worst-case reservation, loss share, and how to think about capital across pools.',
    group: 'Deep dives',
    level: 'advanced',
    readMin: 12,
    toc: [
      { id: 'reserve',     label: 'Worst-case reservation' },
      { id: 'loss-share',  label: 'Loss share vs. withdrawal order' },
      { id: 'capacity',    label: 'Capacity, utilization, and limits' },
      { id: 'sizing',      label: 'A sizing framework' },
      { id: 'tail',        label: 'The tail nobody wants to price' },
    ],
  },
  {
    slug: 'emerging-markets',
    title: 'Why emerging-market FX',
    blurb: 'The context: why local currencies fall, what it costs the people who hold them, and what changes if they don’t have to.',
    group: 'Deep dives',
    level: 'intermediate',
    readMin: 9,
    toc: [
      { id: 'cost',        label: 'What devaluation costs' },
      { id: 'existing',    label: 'What tools already exist (and don’t)' },
      { id: 'gap',         label: 'The gap the protocol fills' },
      { id: 'assumptions', label: 'Assumptions we’re making' },
    ],
  },
  {
    slug: 'governance',
    title: 'Governance & security',
    blurb: 'The Diamond, the timelock, the Safe. What can change, who can change it, and when.',
    group: 'Deep dives',
    level: 'advanced',
    readMin: 11,
    toc: [
      { id: 'diamond',     label: 'Why a Diamond' },
      { id: 'custody',     label: 'Fund custody guarantees' },
      { id: 'timelock',    label: 'The timelock story' },
      { id: 'oracle-gov',  label: 'Oracle governance' },
      { id: 'trust',       label: 'What still requires trust' },
    ],
  },
  {
    slug: 'cheatsheet',
    title: 'Cheatsheet & glossary',
    blurb: 'The whole protocol on one page — terms, roles, numbers, functions.',
    group: 'Reference',
    level: 'beginner',
    readMin: 4,
    toc: [
      { id: 'roles',       label: 'Roles' },
      { id: 'lifecycle',   label: 'Lifecycle' },
      { id: 'numbers',     label: 'Numbers that matter' },
      { id: 'glossary',    label: 'Glossary' },
    ],
  },
];

export function findLesson(slug: string): Lesson | undefined {
  return CATALOG.find((l) => l.slug === slug);
}

export function neighbourhood(slug: string): { prev?: Lesson; next?: Lesson; index: number } {
  const i = CATALOG.findIndex((l) => l.slug === slug);
  return {
    prev: i > 0 ? CATALOG[i - 1] : undefined,
    next: i >= 0 && i < CATALOG.length - 1 ? CATALOG[i + 1] : undefined,
    index: i,
  };
}

/** Ordered list of unique group names in catalog order — used by the sidebar tree. */
export function groupedCatalog(): Array<{ name: string; items: Lesson[] }> {
  const groups: Array<{ name: string; items: Lesson[] }> = [];
  for (const l of CATALOG) {
    let g = groups.find((x) => x.name === l.group);
    if (!g) {
      g = { name: l.group, items: [] };
      groups.push(g);
    }
    g.items.push(l);
  }
  return groups;
}
