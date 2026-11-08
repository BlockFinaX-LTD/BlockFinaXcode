/**
 * Plain-language key facts of a quote, as recorded with it, and a short description of a
 * sponsored Stellar transaction (which contract and function) for the compliance log.
 */
import { Address, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { EconomicQuote } from "@shared/domain/types";

const usd = (v: string | number) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The facts a customer must have understood before buying, in the words the app uses. */
export function keyFacts(e: EconomicQuote, expiresAt: number): string[] {
  const [, ccy] = String(e.pair).split("/");
  const cap = e.structure === "capped" ? `, up to a limit of ${e.cap} ${ccy}` : "";
  const moves = e.direction === "up" ? `rises above ${e.strike}` : `falls below ${e.strike}`;
  return [
    `You are protecting ${usd(e.notional)} against ${e.pair} moving against you, for ${e.tenorDays} days.`,
    `If ${e.pair} ${moves} ${ccy} per USD at the end date, you receive the difference on your amount in USDC${cap}.`,
    `The most you can receive is ${usd(e.maxPayout)}.`,
    `You pay ${usd(e.totalCost)} now: premium ${usd(e.premium)} and execution cost ${usd(e.hedgerFee)}. This is the most you can lose.`,
    `The payout is decided by the agreed reference rate at 14:00 UTC on the end date, not by the rate you may get when you convert currency.`,
    `This price was valid until ${new Date(expiresAt * 1000).toISOString()}.`,
  ];
}

/** Which contract and function a single-call Soroban transaction invokes. */
export function describeCall(xdr: string, networkPassphrase: string): { contract: string | null; method: string | null } {
  try {
    const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
    const op = tx instanceof Transaction ? tx.operations[0] : null;
    if (!op || op.type !== "invokeHostFunction" || op.func.switch().name !== "hostFunctionTypeInvokeContract") return { contract: null, method: null };
    const invoke = op.func.invokeContract();
    return { contract: Address.fromScAddress(invoke.contractAddress()).toString(), method: invoke.functionName().toString() };
  } catch {
    return { contract: null, method: null };
  }
}
