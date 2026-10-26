/**
 * academy/index.tsx: dispatcher for /learn and /learn/:slug.
 */
import { useRoute } from 'wouter';
import { AcademyShell } from './academy-shell';
import { findLesson } from './catalog';
import NotFound from './lessons/not-found';
import { ContractTerms, HowProtectionWorks, Introduction, PricingAndCharges } from './docs/part1';
import { ActiveContracts, ChoosingProtection, Confirming, ExpiryAndSettlement, GettingStarted, YourQuote } from './docs/part2';
import { AddingCapital, CapitalAndPositions, Underwriting, UnderwritingTerms, Withdrawals } from './docs/part3';
import { Funds, ProtectionLimits, RateData, TechnicalRisks, UnderwritingRisks } from './docs/part4';
import { Faq, Glossary, Support, Troubleshooting } from './docs/part5';

const REGISTRY: Record<string, React.ComponentType> = {
  '': Introduction,
  'how-protection-works': HowProtectionWorks,
  'contract-terms': ContractTerms,
  'pricing-and-charges': PricingAndCharges,
  'getting-started': GettingStarted,
  'choosing-protection': ChoosingProtection,
  'your-quote': YourQuote,
  'confirming': Confirming,
  'active-contracts': ActiveContracts,
  'expiry-and-settlement': ExpiryAndSettlement,
  'underwriting': Underwriting,
  'adding-capital': AddingCapital,
  'underwriting-terms': UnderwritingTerms,
  'capital-and-positions': CapitalAndPositions,
  'withdrawals': Withdrawals,
  'funds': Funds,
  'rate-data': RateData,
  'protection-limits': ProtectionLimits,
  'underwriting-risks': UnderwritingRisks,
  'technical-risks': TechnicalRisks,
  'faq': Faq,
  'glossary': Glossary,
  'troubleshooting': Troubleshooting,
  'support': Support,
};

/** Addresses from the previous Academy, sent to their closest page. */
const MOVED: Record<string, string> = {
  'how-blockfinax-works': 'how-protection-works', 'range-product': 'contract-terms', 'oracle-settlement': 'expiry-and-settlement',
  'fees': 'pricing-and-charges', 'underwriting-101': 'underwriting', 'lp-risk': 'underwriting-risks', 'governance': 'funds',
  'hedging-101': 'how-protection-works', 'options-basics': 'contract-terms', 'emerging-markets': '', 'cheatsheet': 'glossary',
};

export default function AcademyRoute() {
  const [, params] = useRoute<{ slug?: string }>('/learn/:slug');
  const raw = params?.slug ?? '';
  const slug = raw in MOVED ? MOVED[raw] : raw;
  const known = findLesson(slug);
  const LessonComponent = REGISTRY[slug] ?? NotFound;
  return (
    <AcademyShell slug={known ? slug : ''}>
      <LessonComponent />
    </AcademyShell>
  );
}
