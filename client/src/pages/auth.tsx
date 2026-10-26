/**
 * auth.tsx — Sign in / sign up with the BlockFinaX passkey wallet.
 *
 * Email code or Google first (a recoverable identity), then, the first time, a passkey
 * that creates the user's accounts and approves every transaction.
 */
import { PasskeyAuth } from '@/components/wallet/passkey-auth';

export default function Auth() {
  return <PasskeyAuth />;
}
