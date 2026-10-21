import { ethers } from "ethers";
import { randomBytes } from "node:crypto";
import { callSpreadValue, putSpreadValue } from "../pricing/kernel";

// Repeatable integration fixtures, not market rates or executable live prices.
export const SANDBOX_MARKETS: Record<string, { spot: number; sigma: number }> = {
  "USD/GHS": { spot: 10, sigma: 0.25 },
  "USD/NGN": { spot: 1500, sigma: 0.3 },
  "USD/KES": { spot: 130, sigma: 0.15 },
};

export async function sandboxQuote(body: any, config: { diamond: string; signerKey: string }, now = Math.floor(Date.now() / 1000)) {
  const market = SANDBOX_MARKETS[body.pair];
  if (!market) throw new Error(`Supported sandbox pairs: ${Object.keys(SANDBOX_MARKETS).join(", ")}`);
  for (const key of ["strike", "payoutCap", "notional", "expiryUnixSeconds"]) {
    if (typeof body[key] !== "number" || !Number.isFinite(body[key]) || body[key] <= 0) throw new Error(`${key} must be a positive finite number`);
  }
  if (!Number.isSafeInteger(body.expiryUnixSeconds)) throw new Error("expiryUnixSeconds must be an integer");
  const seconds = body.expiryUnixSeconds - now;
  if (seconds <= 0 || seconds > 365 * 86400) throw new Error("Expiry must be in the future and within 365 days");
  if (typeof body.strikeAbove !== "boolean") throw new Error("strikeAbove must be a boolean");
  if (body.dynamicPricing) throw new Error("This sandbox deployment supports fixed-price pools");
  if (body.strikeAbove ? body.payoutCap <= body.strike : body.payoutCap >= body.strike) throw new Error("Payout cap must follow the hedge direction");
  const wantsSignature = ["chainId", "diamondAddress", "creator"].some(key => body[key] !== undefined);
  if (wantsSignature && (body.chainId !== 84532 || typeof body.diamondAddress !== "string" || body.diamondAddress.toLowerCase() !== config.diamond.toLowerCase() || !ethers.isAddress(body.creator || ""))) throw new Error("Attestation requires Base Sepolia, the sandbox Diamond, and a valid creator");
  const inputs = { S: market.spot, K_lower: Math.min(body.strike, body.payoutCap), K_upper: Math.max(body.strike, body.payoutCap), T: seconds / (365.25 * 86400), r: 0.04, q: 0.04, sigma: market.sigma };
  const value = (body.strikeAbove ? callSpreadValue : putSpreadValue)(inputs);
  const rate = Math.max(1, Math.round(value / market.spot * 1e6));
  const maxRate = Math.abs(body.payoutCap - body.strike) / market.spot;
  if (rate / 1e6 >= maxRate) throw new Error("Range is too narrow for a viable test quote");
  let attestation = null;
  if (wantsSignature) {
    const wallet = new ethers.Wallet(config.signerKey);
    const nonce = "0x" + randomBytes(32).toString("hex");
    // Mirrors the fixed-price v8 protocol in the integrator API repository.
    const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "address", "string", "uint256", "uint256", "uint256", "uint256", "uint256", "bool", "uint256", "bytes32"],
      [84532, config.diamond, body.creator, body.pair, Math.round(body.strike * 1e6), Math.round(body.payoutCap * 1e6), rate, body.expiryUnixSeconds, Math.round(market.spot * 1e6), body.strikeAbove, now, nonce],
    ));
    attestation = { signature: await wallet.signMessage(ethers.getBytes(hash)), quoteTimestamp: String(now), quoteNonce: nonce, signerAddress: wallet.address, expiresAt: String(now + 120) };
  }
  return {
    environment: "sandbox", synthetic: true,
    premiumRate: rate / 1e6, premiumRateFixed6: String(rate), premiumUsd: body.notional * rate / 1e6,
    maxPayoutUsd: body.notional * maxRate, attestation,
    breakdown: { pair: body.pair, spot: market.spot, sigma: market.sigma, strike: body.strike, payoutCap: body.payoutCap, T_days: seconds / 86400, notional: body.notional, direction: body.strikeAbove ? "upward" : "downward", source: "sandbox fixtures; not live market data", protocol: "fixed-v8" },
  };
}
