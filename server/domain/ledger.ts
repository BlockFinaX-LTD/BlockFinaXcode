/**
 * The balance ledger (Architecture v2.0).
 *
 * The frontend may show one simple balance; this ledger always knows where every unit
 * actually is. Every movement is a transfer between two exact places, so totals are
 * conserved, and value only enters or leaves through an explicit external entry
 * (a confirmed deposit, a withdrawal, a provider fee).
 *
 * A place is: owner (a user id or "treasury") + location (a chain key, or
 * "transit:<routeId>" while a route is in flight) + bucket.
 *
 * Amounts are decimal strings; internally 18-decimal integers, so 6- and 7-decimal
 * assets are both exact.
 */
import { fromUnits, toUnits } from "@shared/domain/pool-economics";
import { ApplicationError } from "@shared/domain/types";

const SCALE = 18;

export type Bucket =
  | "available"        // the owner's to use or withdraw
  | "pending_routing"  // in flight between networks
  | "reserved"         // committed to a pool deposit or a hedge premium
  | "payout"           // settled payout waiting to be claimed
  | "withdrawal"       // on its way to the owner's withdrawal network
  | "float";           // treasury liquidity used to prefund routes

export interface Place {
  owner: string;
  location: string;
  bucket: Bucket;
}

export interface LedgerEntry {
  at: number;
  symbol: string;
  amount: string;
  from: Place | "external";
  to: Place | "external";
  reason: string;
  ref?: string;
}

const keyOf = (p: Place, symbol: string) => `${p.owner}|${p.location}|${p.bucket}|${symbol}`;

export class BalanceLedger {
  private balances = new Map<string, bigint>();
  readonly entries: LedgerEntry[] = [];

  constructor(private readonly clock: () => number = () => Math.floor(Date.now() / 1000)) {}

  private add(p: Place, symbol: string, v: bigint) {
    const k = keyOf(p, symbol);
    const next = (this.balances.get(k) ?? BigInt(0)) + v;
    if (next < BigInt(0)) throw new ApplicationError("INSUFFICIENT_BALANCE", `${p.owner} has not enough ${symbol} in ${p.location}/${p.bucket}`);
    this.balances.set(k, next);
  }

  /** Move value between two places. Fails without changing anything if the source is short. */
  transfer(from: Place, to: Place, symbol: string, amount: string, reason: string, ref?: string) {
    const v = toUnits(amount, SCALE);
    if (v <= BigInt(0)) throw new ApplicationError("INVALID_REQUEST", "Amount must be positive");
    this.add(from, symbol, -v);
    this.add(to, symbol, v);
    this.entries.push({ at: this.clock(), symbol, amount, from, to, reason, ref });
  }

  /** Value entering the ledger from outside (a confirmed on-chain deposit). */
  credit(to: Place, symbol: string, amount: string, reason: string, ref?: string) {
    this.add(to, symbol, toUnits(amount, SCALE));
    this.entries.push({ at: this.clock(), symbol, amount, from: "external", to, reason, ref });
  }

  /** Value leaving the ledger (a withdrawal delivered, a provider fee paid). */
  debit(from: Place, symbol: string, amount: string, reason: string, ref?: string) {
    this.add(from, symbol, -toUnits(amount, SCALE));
    this.entries.push({ at: this.clock(), symbol, amount, from, to: "external", reason, ref });
  }

  balance(p: Place, symbol: string): string {
    return fromUnits(this.balances.get(keyOf(p, symbol)) ?? BigInt(0), SCALE);
  }

  /** Every non-zero place an owner holds value in. */
  positions(owner: string): { location: string; bucket: Bucket; symbol: string; amount: string }[] {
    const out: { location: string; bucket: Bucket; symbol: string; amount: string }[] = [];
    this.balances.forEach((v, k) => {
      const [o, location, bucket, symbol] = k.split("|");
      if (o === owner && v !== BigInt(0)) out.push({ location, bucket: bucket as Bucket, symbol, amount: fromUnits(v, SCALE) });
    });
    return out;
  }

  /** What the user sees: totals per asset, with the exact breakdown kept alongside. */
  summary(owner: string, symbol: string) {
    const rows = this.positions(owner).filter((r) => r.symbol === symbol);
    const sum = (pred: (r: (typeof rows)[number]) => boolean) =>
      fromUnits(rows.filter(pred).reduce((a, r) => a + toUnits(r.amount, SCALE), BigInt(0)), SCALE);
    return {
      symbol,
      spendable: sum((r) => r.bucket === "available"),
      inFlight: sum((r) => r.bucket === "pending_routing" || r.bucket === "withdrawal"),
      committed: sum((r) => r.bucket === "reserved"),
      claimable: sum((r) => r.bucket === "payout"),
      total: sum(() => true),
      byLocation: rows,
    };
  }

  /** Sum of all external credits minus debits; equals the sum of every balance. */
  conservationCheck(symbol: string): { inside: string; netExternal: string; balanced: boolean } {
    let inside = BigInt(0);
    this.balances.forEach((v, k) => { if (k.endsWith(`|${symbol}`)) inside += v; });
    let net = BigInt(0);
    for (const e of this.entries.filter((x) => x.symbol === symbol)) {
      const v = toUnits(e.amount, SCALE);
      if (e.from === "external") net += v;
      if (e.to === "external") net -= v;
    }
    return { inside: fromUnits(inside, SCALE), netExternal: fromUnits(net, SCALE), balanced: inside === net };
  }
}
