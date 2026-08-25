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

/**
 * The largest amount that the provider will actually accept.
 *
 * ## Why this exists rather than a fixed buffer
 *
 * The provider builds the transfer as a batch and puts a fee transfer in it
 * alongside the user's. One decoded from a real failure carried 0.258664 USDC
 * to the fee address. Send the exact balance and there is nothing left to pay
 * that with, so the simulation reverts and MAX, the button whose entire promise
 * is "send everything", is the one that fails.
 *
 * Their preview returns a ticket and a hash and no fee, so the fee cannot be
 * read and subtracted. Reserving a guessed buffer is worse: too small and it
 * still fails, too large and money is stranded in the wallet for no reason the
 * user can see.
 *
 * What the preview does give is a yes or no. That is enough. Try the whole
 * balance first, because on a chain or token with no fee it simply works and
 * costs one call. If it is refused, bisect for the largest amount that is not.
 *
 * ## Why it converges quickly and stops
 *
 * Eight probes narrow the range to a 256th of the balance, which on any real
 * balance is smaller than the fee being solved for, and each step floors to the
 * token's precision so the result is always sendable rather than merely close.
 * The loop is bounded because an unbounded search against someone else's API is
 * how a button press becomes a hundred requests.
 *
 * If even a very small amount is refused, the problem is not the fee and
 * pretending otherwise would send the user hunting for an amount that does not
 * exist. That returns null and the caller says so.
 */
/**
 * What the provider takes on top of the amount being sent.
 *
 * Measured from real transfers on Base rather than assumed. Every successful
 * multi-leg transfer from a smart account carries three extra legs beside the
 * recipient's, and the proportions are exact:
 *
 *   sent 100.00   ->  0.100000 + 0.200000 + 0.004373 gas
 *   sent  30.00   ->  0.030000 + 0.060000 + 0.003687 gas
 *   sent  70.00   ->  0.070000 + 0.140000 + 0.003138 gas
 *   sent 2600.00  ->  2.600000 + 5.200000 + 0.003231 gas
 *
 * That is 0.1% plus 0.2%, so 0.3% of the amount, and a small flat charge for
 * gas paid in the token itself. Across those four the gas ranged 0.0031 to
 * 0.0044 USDC.
 *
 * The reserve below is deliberately above the highest observed gas. Being a
 * fraction of a cent generous costs nothing; being a fraction of a cent short
 * fails the whole transfer, which is the failure this exists to prevent.
 */
export const TRANSFER_FEE_RATE = 0.003;
export const TRANSFER_GAS_RESERVE = 0.006;

/**
 * The most that can be sent, solved rather than searched.
 *
 * The overhead is charged on the amount, not on the balance, so this is not
 * simply the balance minus a percentage. Sending A costs A plus A times the
 * rate plus gas, and that has to equal the balance, which gives
 * A = (balance - gas) / (1 + rate).
 *
 * Subtracting 0.3% from the balance instead would leave a little behind, and
 * the amount left grows with the balance. On 2600 it is nearly eight USDC.
 */
export function computedMax(available: number, token: string): string {
  if (!Number.isFinite(available) || available <= 0) return "0";
  const net = (available - TRANSFER_GAS_RESERVE) / (1 + TRANSFER_FEE_RATE);
  return net > 0 ? maxSendable(net, token) : "0";
}

export async function largestSendable(
  available: number,
  token: string,
  probe: (amount: string) => Promise<boolean>,
  opts: { maxProbes?: number } = {},
): Promise<{ amount: string; probes: number } | null> {
  const budget = Math.max(3, opts.maxProbes ?? 11);
  const full = maxSendable(available, token);
  if (full === "0") return null;

  const unit = Math.pow(10, -decimalsFor(token));
  let probes = 0;

  // The common case: no fee, or a fee taken from somewhere else entirely.
  probes++;
  if (await probe(full)) return { amount: full, probes };

  // The known case: 0.3% plus gas, measured from real transfers. One more call
  // confirms it, and confirming beats trusting because the rate can change and
  // a stale constant would fail exactly as the old MAX did.
  const computed = computedMax(available, token);
  if (parseFloat(computed) > 0) {
    probes++;
    if (await probe(computed)) return { amount: computed, probes };
  }

  // Neither worked, so the schedule is not what was measured. Search for it.

  // Something is being withheld, so search for how much rather than for the
  // amount. Searching the reserve is what keeps the answer close to the
  // balance: bisecting the amount instead spends its precision on the half of
  // the range nobody is interested in, and on a large balance with a small fee
  // it strands real money.
  let works = 0;                                  // no reserve this small has passed
  let reserve = Math.max(unit, available * 0.0005);

  while (probes < budget) {
    const candidate = maxSendable(available - reserve, token);
    if (parseFloat(candidate) <= 0) break;
    probes++;
    if (await probe(candidate)) { works = reserve; break; }
    // Nothing has passed yet, so the fee is larger than this. Step up hard:
    // each multiplication is one API call and the fee could be anywhere.
    const next = reserve * 4;
    if (next >= available) {
      // The step would jump past the whole balance. Stopping here reports
      // nothing sendable, which is wrong whenever a fee is a large fraction of
      // a small balance: on 0.30 with a 0.26 fee, 0.04 sends perfectly well and
      // the user was being told it could not. Try most of the balance as a
      // reserve before giving up on it.
      if (reserve >= available * 0.9) break;
      reserve = available * 0.9;
      continue;
    }
    reserve = next;
  }

  if (!works) return null;

  // Now close the gap between the largest reserve known to fail, works/4, and
  // the smallest known to pass. Every step here recovers money that would
  // otherwise sit in the wallet doing nothing.
  let tooSmall = works / 4;
  let enough = works;
  while (probes < budget && enough - tooSmall > unit) {
    const mid = (tooSmall + enough) / 2;
    const candidate = maxSendable(available - mid, token);
    const n = parseFloat(candidate);
    if (!Number.isFinite(n) || n <= 0) break;
    probes++;
    if (await probe(candidate)) enough = mid; else tooSmall = mid;
  }

  const amount = maxSendable(available - enough, token);
  return parseFloat(amount) > 0 ? { amount, probes } : null;
}
