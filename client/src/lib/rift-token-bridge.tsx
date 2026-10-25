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

import { useEffect, useRef } from 'react';
import { useIdentity as useRift, usesPasskeyWallet } from '@/lib/identity';
import type { RiftUser } from '@rift-finance/react';
import { rift } from './rift-client';
import {
  getV3Status,
  wasMigratedLocally,
  v3RolloutAllows,
  passkeysSupported,
  createPasskey,
  enrolGoogle,
  migrateToV3,
  googleSigningConfigured,
  RiftV3Error,
  type EnrolledMethod,
} from './rift-v3';

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
 * Silent post-login migration attempt — the equivalent of Rift's own
 * maybeMigrateToV3. When a user has just authenticated and their wallet is
 * still v1/v2, try to enrol a passkey right away while the OTP / OAuth
 * click that logged them in is still recent (user-activation is fresh).
 *
 * Fails safe: any error is logged and the V3UpgradeGate banner remains as
 * the deliberate, user-clicked fallback. Won't retry on the same session.
 */
async function maybeMigrateToV3(
  accessToken: string,
  userLabel: string,
  userId: string,
): Promise<void> {
  try {
    // Cheap probe first — no biometric prompt if already on v3.
    const status = await getV3Status(accessToken).catch(() => null);
    if (status?.version === 'v3') return;
    if (!status && wasMigratedLocally(null)) return; // /wallet/v3-status 404
    if (!v3RolloutAllows(userLabel)) return; // not in the rollout window

    // Try to enrol a passkey silently. On mobile Safari this WILL prompt for
    // biometrics — that's the point: catch the user while their gesture is
    // still fresh, so the prompt isn't refused. If they cancel, the banner
    // will offer the same on the next screen.
    const enrolled: EnrolledMethod[] = [];
    if (passkeysSupported()) {
      try {
        enrolled.push(await createPasskey(userLabel, userId));
      } catch (err) {
        console.info('[rift-v3] silent passkey enrolment declined:', err);
      }
    }
    // If no passkey (declined or unsupported), don't force Google here —
    // Google's popup would surprise the user right after login. Leave it
    // for the V3UpgradeGate banner where they can pick deliberately.
    if (!enrolled.length) return;

    await migrateToV3(accessToken, enrolled);
    console.info('[rift-v3] auto-migrated to v3 with', enrolled.length, 'method(s)');
  } catch (err) {
    // Any failure here is fine — V3UpgradeGate takes over on the next render.
    console.warn(
      '[rift-v3] silent maybeMigrateToV3 skipped:',
      err instanceof RiftV3Error ? err.message : String(err),
    );
  }
}

/**
 * Mount once inside <RiftProvider>. Wires useRift()'s state into module
 * scope and into the wallet SDK's bearer-token cache.
 */
export function RiftTokenBridge() {
  const { user, isAuthenticated, getAccessToken } = useRift();
  // Guards against re-firing the migration on every render / token refresh.
  const migrateAttemptedFor = useRef<string | null>(null);

  // Register the async getter so non-React code can pull fresh tokens
  useEffect(() => {
    _getter = getAccessToken;
    return () => { _getter = null; };
  }, [getAccessToken]);

  // Cache the latest user object + sync the SDK's bearer token whenever it changes
  useEffect(() => {
    _cachedUser = user as RiftUser | null;
    if (user?.accessToken) {
      rift.setBearerToken(user.accessToken);
    } else if (!isAuthenticated) {
      rift.clearBearerToken();
      migrateAttemptedFor.current = null; // logout → allow retry on next login
    }
  }, [user, isAuthenticated]);

  // Silent auto-migrate — fires exactly once per authenticated session.
  useEffect(() => {
    // Rift-only: the testnet passkey wallet has no Rift account to migrate.
    if (usesPasskeyWallet || !isAuthenticated || !user?.accessToken) return;
    const key = (user as any)?.id || (user as any)?.email || 'anonymous';
    if (migrateAttemptedFor.current === key) return;
    migrateAttemptedFor.current = key;
    const email = (user as any)?.email ?? '';
    const label = email || 'BlockFinaX';
    const uid = (user as any)?.id ?? (user as any)?.user ?? email;
    // Fire and forget — errors handled inside.
    void maybeMigrateToV3(user.accessToken, label, uid);
  }, [isAuthenticated, user]);

  return null;
}

// Re-export so callers that already had google configured can gate UI on it.
export { googleSigningConfigured };
