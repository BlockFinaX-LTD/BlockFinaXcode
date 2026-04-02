/**
 * Mercuryo Onramp Routes
 *
 * Generates v2-signed widget URLs for the Mercuryo buy-crypto widget.
 * Signature: SHA512(address + secret + ip + merchantTransactionId) prefixed with "v2:"
 */
import { Express, Request } from "express";
import crypto from "crypto";

const WIDGET_ID = process.env.MERCURYO_WIDGET_ID || "";
const SECRET_KEY = process.env.MERCURYO_SECRET_KEY || "";

function getMercuryoNetwork(chainId: number): string {
  switch (chainId) {
    case 56:   return "BSC";
    case 8453: return "BASE";
    case 1135: return "ETHEREUM"; // Lisk — Mercuryo routes via ETH network
    default:   return "ETHEREUM";
  }
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "127.0.0.1";
}

export function registerMercuryoRoutes(app: Express) {
  /**
   * POST /api/mercuryo/sign
   * Body: { address, chainId, currency? }
   * Returns: { widgetUrl, configured }
   */
  app.post("/api/mercuryo/sign", async (req, res) => {
    try {
      if (!WIDGET_ID || !SECRET_KEY) {
        return res.json({
          configured: false,
          widgetUrl: null,
          message: "Mercuryo not yet configured — add MERCURYO_WIDGET_ID and MERCURYO_SECRET_KEY to environment secrets.",
        });
      }

      const { address, chainId = 1135, currency = "USDC" } = req.body;

      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }

      const merchantTransactionId = crypto.randomUUID().replace(/-/g, "");
      const userIp = getClientIp(req);
      const network = getMercuryoNetwork(Number(chainId));

      // v2 signature: SHA512(address + secret + Ip + merchantTransactionId)
      const raw = address + SECRET_KEY + userIp + merchantTransactionId;
      const hash = crypto.createHash("sha512").update(raw).digest("hex");
      const signature = `v2:${hash}`;

      const params = new URLSearchParams({
        widget_id: WIDGET_ID,
        type: "buy",
        currency,
        network,
        address,
        merchant_transaction_id: merchantTransactionId,
        signature,
      });

      const widgetUrl = `https://exchange.mercuryo.io/?${params.toString()}`;

      return res.json({ configured: true, widgetUrl, merchantTransactionId });
    } catch (err) {
      console.error("[Mercuryo] Sign error:", err);
      return res.status(500).json({ error: "Failed to generate widget URL" });
    }
  });

  /**
   * GET /api/mercuryo/status
   * Returns whether Mercuryo is configured (no secrets exposed)
   */
  app.get("/api/mercuryo/status", (_req, res) => {
    res.json({ configured: !!(WIDGET_ID && SECRET_KEY) });
  });
}
