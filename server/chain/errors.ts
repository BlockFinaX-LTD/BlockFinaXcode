/**
 * Chain errors to shared application errors. The product shows only ApplicationError
 * codes; the raw chain message is kept in `detail` for logs and support.
 */
import { ApplicationError, type ApplicationErrorCode } from "@shared/domain/types";

/** Revert reasons from the Base pool facets and ERC20, matched by prefix. */
const EVM_REASONS: [string, ApplicationErrorCode][] = [
  ["Insufficient pool capacity", "INSUFFICIENT_LIQUIDITY"],
  ["Pool does not sell this direction", "DIRECTION_NOT_OFFERED"],
  ["Tenor not offered", "TENOR_DISABLED"],
  ["Tenor must be", "INVALID_TENOR"],
  ["Offer below", "INVALID_TENOR"],
  ["Offer above", "INVALID_TENOR"],
  ["Max 16 tenors", "INVALID_TENOR"],
  ["Cap ", "INVALID_CAP"],
  ["Open cap mismatch", "INVALID_CAP"],
  ["Strike must be", "INVALID_STRIKE"],
  ["Capped protection not offered", "STRUCTURE_NOT_OFFERED"],
  ["Open protection not offered", "STRUCTURE_NOT_OFFERED"],
  ["Quote expired", "QUOTE_EXPIRED"],
  ["Quote nonce already used", "QUOTE_USED"],
  ["Invalid pricing-engine signature", "QUOTE_INVALID"],
  ["Quote signature wrong length", "QUOTE_INVALID"],
  ["Cost exceeds slippage limit", "SLIPPAGE_EXCEEDED"],
  ["Transaction deadline expired", "SLIPPAGE_EXCEEDED"],
  ["Too early", "ORACLE_NOT_READY"],
  ["Resubmit cooldown", "ORACLE_NOT_READY"],
  ["Settlement price implausible", "ORACLE_PRICE_REJECTED"],
  ["Position already settled", "POSITION_SETTLED"],
  ["No payout", "NOTHING_TO_CLAIM"],
  ["No earnings", "NOTHING_TO_CLAIM"],
  ["Notice period not over", "WITHDRAWAL_NOT_READY"],
  ["Hedges expiring before the unlock", "WITHDRAWAL_NOT_READY"],
  ["Pool capital still reserved", "WITHDRAWAL_NOT_READY"],
  ["Pool not found", "POOL_NOT_FOUND"],
  ["Pool not accepting hedges", "POOL_NOT_ACCEPTING"],
  ["Pool closed to external LPs", "UNAUTHORIZED"],
  ["Not pool creator", "UNAUTHORIZED"],
  ["Not your", "UNAUTHORIZED"],
  ["Not owner", "UNAUTHORIZED"],
  ["Not an authorised oracle", "UNAUTHORIZED"],
  ["Protocol is paused", "PAUSED"],
  ["ERC20InsufficientBalance", "INSUFFICIENT_BALANCE"],
  ["transfer amount exceeds balance", "INSUFFICIENT_BALANCE"],
];

export function mapEvmError(err: unknown): ApplicationError {
  if (err instanceof ApplicationError) return err;
  const e = err as { code?: string | number; reason?: string; shortMessage?: string; message?: string };
  const raw = e?.reason ?? e?.shortMessage ?? e?.message ?? String(err);
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001) return new ApplicationError("TRANSACTION_REJECTED", "Transaction rejected", raw);
  const hit = EVM_REASONS.find(([prefix]) => raw.includes(prefix));
  return new ApplicationError(hit ? hit[1] : "UNKNOWN", hit ? hit[0] : "Transaction failed", raw);
}

/** contracts/currency-pool Error enum, by number. */
const STELLAR_POOL_ERRORS: Record<number, ApplicationErrorCode> = {
  3: "UNAUTHORIZED", 4: "INVALID_REQUEST", 5: "INVALID_REQUEST", 6: "POOL_NOT_FOUND", 7: "INVALID_REQUEST",
  8: "PAUSED", 9: "POOL_NOT_ACCEPTING", 10: "TENOR_DISABLED", 11: "INVALID_TENOR", 12: "INVALID_TENOR",
  13: "INVALID_TENOR", 14: "STRUCTURE_NOT_OFFERED", 15: "INVALID_CAP", 16: "INVALID_CAP", 17: "INSUFFICIENT_LIQUIDITY",
  18: "SLIPPAGE_EXCEEDED", 19: "QUOTE_EXPIRED", 20: "QUOTE_USED", 21: "ORACLE_NOT_READY", 22: "ORACLE_PRICE_REJECTED",
  23: "POSITION_SETTLED", 24: "NOTHING_TO_CLAIM", 25: "NOTHING_TO_CLAIM", 26: "INSUFFICIENT_BALANCE",
  27: "INVALID_REQUEST", 28: "WITHDRAWAL_NOT_READY", 29: "WITHDRAWAL_NOT_READY", 30: "WITHDRAWAL_NOT_READY",
  31: "INSUFFICIENT_LIQUIDITY", 32: "UNAUTHORIZED", 33: "CHAIN_NOT_ENABLED", 36: "ORACLE_NOT_READY", 37: "DIRECTION_NOT_OFFERED",
};

/** contracts/oracle-consensus Error enum, by number. */
const STELLAR_ORACLE_ERRORS: Record<number, ApplicationErrorCode> = {
  3: "UNAUTHORIZED", 6: "UNAUTHORIZED", 9: "INVALID_REQUEST", 10: "ORACLE_PRICE_REJECTED",
  11: "POSITION_SETTLED", 12: "ORACLE_NOT_READY", 13: "ORACLE_NOT_READY",
};

export function mapStellarError(err: unknown, contract: "pool" | "oracle" = "pool"): ApplicationError {
  if (err instanceof ApplicationError) return err;
  const raw = (err as { message?: string })?.message ?? String(err);
  if (/rejected|cancel|NotAllowedError/i.test(raw)) return new ApplicationError("TRANSACTION_REJECTED", "Transaction rejected", raw);
  const m = raw.match(/Error\(Contract, #(\d+)\)/) ?? raw.match(/#(\d+)/);
  const table = contract === "pool" ? STELLAR_POOL_ERRORS : STELLAR_ORACLE_ERRORS;
  const code = m ? table[Number(m[1])] : undefined;
  return new ApplicationError(code ?? "UNKNOWN", code ?? "Transaction failed", raw);
}
