/**
 * use-auth.ts — Auth session state hook
 *
 * Reads the session token from localStorage and fetches the current user from
 * /api/auth/me. Provides login helpers for magic link, Google, and Face ID flows.
 *
 * Session token is stored at localStorage key 'bfx_session'.
 *
 * Exports: useAuth, SESSION_KEY
 */

import { useState, useEffect, useCallback } from 'react';

export const SESSION_KEY = 'bfx_session';

export interface AuthUser {
  id: number;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface AuthSession {
  walletAddress: string | null;
  expiresAt: string;
}

export interface UseAuthReturn {
  user: AuthUser | null;
  session: AuthSession | null;
  sessionToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setSessionToken: (token: string) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

async function fetchMe(token: string): Promise<{ user: AuthUser | null; session: AuthSession | null }> {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'x-session-token': token },
    });
    if (!res.ok) return { user: null, session: null };
    return res.json();
  } catch {
    return { user: null, session: null };
  }
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionToken, setSessionTokenState] = useState<string | null>(
    () => localStorage.getItem(SESSION_KEY)
  );
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem(SESSION_KEY);
    if (!token) {
      setUser(null);
      setSession(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { user, session } = await fetchMe(token);
    setUser(user);
    setSession(session);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setSessionToken = useCallback((token: string) => {
    localStorage.setItem(SESSION_KEY, token);
    setSessionTokenState(token);
    // Refresh user data with new token
    fetchMe(token).then(({ user, session }) => {
      setUser(user);
      setSession(session);
    });
  }, []);

  const logout = useCallback(async () => {
    const token = localStorage.getItem(SESSION_KEY);
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-session-token': token },
      }).catch(() => {});
    }
    localStorage.removeItem(SESSION_KEY);
    setSessionTokenState(null);
    setUser(null);
    setSession(null);
  }, []);

  return {
    user,
    session,
    sessionToken,
    isLoading,
    isAuthenticated: !!user,
    setSessionToken,
    logout,
    refresh,
  };
}

/** Helper — attach authorization header to any fetch call. */
export function authHeaders(): HeadersInit {
  const token = localStorage.getItem(SESSION_KEY);
  return token ? { 'x-session-token': token } : {};
}
