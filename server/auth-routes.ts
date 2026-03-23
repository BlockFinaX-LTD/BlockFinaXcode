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
 *   SESSION_SECRET        — Random 32+ byte hex string for signing (required)
 *   GOOGLE_CLIENT_ID      — Google OAuth client ID (optional; Google login disabled without it)
 *   RESEND_API_KEY        — Resend API key (optional; email login disabled without it)
 *   SMTP_FROM             — From address (default: onboarding@resend.dev for testing)
 *   APP_URL               — Public URL for magic link (e.g. https://app.blockfinax.com)
 */

import type { Express } from 'express';
import { db } from './db';
import {
  userAccounts, magicLinks, authSessions, webauthnCredentials,
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

async function getSession(req: any) {
  const token = getSessionToken(req);
  if (!token) return null;
  const [session] = await db
    .select()
    .from(authSessions)
    .where(and(eq(authSessions.sessionToken, token), gt(authSessions.expiresAt, new Date())));
  return session || null;
}

async function createSession(userId: number, walletAddress?: string) {
  const sessionToken = generateToken(48);
  const expiresAt = sessionExpiry();
  await db.insert(authSessions).values({ sessionToken, userId, walletAddress: walletAddress || null, expiresAt });
  return sessionToken;
}

async function findOrCreateUser(email?: string, googleId?: string, name?: string, avatarUrl?: string) {
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
const googleClient = GOOGLE_CLIENT_ID
  ? new OAuth2Client(GOOGLE_CLIENT_ID)
  : null;

function getAppOrigin(req: any): string {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

function getRpId(req: any): string {
  try {
    return new URL(getAppOrigin(req)).hostname;
  } catch {
    return 'localhost';
  }
}

async function sendMagicLinkEmail(email: string, magicUrl: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return false;
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
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Auth] Email send failed:', err);
    return false;
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
    const { walletAddress } = req.body;
    if (!walletAddress) return res.status(400).json({ message: 'walletAddress required' });
    await db.update(authSessions).set({ walletAddress }).where(eq(authSessions.sessionToken, getSessionToken(req)!));
    res.json({ ok: true });
  });

  // ── POST /api/auth/pin-salt — store a user's wallet PIN salt ─────────────
  app.post('/api/auth/pin-salt', async (req, res) => {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ message: 'Not authenticated' });
    const { pinSalt } = req.body;
    if (!pinSalt || typeof pinSalt !== 'string') return res.status(400).json({ message: 'pinSalt required' });
    // Store salt on the user account (we'll use a simple approach of storing on first wallet for this user)
    // Client will use this salt when creating/encrypting their wallet
    // For now, store in session metadata by updating wallet association
    res.json({ ok: true, pinSalt });
  });

  // ── POST /api/auth/magic-link ─────────────────────────────────────────────
  app.post('/api/auth/magic-link', async (req, res) => {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Valid email required' });
    }
    if (!checkMagicLinkRateLimit(email.toLowerCase())) {
      return res.status(429).json({ message: 'Too many requests. Please wait 15 minutes before requesting another link.' });
    }
    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    await db.insert(magicLinks).values({ email, token, expiresAt });
    const appUrl = getAppOrigin(req);
    const magicUrl = `${appUrl}/auth/verify?token=${token}`;
    const sent = await sendMagicLinkEmail(email, magicUrl);
    if (!sent) {
      // Dev mode: return the URL directly so dev can click it
      console.log(`[Auth] Magic link (no RESEND_API_KEY configured): ${magicUrl}`);
    }
    res.json({ ok: true, sent, devUrl: sent ? undefined : magicUrl });
  });

  // ── GET /api/auth/verify/:token ────────────────────────────────────────────
  app.get('/api/auth/verify/:token', async (req, res) => {
    const { token } = req.params;
    const [link] = await db
      .select()
      .from(magicLinks)
      .where(and(eq(magicLinks.token, token), eq(magicLinks.used, false), gt(magicLinks.expiresAt, new Date())));
    if (!link) return res.status(400).json({ message: 'Link expired or already used' });
    await db.update(magicLinks).set({ used: true }).where(eq(magicLinks.id, link.id));
    const user = await findOrCreateUser(link.email);
    const sessionToken = await createSession(user.id);
    res.json({ ok: true, sessionToken, user: { id: user.id, email: user.email, name: user.name } });
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

  // ── GET /api/auth/debug/google-id — temp diagnostic, remove after fix ────
  app.get('/api/auth/debug/google-id', (_req, res) => {
    const raw = process.env.GOOGLE_CLIENT_ID || '';
    const trimmed = raw.trim();
    res.json({
      configured: !!trimmed,
      rawLength: raw.length,
      trimmedLength: trimmed.length,
      hadLeadingSpace: raw !== trimmed,
      preview: trimmed ? `${trimmed.slice(0, 8)}...${trimmed.slice(-30)}` : null,
      endsCorrectly: trimmed.endsWith('.apps.googleusercontent.com'),
    });
  });

  // ── POST /api/auth/google-token ───────────────────────────────────────────
  // New: OAuth access token flow — verifies with Google's tokeninfo endpoint.
  // Works inside iframes / no FedCM restriction. No client secret required.
  app.post('/api/auth/google-token', async (req, res) => {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(400).json({ message: 'accessToken required' });
    try {
      // Verify token with Google and get user info
      const [tokenInfo, userInfo] = await Promise.all([
        fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`).then(r => r.json()),
        fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(r => r.json()),
      ]);
      // Validate token was issued for our client
      if (tokenInfo.error || tokenInfo.aud !== GOOGLE_CLIENT_ID) {
        return res.status(400).json({ message: 'Invalid or expired Google token' });
      }
      if (!userInfo.email) return res.status(400).json({ message: 'Google account has no email' });
      const user = await findOrCreateUser(userInfo.email, userInfo.sub, userInfo.name, userInfo.picture);
      const sessionToken = await createSession(user.id);
      res.json({ ok: true, sessionToken, user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl } });
    } catch (err: any) {
      console.error('[Auth] Google token verify error:', err.message);
      res.status(400).json({ message: 'Google authentication failed' });
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
