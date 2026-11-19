/**
 * OTC: approved merchants trade USDC for local currency with BlockFinaX users. The USDC
 * side always sits in the OTC escrow contract on Stellar (blockfinax-stellar
 * contracts/otc-escrow) until the person who should have received the local currency
 * confirms it arrived and releases it. BlockFinaX rules on disputes.
 *
 * Shared by the server, the screens and the tests.
 */

export const OTC_CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "EGP"] as const;
export type OtcCurrency = (typeof OTC_CURRENCIES)[number];

export const OTC_CURRENCY_NAMES: Record<OtcCurrency, string> = {
  NGN: "Naira", GHS: "Cedi", KES: "Shilling", ZAR: "Rand", EGP: "Egyptian pound",
};

/** The merchant sells USDC (the user buys), or buys USDC (the user sells). */
export type OtcSide = "sell" | "buy";
export const SIDE_CODE: Record<OtcSide, number> = { sell: 0, buy: 1 };
export const sideFromCode = (n: number): OtcSide => (n === 1 ? "buy" : "sell");

export type OtcStatus = "open" | "paid" | "released" | "cancelled" | "disputed" | "resolved_released" | "resolved_refunded";
const STATUSES: OtcStatus[] = ["open", "paid", "released", "cancelled", "disputed", "resolved_released", "resolved_refunded"];
export const statusFromCode = (n: number): OtcStatus => STATUSES[n] ?? "open";
export const FINAL_STATUSES: OtcStatus[] = ["released", "cancelled", "resolved_released", "resolved_refunded"];
export const isFinal = (s: OtcStatus) => FINAL_STATUSES.includes(s);

export const STATUS_LABEL: Record<OtcStatus, string> = {
  open: "Waiting for payment",
  paid: "Marked paid",
  released: "Completed",
  cancelled: "Cancelled",
  disputed: "In dispute",
  resolved_released: "Completed by BlockFinaX",
  resolved_refunded: "Refunded by BlockFinaX",
};

/** Escrow methods a personal wallet may send through the sponsored relay. */
export const OTC_USER_METHODS = [
  "create_offer", "update_offer", "top_up_offer", "withdraw_from_offer", "close_offer",
  "open_order", "mark_paid", "release", "cancel", "dispute",
] as const;

/**
 * What a business account's operators may do: buy USDC only (open an order on a merchant's
 * selling offer, mark it paid, cancel, dispute). Selling USDC, releasing it and running
 * merchant offers are for admins.
 */
export const OTC_OPERATOR_METHODS = ["open_order", "mark_paid", "cancel", "dispute"] as const;
// The same list is installed on chain for each business account's operators
// (OPERATOR_OTC_FUNCTIONS in shared/organisations.ts, enforced by the function allow-list policy).

/** Methods whose argument at this position names the acting party: it must be the wallet itself. */
export const OTC_WALLET_ARG: Record<string, number> = { create_offer: 0, open_order: 0, cancel: 0, dispute: 0 };

/** USDC and rates on chain: USDC in 7 decimals, rates (local currency per USDC) at 1e6. */
export const USDC_DECIMALS = 7;
export const RATE_SCALE = 1_000_000;

const pow10 = (n: number) => BigInt(`1${"0".repeat(n)}`);

/** Decimal string to integer units, rounding down. Refuses anything that is not a plain positive number. */
export function toUnits(value: string | number, decimals: number): bigint {
  const s = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Not a valid amount: ${s}`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * pow10(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function fromUnits(units: bigint | number | string, decimals: number): string {
  const n = BigInt(units);
  const neg = n < BigInt(0);
  const abs = neg ? -n : n;
  const base = pow10(decimals);
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${abs / base}${frac ? `.${frac}` : ""}`;
}

/** Local currency owed for a USDC amount at a rate, to 2 decimal places (rounded half up). */
export function localAmount(usdc: string, rate: string): string {
  const units = toUnits(usdc, USDC_DECIMALS) * toUnits(rate, 6); // scale 1e13
  const cents = (units + BigInt(5) * pow10(10)) / pow10(11);
  return fromUnits(cents, 2);
}

/** What the escrow's error numbers mean, in words a user can act on. */
export const OTC_ERRORS: Record<number, string> = {
  3: "You are not allowed to do that on this order",
  4: "Those terms are not valid",
  5: "The amount is outside this offer's limits",
  6: "OTC trading is paused. Orders already open can still finish",
  7: "Only approved merchants can post offers",
  8: "Offer not found",
  9: "This offer is closed",
  10: "Not enough left in this offer",
  11: "Order not found",
  12: "This order has moved on. Refresh to see where it is",
  13: "The time to pay has run out",
  14: "The buyer still has time to pay",
  15: "You cannot trade with your own offer",
  17: "This currency is not available yet",
};

export function otcErrorMessage(raw: string): string | null {
  const m = /Error\(Contract, #(\d+)\)/.exec(raw);
  return m ? OTC_ERRORS[Number(m[1])] ?? null : null;
}

/** Who does what in an order, from one party's point of view. */
export function roleIn(order: { usdcFrom: string; usdcTo: string }, wallet: string) {
  return {
    /** Locked the USDC; checks the local currency arrived and releases. */
    releases: order.usdcFrom === wallet,
    /** Pays the local currency and marks the order paid; receives the USDC. */
    pays: order.usdcTo === wallet,
  };
}

/** The most a payment proof may be (images or PDF). */
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const PROOF_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

// ── Payment methods ──────────────────────────────────────────────────────────

/** How local currency moves: a bank transfer or mobile money (MoMo, M-Pesa and the like). */
export type PaymentMethod =
  | { type: "bank"; bankName: string; accountNumber: string; accountName: string }
  | { type: "momo"; provider: string; phone: string; accountName: string };

export const MOMO_PROVIDERS: Record<OtcCurrency, string[]> = {
  NGN: ["OPay", "PalmPay", "Moniepoint", "MTN MoMo"],
  GHS: ["MTN MoMo", "Telecel Cash", "AirtelTigo Money"],
  KES: ["M-Pesa", "Airtel Money"],
  ZAR: [],
  EGP: ["Vodafone Cash", "InstaPay"],
};

const field = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");

/** A payment method from a form, checked. Throws a message a person can act on. */
export function parsePaymentMethod(raw: unknown): PaymentMethod {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.type === "bank") {
    const m = { type: "bank" as const, bankName: field(r.bankName), accountNumber: field(r.accountNumber, 40).replace(/\s/g, ""), accountName: field(r.accountName) };
    if (m.bankName.length < 2) throw new Error("Enter the bank's name");
    if (!/^[A-Za-z0-9-]{4,40}$/.test(m.accountNumber)) throw new Error("Enter the account number");
    if (m.accountName.length < 2) throw new Error("Enter the name on the account");
    return m;
  }
  if (r.type === "momo") {
    const m = { type: "momo" as const, provider: field(r.provider), phone: field(r.phone, 20).replace(/[\s-]/g, ""), accountName: field(r.accountName) };
    if (m.provider.length < 2) throw new Error("Choose the mobile money provider");
    if (!/^\+?\d{7,15}$/.test(m.phone)) throw new Error("Enter the mobile money number");
    if (m.accountName.length < 2) throw new Error("Enter the name on the mobile money account");
    return m;
  }
  throw new Error("Choose bank transfer or mobile money");
}

/** One line for lists: "GTBank · 0123456789 · Ada Ltd" or "MTN MoMo · +233 ... · Kofi". */
export function describeMethod(m: PaymentMethod): string {
  return m.type === "bank" ? `${m.bankName} · ${m.accountNumber} · ${m.accountName}` : `${m.provider} · ${m.phone} · ${m.accountName}`;
}

export const methodLabel = (m: Pick<PaymentMethod, "type">) => (m.type === "bank" ? "Bank transfer" : "Mobile money");

// ── Requests for a quote ─────────────────────────────────────────────────────

/** How long a request stays open for merchants to quote. */
export const REQUEST_OPEN_HOURS = 24;
/** The smallest request, in USDC. */
export const MIN_REQUEST_USDC = 10;
