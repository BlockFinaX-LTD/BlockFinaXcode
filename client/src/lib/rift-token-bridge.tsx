/**
 * rift-token-bridge.tsx — Bridge the Rift widget's JWT into the wallet SDK
 *
 * The @rift-finance/react widget owns the session token (with silent refresh
 * via a hidden iframe). Non-React modules (hedge-contract, rift-client) need
 * that token too, so we expose a module-level getter that's kept fresh by a
 * mounted bridge component reading useRift().
 *
 * Flow:
 *   1. <RiftProvider> owns the user + token
 *   2. <RiftTokenBridge> calls useRift() and registers getAccessToken into this module
 *   3. Anywhere else: `await getRiftAccessToken()` resolves to a fresh JWT
 *      (or rejects if the user is signed out)
 *   4. After signin, the bridge also pushes the token into the @rift-finance/wallet
 *      SDK singleton via setBearerToken, so existing typed calls keep working.
 */

import { useEffect } from 'react';
import { useRift } from '@rift-finance/react';
import type { RiftUser } from '@rift-finance/react';
import { rift } from './rift-client';

type Getter = () => Promise<string>;

let _getter: Getter | null = null;
let _cachedUser: RiftUser | null = null;

/** Module-level getter — resolves to a fresh JWT or rejects. */
export async function getRiftAccessToken(): Promise<string> {
  if (!_getter) {
    throw new Error('Rift token getter not initialised — is <RiftTokenBridge/> mounted under <RiftProvider>?');
  }
  return _getter();
}

/** Synchronous best-effort: returns the cached user from the widget, or null. */
export function getRiftUser(): RiftUser | null {
  return _cachedUser;
}

export function hasRiftSession(): boolean {
  return !!_cachedUser;
}

/**
 * Mount once inside <RiftProvider>. Wires useRift()'s state into module
 * scope and into the wallet SDK's bearer-token cache.
 */
export function RiftTokenBridge() {
  const { user, isAuthenticated, getAccessToken } = useRift();

  // Register the async getter so non-React code can pull fresh tokens
  useEffect(() => {
    _getter = getAccessToken;
    return () => { _getter = null; };
  }, [getAccessToken]);

  // Cache the latest user object + sync the SDK's bearer token whenever it changes
  useEffect(() => {
    _cachedUser = user;
    if (user?.accessToken) {
      rift.setBearerToken(user.accessToken);
    } else if (!isAuthenticated) {
      rift.clearBearerToken();
    }
  }, [user, isAuthenticated]);

  return null;
}
