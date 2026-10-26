/**
 * The app: the workspace on the currency-pool model through /api/v2 (the liquidity hub,
 * signed quotes, passkey approval). Hedgers and underwriters share it.
 */
import { Workspace } from '@/components/v2/workspace';

export default function Hedge() {
  return <Workspace />;
}
