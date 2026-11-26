/**
 * Demo invitation endpoints (testnet only; see ./service.ts).
 *
 *   Admin (x-admin-token)
 *   POST /api/admin/demo-invites              { label, days, maxAccounts, fundUsdc, country, note } -> { invite, link }
 *   GET  /api/admin/demo-invites              every invitation with its accounts
 *   POST /api/admin/demo-invites/:id/revoke   revoke, and end its accounts' sessions
 *
 *   Reviewer
 *   GET  /api/demo/invites/:token             { label, state, expiresAt }
 *   POST /api/demo/invites/:token/accept      new demo account and a session -> { sessionToken }
 *   POST /api/demo/fund                       (Bearer) fund the demo wallet once from the test faucet
 *
 * The routes are not registered at all unless the server runs as testnet.
 */
import type { Express, Request, Response } from "express";
import { Keypair, Operation, TransactionBuilder, BASE_FEE, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { requireAdmin } from "../middleware/admin-auth";
import {
  demoInvitesEnabled, endClosedSessions, ensureSchema, hashToken, inviteByToken, newToken, parseInvite, stateOf, stillOpen,
} from "./service";

interface Db { query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> }
type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (h: Handler) => (req: Request, res: Response) => {
  h(req, res).catch((e: any) => {
    const status = e?.status ?? 400;
    if (status >= 500) console.warn("[demo-invites]", e?.message);
    res.status(status).json({ error: { message: e?.message ?? "Request failed" } });
  });
};
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

async function pool(): Promise<Db> {
  const { pool } = await import("../db");
  if (!pool) throw fail(503, "The database is not available");
  return pool as unknown as Db;
}

/** A few accept attempts per network per hour, so a leaked link cannot mint accounts in bulk. */
const attempts = new Map<string, number[]>();
function allowAttempt(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 10) { attempts.set(ip, recent); return false; }
  recent.push(now);
  attempts.set(ip, recent);
  return true;
}

/** Send test USDC from the testnet faucet account to a Stellar address. */
async function sendTestUsdc(to: string, amount: number): Promise<string> {
  const secret = process.env.TESTNET_USDC_FAUCET_SECRET;
  const { chainRegistry } = await import("../chain/config");
  const registry = chainRegistry();
  const stellar = registry?.config.chains.find((c) => c.family === "stellar");
  if (!secret || !registry || !stellar || registry.config.environment !== "testnet") throw fail(503, "The test USDC faucet is not available here");
  const usdc = stellar.assets.USDC;
  if (!usdc) throw fail(503, "No test USDC is configured");
  const { toUnits } = await import("@shared/domain/pool-economics");
  const faucet = Keypair.fromSecret(secret);
  const server = new rpc.Server(stellar.rpcUrls[0]);
  let tx = new TransactionBuilder(await server.getAccount(faucet.publicKey()), { fee: BASE_FEE, networkPassphrase: stellar.networkId })
    .addOperation(Operation.invokeContractFunction({
      contract: usdc.addressOrContract,
      function: "transfer",
      args: [nativeToScVal(faucet.publicKey(), { type: "address" }), nativeToScVal(to, { type: "address" }), nativeToScVal(toUnits(String(amount), usdc.decimals), { type: "i128" })],
    }))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw fail(502, /balance|#10/i.test(sim.error) ? "The test USDC faucet is empty" : sim.error);
  tx = rpc.assembleTransaction(tx, sim).build();
  tx.sign(faucet);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") throw fail(502, "Stellar rejected the funding transfer");
  for (let i = 0; i < 30; i++) {
    const found = await server.getTransaction(sent.hash);
    if (found.status === rpc.Api.GetTransactionStatus.SUCCESS) return sent.hash;
    if (found.status === rpc.Api.GetTransactionStatus.FAILED) throw fail(502, "The funding transfer failed");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw fail(502, `The funding transfer is still pending: ${sent.hash}`);
}

const appUrl = (req: Request) => (process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

export function registerDemoInviteRoutes(app: Express) {
  if (!demoInvitesEnabled()) return;

  // ── admin ──────────────────────────────────────────────────────────────

  app.post("/api/admin/demo-invites", requireAdmin, wrap(async (req, res) => {
    let input;
    try { input = parseInvite(req.body); } catch (e) { throw fail(400, (e as Error).message); }
    const db = await pool();
    await ensureSchema(db);
    const token = newToken();
    const r = await db.query(
      `INSERT INTO demo_invites (token_hash, label, expires_at, max_accounts, fund_usdc, country, note)
       VALUES ($1, $2, now() + ($3 || ' days')::interval, $4, $5, $6, $7) RETURNING *`,
      [hashToken(token), input.label, String(input.days), input.maxAccounts, input.fundUsdc, input.country, input.note],
    );
    // The link is shown once: only its fingerprint is stored.
    res.json({ invite: { ...r.rows[0], token_hash: undefined, used: 0, state: "active" }, link: `${appUrl(req)}/invite/${token}` });
  }));

  app.get("/api/admin/demo-invites", requireAdmin, wrap(async (_req, res) => {
    const db = await pool();
    await ensureSchema(db);
    const invites = await db.query(`SELECT i.id, i.label, i.created_at, i.expires_at, i.revoked_at, i.max_accounts, i.fund_usdc, i.country, i.note,
      (SELECT count(*) FROM demo_accounts a WHERE a.invite_id = i.id) AS used FROM demo_invites i ORDER BY i.id DESC`);
    const accounts = await db.query(`SELECT a.user_id, a.invite_id, a.created_at, a.funded_at, a.fund_tx, u.name FROM demo_accounts a
      LEFT JOIN user_accounts u ON u.id = a.user_id ORDER BY a.created_at`);
    res.json({
      invites: invites.rows.map((i) => ({
        ...i, used: Number(i.used), state: stateOf(i),
        accounts: accounts.rows.filter((a) => a.invite_id === i.id),
      })),
    });
  }));

  app.post("/api/admin/demo-invites/:id/revoke", requireAdmin, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw fail(400, "Unknown invitation");
    const db = await pool();
    await ensureSchema(db);
    const r = await db.query(`UPDATE demo_invites SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1 RETURNING id`, [id]);
    if (!r.rows.length) throw fail(404, "Unknown invitation");
    const ended = await endClosedSessions(db, id);
    res.json({ revoked: true, sessionsEnded: ended });
  }));

  // ── reviewer ───────────────────────────────────────────────────────────

  app.get("/api/demo/invites/:token", wrap(async (req, res) => {
    const invite = await inviteByToken(await pool(), String(req.params.token));
    if (!invite) throw fail(404, "This invitation link is not valid. Ask the BlockFinaX team for a new one.");
    res.json({ label: invite.label, state: stateOf(invite), expiresAt: invite.expires_at, fundUsdc: Number(invite.fund_usdc) });
  }));

  app.post("/api/demo/invites/:token/accept", wrap(async (req, res) => {
    if (!allowAttempt(String(req.ip ?? "unknown"))) throw fail(429, "Too many attempts from this network. Please try again in an hour.");
    const db = await pool();
    await ensureSchema(db);
    const tokenHash = hashToken(String(req.params.token));
    // One transaction on one connection, with the invitation row locked, so two people
    // cannot both take the last place.
    const { pool: raw } = await import("../db");
    const client = await (raw as any).connect() as Db & { release(): void };
    let userId: number;
    let invite: any;
    try {
      await client.query("BEGIN");
      const r = await client.query(`SELECT i.*, (SELECT count(*) FROM demo_accounts a WHERE a.invite_id = i.id) AS used FROM demo_invites i WHERE token_hash = $1 FOR UPDATE`, [tokenHash]);
      invite = r.rows[0];
      if (!invite) throw fail(404, "This invitation link is not valid. Ask the BlockFinaX team for a new one.");
      const state = stateOf(invite);
      if (state === "revoked") throw fail(403, "This invitation has been withdrawn.");
      if (state === "expired") throw fail(403, "This invitation has expired.");
      if (state === "full") throw fail(403, "Every place on this invitation is taken. Ask the BlockFinaX team for another link.");
      const n = Number(invite.used) + 1;
      const u = await client.query(`INSERT INTO user_accounts (name) VALUES ($1) RETURNING id`, [`${invite.label} reviewer ${n}`]);
      userId = Number(u.rows[0].id);
      await client.query(`INSERT INTO demo_accounts (user_id, invite_id) VALUES ($1, $2)`, [userId, invite.id]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
    // The profile a new account normally fills in, completed for the reviewer. No screening:
    // these are test accounts on testnet, holding test USDC only.
    const { saveOnboarding } = await import("../onboarding/service");
    await saveOnboarding(userId, { accountType: "individual", fullName: `${invite.label} reviewer`, country: invite.country, intents: [] } as any)
      .catch((e: Error) => console.warn("[demo-invites] profile:", e.message));
    const { createSession } = await import("../auth-routes");
    const sessionToken = await createSession(userId, undefined, 12);
    res.json({ sessionToken });
  }));

  app.post("/api/demo/fund", wrap(async (req, res) => {
    const { getSession } = await import("../auth-routes");
    const session = await getSession(req);
    if (!session?.userId) throw fail(401, "Sign in first");
    const db = await pool();
    await ensureSchema(db);
    const r = await db.query(`SELECT a.*, i.fund_usdc, i.expires_at, i.revoked_at, i.max_accounts FROM demo_accounts a JOIN demo_invites i ON i.id = a.invite_id WHERE a.user_id = $1`, [session.userId]);
    const row = r.rows[0];
    if (!row) throw fail(403, "Only invited demo accounts are funded this way");
    if (!stillOpen(stateOf({ ...row, used: 0 }))) throw fail(403, "This invitation has ended");
    if (row.funded_at) { res.json({ funded: true, already: true, tx: row.fund_tx }); return; }
    const amount = Number(row.fund_usdc);
    if (!(amount > 0)) { res.json({ funded: false, amount: 0 }); return; }
    // Claim the funding first, so a double tap cannot fund twice; give it back if the transfer fails.
    const claim = await db.query(`UPDATE demo_accounts SET funded_at = now() WHERE user_id = $1 AND funded_at IS NULL RETURNING user_id`, [session.userId]);
    if (!claim.rows.length) { res.json({ funded: true, already: true }); return; }
    try {
      const { chainRegistry } = await import("../chain/config");
      const { AccountService, drizzleAccountRepository } = await import("../accounts/service");
      const registry = chainRegistry();
      const stellar = registry?.config.chains.find((c) => c.family === "stellar");
      if (!registry || !stellar) throw fail(503, "Stellar is not configured");
      const accounts = await new AccountService(registry, await drizzleAccountRepository(registry)).accounts(session.userId);
      const to = accounts.find((a) => a.chain === stellar.key)?.address;
      if (!to) throw fail(400, "Create your wallet passkey first");
      const tx = await sendTestUsdc(to, amount);
      await db.query(`UPDATE demo_accounts SET fund_tx = $2 WHERE user_id = $1`, [session.userId, tx]);
      res.json({ funded: true, amount, tx });
    } catch (e) {
      await db.query(`UPDATE demo_accounts SET funded_at = NULL WHERE user_id = $1`, [session.userId]).catch(() => undefined);
      throw e;
    }
  }));

  // Every 5 minutes: end the sessions of accounts whose invitation has been revoked or has expired.
  setInterval(() => { void pool().then((db) => endClosedSessions(db)).catch(() => undefined); }, 5 * 60_000).unref();
  console.log("[demo-invites] invitation links enabled (testnet)");
}
