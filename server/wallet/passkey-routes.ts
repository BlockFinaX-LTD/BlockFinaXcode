/**
 * The BlockFinaX passkey wallet on the main backend (testnet, WALLET_PROVIDER=passkey).
 *
 * Sign in with an email code or Google; then one passkey owns the user's smart accounts
 * and approves every transaction. Returning users may also sign in with the passkey.
 *   - Stellar: a Passkey Kit smart account, deployed at signup by the fee payer
 *   - EVM (Base Sepolia): a Coinbase Smart Wallet, counterfactual until its first
 *     transaction, which the BlockFinaX relayer submits and pays for
 *
 * Routes
 *   GET  /api/wallet/passkey/config
 *   POST /api/wallet/auth/email/start         { email }
 *   POST /api/wallet/auth/email/verify        { email, requestId, code }
 *   (Google uses /api/auth/google/start, then /auth/google/done in the app)
 *   POST /api/wallet/passkey/register/options  (Bearer session)
 *   POST /api/wallet/passkey/register/verify   { flow, response } (Bearer session)
 *   POST /api/wallet/passkey/signin/options
 *   POST /api/wallet/passkey/signin/verify    { flow, response }
 *   GET  /api/wallet/passkey/me                (Bearer session)
 *   POST /api/wallet/evm/prepare              { calls: [{ to, data, value }] }
 *   POST /api/wallet/evm/submit               { id, response }
 */
import type { Express, NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { ethers } from "ethers";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { decodeCredentialPublicKey } from "@simplewebauthn/server/helpers";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { userAccounts } from "@shared/auth-core-schema";
import { walletPasskeys, type WalletPasskey } from "@shared/chain-wallet-schema";
import { createSession, findOrCreateUser, getAppOrigin, getRpId, getSession } from "../auth-routes";
import { EmailOtp, sendCode } from "./email-otp";
import { chainRegistry } from "../chain/config";
import { AccountService, drizzleAccountRepository } from "../accounts/service";
import type { ChainConfig } from "@shared/chains/registry";
import { toUnits } from "@shared/domain/pool-economics";
import { accountInterface, passkeyOwner, smartAccountAddress } from "./evm-smart-account";
import { deployStellarSmartAccount, PASSKEY_WALLET_WASM } from "./stellar-smart-account";
import { EvmRelayer, paymasterUrls } from "./evm-relayer";
import { Api as StellarApi, Server as StellarServer } from "@stellar/stellar-sdk/rpc";
import { BASE_FEE, Keypair, Operation, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";

/** The passkey wallet is the default; the legacy Rift wallet only with WALLET_PROVIDER=rift. */
export const passkeyWalletEnabled = () => process.env.WALLET_PROVIDER !== "rift";

const challenges = new Map<string, { challenge: string; expiresAt: number; name?: string; userHandle?: string }>();
function putChallenge(value: { challenge: string; name?: string; userHandle?: string }) {
  const flow = randomBytes(16).toString("hex");
  challenges.set(flow, { ...value, expiresAt: Date.now() + 5 * 60_000 });
  return flow;
}
function takeChallenge(flow: unknown) {
  const c = typeof flow === "string" ? challenges.get(flow) : undefined;
  if (typeof flow === "string") challenges.delete(flow);
  if (!c || c.expiresAt < Date.now()) throw httpError(400, "This passkey request expired. Please try again.");
  return c;
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

function chains() {
  const registry = chainRegistry();
  if (!registry) throw httpError(503, "Chains are not configured on this deployment");
  const pick = (family: "evm" | "stellar") =>
    registry.all().find((c) => c.family === family && c.state !== "DISABLED" && c.provisionAtSignup) ?? null;
  return { registry, evm: pick("evm"), stellar: pick("stellar") };
}

let relayer: { chain: string; instance: EvmRelayer } | null = null;
function evmRelayer(evm: ChainConfig): EvmRelayer {
  if (relayer?.chain === evm.key) return relayer.instance;
  const provider = new ethers.JsonRpcProvider(evm.rpcUrls[0], Number(evm.networkId), { staticNetwork: ethers.Network.from(Number(evm.networkId)) });
  const secret = process.env.EVM_RELAYER_PRIVATE_KEY;
  // BlockFinaX contracts, and Circle CCTP's TokenMessenger for moving USDC to the hub.
  const contracts = [evm.contracts.currencyPool, evm.contracts.poolOracle, evm.cctp?.tokenMessenger].filter((a): a is string => Boolean(a));
  const instance = new EvmRelayer(provider, Number(evm.networkId), secret ? new ethers.Wallet(secret, provider) : null, {
    tokens: Object.values(evm.assets).map((a) => a.addressOrContract),
    contracts,
    dailyOpsPerUser: Number(process.env.EVM_RELAYER_DAILY_OPS || 50),
  }, Date.now, paymasterUrls(Number(evm.networkId)));
  relayer = { chain: evm.key, instance };
  return instance;
}

async function requireUser(req: Request) {
  const session = await getSession(req);
  if (!session?.userId) throw httpError(401, "Sign in first");
  return session.userId;
}

// ── Backup passkeys ──────────────────────────────────────────────────────────
// A user's first passkey is the primary: it created the smart accounts. Backups are added as
// extra owners on Base (Coinbase Smart Wallet addOwnerPublicKey) and extra signers on Stellar
// (Passkey Kit add_signer), each approved by an active passkey. A backup is "active" only once
// both chains hold it, and only active passkeys can sign in or approve transactions.

/** Columns added after launch; created here because the startup schema push can stop early. */
let columnsReady: Promise<void> | null = null;
function ensurePasskeyColumns() {
  columnsReady ??= (async () => {
    await db.execute(sql`ALTER TABLE wallet_passkeys ADD COLUMN IF NOT EXISTS label text`);
    await db.execute(sql`ALTER TABLE wallet_passkeys ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'primary'`);
    await db.execute(sql`ALTER TABLE wallet_passkeys ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'`);
    await db.execute(sql`ALTER TABLE wallet_passkeys ADD COLUMN IF NOT EXISTS evm_owner_index integer NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE wallet_passkeys ADD COLUMN IF NOT EXISTS evm_owner boolean NOT NULL DEFAULT true`);
    await db.execute(sql`ALTER TABLE wallet_passkeys ADD COLUMN IF NOT EXISTS stellar_signer boolean NOT NULL DEFAULT true`);
  })().catch((err) => { columnsReady = null; throw err; });
  return columnsReady;
}

/** The primary passkey: the one the smart accounts were created from. */
async function findPasskey(userId: number): Promise<WalletPasskey | null> {
  await ensurePasskeyColumns();
  const [row] = await db.select().from(walletPasskeys)
    .where(and(eq(walletPasskeys.userId, userId), eq(walletPasskeys.role, "primary")))
    .orderBy(asc(walletPasskeys.id)).limit(1);
  return row ?? null;
}

/** Every passkey that may sign in and approve transactions. */
async function activePasskeys(userId: number): Promise<WalletPasskey[]> {
  await ensurePasskeyColumns();
  return db.select().from(walletPasskeys)
    .where(and(eq(walletPasskeys.userId, userId), eq(walletPasskeys.status, "active")))
    .orderBy(asc(walletPasskeys.id));
}

const passkeyView = (p: WalletPasskey) => ({
  credentialId: p.credentialId, label: p.label ?? (p.role === "primary" ? "First passkey" : "Backup passkey"),
  role: p.role, status: p.status, createdAt: p.createdAt, onBase: p.evmOwner, onStellar: p.stellarSigner,
});

async function passkeyFor(userId: number): Promise<WalletPasskey> {
  const row = await findPasskey(userId);
  if (!row) throw httpError(404, "Create your wallet passkey first");
  return row;
}

const otp = new EmailOtp(randomBytes(32).toString("hex"));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Make sure the user has an account on every signup chain. Safe to call repeatedly. */
async function provision(userId: number, passkey: WalletPasskey) {
  const { registry, evm, stellar } = chains();
  const accounts = new AccountService(registry, await drizzleAccountRepository(registry));
  const have = new Set((await accounts.accounts(userId)).map((a) => a.chain));
  const errors: string[] = [];
  if (evm && !have.has(evm.key)) {
    try {
      const provider = new ethers.JsonRpcProvider(evm.rpcUrls[0], Number(evm.networkId), { staticNetwork: ethers.Network.from(Number(evm.networkId)) });
      const address = await smartAccountAddress(provider, passkeyOwner(passkey.x, passkey.y));
      await accounts.link(userId, { chain: evm.key, address, walletProvider: "blockfinax-passkey", accountType: "smart_account" });
    } catch (err) {
      errors.push(`${evm.name}: ${(err as Error).message}`);
    }
  }
  if (stellar && !have.has(stellar.key)) {
    try {
      const feePayer = process.env.STELLAR_FEE_PAYER_SECRET;
      if (!feePayer) throw new Error("Stellar fee payer is not configured");
      const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(passkey.x.slice(2), "hex"), Buffer.from(passkey.y.slice(2), "hex")]);
      const deployed = await deployStellarSmartAccount({
        rpcUrl: stellar.rpcUrls[0], networkPassphrase: stellar.networkId, feePayerSecret: feePayer,
        credentialId: passkey.credentialId, publicKey,
      });
      await accounts.link(userId, { chain: stellar.key, address: deployed.contract, walletProvider: "blockfinax-passkey", accountType: "soroban_contract" });
    } catch (err) {
      errors.push(`${stellar.name}: ${(err as Error).message}`);
    }
  }
  return { accounts: await accounts.accounts(userId), errors };
}

function toBytes(b64url: string) {
  return new Uint8Array(Buffer.from(b64url, "base64url"));
}

export function registerPasskeyWalletRoutes(app: Express) {
  app.get("/api/wallet/passkey/config", (req, res) => {
    if (!passkeyWalletEnabled()) return res.json({ enabled: false });
    const { evm, stellar } = chains();
    res.json({
      enabled: true,
      rpId: getRpId(req),
      evm: evm ? { chain: evm.key, chainId: Number(evm.networkId), name: evm.name } : null,
      stellar: stellar ? { chain: stellar.key, rpcUrl: stellar.rpcUrls[0], networkPassphrase: stellar.networkId, walletWasmHash: PASSKEY_WALLET_WASM } : null,
    });
  });
  if (!passkeyWalletEnabled()) return;

  app.post("/api/wallet/auth/email/start", wrap(async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) throw httpError(400, "Enter a valid email address");
    const { requestId, code } = otp.issue(email);
    try {
      await sendCode(email, code, requestId);
    } catch (err) {
      otp.cancel(email);
      throw err;
    }
    res.json({ requestId });
  }));

  app.post("/api/wallet/auth/email/verify", wrap(async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    try {
      otp.verify(email, String(req.body?.requestId ?? ""), String(req.body?.code ?? "").trim());
    } catch (err) {
      throw httpError(400, (err as Error).message);
    }
    const user = await findOrCreateUser(email);
    const sessionToken = await createSession(user.id);
    res.json({ sessionToken });
  }));

  /** Create the wallet passkey for a signed-in user, then their smart accounts. */
  app.post("/api/wallet/passkey/register/options", wrap(async (req, res) => {
    const userId = await requireUser(req);
    if (await findPasskey(userId)) throw httpError(409, "Your wallet passkey already exists. Approve transactions with it.");
    const [user] = await db.select().from(userAccounts).where(eq(userAccounts.id, userId));
    const options = await generateRegistrationOptions({
      rpName: "BlockFinaX",
      rpID: getRpId(req),
      userName: user?.email || user?.name || `BlockFinaX user ${userId}`,
      userID: new TextEncoder().encode(`bfx-${userId}`),
      attestationType: "none",
      supportedAlgorithmIDs: [-7],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    res.json({ flow: putChallenge({ challenge: options.challenge, userHandle: String(userId) }), options });
  }));

  app.post("/api/wallet/passkey/register/verify", wrap(async (req, res) => {
    const userId = await requireUser(req);
    const pending = takeChallenge(req.body?.flow);
    if (pending.userHandle !== String(userId)) throw httpError(400, "This passkey request belongs to another session");
    if (await findPasskey(userId)) throw httpError(409, "Your wallet passkey already exists");
    const verified = await verifyRegistrationResponse({
      response: req.body?.response,
      expectedChallenge: pending.challenge,
      expectedOrigin: getAppOrigin(req),
      expectedRPID: getRpId(req),
      requireUserVerification: true,
    });
    if (!verified.verified || !verified.registrationInfo) throw httpError(400, "Passkey registration failed");
    const credential = verified.registrationInfo.credential;
    const key = decodeCredentialPublicKey(credential.publicKey) as unknown as Map<number, unknown>;
    if (key.get(3) !== -7 || key.get(-1) !== 1) throw httpError(400, "A P-256 passkey is required");
    const x = key.get(-2) as Uint8Array;
    const y = key.get(-3) as Uint8Array;
    if (x?.length !== 32 || y?.length !== 32) throw httpError(400, "Invalid passkey public key");
    const [passkey] = await db.insert(walletPasskeys).values({
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64"),
      x: ethers.hexlify(x),
      y: ethers.hexlify(y),
      counter: credential.counter,
      transports: JSON.stringify(credential.transports ?? []),
    }).returning();
    res.json({ credentialId: passkey.credentialId, ...(await provision(userId, passkey)) });
  }));

  app.post("/api/wallet/passkey/signin/options", wrap(async (req, res) => {
    await ensurePasskeyColumns();
    const options = await generateAuthenticationOptions({ rpID: getRpId(req), userVerification: "required" });
    res.json({ flow: putChallenge({ challenge: options.challenge }), options });
  }));

  app.post("/api/wallet/passkey/signin/verify", wrap(async (req, res) => {
    const pending = takeChallenge(req.body?.flow);
    const response = req.body?.response;
    const [passkey] = await db.select().from(walletPasskeys).where(eq(walletPasskeys.credentialId, String(response?.id ?? ""))).limit(1);
    if (!passkey) throw httpError(400, "This passkey is not registered with BlockFinaX testnet");
    if (passkey.status !== "active") throw httpError(400, "This backup passkey is not set up yet. Finish adding it from your other device.");
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: getAppOrigin(req),
      expectedRPID: getRpId(req),
      requireUserVerification: true,
      credential: { id: passkey.credentialId, publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64")), counter: passkey.counter, transports: JSON.parse(passkey.transports) },
    });
    if (!result.verified) throw httpError(401, "Passkey verification failed");
    await db.update(walletPasskeys).set({ counter: result.authenticationInfo.newCounter }).where(eq(walletPasskeys.id, passkey.id));
    const sessionToken = await createSession(passkey.userId);
    const [user] = await db.select().from(userAccounts).where(eq(userAccounts.id, passkey.userId));
    const provisioned = await provision(passkey.userId, (await findPasskey(passkey.userId)) ?? passkey);
    res.json({ sessionToken, user: { id: user.id, name: user.name }, credentialId: passkey.credentialId, ...provisioned });
  }));

  app.get("/api/wallet/passkey/me", wrap(async (req, res) => {
    const userId = await requireUser(req);
    const passkey = await findPasskey(userId);
    const [user] = await db.select().from(userAccounts).where(eq(userAccounts.id, userId));
    const accounts = passkey ? (await provision(userId, passkey)).accounts : [];
    const passkeys = await db.select().from(walletPasskeys).where(eq(walletPasskeys.userId, userId)).orderBy(asc(walletPasskeys.id));
    res.json({ user: { id: user.id, name: user.name, email: user.email }, credentialId: passkey?.credentialId ?? null, accounts, passkeys: passkeys.map(passkeyView) });
  }));

  app.post("/api/wallet/evm/prepare", wrap(async (req, res) => {
    const userId = await requireUser(req);
    const { registry, evm } = chains();
    if (!evm) throw httpError(400, "No EVM network is enabled for this wallet");
    const passkey = await passkeyFor(userId);
    const accounts = await new AccountService(registry, await drizzleAccountRepository(registry)).accounts(userId);
    const sender = accounts.find((a) => a.chain === evm.key)?.address;
    if (!sender) throw httpError(400, `No ${evm.name} account yet. Sign in again to create it.`);
    const calls = (Array.isArray(req.body?.calls) ? req.body.calls : []).map((c: any) => ({
      target: ethers.getAddress(String(c.to)), value: BigInt(c.value ?? 0), data: String(c.data ?? "0x"),
    }));
    const prepared = await evmRelayer(evm).prepare({ userId, sender, owner: passkeyOwner(passkey.x, passkey.y), calls });
    const options = await generateAuthenticationOptions({
      rpID: getRpId(req),
      challenge: ethers.getBytes(prepared.hash),
      allowCredentials: (await activePasskeys(userId)).filter((p) => p.evmOwner).map((p) => ({ id: p.credentialId, transports: JSON.parse(p.transports) })),
      userVerification: "required",
    });
    res.json({ id: prepared.id, hash: prepared.hash, options });
  }));

  app.post("/api/wallet/evm/submit", wrap(async (req, res) => {
    const userId = await requireUser(req);
    const { evm } = chains();
    if (!evm) throw httpError(400, "No EVM network is enabled for this wallet");
    const relay = evmRelayer(evm);
    const pending = relay.take(String(req.body?.id ?? ""), userId);
    const response = req.body?.response;
    const passkey = (await activePasskeys(userId)).find((p) => p.credentialId === response?.id && p.evmOwner);
    if (!passkey) throw httpError(401, "Approve with a passkey that owns this wallet");
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: Buffer.from(ethers.getBytes(pending.hash)).toString("base64url"),
      expectedOrigin: getAppOrigin(req),
      expectedRPID: getRpId(req),
      requireUserVerification: true,
      credential: { id: passkey.credentialId, publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64")), counter: passkey.counter, transports: JSON.parse(passkey.transports) },
    });
    if (!result.verified) throw httpError(401, "Passkey verification failed");
    await db.update(walletPasskeys).set({ counter: result.authenticationInfo.newCounter }).where(eq(walletPasskeys.id, passkey.id));
    const sent = await relay.submit(pending, {
      authenticatorData: toBytes(response.response.authenticatorData),
      clientDataJSON: Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"),
      signature: toBytes(response.response.signature),
      ownerIndex: passkey.evmOwnerIndex,
    });
    res.json({ chain: evm.key, hash: sent.hash, state: sent.success ? "CONFIRMED" : "FAILED" });
  }));

  // ── Backup passkeys ─────────────────────────────────────────────────────

  /** Register a backup passkey (on this device or a security key). It starts as pending. */
  app.post("/api/wallet/passkeys/backup/options", wrap(async (req, res) => {
    const userId = await requireUser(req);
    if (!(await findPasskey(userId))) throw httpError(400, "Create your first passkey before adding a backup");
    const all = await db.select().from(walletPasskeys).where(eq(walletPasskeys.userId, userId));
    if (all.length >= 5) throw httpError(400, "You can have up to five passkeys");
    const [user] = await db.select().from(userAccounts).where(eq(userAccounts.id, userId));
    const label = String(req.body?.label ?? "").trim().slice(0, 40) || "Backup passkey";
    const options = await generateRegistrationOptions({
      rpName: "BlockFinaX",
      rpID: getRpId(req),
      userName: `${user?.email || user?.name || `user ${userId}`} (${label})`,
      userID: new TextEncoder().encode(`bfx-${userId}`),
      attestationType: "none",
      supportedAlgorithmIDs: [-7],
      excludeCredentials: all.map((p) => ({ id: p.credentialId, transports: JSON.parse(p.transports) })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    res.json({ flow: putChallenge({ challenge: options.challenge, userHandle: String(userId), name: label }), options });
  }));

  app.post("/api/wallet/passkeys/backup/verify", wrap(async (req, res) => {
    const userId = await requireUser(req);
    const pending = takeChallenge(req.body?.flow);
    if (pending.userHandle !== String(userId)) throw httpError(400, "This passkey request belongs to another session");
    const verified = await verifyRegistrationResponse({
      response: req.body?.response,
      expectedChallenge: pending.challenge,
      expectedOrigin: getAppOrigin(req),
      expectedRPID: getRpId(req),
      requireUserVerification: true,
    });
    if (!verified.verified || !verified.registrationInfo) throw httpError(400, "Passkey registration failed");
    const credential = verified.registrationInfo.credential;
    const key = decodeCredentialPublicKey(credential.publicKey) as unknown as Map<number, unknown>;
    if (key.get(3) !== -7 || key.get(-1) !== 1) throw httpError(400, "A P-256 passkey is required");
    const x = key.get(-2) as Uint8Array;
    const y = key.get(-3) as Uint8Array;
    if (x?.length !== 32 || y?.length !== 32) throw httpError(400, "Invalid passkey public key");
    await ensurePasskeyColumns();
    const [row] = await db.insert(walletPasskeys).values({
      userId, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey).toString("base64"),
      x: ethers.hexlify(x), y: ethers.hexlify(y), counter: credential.counter, transports: JSON.stringify(credential.transports ?? []),
      label: pending.name ?? "Backup passkey", role: "backup", status: "pending", evmOwner: false, stellarSigner: false,
    }).returning();
    // The Stellar wallet needs the uncompressed key (0x04 || x || y) to add it as a signer.
    res.json({ passkey: passkeyView(row), stellarPublicKey: Buffer.concat([Buffer.from([4]), Buffer.from(x), Buffer.from(y)]).toString("base64url") });
  }));

  async function backupFor(userId: number, credentialId: string): Promise<WalletPasskey> {
    await ensurePasskeyColumns();
    const [row] = await db.select().from(walletPasskeys)
      .where(and(eq(walletPasskeys.userId, userId), eq(walletPasskeys.credentialId, credentialId))).limit(1);
    if (!row || row.role !== "backup") throw httpError(404, "Backup passkey not found");
    return row;
  }

  /** Base: an operation adding the backup as an owner, approved by an active passkey. */
  app.post("/api/wallet/passkeys/:credentialId/base/prepare", wrap(async (req, res) => {
    const userId = await requireUser(req);
    const { registry, evm } = chains();
    if (!evm) throw httpError(400, "No EVM network is enabled for this wallet");
    const backup = await backupFor(userId, req.params.credentialId);
    if (backup.evmOwner) return res.json({ done: true });
    const primary = await passkeyFor(userId);
    const accounts = await new AccountService(registry, await drizzleAccountRepository(registry)).accounts(userId);
    const sender = accounts.find((a) => a.chain === evm.key)?.address;
    if (!sender) throw httpError(400, `No ${evm.name} account yet`);
    const data = accountInterface.encodeFunctionData("addOwnerPublicKey", [ethers.zeroPadValue(backup.x, 32), ethers.zeroPadValue(backup.y, 32)]);
    const prepared = await evmRelayer(evm).prepare({
      userId, sender, owner: passkeyOwner(primary.x, primary.y), calls: [{ target: sender, value: BigInt(0), data }], ownerChange: true,
    });
    const options = await generateAuthenticationOptions({
      rpID: getRpId(req),
      challenge: ethers.getBytes(prepared.hash),
      allowCredentials: (await activePasskeys(userId)).filter((p) => p.evmOwner).map((p) => ({ id: p.credentialId, transports: JSON.parse(p.transports) })),
      userVerification: "required",
    });
    res.json({ done: false, id: prepared.id, hash: prepared.hash, options });
  }));

  /**
   * Check both chains and activate the backup once each holds it. Base is read on chain
   * (isOwnerPublicKey); Stellar is checked from the confirmed add_signer transaction.
   */
  app.post("/api/wallet/passkeys/:credentialId/finalize", wrap(async (req, res) => {
    const userId = await requireUser(req);
    const { registry, evm, stellar } = chains();
    const backup = await backupFor(userId, req.params.credentialId);
    const accounts = await new AccountService(registry, await drizzleAccountRepository(registry)).accounts(userId);
    const updates: Partial<WalletPasskey> = {};

    if (evm && !backup.evmOwner) {
      const address = accounts.find((a) => a.chain === evm.key)?.address;
      const provider = new ethers.JsonRpcProvider(evm.rpcUrls[0], Number(evm.networkId), { staticNetwork: ethers.Network.from(Number(evm.networkId)) });
      if (address && (await provider.getCode(address)) !== "0x") {
        const call = (fn: string, args: unknown[]) => provider.call({ to: address, data: accountInterface.encodeFunctionData(fn, args) })
          .then((r) => accountInterface.decodeFunctionResult(fn, r));
        const x32 = ethers.zeroPadValue(backup.x, 32), y32 = ethers.zeroPadValue(backup.y, 32);
        const [isOwner] = await call("isOwnerPublicKey", [x32, y32]);
        if (isOwner) {
          const [next] = await call("nextOwnerIndex", []);
          const wanted = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [x32, y32]).toLowerCase();
          for (let i = Number(next) - 1; i >= 0; i--) {
            const [owner] = await call("ownerAtIndex", [i]);
            if (String(owner).toLowerCase() === wanted) { updates.evmOwnerIndex = i; updates.evmOwner = true; break; }
          }
        }
      }
    } else if (!evm) {
      updates.evmOwner = true;
    }

    const stellarHash = typeof req.body?.stellarHash === "string" ? req.body.stellarHash : null;
    if (stellar && !backup.stellarSigner && stellarHash && /^[0-9a-f]{64}$/.test(stellarHash)) {
      const wallet = accounts.find((a) => a.chain === stellar.key)?.address;
      const server = new StellarServer(stellar.rpcUrls[0]);
      const tx = await server.getTransaction(stellarHash);
      if (tx.status === StellarApi.GetTransactionStatus.SUCCESS && wallet) {
        const op = tx.envelopeXdr.v1().tx().operations()[0]?.body().invokeHostFunctionOp();
        const invoke = op?.hostFunction().invokeContract();
        const { Address, scValToNative } = await import("@stellar/stellar-sdk");
        const target = invoke ? Address.fromScAddress(invoke.contractAddress()).toString() : "";
        const fn = invoke?.functionName().toString();
        const arg = invoke ? scValToNative(invoke.args()[0]) : null;
        // Signer::Secp256r1(key_id, public_key, ...): the key id must be this passkey's credential id.
        const keyId = Array.isArray(arg) && arg[1] ? Buffer.from(arg[1]).toString("base64url") : null;
        if (target === wallet && fn === "add_signer" && keyId === backup.credentialId) updates.stellarSigner = true;
      }
    } else if (!stellar) {
      updates.stellarSigner = true;
    }

    const evmDone = updates.evmOwner ?? backup.evmOwner;
    const stellarDone = updates.stellarSigner ?? backup.stellarSigner;
    if (evmDone && stellarDone) updates.status = "active";
    if (Object.keys(updates).length) await db.update(walletPasskeys).set(updates).where(eq(walletPasskeys.id, backup.id));
    const [row] = await db.select().from(walletPasskeys).where(eq(walletPasskeys.id, backup.id));
    res.json({ passkey: passkeyView(row) });
  }));

  /** Forget a backup that never finished setup. Active passkeys stay: removing an owner is not built yet. */
  app.post("/api/wallet/passkeys/:credentialId/cancel", wrap(async (req, res) => {
    const userId = await requireUser(req);
    const backup = await backupFor(userId, req.params.credentialId);
    if (backup.evmOwner || backup.stellarSigner) throw httpError(400, "This passkey is already on your wallet and cannot be cancelled");
    await db.delete(walletPasskeys).where(eq(walletPasskeys.id, backup.id));
    res.json({ ok: true });
  }));

  /**
   * Testnet only: send FAUCET_USDC test USDC from the BlockFinaX faucet account to the user's
   * Stellar wallet, once per user per day. Circle's faucet cannot pay contract (C)
   * addresses, so testers are funded from this account instead.
   */
  const FAUCET_USDC = "10000";
  const faucetClaims = new Map<string, number>();
  app.post("/api/wallet/faucet/usdc", wrap(async (req, res) => {
    const userId = await requireUser(req);
    const secret = process.env.TESTNET_USDC_FAUCET_SECRET;
    const { registry, stellar } = chains();
    if (!secret || !stellar || registry.config.environment !== "testnet") throw httpError(503, "The test USDC faucet is not available here");
    const day = `${userId}:${new Date().toISOString().slice(0, 10)}`;
    if (faucetClaims.has(day)) throw httpError(429, "You already received test USDC today. Try again tomorrow.");
    const accounts = await new AccountService(registry, await drizzleAccountRepository(registry)).accounts(userId);
    const to = accounts.find((a) => a.chain === stellar.key)?.address;
    if (!to) throw httpError(400, "Create your wallet passkey first");
    const usdc = stellar.assets.USDC;
    const faucet = Keypair.fromSecret(secret);
    const server = new StellarServer(stellar.rpcUrls[0]);
    faucetClaims.set(day, Date.now());
    try {
      let tx = new TransactionBuilder(await server.getAccount(faucet.publicKey()), { fee: BASE_FEE, networkPassphrase: stellar.networkId })
        .addOperation(Operation.invokeContractFunction({
          contract: usdc.addressOrContract,
          function: "transfer",
          args: [nativeToScVal(faucet.publicKey(), { type: "address" }), nativeToScVal(to, { type: "address" }), nativeToScVal(toUnits(FAUCET_USDC, usdc.decimals), { type: "i128" })],
        }))
        .setTimeout(60)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (StellarApi.isSimulationError(sim)) throw new Error(/balance|#10/i.test(sim.error) ? "The faucet is empty. Ask the BlockFinaX team to refill it." : sim.error);
      tx = (await import("@stellar/stellar-sdk")).rpc.assembleTransaction(tx, sim).build();
      tx.sign(faucet);
      const sent = await server.sendTransaction(tx);
      if (sent.status === "ERROR") throw new Error("Stellar rejected the faucet transfer");
      for (let i = 0; i < 30; i++) {
        const found = await server.getTransaction(sent.hash);
        if (found.status === StellarApi.GetTransactionStatus.SUCCESS) return res.json({ chain: stellar.key, hash: sent.hash, amount: FAUCET_USDC });
        if (found.status === StellarApi.GetTransactionStatus.FAILED) throw new Error("The faucet transfer failed");
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(`The faucet transfer is still pending: ${sent.hash}`);
    } catch (err) {
      faucetClaims.delete(day);
      throw httpError(400, (err as Error).message);
    }
  }));

  app.use(["/api/wallet/passkey", "/api/wallet/evm", "/api/wallet/faucet"], (err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err?.status ?? 400).json({ error: { code: err?.status === 401 ? "UNAUTHORIZED" : "WALLET_ERROR", message: err?.message ?? "Request failed" } });
  });
}
