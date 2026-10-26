/**
 * catalog.ts: canonical lesson catalog.
 *
 * The sidebar tree, prev/next chain, /learn landing curriculum, and the
 * route dispatcher all read from this single array. Adding a lesson means
 * inserting one entry here and one lesson file, nothing else.
 *
 * The documentation in five parts: about BlockFinaX, buying protection, providing
 * underwriting capital, funds data and risk, and help and reference.
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
  { slug: '', title: 'Introduction', group: 'About BlockFinaX', level: 'beginner', readMin: 4,
    blurb: 'What BlockFinaX does, who uses it and what is available today.',
    toc: [{ id: 'what', label: 'What BlockFinaX does' }, { id: 'who', label: 'Who uses it' }, { id: 'today', label: 'What is available today' }, { id: 'guide', label: 'How this guide is organised' }] },
  { slug: 'how-protection-works', title: 'How protection works', group: 'About BlockFinaX', level: 'beginner', readMin: 5,
    blurb: 'The buyer, the underwriters, the premium, the payout conditions and settlement.',
    toc: [{ id: 'parties', label: 'The parties' }, { id: 'life', label: 'From purchase to payout' }, { id: 'example', label: 'A worked example' }] },
  { slug: 'contract-terms', title: 'Markets and contract terms', group: 'About BlockFinaX', level: 'beginner', readMin: 6,
    blurb: 'The currencies on offer and the terms that define every contract.',
    toc: [{ id: 'markets', label: 'Markets' }, { id: 'terms', label: 'Contract terms' }, { id: 'formula', label: 'The payout formula' }, { id: 'durations', label: 'Durations and end times' }] },
  { slug: 'pricing-and-charges', title: 'Pricing and charges', group: 'About BlockFinaX', level: 'beginner', readMin: 5,
    blurb: 'What the premium pays for, how a quote is set and when each fee applies.',
    toc: [{ id: 'premium', label: 'The premium' }, { id: 'quote', label: 'How a quote is set' }, { id: 'fees', label: 'Fees and when they apply' }, { id: 'example', label: 'All charges on one contract' }] },
  { slug: 'getting-started', title: 'Before your first purchase', group: 'Buying protection', level: 'beginner', readMin: 5,
    blurb: 'Your account, wallet, funding and verification.',
    toc: [{ id: 'account', label: 'Account and wallet' }, { id: 'funding', label: 'Adding USDC' }, { id: 'verification', label: 'Verification' }] },
  { slug: 'choosing-protection', title: 'Choosing your protection', group: 'Buying protection', level: 'beginner', readMin: 5,
    blurb: 'Selecting the currency, Cap or Floor, amount, end date, strike and limit.',
    toc: [{ id: 'steps', label: 'Making your choices' }, { id: 'pools', label: 'Which pool you buy from' }, { id: 'rfq', label: 'When no pool fits' }] },
  { slug: 'your-quote', title: 'Understanding your quote', group: 'Buying protection', level: 'beginner', readMin: 5,
    blurb: 'What each line of a quote means and what remains your risk.',
    toc: [{ id: 'lines', label: 'What the quote shows' }, { id: 'exposure', label: 'What remains your risk' }, { id: 'validity', label: 'How long a quote lasts' }] },
  { slug: 'confirming', title: 'Confirming a purchase', group: 'Buying protection', level: 'beginner', readMin: 3,
    blurb: 'What happens between accepting a quote and holding an active contract.',
    toc: [{ id: 'steps', label: 'Steps' }, { id: 'funds', label: 'When funds move' }] },
  { slug: 'active-contracts', title: 'Following an active contract', group: 'Buying protection', level: 'beginner', readMin: 3,
    blurb: 'What you can see and do while protection is running.',
    toc: [{ id: 'view', label: 'What you can see' }, { id: 'changes', label: 'Changes and cancellation' }] },
  { slug: 'expiry-and-settlement', title: 'Expiry and settlement', group: 'Buying protection', level: 'beginner', readMin: 6,
    blurb: 'How the outcome is determined and how a payout reaches you.',
    toc: [{ id: 'when', label: 'When the outcome is set' }, { id: 'rate', label: 'The settlement rate' }, { id: 'payout', label: 'Calculating the payout' }, { id: 'claim', label: 'Claiming' }, { id: 'examples', label: 'Outcomes compared' }] },
  { slug: 'underwriting', title: 'How underwriting works', group: 'Providing underwriting capital', level: 'beginner', readMin: 5,
    blurb: 'What you commit to, how premiums are earned and how payouts reduce capital.',
    toc: [{ id: 'commit', label: 'What you commit to' }, { id: 'earn', label: 'How premiums are earned' }, { id: 'payouts', label: 'How payouts reduce capital' }, { id: 'example', label: 'A worked example' }] },
  { slug: 'adding-capital', title: 'Adding capital', group: 'Providing underwriting capital', level: 'beginner', readMin: 4,
    blurb: 'Joining a pool or creating one.',
    toc: [{ id: 'join', label: 'Adding to an existing pool' }, { id: 'create', label: 'Creating a pool' }, { id: 'requirements', label: 'Requirements' }] },
  { slug: 'underwriting-terms', title: 'Setting underwriting terms', group: 'Providing underwriting capital', level: 'beginner', readMin: 5,
    blurb: 'The settings underwriters and pool creators can change.',
    toc: [{ id: 'everyone', label: 'Settings for every underwriter' }, { id: 'creators', label: 'Settings for pool creators' }, { id: 'fixed', label: 'Settings that cannot be changed' }] },
  { slug: 'capital-and-positions', title: 'Capital and positions', group: 'Providing underwriting capital', level: 'beginner', readMin: 5,
    blurb: 'Free and reserved capital, capacity, and what the interface shows.',
    toc: [{ id: 'states', label: 'Free, reserved and pending' }, { id: 'shared', label: 'How contracts share capital' }, { id: 'monitor', label: 'Monitoring positions' }] },
  { slug: 'withdrawals', title: 'Withdrawals and proceeds', group: 'Providing underwriting capital', level: 'beginner', readMin: 3,
    blurb: 'When capital and earnings can be withdrawn, and how.',
    toc: [{ id: 'when', label: 'When money is available' }, { id: 'how', label: 'Withdrawing' }, { id: 'creator', label: 'Pool creator earnings' }] },
  { slug: 'funds', title: 'Where funds are held', group: 'Funds, data and risk', level: 'beginner', readMin: 5,
    blurb: 'Where money sits at each stage and who can move it.',
    toc: [{ id: 'stages', label: 'At each stage' }, { id: 'permissions', label: 'Who can move what' }, { id: 'admin', label: 'Administrative powers' }] },
  { slug: 'rate-data', title: 'Exchange-rate data', group: 'Funds, data and risk', level: 'beginner', readMin: 4,
    blurb: 'Where rates come from and how the settlement rate is set.',
    toc: [{ id: 'pricing', label: 'Data used for pricing' }, { id: 'settlement', label: 'Data used for settlement' }, { id: 'bank', label: 'Reference rate and your bank rate' }] },
  { slug: 'protection-limits', title: 'Protection limits', group: 'Funds, data and risk', level: 'beginner', readMin: 4,
    blurb: 'Why a payout may not offset your full loss.',
    toc: [{ id: 'limits', label: 'Where a payout falls short' }] },
  { slug: 'underwriting-risks', title: 'Underwriting risks', group: 'Funds, data and risk', level: 'beginner', readMin: 4,
    blurb: 'How underwriters can lose money.',
    toc: [{ id: 'loss', label: 'Loss on a contract' }, { id: 'correlated', label: 'Losses that arrive together' }, { id: 'other', label: 'Other risks' }] },
  { slug: 'technical-risks', title: 'Technical and operational risks', group: 'Funds, data and risk', level: 'beginner', readMin: 4,
    blurb: 'The systems BlockFinaX depends on and the safeguards in place.',
    toc: [{ id: 'dependencies', label: 'Dependencies' }, { id: 'safeguards', label: 'Safeguards' }] },
  { slug: 'faq', title: 'Common questions', group: 'Help and reference', level: 'beginner', readMin: 4,
    blurb: 'Answers to questions the other pages leave open.',
    toc: [{ id: 'questions', label: 'Questions' }] },
  { slug: 'glossary', title: 'Glossary', group: 'Help and reference', level: 'beginner', readMin: 4,
    blurb: 'Terms used in BlockFinaX, in plain language.',
    toc: [{ id: 'terms', label: 'Terms' }] },
  { slug: 'troubleshooting', title: 'Troubleshooting', group: 'Help and reference', level: 'beginner', readMin: 4,
    blurb: 'Common problems and what to do next.',
    toc: [{ id: 'quotes', label: 'Quotes' }, { id: 'transactions', label: 'Transactions' }, { id: 'sign-in', label: 'Signing in' }, { id: 'settlement', label: 'Settlement' }] },
  { slug: 'support', title: 'Contact and support', group: 'Help and reference', level: 'beginner', readMin: 2,
    blurb: 'How to reach BlockFinaX and what to include.',
    toc: [{ id: 'channels', label: 'Channels' }, { id: 'include', label: 'What to include' }] },
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
