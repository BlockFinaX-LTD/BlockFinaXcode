/**
 * Who is signed in, independent of the wallet provider.
 *
 * Production (default) uses Rift: this module passes useRift() through unchanged.
 * Testnet (VITE_WALLET_PROVIDER=passkey) uses the BlockFinaX passkey wallet: the same
 * shape is filled from the passkey session, with `address` set to the user's smart
 * account on the EVM network and `accessToken` set to the BlockFinaX session token
 * (the server accepts it wherever it accepts a Rift token on that deployment).
 *
 * The provider choice is fixed at build time, so the hook order never changes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { RiftProvider, useRift } from "@rift-finance/react";
import {
  currentPasskeySession, passkeyWalletProvider, signOutPasskey, storedSessionToken, walletConfig, type PasskeySession,
} from "./wallets/passkey-wallet";
import type { WalletProvider } from "./wallet-provider";

export const walletProviderKind: "rift" | "passkey" =
  import.meta.env.VITE_WALLET_PROVIDER === "passkey" ? "passkey" : "rift";
export const usesPasskeyWallet = walletProviderKind === "passkey";

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
    isAuthenticated: Boolean(session),
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

/** Wraps the app with the identity provider for this build. */
export function IdentityProvider({ apiKey, widgetUrl, children }: { apiKey: string; widgetUrl?: string; children: ReactNode }) {
  if (usesPasskeyWallet) return <PasskeyIdentityProvider>{children}</PasskeyIdentityProvider>;
  return <RiftProvider apiKey={apiKey} widgetUrl={widgetUrl} persist>{children}</RiftProvider>;
}

function usePasskeyIdentity(): Identity {
  const ctx = useContext(PasskeyContext);
  if (!ctx) throw new Error("useIdentity must be used inside IdentityProvider");
  return ctx;
}

/** Same shape as useRift(); callers that used useRift switch by changing the import. */
export const useIdentity: () => Identity & Record<string, any> = usesPasskeyWallet
  ? usePasskeyIdentity
  : (useRift as unknown as () => Identity & Record<string, any>);

/** Passkey session controls for the testnet sign-in page. */
export function usePasskeySession() {
  const ctx = useContext(PasskeyContext);
  if (!ctx) throw new Error("usePasskeySession needs the passkey wallet build");
  return ctx;
}

/** The wallet provider that signs EVM transactions in this build. */
export async function activeEvmWalletProvider(): Promise<WalletProvider> {
  if (usesPasskeyWallet) return passkeyWalletProvider;
  const { riftWalletProvider } = await import("./wallets/rift-provider");
  return riftWalletProvider;
}
