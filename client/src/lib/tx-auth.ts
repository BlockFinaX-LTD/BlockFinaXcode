/**
 * tx-auth.ts — Transaction authorization prompt (singleton)
 *
 * Rift requires credentials (OTP or password) on every signed transaction.
 * For multi-tx flows (approve + execute), we cache the credential in memory
 * for a short window so the user isn't prompted twice in a row.
 *
 * Usage:
 *   import { requestTxAuth } from '@/lib/tx-auth';
 *   const creds = await requestTxAuth('Authorize buy protection');
 *   await sendContractTx(signer, to, data, value);   // sendContractTx pulls creds from the same store
 */

import type { SignerAuth } from './rift-client';

// ── In-memory cache (cleared on reload or logout) ────────────────────────

interface CacheEntry {
  creds: SignerAuth;
  expiresAt: number;
}

let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — covers multi-tx flows

export function getCachedTxAuth(): SignerAuth | null {
  if (!cache) return null;
  if (Date.now() > cache.expiresAt) {
    cache = null;
    return null;
  }
  return cache.creds;
}

export function setCachedTxAuth(creds: SignerAuth): void {
  cache = { creds, expiresAt: Date.now() + CACHE_TTL_MS };
}

export function clearCachedTxAuth(): void {
  cache = null;
}

// ── Promise-based prompt ──────────────────────────────────────────────────

type Resolver = (creds: SignerAuth) => void;
type Rejecter = (err: Error) => void;

interface Pending {
  title: string;
  description?: string;
  resolve: Resolver;
  reject: Rejecter;
}

let pending: Pending | null = null;
let listener: ((p: Pending | null) => void) | null = null;

/** Subscribe to pending requests (used by the singleton modal). */
export function subscribeTxAuth(cb: (p: Pending | null) => void): () => void {
  listener = cb;
  // Fire immediately in case there's a request waiting
  cb(pending);
  return () => { listener = null; };
}

/**
 * Request transaction credentials from the user.
 * Resolves with the credentials once entered (and caches them for CACHE_TTL_MS).
 * Throws if the user cancels.
 */
export function requestTxAuth(title: string, description?: string): Promise<SignerAuth> {
  // Serve from cache if still fresh
  const cached = getCachedTxAuth();
  if (cached) return Promise.resolve(cached);

  return new Promise<SignerAuth>((resolve, reject) => {
    pending = {
      title,
      description,
      resolve: (creds) => {
        setCachedTxAuth(creds);
        pending = null;
        listener?.(null);
        resolve(creds);
      },
      reject: (err) => {
        pending = null;
        listener?.(null);
        reject(err);
      },
    };
    listener?.(pending);
  });
}

export type { Pending };
