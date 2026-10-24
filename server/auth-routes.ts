/**
 * auth-routes.ts — Authentication endpoints for BlockFinaX
 *
 * Provides:
 *   POST /api/auth/magic-link            — Send email magic link
 *   GET  /api/auth/verify/:token         — Verify magic link token → create session
 *   POST /api/auth/google                — Verify Google ID token → create session
 *   POST /api/auth/webauthn/register-challenge   — Get WebAuthn registration challenge
 *   POST /api/auth/webauthn/register             — Verify + store WebAuthn credential
 *   POST /api/auth/webauthn/auth-challenge       — Get WebAuthn authentication challenge
 *   POST /api/auth/webauthn/authenticate         — Verify assertion → create session + return unlock key
 *   GET  /api/auth/me                    — Get current session user
 *   POST /api/auth/logout                — Invalidate session
 *   POST /api/auth/session/wallet        — Attach a wallet address to a session
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID      — Google OAuth client ID (optional; Google login disabled without it)
 *   RESEND_API_KEY        — Resend API key (optional; email login disabled without it)
 *   SMTP_FROM             — From address (default: onboarding@resend.dev for testing)
 *   APP_URL               — Public URL for magic link (e.g. https://app.blockfinax.com)
 */

import type { Express } from 'express';
import { strictLimiter, pollLimiter } from './middleware/rate-limiter';
import { db } from './db';
import {
  userAccounts, magicLinks, authSessions, webauthnCredentials, wallets,
} from '@shared/schema';
import { eq, and, gt, lt } from 'drizzle-orm';
import { randomBytes, createHash } from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { OAuth2Client } from 'google-auth-library';
import { Resend } from 'resend';

// ── Token helpers ─────────────────────────────────────────────────────────────

/** SHA-256 hash of a raw magic-link token — only the hash is ever stored in the DB. */
function hashMagicToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// ── Rate limiting (in-memory) ─────────────────────────────────────────────────
// Tracks magic link requests: email → list of timestamps
const magicLinkRateMap = new Map<string, number[]>();
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_MAX_REQUESTS = 3;

function checkMagicLinkRateLimit(email: string): boolean {
  const now = Date.now();
  const timestamps = (magicLinkRateMap.get(email) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_MAX_REQUESTS) return false;
  timestamps.push(now);
  magicLinkRateMap.set(email, timestamps);
  return true;
}

const verifiedMagicSessions = new Map<string, { sessionToken: string; expiresAt: number }>();
const verifyHashToPollToken = new Map<string, string>();

// ── Cleanup expired magic link tokens ────────────────────────────────────────
// Runs every 30 minutes to delete used/expired tokens from the DB
function startTokenCleanup() {
  const run = async () => {
    try {
      await db.delete(magicLinks).where(lt(magicLinks.expiresAt, new Date()));
    } catch (err) {
      console.error('[Auth] Token cleanup error:', err);
    }
  };
  run();
  setInterval(run, 30 * 60 * 1000);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

function sessionExpiry(hours = 30 * 24): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function getSessionToken(req: any): string | null {
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return req.headers['x-session-token'] || null;
}

export async function getSession(req: any) {
  const token = getSessionToken(req);
  if (!token) return null;
  const [session] = await db
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.sessionToken, token), gt(authSessions.expiresAt, new Date())));
  return session || null;
}

export async function createSession(userId: number, walletAddress?: string) {
  const sessionToken = generateToken(48);
  const expiresAt = sessionExpiry();
  await db.insert(authSessions).values({ sessionToken, userId, walletAddress: walletAddress || null, expiresAt });
  return sessionToken;
}

export async function findOrCreateUser(email?: string, googleId?: string, name?: string, avatarUrl?: string) {
  if (email) {
    const [existing] = await db.select().from(userAccounts).where(eq(userAccounts.email, email));
    if (existing) {
      if (googleId && !existing.googleId) {
        await db.update(userAccounts).set({ googleId, name: name || existing.name, avatarUrl: avatarUrl || existing.avatarUrl }).where(eq(userAccounts.id, existing.id));
      }
      return existing;
    }
  }
  if (googleId) {
    const [existing] = await db.select().from(userAccounts).where(eq(userAccounts.googleId, googleId));
    if (existing) return existing;
  }
  const [created] = await db.insert(userAccounts).values({ email: email || null, googleId: googleId || null, name: name || null, avatarUrl: avatarUrl || null }).returning();
  return created;
}

// In-memory WebAuthn challenge store (challenges are valid for 60 seconds)
const pendingChallenges = new Map<string, { challenge: string; expiresAt: number }>();

function storePendingChallenge(key: string, challenge: string) {
  pendingChallenges.set(key, { challenge, expiresAt: Date.now() + 60_000 });
}

function retrievePendingChallenge(key: string): string | null {
  const entry = pendingChallenges.get(key);
  pendingChallenges.delete(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.challenge;
}

const RP_NAME = 'BlockFinaX';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim() || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
const googleClient = GOOGLE_CLIENT_ID
  ? new OAuth2Client(GOOGLE_CLIENT_ID)
  : null;

// Short-lived OAuth state store (CSRF protection) — state → expiresAt
const oauthStateStore = new Map<string, number>();
// Clean up expired states every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of oauthStateStore) if (exp < now) oauthStateStore.delete(k);
}, 10 * 60 * 1000);

export function getAppOrigin(req: any): string {
  const configured = (process.env.PUBLIC_APP_URL || process.env.APP_URL || '').trim();
  if (configured) {
    const url = new URL(configured);
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('PUBLIC_APP_URL must use HTTPS in production');
    }
    return url.origin;
  }
  // Never derive production authentication origins from request headers.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PUBLIC_APP_URL is required in production');
  }
  // Local development only: hosted origin values can be absent here.
  const proto =
    req.headers['x-forwarded-proto']?.split(',')[0].trim() ||
    req.protocol;
  return `${proto}://${req.get('host')}`;
}

/**
 * The passkey relying-party domain. Normally the app's own host. PASSKEY_RP_ID keeps
 * passkeys created on an earlier address working after a domain move: the browser then
 * reads /.well-known/webauthn on that domain to allow the new address (related origins).
 */
export function getRpId(req: any): string {
  const configured = process.env.PASSKEY_RP_ID?.trim();
  if (configured) return configured;
  try {
    return new URL(getAppOrigin(req)).hostname;
  } catch {
    return 'localhost';
  }
}

/** Origins allowed to use the passkey domain: the app, plus PASSKEY_RELATED_ORIGINS (comma-separated). */
export function getPasskeyOrigins(req: any): string[] {
  const extra = (process.env.PASSKEY_RELATED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => new URL(o).origin);
  return Array.from(new Set([getAppOrigin(req), ...extra]));
}

async function sendMagicLinkEmail(email: string, magicUrl: string): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { sent: false, error: 'RESEND_API_KEY not configured' };
  try {
    const resend = new Resend(apiKey);
    const from = process.env.SMTP_FROM?.trim() || 'BlockFinaX <onboarding@resend.dev>';
    const { error } = await resend.emails.send({
      from,
      to: [email],
      subject: 'Your BlockFinaX sign-in link',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#1d4ed8">BlockFinaX</h2>
          <p>Click the button below to sign in. This link expires in 15 minutes.</p>
          <a href="${magicUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Sign in to BlockFinaX
          </a>
          <p style="color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });
    if (error) {
      console.error('[Auth] Resend error:', error);
      return { sent: false, error: error.message || JSON.stringify(error) };
    }
    return { sent: true };
  } catch (err: any) {
    console.error('[Auth] Email send failed:', err);
    return { sent: false, error: err?.message || String(err) };
  }
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerAuthRoutes(app: Express) {
  startTokenCleanup();

  // ── GET /api/auth/me ────────────────────────────────────────────────────────
  app.get('/api/auth/me', async (req, res) => {
    const session = await getSession(req);
    if (!session) return res.json({ user: null, session: null });
    const [user] = await db.select().from(userAccounts).where(eq(userAccounts.id, session.userId!));
    res.json({ user: user || null, session: { walletAddress: session.walletAddress, expiresAt: session.expiresAt } });
  });

  // ── GET /api/auth/me/wallets ────────────────────────────────────────────────
  // Returns all wallet addresses this user has ever linked to any session.
  // Used on new devices to detect an existing wallet before creating a new one.
  app.get('/api/auth/me/wallets', async (req, res) => {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ message: 'Not authenticated' });

    // Gather wallet addresses from all sessions belonging to this user
    const sessions = await db
      .select({ walletAddress: authSessions.walletAddress })
      .from(authSessions)
      .where(eq(authSessions.userId, session.userId!));

    const addresses = [
      ...new Set(
        sessions
          .map(s => s.walletAddress)
          .filter((a): a is string => !!a)
      ),
    ];

    res.json({ wallets: addresses.map(address => ({ address })) });
  });

  // ── POST /api/auth/logout ───────────────────────────────────────────────────
  app.post('/api/auth/logout', async (req, res) => {
    const token = getSessionToken(req);
    if (token) await db.delete(authSessions).where(eq(authSessions.sessionToken, token));
    res.json({ ok: true });
  });

  // ── POST /api/auth/session/wallet ────────────────────────────────────────────
  app.post('/api/auth/session/wallet', async (req, res) => {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ message: 'Not authenticated' });
    const { walletAddress, signature } = req.body;
    if (!walletAddress) return res.status(400).json({ message: 'walletAddress required' });

    // Security fix: verify the caller actually owns this wallet address.
    // The client must sign a deterministic message with the wallet's private key.
    if (!signature) return res.status(400).json({ message: 'signature required — sign: "Link wallet <address> to BlockFinaX"' });
    try {
      const { ethers } = await import('ethers');
      const message = `Link wallet ${walletAddress} to BlockFinaX`;
      const recovered = ethers.verifyMessage(message, signature);
      if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
        return res.status(403).json({ message: 'Signature does not match wallet address' });
      }
    } catch {
      return res.status(400).json({ message: 'Invalid signature' });
    }

    await db.update(authSessions).set({ walletAddress }).where(eq(authSessions.sessionToken, getSessionToken(req)!));
    res.json({ ok: true });
  });

  // ── POST /api/auth/pin-salt — store a user's wallet PIN salt ─────────────
  app.post('/api/auth/pin-salt', async (req, res) => {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ message: 'Not authenticated' });
    const { pinSalt } = req.body;
    if (!pinSalt || typeof pinSalt !== 'string') return res.status(400).json({ message: 'pinSalt required' });

    // Store the PBKDF2 salt on the wallet record so it can be retrieved for
    // cross-device recovery. The salt is NOT sensitive (it's a random value
    // used as input to key derivation — the PIN itself is never stored).
    if (session.walletAddress) {
      await db.update(wallets)
        .set({ pinSalt })
        .where(eq(wallets.address, session.walletAddress));
    }
    res.json({ ok: true, pinSalt });
  });

  // ── POST /api/auth/magic-link ─────────────────────────────────────────────
  app.post('/api/auth/magic-link', strictLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Valid email required' });
    }
    if (!checkMagicLinkRateLimit(email.toLowerCase())) {
      return res.status(429).json({ message: 'Too many requests. Please wait 15 minutes before requesting another link.' });
    }

    const verifyToken = generateToken(32);
    const pollToken   = generateToken(24);
    const tokenHash   = hashMagicToken(verifyToken);
    const expiresAt   = new Date(Date.now() + 15 * 60 * 1000);

    await db.insert(magicLinks).values({ email, token: tokenHash, expiresAt });

    verifyHashToPollToken.set(tokenHash, pollToken);
    setTimeout(() => verifyHashToPollToken.delete(tokenHash), 15 * 60 * 1000);

    const appUrl   = getAppOrigin(req);
    const magicUrl = `${appUrl}/auth/verify?token=${verifyToken}`;
    const result   = await sendMagicLinkEmail(email, magicUrl);
    if (!result.sent) {
      verifyHashToPollToken.delete(tokenHash);
      await db.delete(magicLinks).where(eq(magicLinks.token, tokenHash));
      // Never put a bearer login URL in application logs or API responses.
      console.error(`[Auth] Magic link delivery failed: ${result.error || "provider unavailable"}`);
      return res.status(503).json({ ok: false, message: "Email delivery is temporarily unavailable." });
    }

    res.json({ ok: true, sent: true, pollToken });
  });

  // ── GET /api/auth/verify/:token ────────────────────────────────────────────
  app.get('/api/auth/verify/:token', async (req, res) => {
    const { token } = req.params;
    const tokenHash = hashMagicToken(token);
    const [link] = await db
      .select()
      .from(magicLinks)
      .where(and(eq(magicLinks.token, tokenHash), eq(magicLinks.used, false), gt(magicLinks.expiresAt, new Date())));
    if (!link) return res.status(400).json({ message: 'Link expired or already used' });
    await db.update(magicLinks).set({ used: true }).where(eq(magicLinks.id, link.id));
    const user = await findOrCreateUser(link.email);
    const sessionToken = await createSession(user.id);

    const pollToken = verifyHashToPollToken.get(tokenHash);
    if (pollToken) {
      verifiedMagicSessions.set(pollToken, {
        sessionToken,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      verifyHashToPollToken.delete(tokenHash);
    }

    res.json({ ok: true, sessionToken, user: { id: user.id, email: user.email, name: user.name } });
  });

  // ── GET /api/auth/magic-link/poll ──────────────────────────────────────────
  // Polled by the device that initiated the magic link request. Returns the
  // session token once the link has been verified on any device.
  app.get('/api/auth/magic-link/poll', pollLimiter, (req, res) => {
    const token = req.query.token as string;
    if (!token) return res.status(400).json({ ok: false });

    const entry = verifiedMagicSessions.get(token);
    if (!entry || Date.now() > entry.expiresAt) {
      return res.json({ ok: false });
    }

    verifiedMagicSessions.delete(token);
    res.json({ ok: true, sessionToken: entry.sessionToken });
  });

  // This legacy endpoint accepted unverified client-supplied JWT claims and
  // email addresses. Keep it explicitly unavailable until server-side Stytch
  // session verification is implemented; decoding a JWT is not authentication.
  app.post('/api/auth/stytch', (_req, res) => {
    res.status(410).json({ message: 'This sign-in method is temporarily unavailable.' });
  });

  // ── POST /api/auth/google ─────────────────────────────────────────────────
  // Legacy: ID token flow (One Tap / FedCM) — kept for compatibility
  app.post('/api/auth/google', async (req, res) => {
    if (!googleClient) {
      return res.status(503).json({ message: 'Google login not configured. Set GOOGLE_CLIENT_ID.' });
    }
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'idToken required' });
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload) return res.status(400).json({ message: 'Invalid Google token' });
      const user = await findOrCreateUser(payload.email, payload.sub, payload.name, payload.picture);
      const sessionToken = await createSession(user.id);
      res.json({ ok: true, sessionToken, user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl } });
    } catch (err: any) {
      console.error('[Auth] Google verify error:', err.message);
      res.status(400).json({ message: 'Google authentication failed' });
    }
  });

  // ── GET /api/auth/google/start ────────────────────────────────────────────
  // Begins the Authorization Code OAuth flow. Generates a CSRF state token,
  // stores it in memory, then redirects the browser to Google's consent screen.
  // Pass ?popup=1 to signal that the flow is running inside a popup window.
  app.get('/api/auth/google/start', (req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.redirect('/auth?error=google_not_configured');
    }
    const origin = getAppOrigin(req);
    const redirectUri = `${origin}/api/auth/google/callback`;
    const isPopup = req.query.popup === '1';
    // Encode popup flag into the state token so we can detect it in the callback
    const stateToken = generateToken(24);
    const state = isPopup ? `${stateToken}|popup` : stateToken;
    oauthStateStore.set(state, Date.now() + 10 * 60 * 1000); // 10-min expiry

    const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
    const url = client.generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      state,
      prompt: 'select_account',
    });
    console.log('[Auth] Google OAuth start → redirect URI:', redirectUri, isPopup ? '(popup)' : '');
    res.redirect(url);
  });

  // ── GET /api/auth/google/callback ─────────────────────────────────────────
  // Google redirects here with an authorization code. We exchange the code for
  // tokens server-side (using the client secret), verify the ID token, create
  // a session, then redirect the browser to the frontend completion page.
  app.get('/api/auth/google/callback', async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;

    // Detect popup mode from state suffix
    const isPopup = typeof state === 'string' && state.endsWith('|popup');

    const errorRedirect = (msg: string) =>
      isPopup
        ? res.redirect(`/auth/google/done?popup=1&error=${encodeURIComponent(msg)}`)
        : res.redirect(`/auth?error=${encodeURIComponent(msg)}`);

    if (error === 'access_denied') return isPopup ? res.redirect('/auth/google/done?popup=1&error=access_denied') : res.redirect('/auth');
    if (error) return errorRedirect(error);

    // Validate CSRF state (look up exact state string including |popup suffix)
    const stateExpiry = oauthStateStore.get(state);
    if (!stateExpiry || Date.now() > stateExpiry) {
      return errorRedirect('invalid_state');
    }
    oauthStateStore.delete(state);

    if (!code) return errorRedirect('no_code');

    try {
      const origin = getAppOrigin(req);
      const redirectUri = `${origin}/api/auth/google/callback`;
      const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);

      // Exchange code for tokens
      const { tokens } = await client.getToken(code);
      if (!tokens.id_token) throw new Error('No ID token returned');

      // Verify the ID token
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload?.email) throw new Error('No email in Google token');

      const user = await findOrCreateUser(payload.email, payload.sub, payload.name, payload.picture);
      const sessionToken = await createSession(user.id);

      // Redirect to frontend — session token and Google ID token go in the URL
      // fragment so they are never sent to any server (stays in the browser only).
      // The Google ID token is needed by Lit Protocol to mint/access the user's PKP.
      if (!tokens.id_token) {
        console.error('[Auth] Google returned no id_token — scope may be missing "openid"');
        return errorRedirect('no_id_token');
      }
      console.log('[Auth] Google callback OK — id_token length:', tokens.id_token.length);
      const fragment = `token=${encodeURIComponent(sessionToken)}&idToken=${encodeURIComponent(tokens.id_token)}`;
      const donePath = isPopup
        ? `/auth/google/done?popup=1#${fragment}`
        : `/auth/google/done#${fragment}`;
      res.redirect(donePath);
    } catch (err: any) {
      console.error('[Auth] Google callback error:', err.message);
      errorRedirect(err.message);
    }
  });

  // ── POST /api/auth/webauthn/register-challenge ────────────────────────────
  app.post('/api/auth/webauthn/register-challenge', async (req, res) => {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ message: 'Must be logged in to register Face ID' });
    const [user] = await db.select().from(userAccounts).where(eq(userAccounts.id, session.userId!));
    if (!user) return res.status(404).json({ message: 'User not found' });
    const existingCreds = await db.select().from(webauthnCredentials).where(eq(webauthnCredentials.userId, user.id));
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: getRpId(req),
      userID: new TextEncoder().encode(String(user.id)),
      userName: user.email || `user_${user.id}`,
      userDisplayName: user.name || user.email || `User ${user.id}`,
      excludeCredentials: existingCreds.map(c => ({ id: c.credentialId, type: 'public-key' as const })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
      timeout: 60_000,
    });
    storePendingChallenge(`reg:${user.id}`, options.challenge);
    res.json(options);
  });

  // ── POST /api/auth/webauthn/register ─────────────────────────────────────
  app.post('/api/auth/webauthn/register', async (req, res) => {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ message: 'Not authenticated' });
    const challenge = retrievePendingChallenge(`reg:${session.userId}`);
    if (!challenge) return res.status(400).json({ message: 'Challenge expired — please try again' });
    const { response: registrationResponse } = req.body;
    try {
      const verification = await verifyRegistrationResponse({
        response: registrationResponse,
        expectedChallenge: challenge,
        expectedOrigin: getAppOrigin(req),
        expectedRPID: getRpId(req),
        requireUserVerification: false,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ message: 'WebAuthn verification failed' });
      }
      const { credential } = verification.registrationInfo;
      const deviceUnlockKey = randomBytes(32).toString('hex');
      const credentialIdBase64 = Buffer.from(credential.id).toString('base64url');
      await db.insert(webauthnCredentials).values({
        userId: session.userId!,
        credentialId: credentialIdBase64,
        publicKey: Buffer.from(credential.publicKey).toString('base64'),
        counter: credential.counter,
        deviceUnlockKey,
      });
      res.json({ ok: true, deviceUnlockKey });
    } catch (err: any) {
      console.error('[Auth] WebAuthn register error:', err.message);
      res.status(400).json({ message: err.message || 'Registration failed' });
    }
  });

  // ── POST /api/auth/webauthn/auth-challenge ────────────────────────────────
  app.post('/api/auth/webauthn/auth-challenge', async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: getRpId(req),
      userVerification: 'preferred',
      timeout: 60_000,
    });
    storePendingChallenge(`auth:${req.ip}`, options.challenge);
    res.json(options);
  });

  // ── POST /api/auth/webauthn/authenticate ─────────────────────────────────
  app.post('/api/auth/webauthn/authenticate', async (req, res) => {
    const challenge = retrievePendingChallenge(`auth:${req.ip}`);
    if (!challenge) return res.status(400).json({ message: 'Challenge expired — please try again' });
    const { response: authResponse } = req.body;
    const credentialIdFromResponse = authResponse.id;
    const [storedCred] = await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.credentialId, credentialIdFromResponse));
    if (!storedCred) return res.status(400).json({ message: 'Credential not found' });
    try {
      const verification = await verifyAuthenticationResponse({
        response: authResponse,
        expectedChallenge: challenge,
        expectedOrigin: getAppOrigin(req),
        expectedRPID: getRpId(req),
        requireUserVerification: false,
        credential: {
          id: storedCred.credentialId,
          publicKey: new Uint8Array(Buffer.from(storedCred.publicKey, 'base64')),
          counter: storedCred.counter ?? 0,
        },
      });
      if (!verification.verified) return res.status(400).json({ message: 'Authentication failed' });
      await db.update(webauthnCredentials).set({ counter: verification.authenticationInfo.newCounter }).where(eq(webauthnCredentials.id, storedCred.id));
      const sessionToken = await createSession(storedCred.userId!);
      res.json({ ok: true, sessionToken, deviceUnlockKey: storedCred.deviceUnlockKey });
    } catch (err: any) {
      console.error('[Auth] WebAuthn auth error:', err.message);
      res.status(400).json({ message: err.message || 'Authentication failed' });
    }
  });
}
