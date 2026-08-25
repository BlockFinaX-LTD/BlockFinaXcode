/**
 * send-amount.ts, working out what "everything" actually means.
 *
 * ## Why MAX was failing
 *
 * Both send sheets did `setAmount(String(available))`, where `available` is the
 * balance already passed through `Number()`. That round trip has no idea what
 * the token's precision is, so it can produce a value with more decimal places
 * than the token has, or one whose last digit sits above the true on-chain
 * integer. Rift's preview then converts it to base units, finds it exceeds the
 * balance, and returns a 400 with no message. The user sees "400 on
 * /v1/transactions/preview" after pressing a button that promised to send
 * everything.
 *
 * A float can also stringify into scientific notation, and "1e-7" is not an
 * amount any API accepts.
 *
 * ## Why it rounds down and never up
 *
 * Off by one unit downward leaves a millionth of a dollar behind, which nobody
 * notices. Off by one unit upward fails the whole transfer. There is no
 * symmetry here, so the rounding is always toward zero.
 *
 * Gas is not deducted. On Base these transfers are sponsored, and USDC gas
 * would not come out of the USDC balance anyway. If sponsorship ever ends, the
 * native token is what needs the headroom, not this.
 */

/** Base units per whole token. USDC and USDT are 6, most ERC-20s are 18. */
export const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
  ETH: 18,
  WETH: 18,
};

export function decimalsFor(token: string): number {
  return TOKEN_DECIMALS[String(token || "").toUpperCase()] ?? 6;
}

/**
 * The largest amount of this token that can actually be sent, as a string.
 *
 * Returns a plain decimal string with no exponent and no trailing zeros, which
 * is what the API expects and what a person expects to see in the field.
 */
export function maxSendable(available: number, token: string): string {
  const decimals = decimalsFor(token);
  if (!Number.isFinite(available) || available <= 0) return "0";

  // Floor at the token's precision. toFixed rounds half up, which is the one
  // direction that breaks this, so the truncation is done deliberately first.
  const scale = Math.pow(10, decimals);
  const floored = Math.floor(available * scale) / scale;
  if (!Number.isFinite(floored) || floored <= 0) return "0";

  // toFixed rather than String, because String gives exponent form for small
  // numbers and an API that receives "1e-7" rejects it.
  return trimZeros(floored.toFixed(decimals));
}

function trimZeros(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/\.?0+$/, "");
}

/**
 * Is this amount actually sendable, and if not, why in words.
 *
 * The reason is returned rather than a boolean because every caller was
 * building its own message, and the useful ones differ: too many decimals is a
 * different problem from too little money and needs a different sentence.
 */
export function checkAmount(
  raw: string,
  available: number,
  token: string,
): { ok: boolean; reason?: string } {
  const n = parseFloat(raw);
  if (!raw.trim()) return { ok: false, reason: "Enter an amount." };
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: "That is not an amount." };

  const decimals = decimalsFor(token);
  const places = (raw.split(".")[1] ?? "").length;
  if (places > decimals) {
    return {
      ok: false,
      reason: `${token.toUpperCase()} only goes to ${decimals} decimal places. Try ${maxSendable(n, token)}.`,
    };
  }

  // Compared in base units rather than as floats, because comparing 44.9375
  // against a balance of 44.9375 can fail on a rounding error that exists only
  // in the comparison and not in the money.
  const scale = Math.pow(10, decimals);
  const wanted = Math.round(n * scale);
  const held = Math.floor(available * scale);
  if (wanted > held) {
    return {
      ok: false,
      reason: `You have ${maxSendable(available, token)} ${token.toUpperCase()}. Press MAX to send all of it.`,
    };
  }
  return { ok: true };
}
