/** Isolated partner pricing service. Never starts production routes or workers. */
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { ethers } from "ethers";
import { sandboxQuote, SANDBOX_MARKETS } from "./quote";

async function start() {
  if (process.env.APP_ENV !== "sandbox" || process.env.NETWORK_MODE !== "testnet") throw new Error("Sandbox entrypoint requires APP_ENV=sandbox and NETWORK_MODE=testnet");
  for (const key of ["DATABASE_URL", "SANDBOX_DIAMOND_ADDRESS", "SANDBOX_PRICING_PRIVATE_KEY"]) if (!process.env[key]) throw new Error(`${key} is required`);
  // Sandbox services receive only new sandbox secrets. Refuse copied production credentials.
  for (const key of ["DEPLOYER_PRIVATE_KEY", "TREASURY_POOL_PRIVATE_KEY", "PRICING_ENGINE_PRIVATE_KEY", "RESEND_API_KEY", "RIFT_SECRET_KEY"]) if (process.env[key]) throw new Error(`Remove production credential ${key} from this service`);
  const diamond = process.env.SANDBOX_DIAMOND_ADDRESS!;
  const signerKey = process.env.SANDBOX_PRICING_PRIVATE_KEY!;
  if (!ethers.isAddress(diamond) || diamond === ethers.ZeroAddress) throw new Error("Invalid sandbox Diamond");
  const provider = new ethers.JsonRpcProvider(process.env.SANDBOX_RPC_URL || "https://sepolia.base.org");
  if (Number((await provider.getNetwork()).chainId) !== 84532) throw new Error("Sandbox RPC must target Base Sepolia");
  if (await provider.getCode(diamond) === "0x") throw new Error("Sandbox Diamond must be deployed first");
  const signer = new ethers.Wallet(signerKey);
  const contract = new ethers.Contract(diamond, ["function getPricingEngineSigner() view returns(address)"], provider);
  if ((await contract.getPricingEngineSigner()).toLowerCase() !== signer.address.toLowerCase()) throw new Error("Pricing signer does not match sandbox contract");

  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`CREATE TABLE IF NOT EXISTS sandbox_quote_log (id BIGSERIAL PRIMARY KEY, pair TEXT NOT NULL, creator TEXT, premium_rate TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "32kb" }));
  const { generalApiLimiter } = await import("../middleware/rate-limiter");
  app.use("/api", generalApiLimiter);
  app.use((_req, res, next) => { res.set("X-BlockFinaX-Environment", "sandbox"); res.set("Cache-Control", "no-store"); next(); });
  app.get("/health", (_req, res) => res.json({ status: "ok", environment: "sandbox", chainId: 84532 }));
  app.get("/api/pricing/health", (_req, res) => res.json({ environment: "sandbox", synthetic: true, pricingEngineSigner: signer.address, pairs: Object.entries(SANDBOX_MARKETS).map(([pair, market]) => ({ pair, ...market, source: "synthetic" })) }));
  app.get("/api/pricing/signer", (_req, res) => res.json({ signerAddress: signer.address }));
  app.post("/api/pricing/quote", async (req, res) => {
    try {
      const result = await sandboxQuote(req.body, { diamond, signerKey });
      await db.execute(sql`INSERT INTO sandbox_quote_log (pair, creator, premium_rate) VALUES (${req.body.pair}, ${req.body.creator || null}, ${result.premiumRateFixed6})`);
      res.json(result);
    } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Invalid test quote" }); }
  });
  app.listen(Number(process.env.PORT) || 5001, "0.0.0.0", () => console.log("[sandbox-pricing] ready on Base Sepolia; synthetic market inputs"));
}

start().catch(e => { console.error("[sandbox-pricing] startup failed:", e.message); process.exitCode = 1; });
