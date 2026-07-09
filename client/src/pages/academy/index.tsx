/**
 * academy/index.tsx — dispatcher for /learn and /learn/:slug.
 *
 * Reads the URL, resolves it against the catalog, and mounts the matching
 * lesson component inside the shared shell. Kept in one place so App.tsx
 * only has to know one route to register.
 */
import { useRoute } from 'wouter';
import { AcademyShell } from './academy-shell';
import { findLesson } from './catalog';

import StartHere from './lessons/start-here';
import Hedging101 from './lessons/hedging-101';
import OptionsBasics from './lessons/options-basics';
import Underwriting101 from './lessons/underwriting-101';
import HowBlockFinaXWorks from './lessons/how-blockfinax-works';
import RangeProduct from './lessons/range-product';
import OracleSettlement from './lessons/oracle-settlement';
import Fees from './lessons/fees';
import LpRisk from './lessons/lp-risk';
import EmergingMarkets from './lessons/emerging-markets';
import Governance from './lessons/governance';
import Cheatsheet from './lessons/cheatsheet';
import NotFound from './lessons/not-found';

const REGISTRY: Record<string, React.ComponentType> = {
  '': StartHere,
  'hedging-101': Hedging101,
  'options-basics': OptionsBasics,
  'underwriting-101': Underwriting101,
  'how-blockfinax-works': HowBlockFinaXWorks,
  'range-product': RangeProduct,
  'oracle-settlement': OracleSettlement,
  'fees': Fees,
  'lp-risk': LpRisk,
  'emerging-markets': EmergingMarkets,
  'governance': Governance,
  'cheatsheet': Cheatsheet,
};

export default function AcademyRoute() {
  const [, params] = useRoute<{ slug?: string }>('/learn/:slug');
  const slug = params?.slug ?? '';
  const known = findLesson(slug);
  const LessonComponent = REGISTRY[slug] ?? NotFound;

  return (
    <AcademyShell slug={known ? slug : ''}>
      <LessonComponent />
    </AcademyShell>
  );
}
