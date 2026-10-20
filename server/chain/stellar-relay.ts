/**
 * Sponsored relay for Stellar user transactions (moved from the Stellar wallet server's
 * policy.ts and stellar.ts, Architecture v2.0 stage 5).
 *
 * A user's passkey smart account authorizes a contract call; the platform's fee payer
 * submits it. Before paying, the relay checks the call is exactly one approved method on
 * the configured pool contract, uses the user's own account where the method takes one,
 * and carries an authorization from that account bound to this exact invocation.
 */
import { Address, BASE_FEE, Keypair, Operation, Transaction, TransactionBuilder, scValToNative, rpc, type xdr } from "@stellar/stellar-sdk";
import { ApplicationError } from "@shared/domain/types";

const POOL_METHODS = new Set([
  "create_pool", "set_tenor", "set_structures", "set_pool_settings", "deposit", "request_withdrawal",
  "cancel_withdrawal", "execute_withdrawal", "withdraw_creator_earnings", "buy_protection", "settle_position",
  "claim_payout", "advance_settlement_cursor", "maintain_storage",
]);
const WALLET_ARG: Record<string, number> = { create_pool: 0, deposit: 1, request_withdrawal: 1, buy_protection: 0 };
const PERMISSIONLESS = new Set(["settle_position", "advance_settlement_cursor", "maintain_storage"]);

/** Another contract the relay may pay for, with its own method allowlist. */
export interface ExtraContractPolicy {
  contract: string;
  methods: Set<string>;
  walletArg: Record<string, number>;
  permissionless: Set<string>;
}

export function inspectPoolCall(envelope: string, networkPassphrase: string, wallet: string, poolContract: string, tokens: string[] = [], extra: ExtraContractPolicy[] = [], spenders: string[] = []) {
  const tx = TransactionBuilder.fromXDR(envelope, networkPassphrase);
  if (!(tx instanceof Transaction) || tx.operations.length !== 1) throw new ApplicationError("UNAUTHORIZED", "Only one pool call is permitted");
  const op = tx.operations[0];
  if (op.type !== "invokeHostFunction" || op.func.switch().name !== "hostFunctionTypeInvokeContract") {
    throw new ApplicationError("UNAUTHORIZED", "Only a Soroban contract call is permitted");
  }
  const invoke = op.func.invokeContract();
  const method = invoke.functionName().toString();
  const target = Address.fromScAddress(invoke.contractAddress()).toString();
  const args = invoke.args().map(scValToNative);
  const tokenTransfer = tokens.includes(target) && method === "transfer";
  // An allowance for an approved spender (Circle CCTP's TokenMessengerMinter), from the user's wallet.
  const tokenApprove = tokens.includes(target) && method === "approve";
  const policy = extra.find((e) => e.contract === target);
  if (policy) {
    if (!policy.methods.has(method)) throw new ApplicationError("UNAUTHORIZED", "Contract or method is not approved");
    const arg = policy.walletArg[method];
    if (arg !== undefined && args[arg] !== wallet) throw new ApplicationError("UNAUTHORIZED", "Call must use the connected wallet address");
  } else if (tokenApprove) {
    if (args.length !== 4 || args[0] !== wallet || !spenders.includes(String(args[1])) || typeof args[2] !== "bigint" || args[2] <= BigInt(0)) {
      throw new ApplicationError("UNAUTHORIZED", "Only an allowance from your wallet to an approved transfer contract is permitted");
    }
  } else if (tokenTransfer) {
    // A user sending a listed asset: from their own wallet, a positive amount, to someone else.
    if (args.length !== 3 || args[0] !== wallet || args[1] === wallet || typeof args[2] !== "bigint" || args[2] <= BigInt(0)) {
      throw new ApplicationError("UNAUTHORIZED", "Only a positive transfer from your wallet to another address is permitted");
    }
  } else if (target !== poolContract || !POOL_METHODS.has(method)) {
    throw new ApplicationError("UNAUTHORIZED", "Contract or method is not approved");
  }
  if (!policy && WALLET_ARG[method] !== undefined && !tokenTransfer && !tokenApprove && args[WALLET_ARG[method]] !== wallet) {
    throw new ApplicationError("UNAUTHORIZED", "Call must use the connected wallet address");
  }
  const auth = op.auth ?? [];
  const permissionless = policy ? policy.permissionless.has(method) : PERMISSIONLESS.has(method);
  if (permissionless && auth.length === 0) return { func: op.func, auth, method, target };
  if (
    auth.length !== 1 ||
    auth[0].credentials().switch().name !== "sorobanCredentialsAddressV2" ||
    Address.fromScAddress(auth[0].credentials().addressV2().address()).toString() !== wallet
  ) throw new ApplicationError("UNAUTHORIZED", "Pool call must be authorized by your connected wallet");
  const root = auth[0].rootInvocation();
  if (root.function().switch().name !== "sorobanAuthorizedFunctionTypeContractFn" || !root.function().contractFn().toXDR().equals(invoke.toXDR())) {
    throw new ApplicationError("UNAUTHORIZED", "Authorization is not bound to this pool call");
  }
  return { func: op.func, auth, method, target };
}

/** Submit an inspected call with the platform fee payer as source. Returns the hash once confirmed. */
export async function relay(
  server: rpc.Server,
  networkPassphrase: string,
  feePayerSecret: string,
  func: xdr.HostFunction,
  auth: xdr.SorobanAuthorizationEntry[],
): Promise<string> {
  const payer = Keypair.fromSecret(feePayerSecret);
  const account = await server.getAccount(payer.publicKey());
  let tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
    .addOperation(Operation.invokeHostFunction({ func, auth }))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  tx = rpc.assembleTransaction(tx, sim).build();
  tx.sign(payer);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") throw new Error(`Stellar rejected transaction: ${sent.errorResult?.toXDR("base64")}`);
  return sent.hash;
}
