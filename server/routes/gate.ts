/**
 * gate.ts — Private-beta gating endpoints
 *
 * /api/access/request   POST   public — submit the app-access form
 * /api/access/check     GET    public — given an email, returns { allowed }
 * /api/docs/request     POST   public — request a docs magic link
 * /api/docs/verify      GET    public — verify a docs token (?t=)
 *
 * Admin endpoints (gated by x-admin-token via requireAdmin):
 * /api/admin/access/requests        GET    — list pending/approved/rejected
 * /api/admin/access/requests/:id    POST   — approve / reject (body: action, note)
 * /api/admin/access/grants          GET    — list current allowlist
 * /api/admin/access/grants          POST   — add an email directly (body: email)
 * /api/admin/access/grants/:id      DELETE — revoke
 * /api/admin/docs/tokens            GET    — list issued tokens
 * /api/admin/docs/tokens/:id        DELETE — revoke a token
 */

import type { Express } from 'express';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../db';
import { storage } from '../storage';
import { accessRequests, accessGrants, docsTokens, signinTokens, wallets } from '@shared/schema';
import { requireAdmin, getOwnerEmails } from '../middleware/admin-auth';
import { mintInvestorSession } from './investor';

const RIFT_API_BASE = process.env.RIFT_API_BASE || 'https://payment.riftfi.xyz';
const RIFT_API_KEY = process.env.VITE_RIFT_API_KEY || process.env.RIFT_API_KEY || '';
import {
  emailAdminNewAccessRequest,
  emailUserAccessReceived,
  emailUserAccessApproved,
  emailUserAccessRejected,
  emailAdminNewDocsRequest,
  emailDocsToken,
  APP_URL,
} from '../email';

// Once a user is invited or approved, we want them to effectively never have
// to request access again on the same browser. Tokens are minted for 90 days
// and renewed on use whenever they have < RENEW_BELOW_MS left — so any user
// who hits a gated route at least once per 90 days stays logged in forever.
const SIGNIN_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const DOCS_TOKEN_TTL_MS   = 90 * 24 * 60 * 60 * 1000; // 90 days
const RENEW_BELOW_MS      = 30 * 24 * 60 * 60 * 1000; // renew if < 30 days left

function shouldRenew(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() < RENEW_BELOW_MS;
}

// ── Helpers ────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normEmail(s: unknown): string {
  return String(s || '').trim().toLowerCase();
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function isEmailGranted(email: string): Promise<boolean> {
  const norm = normEmail(email);
  if (!norm) return false;
  const [row] = await db
    .select({ id: accessGrants.id })
    .from(accessGrants)
    .where(and(eq(accessGrants.email, norm), isNull(accessGrants.revokedAt)))
    .limit(1);
  return !!row;
}

// ── Public schemas ─────────────────────────────────────────────────────

const accessRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  country: z.string().trim().max(80).optional(),
  role: z.string().trim().max(80).optional(),
  company: z.string().trim().max(160).optional(),
  useCase: z.string().trim().max(2000).optional(),
  heardFrom: z.string().trim().max(160).optional(),
  socialHandle: z.string().trim().max(120).optional(),
});

const docsRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(800).optional(),
});

// ─────────────────────────────────────────────────────────────────────────

export function registerGateRoutes(app: Express) {
  // ── Public: submit access request ────────────────────────────────────
  app.post('/api/access/request', async (req, res) => {
    const parsed = accessRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    // If they're already on the allowlist, short-circuit.
    if (await isEmailGranted(data.email)) {
      return res.json({ status: 'already_approved' });
    }

    // Dedupe: if there's an outstanding pending request, refresh its row
    // instead of stacking duplicates.
    const [existing] = await db
      .select()
      .from(accessRequests)
      .where(and(eq(accessRequests.email, data.email), eq(accessRequests.status, 'pending')))
      .limit(1);

    let row;
    if (existing) {
      [row] = await db
        .update(accessRequests)
        .set({
          name: data.name,
          country: data.country || null,
          role: data.role || null,
          company: data.company || null,
          useCase: data.useCase || null,
          heardFrom: data.heardFrom || null,
          socialHandle: data.socialHandle || null,
        })
        .where(eq(accessRequests.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(accessRequests)
        .values({
          name: data.name,
          email: data.email,
          country: data.country || null,
          role: data.role || null,
          company: data.company || null,
          useCase: data.useCase || null,
          heardFrom: data.heardFrom || null,
          socialHandle: data.socialHandle || null,
        })
        .returning();
    }

    // Fire-and-forget notifications
    Promise.all([
      emailAdminNewAccessRequest({ ...row, id: row.id }).catch((e) =>
        console.error('[access/request] admin email failed:', e?.message),
      ),
      emailUserAccessReceived(row.email, row.name).catch((e) =>
        console.error('[access/request] user email failed:', e?.message),
      ),
    ]);

    return res.json({ status: 'received', id: row.id });
  });

  // ── Public: verify a signin token from the approval email ───────────
  // The /auth route's AuthGate calls this with ?t=<raw>. We never return
  // which email the token belongs to — Rift learns that from the user
  // signing in. We just confirm the token is real, unexpired, unrevoked.
  app.get('/api/access/signin-verify', async (req, res) => {
    const raw = String(req.query.t || '').trim();
    if (!raw) return res.json({ valid: false });
    const tokenHash = hashToken(raw);
    const [tok] = await db
      .select()
      .from(signinTokens)
      .where(eq(signinTokens.tokenHash, tokenHash))
      .limit(1);
    if (!tok) return res.json({ valid: false });
    if (tok.revokedAt) return res.json({ valid: false, reason: 'revoked' });
    if (tok.expiresAt.getTime() < Date.now()) return res.json({ valid: false, reason: 'expired' });
    if (!tok.firstUsedAt) {
      await db.update(signinTokens).set({ firstUsedAt: new Date() }).where(eq(signinTokens.id, tok.id));
    }
    // Sliding-window renewal: keep approved users signed in indefinitely as
    // long as they visit at least once per 90 days.
    let expiresAt = tok.expiresAt;
    if (shouldRenew(expiresAt)) {
      expiresAt = new Date(Date.now() + SIGNIN_TOKEN_TTL_MS);
      await db.update(signinTokens).set({ expiresAt }).where(eq(signinTokens.id, tok.id));
    }
    return res.json({ valid: true, expiresAt });
  });

  // ── Public: check if an email has been granted ───────────────────────
  app.get('/api/access/check', async (req, res) => {
    const email = normEmail(req.query.email);
    if (!email || !EMAIL_RE.test(email)) return res.json({ allowed: false });
    const allowed = await isEmailGranted(email);
    let status: 'allowed' | 'pending' | 'rejected' | 'none' = allowed ? 'allowed' : 'none';
    if (!allowed) {
      const [pending] = await db
        .select({ status: accessRequests.status })
        .from(accessRequests)
        .where(eq(accessRequests.email, email))
        .orderBy(desc(accessRequests.createdAt))
        .limit(1);
      if (pending) status = pending.status as any;
    }
    return res.json({ allowed, status });
  });

  // ── Public: request a docs magic link ────────────────────────────────
  app.post('/api/docs/request', async (req, res) => {
    const parsed = docsRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const data = parsed.data;

    // Generate a 32-byte URL-safe token, store only its sha256 hash.
    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(raw);
    const expiresAt = new Date(Date.now() + DOCS_TOKEN_TTL_MS);

    await db.insert(docsTokens).values({
      email: data.email,
      tokenHash,
      name: data.name || null,
      reason: data.reason || null,
      expiresAt,
    });

    Promise.all([
      emailDocsToken(data.email, data.name || null, raw, expiresAt).catch((e) =>
        console.error('[docs/request] user email failed:', e?.message),
      ),
      emailAdminNewDocsRequest({ email: data.email, name: data.name, reason: data.reason }).catch(
        (e) => console.error('[docs/request] admin email failed:', e?.message),
      ),
    ]);

    return res.json({ status: 'sent' });
  });

  // ── Public: verify a docs token (CORS-enabled for the external docs site) ─
  // The Docusaurus site at docs.blockfinax.com calls this endpoint cross-origin
  // from its Root theme swizzle. Allow-listed via DOCS_SITE_ORIGINS env var
  // (comma-separated); falls back to the prod docs subdomain.
  const docsAllowedOrigins = (
    process.env.DOCS_SITE_ORIGINS ||
    'https://docs.blockfinax.com,http://localhost:3000'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  function setDocsCors(req: any, res: any) {
    const origin = req.headers.origin as string | undefined;
    if (origin && docsAllowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }

  app.options('/api/docs/verify', (req, res) => {
    setDocsCors(req, res);
    res.sendStatus(204);
  });

  app.get('/api/docs/verify', async (req, res) => {
    setDocsCors(req, res);
    const raw = String(req.query.t || '').trim();
    if (!raw) return res.json({ valid: false });
    const tokenHash = hashToken(raw);
    const [tok] = await db.select().from(docsTokens).where(eq(docsTokens.tokenHash, tokenHash)).limit(1);
    if (!tok) return res.json({ valid: false });
    if (tok.revokedAt) return res.json({ valid: false, reason: 'revoked' });
    if (tok.expiresAt.getTime() < Date.now()) return res.json({ valid: false, reason: 'expired' });

    // Mark first use; subsequent uses keep the same token alive until expiry
    if (!tok.usedAt) {
      await db.update(docsTokens).set({ usedAt: new Date() }).where(eq(docsTokens.id, tok.id));
    }
    // Sliding-window renewal: if the token is within RENEW_BELOW_MS of expiry,
    // push it out to a fresh 90-day window. Active users effectively never
    // expire as long as they visit at least once per 90 days.
    let expiresAt = tok.expiresAt;
    if (shouldRenew(expiresAt)) {
      expiresAt = new Date(Date.now() + DOCS_TOKEN_TTL_MS);
      await db.update(docsTokens).set({ expiresAt }).where(eq(docsTokens.id, tok.id));
    }
    // Also mint a fresh investor-room session so the data-room page never
    // asks for a code on a return visit. Investor sessions are in-memory and
    // die on server restart, so we re-mint on every verify to make the flow
    // self-healing.
    const investor = mintInvestorSession({ editEnabled: true });
    return res.json({
      valid: true,
      expiresAt,
      investorToken: investor.token,
      investorExpiresAt: new Date(investor.expiresAt).toISOString(),
    });
  });

  // ── Public: shared-secret bypass — admin key in URL ─────────────────────
  // The simplest path for the team: set DOCS_BYPASS_KEY in .env to a long
  // random string. Visit /data-room?key=<that string> and the gate mints a
  // 7-day docs token, strips the param from the URL, and lets you through.
  // Bookmark the URL once and you're set.
  app.post('/api/docs/bypass', async (req, res) => {
    const key = String(req.body?.key || '').trim();
    const expected = (process.env.DOCS_BYPASS_KEY || '').trim();
    if (!expected) return res.status(503).json({ error: 'DOCS_BYPASS_KEY not configured' });
    if (!key || key !== expected) return res.status(401).json({ error: 'invalid key' });

    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(raw);
    const expiresAt = new Date(Date.now() + DOCS_TOKEN_TTL_MS);
    await db.insert(docsTokens).values({
      email: 'bypass@blockfinax.local',
      tokenHash,
      name: 'shared-key bypass',
      reason: 'DOCS_BYPASS_KEY',
      expiresAt,
      usedAt: new Date(),
    });
    // Also mint an investor-room session so the data-room page's own password
    // gate doesn't ask for a second code on top of the shared-key URL.
    const investor = mintInvestorSession({ editEnabled: true });
    return res.json({
      token: raw,
      expiresAt: expiresAt.toISOString(),
      investorToken: investor.token,
      investorExpiresAt: new Date(investor.expiresAt).toISOString(),
    });
  });

  // ── Public: admin bypass — mint a docs token for ADMIN_EMAILS members ──
  // Lets a signed-in admin skip the magic-link flow entirely. The client
  // passes their Rift access token; we resolve the email via Rift and check
  // it against ADMIN_EMAILS. On success, mint a docs token bound to that
  // email and return it raw — the gate stores it and proceeds.
  app.post('/api/docs/admin-bypass', async (req, res) => {
    const accessToken = String(req.body?.accessToken || '').trim();
    if (!accessToken) return res.status(400).json({ error: 'accessToken required' });

    const allowed = getOwnerEmails();
    if (allowed.length === 0) {
      return res.status(500).json({ error: 'ADMIN_EMAILS not configured' });
    }
    if (!RIFT_API_KEY) {
      return res.status(500).json({ error: 'Server is missing the Rift API key' });
    }

    let riftRes: Response;
    try {
      riftRes = await fetch(`${RIFT_API_BASE}/user/me`, {
        method: 'GET',
        headers: {
          'X-API-Key': RIFT_API_KEY,
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });
    } catch (err: any) {
      console.error('[docs/admin-bypass] Rift unreachable:', err?.message);
      return res.status(502).json({ error: 'Could not reach Rift to verify the session' });
    }
    if (riftRes.status === 401 || riftRes.status === 403) {
      return res.status(401).json({ error: 'Rift session expired' });
    }
    if (!riftRes.ok) {
      return res.status(502).json({ error: 'Rift returned an error verifying the session' });
    }

    const body = (await riftRes.json()) as any;
    const user = body?.user ?? body?.data?.user ?? body?.data ?? body;
    const email: string | undefined = user?.email;
    if (!email) return res.status(403).json({ error: 'No email on the Rift account' });
    if (!allowed.includes(email.toLowerCase())) {
      return res.status(403).json({ error: 'Not on the admin allowlist' });
    }

    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(raw);
    const expiresAt = new Date(Date.now() + DOCS_TOKEN_TTL_MS);
    await db.insert(docsTokens).values({
      email: email.toLowerCase(),
      tokenHash,
      name: 'admin bypass',
      reason: 'admin email allowlist',
      expiresAt,
      usedAt: new Date(),
    });
    return res.json({ token: raw, expiresAt: expiresAt.toISOString() });
  });

  // ── Public: register a Rift-authenticated user in our wallets table ─
  //
  // The dashboard counts users from the legacy `wallets` Postgres table,
  // but that table is only populated by the legacy POST /api/wallets
  // endpoint (which requires a session token from auth_sessions). After
  // the Rift migration nobody hits that, so the count is permanently 0
  // even when real users sign up.
  //
  // This endpoint is called by the client on every successful Rift
  // sign-in (from RiftPostSigninSync). It verifies the access token via
  // Rift's /user/me, then upserts a wallet row keyed by address. Once
  // present, repeat sign-ins are no-ops thanks to ON CONFLICT DO NOTHING.
  app.post('/api/rift/register', async (req, res) => {
    const accessToken = String(req.body?.accessToken || '').trim();
    if (!accessToken) return res.status(400).json({ error: 'accessToken required' });
    if (!RIFT_API_KEY) return res.status(500).json({ error: 'Server is missing the Rift API key' });

    let riftRes: Response;
    try {
      riftRes = await fetch(`${RIFT_API_BASE}/user/me`, {
        method: 'GET',
        headers: {
          'X-API-Key': RIFT_API_KEY,
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });
    } catch (err: any) {
      console.error('[rift/register] Rift unreachable:', err?.message);
      return res.status(502).json({ error: 'Could not reach Rift to verify the session' });
    }
    if (riftRes.status === 401 || riftRes.status === 403) {
      return res.status(401).json({ error: 'Rift session expired' });
    }
    if (!riftRes.ok) {
      return res.status(502).json({ error: 'Rift returned an error verifying the session' });
    }

    const body = (await riftRes.json()) as any;
    const user = body?.user ?? body?.data?.user ?? body?.data ?? body;
    const address = (user?.address || '').toString().trim();
    const email = (user?.email || '').toString().trim().toLowerCase() || null;
    if (!address) return res.status(400).json({ error: 'No address on the Rift account' });

    // Upsert. encryptedPrivateKey is required-nonnull on the legacy table
    // but Rift custodies the key, so we store a sentinel marker instead.
    try {
      const [row] = await db
        .insert(wallets)
        .values({
          address,
          name: 'Rift wallet',
          encryptedPrivateKey: 'rift-managed',
          email,
          isImported: true,
        })
        .onConflictDoNothing({ target: wallets.address })
        .returning({ id: wallets.id });

      // Referral attribution: only for a genuinely NEW wallet, and only via a
      // code carried from /auth?ref=CODE. storage enforces no-self-referral,
      // code caps, and one-referrer-per-referee. Pending until the referee
      // qualifies on-chain. Fire-and-forget — never blocks registration.
      if (row) {
        const referralCode = String(req.body?.referralCode || '').trim();
        if (referralCode) {
          storage.recordReferralSignup(address.toLowerCase(), referralCode)
            .then((ok) => { if (ok) console.log(`[referral] pending: ${address} via ${referralCode}`); })
            .catch((e) => console.warn('[referral] signup record failed:', e?.message));
        }
      }
      return res.json({ status: row ? 'created' : 'already_registered', address });
    } catch (err: any) {
      console.error('[rift/register] wallet upsert failed:', err?.message);
      return res.status(500).json({ error: 'Failed to register user' });
    }
  });

  // ── Admin: list access requests ──────────────────────────────────────
  app.get('/api/admin/access/requests', requireAdmin, async (req, res) => {
    const status = String(req.query.status || 'pending');
    const rows = await db
      .select()
      .from(accessRequests)
      .where(status === 'all' ? sql`true` : eq(accessRequests.status, status))
      .orderBy(desc(accessRequests.createdAt))
      .limit(500);
    return res.json({ requests: rows });
  });

  // ── Admin: approve / reject ──────────────────────────────────────────
  app.post('/api/admin/access/requests/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const action = String(req.body?.action || '');
    const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be approve or reject' });
    }

    const [req_] = await db.select().from(accessRequests).where(eq(accessRequests.id, id)).limit(1);
    if (!req_) return res.status(404).json({ error: 'not found' });

    const reviewer = (req as any).adminEmail || null;

    if (action === 'approve') {
      // Insert into grants (idempotent via unique email)
      await db
        .insert(accessGrants)
        .values({ email: req_.email, grantedBy: reviewer })
        .onConflictDoUpdate({
          target: accessGrants.email,
          set: { revokedAt: null, grantedAt: new Date(), grantedBy: reviewer },
        });
      await db
        .update(accessRequests)
        .set({ status: 'approved', reviewedAt: new Date(), reviewedBy: reviewer, reviewNote: note })
        .where(eq(accessRequests.id, id));

      // Mint a signin token so the approval email can carry a real magic link
      // that unlocks /auth (and only /auth — separate from docs tokens). 30-day
      // expiry so the applicant can sign in from multiple devices before it
      // burns. The token isn't single-use — once they've signed in via Rift
      // the widget owns the session and they don't need the link again.
      const rawSignin = crypto.randomBytes(32).toString('base64url');
      const signinHash = hashToken(rawSignin);
      const signinExpiresAt = new Date(Date.now() + SIGNIN_TOKEN_TTL_MS);
      await db.insert(signinTokens).values({
        email: req_.email,
        tokenHash: signinHash,
        expiresAt: signinExpiresAt,
      });

      emailUserAccessApproved(req_.email, req_.name, rawSignin).catch((e) =>
        console.error('[admin/access] approve email failed:', e?.message),
      );
      return res.json({ status: 'approved' });
    }

    await db
      .update(accessRequests)
      .set({ status: 'rejected', reviewedAt: new Date(), reviewedBy: reviewer, reviewNote: note })
      .where(eq(accessRequests.id, id));
    emailUserAccessRejected(req_.email, req_.name, note || undefined).catch((e) =>
      console.error('[admin/access] reject email failed:', e?.message),
    );
    return res.json({ status: 'rejected' });
  });

  // ── Admin: manage grants ─────────────────────────────────────────────
  app.get('/api/admin/access/grants', requireAdmin, async (_req, res) => {
    const rows = await db
      .select()
      .from(accessGrants)
      .where(isNull(accessGrants.revokedAt))
      .orderBy(desc(accessGrants.grantedAt))
      .limit(1000);
    return res.json({ grants: rows });
  });

  app.post('/api/admin/access/grants', requireAdmin, async (req, res) => {
    const email = normEmail(req.body?.email);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid email' });
    const reviewer = (req as any).adminEmail || null;
    await db
      .insert(accessGrants)
      .values({ email, grantedBy: reviewer })
      .onConflictDoUpdate({
        target: accessGrants.email,
        set: { revokedAt: null, grantedAt: new Date(), grantedBy: reviewer },
      });
    return res.json({ status: 'added' });
  });

  app.delete('/api/admin/access/grants/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    await db.update(accessGrants).set({ revokedAt: new Date() }).where(eq(accessGrants.id, id));
    return res.json({ status: 'revoked' });
  });

  // ── Admin: docs tokens ───────────────────────────────────────────────
  app.get('/api/admin/docs/tokens', requireAdmin, async (_req, res) => {
    const rows = await db
      .select({
        id: docsTokens.id,
        email: docsTokens.email,
        name: docsTokens.name,
        reason: docsTokens.reason,
        expiresAt: docsTokens.expiresAt,
        usedAt: docsTokens.usedAt,
        revokedAt: docsTokens.revokedAt,
        createdAt: docsTokens.createdAt,
      })
      .from(docsTokens)
      .orderBy(desc(docsTokens.createdAt))
      .limit(500);
    return res.json({ tokens: rows });
  });

  app.delete('/api/admin/docs/tokens/:id', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    await db.update(docsTokens).set({ revokedAt: new Date() }).where(eq(docsTokens.id, id));
    return res.json({ status: 'revoked' });
  });
}
