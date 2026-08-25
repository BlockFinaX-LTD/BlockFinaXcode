/**
 * Turning a failure into something a person can act on.
 *
 * ## Why this exists
 *
 * The error that actually reached a customer this week was this:
 *
 *     Execution reverted with reason: UserOperation reverted during
 *     simulation with reason: 0x08c379a0000000000000000000000000000000
 *     0000000000000000000000000000200000000000000000000000000000000000
 *     000000000000000000000000026496e73756666696369656e7420706f6f6c…
 *
 * Inside that blob, ABI-encoded, is the sentence "Insufficient pool liquidity
 * for payout" — and behind that, an answer the customer could have acted on:
 * buy less, or add liquidity. Nothing decoded it, so the app either showed the
 * blob or fell through to "The contract rejected the transaction", which is
 * true of every revert ever and useful for none of them.
 *
 * So the first job here is decoding: a revert string is a real message that
 * happens to be in hex, and it should be read before anything is said about it.
 *
 * ## The rules are matched against the decoded text
 *
 * The old matcher tested `Insufficient liquidity` against a contract that says
 * `Insufficient pool liquidity for payout`. The rule never fired — not because
 * the idea was wrong, but because it was written from memory of the contract
 * rather than from the contract. Rules here are matched against both the raw
 * text and whatever was decoded out of it, and the strings are the ones the
 * deployed facets actually emit.
 *
 * ## Every result says what to do next
 *
 * "Transaction failed" is a title, not information. Each explanation carries a
 * next step, because in almost every case there is one: retry, use a smaller
 * amount, top up gas, sign in again, or wait for someone else to fix it. Where
 * the honest answer is "this is ours to fix, not yours", it says that too,
 * rather than implying the customer did something wrong.
 *
 * The raw text is kept in `detail` for the console and for support. It is never
 * the message.
 */

import { ethers } from "ethers";

export interface Explained {
  /** Short, specific, and never "Transaction Failed". */
  title: string;
  /** What happened and what to do about it, in that order. */
  message: string;
  /** The original text. For the console and support, not for the customer. */
  detail?: string;
}

// ── Getting to the text ───────────────────────────────────────────────────

/** Everywhere a message hides across ethers, fetch, and our own throws. */
function rawOf(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  const e = err as Record<string, any>;
  return (
    e.reason ??
    e.shortMessage ??
    e.data?.message ??
    e.error?.message ??
    e.info?.error?.message ??
    e.message ??
    String(err)
  );
}

const ERROR_STRING = "0x08c379a0"; // Error(string)
const PANIC_UINT = "0x4e487b71"; // Panic(uint256)

const PANIC_REASONS: Array<[string, string]> = [
  ["0x01", "an assertion failed"],
  ["0x11", "an arithmetic operation overflowed"],
  ["0x12", "something was divided by zero"],
  ["0x21", "a value was cast to an invalid enum"],
  ["0x31", "an empty array was popped"],
  ["0x32", "an array index was out of bounds"],
];

/**
 * The sentence inside the hex, if there is one.
 *
 * Scans rather than expecting the payload at the start: reverts arrive wrapped
 * in prose by the node, the bundler and ethers in turn, and the encoded part is
 * usually somewhere in the middle of all of it.
 */
export function decodeRevert(text: string): string | null {
  if (!text) return null;

  const errMatch = text.match(new RegExp(ERROR_STRING + "([0-9a-fA-F]+)"));
  if (errMatch) {
    try {
      const [decoded] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["string"],
        "0x" + errMatch[1],
      );
      if (decoded) return String(decoded);
    } catch {
      /* truncated or malformed — fall through */
    }
  }

  const panicMatch = text.match(new RegExp(PANIC_UINT + "([0-9a-fA-F]+)"));
  if (panicMatch) {
    try {
      const [code] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256"],
        "0x" + panicMatch[1],
      );
      const hex = "0x" + Number(code).toString(16).padStart(2, "0");
      const known = PANIC_REASONS.filter((p) => p[0] === hex)[0];
      return known ? `the contract panicked because ${known[1]}` : `the contract panicked (${hex})`;
    } catch {
      /* fall through */
    }
  }
  return null;
}

// ── The rules ─────────────────────────────────────────────────────────────
//
// Ordered: the first match wins, so specific sits above general. Each `when`
// is tested against the raw text and the decoded revert together, lowercased.

interface Rule {
  when: (t: string) => boolean;
  title: string;
  message: string;
}

const has =
  (...needles: string[]) =>
  (t: string) =>
    needles.some((n) => t.includes(n));

const RULES: Rule[] = [
  // ── the wallet API refused the transfer ──
  //
  // Rift's 400s often carry no message, so the thrown error is the status and
  // the path and nothing else. A user pressing MAX saw "400 on
  // /v1/transactions/preview" and could do nothing with it.
  //
  // The cause in practice was an amount with more decimal places than the
  // token has, produced by taking a balance through a float. That is fixed at
  // source in send-amount.ts, but the same 400 covers several other refusals,
  // so it needs a sentence that points somewhere useful either way.
  {
    when: has("transactions/preview", "/v1/transactions"),
    title: "That amount was refused",
    message:
      "Usually the amount is a fraction above the balance, or has more decimal places than the token allows. Press MAX to fill in exactly what can be sent.",
  },
  {
    when: has("insufficient funds", "insufficient balance", "exceeds balance", "transfer amount exceeds"),
    title: "Not enough to cover that",
    message: "The amount is above what this wallet holds. Press MAX to fill in the exact balance.",
  },

  // ── the customer chose to stop ──
  {
    when: has("user rejected", "user denied", "cancelled", "canceled", "notallowederror"),
    title: "Cancelled",
    message: "Nothing was sent and nothing was charged.",
  },

  // ── pool capacity: the one that actually bit ──
  {
    when: has("insufficient pool liquidity", "insufficient liquidity"),
    title: "Not enough cover left in this pool",
    message:
      "The pool can't cover the payout this position would need. Try a smaller amount, or wait for more underwriting — the buy screen shows the largest amount this pool can take right now.",
  },
  {
    when: has("pool closed", "pool is closed"),
    title: "This pool is closed",
    message: "It isn't accepting new cover. Other pools on the same pair may still be open.",
  },
  {
    when: has("event expired", "expired event", "past expiry"),
    title: "This cover has expired",
    message: "It can no longer be bought or added to. Look for a pool with a later expiry.",
  },
  {
    when: has("event not found", "invalid event"),
    title: "Pool not found on this network",
    message: "It may have been created on a different chain. Check the network selector and try again.",
  },

  // ── money and approvals ──
  {
    when: has("insufficient funds", "insufficient balance for gas", "gas required exceeds"),
    title: "Not enough ETH for network fees",
    message: "Your wallet needs a small amount of ETH on this network to pay gas, separate from the USDC you're spending.",
  },
  {
    when: has("allowance", "exceeds allowance", "transfer amount exceeds"),
    title: "Approval hasn't landed yet",
    message: "The token approval is still confirming on-chain. Give it a few seconds and try again.",
  },
  {
    when: has("insufficient", "exceeds balance"),
    title: "Not enough balance",
    message: "You don't have enough of this token to cover the amount plus fees.",
  },

  // ── signing, which is where most of this week went ──
  {
    when: has("enclave sign returned null", "consent factor"),
    title: "Your wallet can't approve transactions right now",
    message:
      "The signing service can't authorise anything on this wallet. This is on our side and we've reported it — your funds are safe and nothing was sent. Please try again later or contact support.",
  },
  {
    when: has("no signing method", "no enrolled method", "unsupported"),
    title: "No way to approve this yet",
    message: "This wallet has no working signing method on this device. Add one under Profile → Signing.",
  },
  {
    when: has("ticket expired", "challenge_missing_or_expired", "challenge expired"),
    title: "That took too long",
    message: "The approval window closed before it completed. Start the transaction again.",
  },
  {
    when: has("reseal_failed", "reseal failed"),
    title: "Approval was refused",
    message: "The signing service didn't accept that credential. Try a different signing method, or add one under Profile → Signing.",
  },

  // ── session and network ──
  {
    when: has("401", "unauthorized", "invalid token", "token expired", "jwt expired"),
    title: "You've been signed out",
    message: "Your session expired. Sign in again and your balances and positions will be exactly as you left them.",
  },
  {
    when: has("429", "too many requests", "rate limit"),
    title: "We're being rate-limited",
    message: "The network data provider is throttling us. Wait a moment and try again — nothing was sent.",
  },
  {
    when: has("failed to fetch", "networkerror", "err_network", "timeout", "timed out"),
    title: "Couldn't reach the network",
    message: "Check your connection and try again. If the transaction had already been sent, it will still complete.",
  },

  // ── transaction plumbing ──
  {
    when: has("replacement fee too low", "replacement transaction underpriced"),
    title: "An earlier transaction is still pending",
    message: "Wait for it to confirm before sending another.",
  },
  {
    when: has("nonce too low", "nonce has already been used"),
    title: "Transactions got out of order",
    message: "Wait a few seconds and try again.",
  },
  {
    when: has("fees not initialized"),
    title: "This pool isn't ready yet",
    message: "Its fee configuration hasn't been set on-chain. Please try again shortly.",
  },
  {
    when: has("payment token not whitelisted", "token not allowed"),
    title: "Wrong payment token",
    message: "This pool doesn't accept the token you selected. Switch tokens and try again.",
  },
  {
    when: has("paused"),
    title: "Trading is paused",
    message: "The contract has been paused. This is temporary and nothing was sent.",
  },
];

// ── The entry point ───────────────────────────────────────────────────────

/**
 * Explain a failure.
 *
 * Guarantees the message is prose. A hex blob, an empty string or an object
 * nobody anticipated all end at the generic case rather than being printed at
 * the customer, with the original preserved in `detail`.
 */
export function explainTxError(err: unknown): Explained {
  const raw = rawOf(err);
  const decoded = decodeRevert(raw);
  const detail = decoded ? `${decoded} — ${raw}` : raw || undefined;
  const haystack = `${raw} ${decoded ?? ""}`.toLowerCase();

  for (const rule of RULES) {
    if (rule.when(haystack)) {
      return { title: rule.title, message: rule.message, detail };
    }
  }

  // A revert we have no rule for. The contract's own sentence is better than
  // anything generic, so show it — it is at least specific and true.
  if (decoded) {
    return {
      title: "The contract rejected this",
      message: `${decoded[0].toUpperCase()}${decoded.slice(1)}. Check the amount and try again.`,
      detail,
    };
  }

  // Never hand back hex, an empty string, or "[object Object]" — the last of
  // which String(err) produces for any error thrown as a bare object, and
  // which passes a naive "does it look like words" check.
  const usable =
    !!raw &&
    !raw.startsWith("0x") &&
    !raw.includes("[object ") &&
    raw.length < 200 &&
    /[a-z]{3}/i.test(raw);
  return {
    title: "That didn't go through",
    message: usable
      ? `${raw}${/[.!?]$/.test(raw) ? "" : "."}`
      : "Something went wrong and nothing was sent. Try again, and contact support if it keeps happening.",
    detail,
  };
}

/** For call sites that only have room for one line. */
export function friendlyError(err: unknown): string {
  return explainTxError(err).message;
}
