/**
 * Who is signed in: the BlockFinaX passkey wallet (email or Google, then a passkey).
 *
 * `address` is the user's smart account on the EVM network and `accessToken` is the
 * BlockFinaX session token, which the server accepts on every signed-in route.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  currentPasskeySession, passkeyWalletProvider, signOutPasskey, storedSessionToken, walletConfig, type PasskeySession,
} from "./wallets/passkey-wallet";
import type { WalletProvider } from "./wallet-provider";

/** Kept for older call sites: the passkey wallet is the only wallet. */
export const usesPasskeyWallet = true;

export interface IdentityUser {
  user: string;
  address: string;
  accessToken: string;
  btcAddress?: string;
  email?: string | null;
  name?: string | null;
}

export interface Identity {
  isAuthenticated: boolean;
  user: IdentityUser | null;
  error: string | null;
  getAccessToken: () => Promise<string>;
  open: (options?: { mode?: "signin" | "signup" }) => void;
  signOut: () => Promise<void>;
}

interface PasskeyIdentity extends Identity {
  /** Signed in (email, Google or passkey), whether or not the wallet passkey exists yet. */
  signedIn: boolean;
  session: PasskeySession | null;
  setSession: (session: PasskeySession | null) => void;
  ready: boolean;
}

const PasskeyContext = createContext<PasskeyIdentity | null>(null);

function evmAddress(session: PasskeySession | null, stellarChain: string | undefined) {
  return session?.accounts.find((a) => a.chain !== stellarChain)?.address ?? "";
}

function PasskeyIdentityProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PasskeySession | null>(null);
  const [stellarChain, setStellarChain] = useState<string>();
  const [ready, setReady] = useState(() => !storedSessionToken());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void walletConfig().then((c) => setStellarChain(c.stellar?.chain)).catch(() => {});
    if (!storedSessionToken()) return;
    void currentPasskeySession()
      .then(setSession)
      .catch((e) => setError((e as Error).message))
      .finally(() => setReady(true));
  }, []);

  const signOut = useCallback(async () => {
    await signOutPasskey();
    setSession(null);
  }, []);

  const value = useMemo<PasskeyIdentity>(() => ({
    session,
    setSession,
    ready,
    signedIn: Boolean(session),
    // The app opens once the wallet exists: signed in and holding a passkey account.
    isAuthenticated: Boolean(session?.credentialId && session.accounts.length > 0),
    error,
    user: session
      ? {
          user: `bfx-${session.user.id}`,
          address: evmAddress(session, stellarChain),
          accessToken: session.sessionToken,
          email: session.user.email ?? null,
          name: session.user.name,
        }
      : null,
    getAccessToken: async () => {
      const token = storedSessionToken();
      if (!token) throw new Error("Not signed in");
      return token;
    },
    open: () => { if (window.location.pathname !== "/auth") window.location.assign("/auth"); },
    signOut,
  }), [session, stellarChain, ready, error, signOut]);

  return <PasskeyContext.Provider value={value}>{children}</PasskeyContext.Provider>;
}

/** Wraps the app with the signed-in identity. */
export function IdentityProvider({ children }: { children: ReactNode }) {
  return <PasskeyIdentityProvider>{children}</PasskeyIdentityProvider>;
}

function usePasskeyIdentity(): Identity {
  const ctx = useContext(PasskeyContext);
  if (!ctx) throw new Error("useIdentity must be used inside IdentityProvider");
  return ctx;
}

/** The signed-in user and sign-in controls. */
export const useIdentity: () => Identity & Record<string, any> = usePasskeyIdentity as () => Identity & Record<string, any>;

/** Passkey session controls for the sign-in page. */
export function usePasskeySession() {
  const ctx = useContext(PasskeyContext);
  if (!ctx) throw new Error("usePasskeySession needs the passkey wallet build");
  return ctx;
}

/** The wallet provider that signs EVM transactions. */
export async function activeEvmWalletProvider(): Promise<WalletProvider> {
  return passkeyWalletProvider;
}
