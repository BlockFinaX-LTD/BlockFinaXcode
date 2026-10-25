/**
 * catalog.ts: canonical lesson catalog.
 *
 * The sidebar tree, prev/next chain, /learn landing curriculum, and the
 * route dispatcher all read from this single array. Adding a lesson means
 * inserting one entry here and one lesson file, nothing else.
 *
 * Order matters: Part 1 teaches BlockFinaX itself, Part 2 teaches currency
 * risk in general. Slugs are kept from the first Academy so old links work.
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
    slug: '', title: 'Start here', group: 'Part 1: Learn BlockFinaX', level: 'beginner', readMin: 4,
    blurb: 'What BlockFinaX is, who it is for, and how the Academy is organised.',
    toc: [{ id: 'what', label: 'What BlockFinaX is' }, { id: 'who', label: 'Who it is for' }, { id: 'parts', label: 'The two parts' }, { id: 'how', label: 'How to use the Academy' }],
  },
  {
    slug: 'how-blockfinax-works', title: 'How BlockFinaX works', group: 'Part 1: Learn BlockFinaX', level: 'beginner', readMin: 7,
    blurb: 'The people involved, the money in USDC, and the life of one protection from quote to payout.',
    toc: [{ id: 'roles', label: 'Who is involved' }, { id: 'money', label: 'Your account and your money' }, { id: 'life', label: 'The life of one protection' }, { id: 'rfq', label: 'When no pool fits' }],
  },
  {
    slug: 'range-product', title: 'Strike, cap and payout', group: 'Part 1: Learn BlockFinaX', level: 'beginner', readMin: 7,
    blurb: 'The four choices behind every protection and what you are paid in each outcome.',
    toc: [{ id: 'choices', label: 'The four choices' }, { id: 'outcomes', label: 'Three possible outcomes' }, { id: 'example', label: 'A worked example' }, { id: 'capped-open', label: 'Capped or open' }, { id: 'durations', label: 'Durations and end times' }],
  },
  {
    slug: 'oracle-settlement', title: 'How the rate is set and you get paid', group: 'Part 1: Learn BlockFinaX', level: 'beginner', readMin: 5,
    blurb: 'Who reports the rate at expiry, how the payout is fixed, and how you claim it.',
    toc: [{ id: 'when', label: 'When protection ends' }, { id: 'rate', label: 'How the rate is agreed' }, { id: 'settle', label: 'Fixing the payout' }, { id: 'claim', label: 'Claiming' }],
  },
  {
    slug: 'fees', title: 'Fees and earnings', group: 'Part 1: Learn BlockFinaX', level: 'beginner', readMin: 5,
    blurb: 'What a business pays, what underwriters and pool creators earn, with one example.',
    toc: [{ id: 'business', label: 'What a business pays' }, { id: 'underwriters', label: 'What underwriters earn' }, { id: 'creators', label: 'What pool creators earn' }, { id: 'example', label: 'One purchase, every fee' }],
  },
  {
    slug: 'underwriting-101', title: 'Underwriting: the other side of the trade', group: 'Part 1: Learn BlockFinaX', level: 'beginner', readMin: 6,
    blurb: 'How your USDC backs protection, where returns come from, and the controls you keep.',
    toc: [{ id: 'what', label: 'What underwriting means' }, { id: 'pools', label: 'How a pool works' }, { id: 'returns', label: 'Where returns come from' }, { id: 'controls', label: 'What you control' }],
  },
  {
    slug: 'lp-risk', title: 'Underwriter risk and sizing', group: 'Part 1: Learn BlockFinaX', level: 'intermediate', readMin: 7,
    blurb: 'What you can lose, three worked scenarios, and how to size and spread your capital.',
    toc: [{ id: 'risk', label: 'The risk you take' }, { id: 'scenarios', label: 'Three scenarios' }, { id: 'sizing', label: 'Sizing a position' }, { id: 'spread', label: 'Spreading risk' }],
  },
  {
    slug: 'governance', title: 'Trust and security', group: 'Part 1: Learn BlockFinaX', level: 'beginner', readMin: 5,
    blurb: 'What the rules in code guarantee, what you approve yourself, and how changes are handled.',
    toc: [{ id: 'code', label: 'What the code guarantees' }, { id: 'you', label: 'What only you can approve' }, { id: 'changes', label: 'How changes are handled' }, { id: 'trust', label: 'What you are trusting' }],
  },
  {
    slug: 'hedging-101', title: 'Currency risk, from first principles', group: 'Part 2: Understanding FX risk', level: 'beginner', readMin: 7,
    blurb: 'What currency risk is, how it reaches a business, and the ways to manage it.',
    toc: [{ id: 'what', label: 'What currency risk is' }, { id: 'exposure', label: 'Payables and receivables' }, { id: 'example', label: 'An import invoice' }, { id: 'manage', label: 'Ways to manage it' }],
  },
  {
    slug: 'options-basics', title: 'Forwards, swaps and options', group: 'Part 2: Understanding FX risk', level: 'beginner', readMin: 7,
    blurb: 'The main hedging instruments, how each works, and what each asks of you.',
    toc: [{ id: 'forwards', label: 'Forwards and NDFs' }, { id: 'swaps', label: 'Swaps' }, { id: 'futures', label: 'Futures' }, { id: 'options', label: 'Options' }, { id: 'compare', label: 'Side by side' }],
  },
  {
    slug: 'emerging-markets', title: 'Why hedging is hard to find in emerging markets', group: 'Part 2: Understanding FX risk', level: 'intermediate', readMin: 6,
    blurb: 'How large the gap is, why small businesses are left out, and what is changing.',
    toc: [{ id: 'size', label: 'The size of the exposure' }, { id: 'moves', label: 'How far currencies move' }, { id: 'gap', label: 'Why supply is thin' }, { id: 'africa', label: 'In our markets' }],
  },
  {
    slug: 'cheatsheet', title: 'Glossary', group: 'Part 2: Understanding FX risk', level: 'beginner', readMin: 4,
    blurb: 'Every term in the Academy, in one line each.',
    toc: [{ id: 'blockfinax', label: 'BlockFinaX terms' }, { id: 'fx', label: 'FX terms' }],
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

/** Ordered list of unique group names in catalog order, used by the sidebar tree. */
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
