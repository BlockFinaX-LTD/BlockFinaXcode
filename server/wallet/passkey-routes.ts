/**
 * The BlockFinaX passkey wallet on the main backend (testnet, WALLET_PROVIDER=passkey).
 *
 * One passkey is the user's login and the owner of their smart accounts:
 *   - Stellar: a Passkey Kit smart account, deployed at signup by the fee payer
 *   - EVM (Base Sepolia): a Coinbase Smart Wallet, counterfactual until its first
 *     transaction, which the BlockFinaX relayer submits and pays for
 *
 * Routes
 *   GET  /api/wallet/passkey/config
 *   POST /api/wallet/passkey/signup/options   { name? }
 *   POST /api/wallet/passkey/signup/verify    { flow, response }
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
import { eq } from "drizzle-orm";
import { db } from "../db";
import { userAccounts } from "@shared/auth-core-schema";
import { walletPasskeys, type WalletPasskey } from "@shared/chain-wallet-schema";
import { createSession, getAppOrigin, getRpId, getSession } from "../auth-routes";
import { chainRegistry } from "../chain/config";
import { AccountService, drizzleAccountRepository } from "../accounts/service";
import type { ChainConfig } from "@shared/chains/registry";
import { passkeyOwner, smartAccountAddress } from "./evm-smart-account";
import { deployStellarSmartAccount, PASSKEY_WALLET_WASM } from "./stellar-smart-account";
import { EvmRelayer } from "./evm-relayer";

export const passkeyWalletEnabled = () => process.env.WALLET_PROVIDER === "passkey";

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
  const contracts = [evm.contracts.currencyPool, evm.contracts.poolOracle].filter((a): a is string => Boolean(a));
  const instance = new EvmRelayer(provider, Number(evm.networkId), secret ? new ethers.Wallet(secret, provider) : null, {
    tokens: Object.values(evm.assets).map((a) => a.addressOrContract),
    contracts,
    dailyOpsPerUser: Number(process.env.EVM_RELAYER_DAILY_OPS || 50),
  });
  relayer = { chain: evm.key, instance };
  return instance;
}

async function requireUser(req: Request) {
  const session = await getSession(req);
  if (!session?.userId) throw httpError(401, "Sign in first");
  return session.userId;
}

async function passkeyFor(userId: number): Promise<WalletPasskey> {
  const [row] = await db.select().from(walletPasskeys).where(eq(walletPasskeys.userId, userId)).limit(1);
  if (!row) throw httpError(404, "No passkey wallet for this account");
  return row;
}

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

  app.post("/api/wallet/passkey/signup/options", wrap(async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : "";
    const userHandle = randomBytes(16).toString("base64url");
    const options = await generateRegistrationOptions({
      rpName: "BlockFinaX",
      rpID: getRpId(req),
      userName: name || "BlockFinaX testnet",
      userID: toBytes(userHandle),
      attestationType: "none",
      supportedAlgorithmIDs: [-7],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    res.json({ flow: putChallenge({ challenge: options.challenge, name, userHandle }), options });
  }));

  app.post("/api/wallet/passkey/signup/verify", wrap(async (req, res) => {
    const pending = takeChallenge(req.body?.flow);
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

    const [user] = await db.insert(userAccounts).values({ name: pending.name || null }).returning();
    const [passkey] = await db.insert(walletPasskeys).values({
      userId: user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64"),
      x: ethers.hexlify(x),
      y: ethers.hexlify(y),
      counter: credential.counter,
      transports: JSON.stringify(credential.transports ?? []),
    }).returning();
    const sessionToken = await createSession(user.id);
    const provisioned = await provision(user.id, passkey);
    res.json({ sessionToken, user: { id: user.id, name: user.name }, credentialId: passkey.credentialId, ...provisioned });
  }));

  app.post("/api/wallet/passkey/signin/options", wrap(async (req, res) => {
    const options = await generateAuthenticationOptions({ rpID: getRpId(req), userVerification: "required" });
    res.json({ flow: putChallenge({ challenge: options.challenge }), options });
  }));

  app.post("/api/wallet/passkey/signin/verify", wrap(async (req, res) => {
    const pending = takeChallenge(req.body?.flow);
    const response = req.body?.response;
    const [passkey] = await db.select().from(walletPasskeys).where(eq(walletPasskeys.credentialId, String(response?.id ?? ""))).limit(1);
    if (!passkey) throw httpError(400, "This passkey is not registered with BlockFinaX testnet");
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
    const provisioned = await provision(passkey.userId, passkey);
    res.json({ sessionToken, user: { id: user.id, name: user.name }, credentialId: passkey.credentialId, ...provisioned });
  }));

  app.get("/api/wallet/passkey/me", wrap(async (req, res) => {
    const userId = await requireUser(req);
    const passkey = await passkeyFor(userId);
    const [user] = await db.select().from(userAccounts).where(eq(userAccounts.id, userId));
    const { registry } = chains();
    const accounts = await new AccountService(registry, await drizzleAccountRepository(registry)).accounts(userId);
    res.json({ user: { id: user.id, name: user.name, email: user.email }, credentialId: passkey.credentialId, accounts });
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
      allowCredentials: [{ id: passkey.credentialId, transports: JSON.parse(passkey.transports) }],
      userVerification: "required",
    });
    res.json({ id: prepared.id, hash: prepared.hash, options });
  }));

  app.post("/api/wallet/evm/submit", wrap(async (req, res) => {
    const userId = await requireUser(req);
    const { evm } = chains();
    if (!evm) throw httpError(400, "No EVM network is enabled for this wallet");
    const passkey = await passkeyFor(userId);
    const relay = evmRelayer(evm);
    const pending = relay.take(String(req.body?.id ?? ""), userId);
    const response = req.body?.response;
    if (response?.id !== passkey.credentialId) throw httpError(401, "Approve with the passkey that owns this wallet");
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
    });
    res.json({ chain: evm.key, hash: sent.hash, state: sent.success ? "CONFIRMED" : "FAILED" });
  }));

  app.use(["/api/wallet/passkey", "/api/wallet/evm"], (err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err?.status ?? 400).json({ error: { code: err?.status === 401 ? "UNAUTHORIZED" : "WALLET_ERROR", message: err?.message ?? "Request failed" } });
  });
}
