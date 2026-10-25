/**
 * The bytes the Stellar currency-pool contract verifies for a purchase quote
 * (contracts/currency-pool quote_digest). Pinned by the same golden vector as the
 * contract's quote_digest_golden_vector test.
 */
import { createHash } from "node:crypto";
import { Address } from "@stellar/stellar-sdk";

const TAG = Buffer.from("BFX_STELLAR_POOL_BUY_V1");

export interface StellarBuyParams {
  pool_id: number;
  notional: bigint;
  tenor_days: number;
  structure: number;
  strike_above: boolean;
  spot: bigint;
  strike: bigint;
  cap: bigint;
  fair_rate: number;
  max_cost: bigint;
  deadline: bigint;
  quote_timestamp: bigint;
  quote_nonce: Buffer;
}

const be = (value: bigint, bytes: number) =>
  Buffer.from(BigInt.asUintN(bytes * 8, value).toString(16).padStart(bytes * 2, "0"), "hex");

export function stellarQuoteDigest(contractId: string, hedger: string, p: StellarBuyParams): Buffer {
  return createHash("sha256")
    .update(Buffer.concat([
      TAG,
      Address.fromString(contractId).toScVal().toXDR(),
      Address.fromString(hedger).toScVal().toXDR(),
      be(BigInt(p.pool_id), 4),
      be(p.notional, 16),
      be(BigInt(p.tenor_days), 4),
      be(BigInt(p.structure), 4),
      Buffer.from([p.strike_above ? 1 : 0]),
      be(p.spot, 8),
      be(p.strike, 8),
      be(p.cap, 8),
      be(BigInt(p.fair_rate), 4),
      be(p.quote_timestamp, 8),
      p.quote_nonce,
    ]))
    .digest();
}
