import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { EmailOtp, sendCode } from "./otp.js";
import { OAuth2Client } from "google-auth-library";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { decodeCredentialPublicKey } from "@simplewebauthn/server/helpers";
import { Store } from "./store.js";
import {
  Challenges,
  randomToken,
  issueSession,
  readSession,
} from "./security.js";
import { inspectPayment } from "./policy.js";
import {
  NETWORK,
  RPC,
  WASM,
  TOKEN,
  deploy,
  fund,
  balance,
  invoke,
} from "./stellar.js";
const origin = process.env.APP_ORIGIN || "http://localhost:5173";
const rpID = process.env.RP_ID || new URL(origin).hostname;
const secret = process.env.SESSION_SECRET || "";
if (secret.length < 32)
  throw Error("Set SESSION_SECRET to at least 32 random characters");
if (
  process.env.NODE_ENV === "production" &&
  (!origin.startsWith("https://") || !process.env.RESEND_API_KEY)
)
  throw Error("Production requires HTTPS APP_ORIGIN and RESEND_API_KEY");
const secure = origin.startsWith("https://");
const db = new Store(process.env.DATABASE_PATH);
const challenges = new Challenges();
const emailOtp = new EmailOtp(db, secret);
const deploymentsInFlight = new Set<string>();
const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", new URL(RPC).origin],
        frameAncestors: ["'none'"],
      },
    },
  }),
);
app.use(express.json({ limit: "128kb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use("/api", (req, res, next) => {
  if (req.method !== "GET" && req.get("origin") !== origin) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  next();
});
const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10 });
const sponsorLimit = rateLimit({ windowMs: 60_000, limit: 5 });
function cookie(req: express.Request, name: string) {
  return req.headers.cookie
    ?.split("; ")
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
async function user(req: express.Request) {
  try {
    const id = await readSession(cookie(req, "bfx_session") || "", secret);
    const value = db.user(id);
    if (!value) throw Error();
    return value;
  } catch {
    throw Object.assign(Error("Please sign in"), { status: 401 });
  }
}
function findUser(email: string) {
  const known = db.db
    .prepare("SELECT id FROM users WHERE email=?")
    .get(email) as { id: string } | undefined;
  const id = known?.id || randomUUID();
  if (!known)
    db.db.prepare("INSERT INTO users(id,email) VALUES(?,?)").run(id, email);
  return id;
}
async function login(res: express.Response, id: string) {
  res.cookie("bfx_session", await issueSession(id, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 8 * 3600_000,
    path: "/",
  });
}
app.get("/api/config", (_req, res) =>
  res.json({
    network: "testnet",
    networkPassphrase: NETWORK,
    rpcUrl: RPC,
    walletWasmHash: WASM,
    tokenContract: TOKEN,
    rpId: rpID,
    googleEnabled: !!(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ),
    sponsorshipConfigured: !!process.env.STELLAR_FEE_PAYER_SECRET,
  }),
);
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, network: "testnet" }),
);
app.get("/api/me", async (req, res) => {
  const value = await user(req);
  res.json({
    email: value.email,
    wallet: db.wallet(value.id)
      ? {
          contract: db.wallet(value.id)!.contract,
          credential: db.wallet(value.id)!.credential,
        }
      : null,
    events: db.events(value.id),
  });
});
app.post("/api/auth/email", authLimit, async (req, res) => {
  const email = z.email().max(254).parse(req.body.email).toLowerCase();
  const { requestId, code } = emailOtp.issue(email);
  try {
    await sendCode(email, code, requestId);
  } catch (error) {
    emailOtp.cancel(requestId);
    throw error;
  }
  res.json({
    requestId,
    message: "Check your email for your six-digit sign-in code.",
  });
});
app.post("/api/auth/email/verify", authLimit, async (req, res) => {
  const input = z
    .object({
      email: z.email().max(254),
      requestId: z.string().min(32).max(128),
      code: z.string().regex(/^\d{6}$/),
    })
    .parse(req.body);
  const email = input.email.toLowerCase();
  emailOtp.verify(email, input.requestId, input.code);
  await login(res, findUser(email));
  res.json({ ok: true });
});
function google() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
    throw Error("Google sign-in is not configured");
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${origin}/api/auth/google/callback`,
  );
}
app.get("/api/auth/google", authLimit, (_req, res) => {
  const state = randomToken();
  res.cookie("bfx_oauth", state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 600_000,
    path: "/api/auth/google",
  });
  res.redirect(
    google().generateAuthUrl({
      scope: ["openid", "email", "profile"],
      state,
      access_type: "online",
    }),
  );
});
app.get("/api/auth/google/callback", authLimit, async (req, res) => {
  const state = z.string().parse(req.query.state);
  if (state !== cookie(req, "bfx_oauth"))
    throw Error("Google sign-in state mismatch");
  res.clearCookie("bfx_oauth", { path: "/api/auth/google" });
  const client = google();
  const { tokens } = await client.getToken(z.string().parse(req.query.code));
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token!,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified)
    throw Error("Google email must be verified");
  await login(res, findUser(payload.email.toLowerCase()));
  res.redirect("/");
});
app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("bfx_session", { path: "/" });
  res.json({ ok: true });
});
app.post("/api/wallet/registration/options", async (req, res) => {
  const value = await user(req);
  if (db.wallet(value.id))
    throw Error("A wallet already exists. Unlock it with your passkey.");
  const options = await generateRegistrationOptions({
    rpName: "BlockFinaX",
    rpID,
    userName: value.email,
    userID: new TextEncoder().encode(value.id),
    attestationType: "none",
    supportedAlgorithmIDs: [-7],
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });
  challenges.put(`${value.id}:register`, options.challenge);
  res.json(options);
});
app.post("/api/wallet/registration/verify", sponsorLimit, async (req, res) => {
  const value = await user(req);
  if (db.wallet(value.id)) throw Error("A wallet already exists");
  const verified = await verifyRegistrationResponse({
    response: req.body,
    expectedChallenge: challenges.take(`${value.id}:register`),
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });
  if (!verified.verified || !verified.registrationInfo)
    throw Error("Passkey registration failed");
  const credential = verified.registrationInfo.credential;
  const key = decodeCredentialPublicKey(credential.publicKey) as Map<
    number,
    unknown
  >;
  if (key.get(3) !== -7 || key.get(-1) !== 1)
    throw Error("A P-256 passkey is required");
  const x = key.get(-2) as Uint8Array;
  const y = key.get(-3) as Uint8Array;
  if (x.length !== 32 || y.length !== 32) throw Error("Invalid passkey");
  const publicKey = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(x),
    Buffer.from(y),
  ]);
  if (deploymentsInFlight.has(value.id) || db.wallet(value.id))
    throw Error("Wallet creation is already in progress");
  deploymentsInFlight.add(value.id);
  try {
    const deployed = await deploy(credential.id, publicKey);
    db.db
      .prepare(
        "INSERT INTO wallets(user_id,contract,credential,public_key,counter,transports) VALUES(?,?,?,?,?,?)",
      )
      .run(
        value.id,
        deployed.contract,
        credential.id,
        Buffer.from(credential.publicKey).toString("base64"),
        credential.counter,
        JSON.stringify(credential.transports || []),
      );
    db.event(value.id, "Wallet created", deployed.hash);
    res.json({
      contract: deployed.contract,
      credential: credential.id,
      hash: deployed.hash,
    });
  } finally {
    deploymentsInFlight.delete(value.id);
  }
});
app.post("/api/wallet/unlock/options", async (req, res) => {
  const value = await user(req);
  const wallet = db.wallet(value.id);
  if (!wallet) throw Error("Create a wallet first");
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [
      { id: wallet.credential, transports: JSON.parse(wallet.transports) },
    ],
    userVerification: "required",
  });
  challenges.put(`${value.id}:unlock`, options.challenge);
  res.json(options);
});
app.post("/api/wallet/unlock/verify", async (req, res) => {
  const value = await user(req);
  const wallet = db.wallet(value.id);
  if (!wallet) throw Error("No wallet found");
  const result = await verifyAuthenticationResponse({
    response: req.body,
    expectedChallenge: challenges.take(`${value.id}:unlock`),
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: wallet.credential,
      publicKey: Buffer.from(wallet.public_key, "base64"),
      counter: wallet.counter,
      transports: JSON.parse(wallet.transports),
    },
  });
  if (!result.verified) throw Error("Passkey verification failed");
  db.db
    .prepare("UPDATE wallets SET counter=? WHERE user_id=?")
    .run(result.authenticationInfo.newCounter, value.id);
  res.json({ contract: wallet.contract, credential: wallet.credential });
});
app.get("/api/wallet/balance", async (req, res) => {
  const value = await user(req);
  const wallet = db.wallet(value.id);
  if (!wallet) throw Error("Create a wallet first");
  res.json({ stroops: await balance(wallet.contract) });
});
const faucetInFlight = new Set<string>();
app.post("/api/wallet/faucet", sponsorLimit, async (req, res) => {
  const value = await user(req);
  const wallet = db.wallet(value.id);
  if (!wallet) throw Error("Create a wallet first");
  const prior = db.db
    .prepare(
      "SELECT created FROM events WHERE user_id=? AND kind='Test funds received' ORDER BY created DESC LIMIT 1",
    )
    .get(value.id) as { created: number } | undefined;
  if (
    faucetInFlight.has(value.id) ||
    (prior && prior.created > Date.now() - 24 * 3600_000)
  )
    throw Error("Test funding is available once every 24 hours");
  faucetInFlight.add(value.id);
  try {
    const txHash = await fund(wallet.contract);
    db.event(value.id, "Test funds received", txHash);
    res.json({ hash: txHash });
  } finally {
    faucetInFlight.delete(value.id);
  }
});
app.post("/api/wallet/payments", sponsorLimit, async (req, res) => {
  const value = await user(req);
  const wallet = db.wallet(value.id);
  if (!wallet) throw Error("Create a wallet first");
  const xdr = z.string().min(10).max(100_000).parse(req.body.xdr);
  const payment = inspectPayment(xdr, NETWORK, wallet.contract, TOKEN);
  const txHash = await invoke(payment.func, payment.auth);
  db.event(value.id, `Sent ${Number(payment.amount) / 1e7} test XLM`, txHash);
  res.json({ hash: txHash });
});
app.use(express.static(resolve("dist")));
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const error = err as Error & { status?: number };
    res
      .status(error.status || 400)
      .json({ error: error.message || "Request failed" });
  },
);
app.listen(
  Number(process.env.PORT || 4100),
  process.env.HOST || "127.0.0.1",
  () =>
    console.info(
      `BlockFinaX wallet API: http://localhost:${process.env.PORT || 4100}`,
    ),
);
