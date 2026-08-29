/**
 * signer.ts — pricing-engine ECDSA signing.
 *
 * Loads PRICING_ENGINE_PRIVATE_KEY from env and signs every quote with the EXACT
 * payload the on-chain contract verifies (see HedgeFacet._verifyQuoteSignature):
 *
 *   keccak256(abi.encode(
 *     chainId, diamondAddress, creator,
 *     underlying, strike, payoutCap, premiumRate, expiryDate, initialRate, strikeAbove,
 *     quoteTimestamp, quoteNonce
 *   ))
 *
 * wrapped with the EIP-191 "Ethereum Signed Message" prefix (so the contract can
 * use OpenZeppelin's MessageHashUtils.toEthSignedMessageHash).
 *
 * The signer wallet is constructed lazily (on first sign), so the server can boot
 * without the env var present — pricing quotes will simply be unsigned in that case.
 *
 * Key rotation: change PRICING_ENGINE_PRIVATE_KEY in env, restart server, and call
 * setPricingEngineSigner(newAddress) on-chain. Quotes signed with the old key
 * become invalid immediately on the on-chain call.
 */

import { ethers } from "ethers";
import { randomBytes } from "node:crypto";

let cachedWallet: ethers.Wallet | null = null;

/** Lazy-load the signer wallet from env. Returns null if PRICING_ENGINE_PRIVATE_KEY is unset. */
function getSigner(): ethers.Wallet | null {
  if (cachedWallet) return cachedWallet;
  const key = process.env.PRICING_ENGINE_PRIVATE_KEY;
  if (!key) return null;
  try {
    cachedWallet = new ethers.Wallet(key);
    return cachedWallet;
  } catch (err) {
    console.error("[Pricing] PRICING_ENGINE_PRIVATE_KEY is malformed; signing disabled:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Public address of the signer, for diagnostics and for setting on-chain via setPricingEngineSigner. */
export function getSignerAddress(): string | null {
  const w = getSigner();
  return w ? w.address : null;
}

/** Convert a JS Number/string FX rate (e.g. 11.5) to a 6-decimal bigint matching the on-chain `rate()` helper. */
export function rateToFixed6(value: number | string): bigint {
  const [whole, frac = ""] = String(value).split(".");
  const padded = (frac + "000000").slice(0, 6);
  return BigInt(whole) * BigInt(1_000_000) + BigInt(padded || "0");
}

/** Convert a 6-decimal-PRECISION fraction (e.g. premiumRate 25_000n = 2.5%) — passthrough. */
function asBigint(v: number | bigint | string): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.round(v));
  return BigInt(v);
}

export interface SignableQuote {
  /** EIP-155 chain id of the target Diamond. */
  chainId: number | bigint;
  /** Diamond contract address (the verifier). */
  diamondAddress: string;
  /** Address that will call createEvent — quote is BOUND to this caller. */
  creator: string;

  // Event params — must match what the user submits to createEvent verbatim.
  underlying: string;        // e.g. "USD/GHS"
  strike: bigint;            // 6-dec fixed
  payoutCap: bigint;         // 6-dec fixed (0n for legacy single-strike)
  premiumRate: bigint;       // PRECISION-denominated (e.g. 25_000n = 2.5%)
  expiryDate: bigint;        // unix seconds
  initialRate: bigint;       // 6-dec fixed
  strikeAbove: boolean;
  /**
   * How the pool prices cover for its whole life: false fixed, true per-purchase.
   *
   * Signed, not merely sent. Without it in the payload a creator could take an
   * attestation for their opening premium and then flip the pool to dynamic,
   * which is a different product from the one the engine blessed.
   */
  dynamicPricing: boolean;
}

export interface SignedQuote {
  signature: string;         // 0x-prefixed 65-byte hex
  quoteTimestamp: bigint;    // unix seconds
  quoteNonce: string;        // 0x-prefixed 32-byte hex
  signerAddress: string;     // public address of the signer (matches on-chain pricingEngineSigner)
}

/** Build the same keccak256(abi.encode(...)) payload the contract recovers against. */
export function buildSignableHash(q: SignableQuote, quoteTimestamp: bigint, quoteNonce: string): string {
  return ethers.solidityPackedKeccak256(
    [
      "uint256", "address", "address",
      "string",
      "uint256", "uint256", "uint256", "uint256", "uint256", "bool",
      "bool",
      "uint256", "bytes32",
    ],
    [
      asBigint(q.chainId), ethers.getAddress(q.diamondAddress), ethers.getAddress(q.creator),
      q.underlying,
      q.strike, q.payoutCap, q.premiumRate, q.expiryDate, q.initialRate, q.strikeAbove,
      q.dynamicPricing,
      quoteTimestamp, quoteNonce,
    ],
  );
}

/**
 * Sign a quote. Returns null if PRICING_ENGINE_PRIVATE_KEY is unset (advisory-only mode).
 *
 * The keccak hash is wrapped with EIP-191 prefix via wallet.signMessage(getBytes(hash))
 * so the on-chain MessageHashUtils.toEthSignedMessageHash recovery matches.
 *
 * NOTE: solidityPackedKeccak256 produces a different hash than abi.encode keccak256.
 *       We use solidityPacked here because the on-chain contract uses abi.encode —
 *       but encoded values for fixed-size types (uint256, address, bool, bytes32)
 *       and string (length-prefixed in both cases) hash identically. We'll re-verify
 *       via tests.
 */
export async function signQuote(q: SignableQuote): Promise<SignedQuote | null> {
  const wallet = getSigner();
  if (!wallet) return null;

  const quoteTimestamp = BigInt(Math.floor(Date.now() / 1000));
  const quoteNonce = "0x" + randomBytes(32).toString("hex");

  // The on-chain contract uses abi.encode (NOT abi.encodePacked) for the payload —
  // so we must mirror that here. ethers.AbiCoder.encode + keccak256 is the equivalent.
  const messageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "uint256", "address", "address",
        "string",
        "uint256", "uint256", "uint256", "uint256", "uint256", "bool",
        "bool",
        "uint256", "bytes32",
      ],
      [
        asBigint(q.chainId), ethers.getAddress(q.diamondAddress), ethers.getAddress(q.creator),
        q.underlying,
        q.strike, q.payoutCap, q.premiumRate, q.expiryDate, q.initialRate, q.strikeAbove,
        q.dynamicPricing,
        quoteTimestamp, quoteNonce,
      ],
    ),
  );

  // signMessage applies the EIP-191 "\x19Ethereum Signed Message:\n32" prefix,
  // matching MessageHashUtils.toEthSignedMessageHash on-chain.
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));

  return {
    signature,
    quoteTimestamp,
    quoteNonce,
    signerAddress: wallet.address,
  };
}

/* ── Purchase quotes ─────────────────────────────────────────────────────── */

export interface SignablePurchase {
  chainId: number | bigint;
  diamondAddress: string;
  /** The wallet that will call buyProtectionQuoted. The quote is bound to it. */
  buyer: string;
  eventId: number | bigint;
  /** 6-decimal fixed, matching the contract's token precision. */
  notional: bigint;
  /** PRECISION-denominated rate to charge (1e6 = 100%). */
  premiumRate: bigint;
}

/**
 * Sign a purchase quote for buyProtectionQuoted.
 *
 * A different payload from signQuote on purpose, and it must stay that way. The
 * creation quote binds to the creator and the event's terms; this binds to the
 * buyer, the pool being bought into, the size and the price. A shared shape
 * would let a signature minted for one action be replayed as the other, and
 * both draw on the same nonce set.
 *
 * Every field is in the hash for a reason the contract enforces:
 *   chainId + diamond  — no cross-chain or cross-diamond replay
 *   buyer              — Alice cannot spend a quote issued to Bob
 *   eventId            — a quote for a cheap pool cannot buy into a dear one
 *   notional           — a quote for $1,000 cannot buy $1,000,000 at that rate
 *   premiumRate        — the price cannot be edited downward in flight
 *   timestamp + nonce  — 120 second freshness, single use
 *
 * Returns null when PRICING_ENGINE_PRIVATE_KEY is unset, which the caller must
 * treat as "this pool cannot be bought right now" rather than falling back to
 * the pool's fixed rate: a dynamic pool has no fixed rate to fall back to.
 */
export async function signPurchaseQuote(q: SignablePurchase): Promise<SignedQuote | null> {
  const wallet = getSigner();
  if (!wallet) return null;

  const quoteTimestamp = BigInt(Math.floor(Date.now() / 1000));
  const quoteNonce = "0x" + randomBytes(32).toString("hex");

  // abi.encode, matching _verifyPurchaseQuote exactly. Field order is part of
  // the contract; changing it here without changing it there recovers a
  // different address and every purchase reverts.
  const messageHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "address", "uint256", "uint256", "uint256", "uint256", "bytes32"],
      [
        asBigint(q.chainId),
        ethers.getAddress(q.diamondAddress),
        ethers.getAddress(q.buyer),
        asBigint(q.eventId),
        q.notional,
        q.premiumRate,
        quoteTimestamp,
        quoteNonce,
      ],
    ),
  );

  const signature = await wallet.signMessage(ethers.getBytes(messageHash));
  return { signature, quoteTimestamp, quoteNonce, signerAddress: wallet.address };
}
