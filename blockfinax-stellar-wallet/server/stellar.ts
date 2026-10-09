import {
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  hash,
  nativeToScVal,
  Address,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { Server, assembleTransaction, Api } from "@stellar/stellar-sdk/rpc";
import { Client } from "passkey-kit-sdk";
export const NETWORK = Networks.TESTNET;
export const RPC =
  process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
export const WASM =
  process.env.WALLET_WASM_HASH ||
  "fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0";
export const TOKEN = Asset.native().contractId(NETWORK);
export const rpc = new Server(RPC);
function payer() {
  if (!process.env.STELLAR_FEE_PAYER_SECRET)
    throw Error("Fee payer is not configured. Run npm run setup:testnet.");
  return Keypair.fromSecret(process.env.STELLAR_FEE_PAYER_SECRET);
}
let queue: Promise<unknown> = Promise.resolve();
export function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work);
  queue = next.catch(() => {});
  return next;
}
async function confirm(tx: ReturnType<TransactionBuilder["build"]>) {
  const result = await rpc.sendTransaction(tx);
  if (result.status === "ERROR")
    throw Error(
      `Stellar rejected transaction: ${result.errorResult?.toXDR("base64")}`,
    );
  if (result.status === "TRY_AGAIN_LATER")
    throw Error("Stellar is busy. Please retry.");
  for (let i = 0; i < 30; i++) {
    const found = await rpc.getTransaction(result.hash);
    if (found.status === Api.GetTransactionStatus.SUCCESS) return result.hash;
    if (found.status === Api.GetTransactionStatus.FAILED)
      throw Error("Transaction failed on Stellar testnet");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error(
    `Transaction confirmation timed out. Check ${result.hash} before retrying.`,
  );
}
export async function invoke(
  func: xdr.HostFunction,
  auth: xdr.SorobanAuthorizationEntry[] = [],
) {
  return serialized(async () => {
    const key = payer();
    const account = await rpc.getAccount(key.publicKey());
    let tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK,
    })
      .addOperation(Operation.invokeHostFunction({ func, auth }))
      .setTimeout(60)
      .build();
    const sim = await rpc.simulateTransaction(tx);
    if (Api.isSimulationError(sim)) throw Error(sim.error);
    tx = assembleTransaction(tx, sim).build();
    const fee = Number(tx.fee);
    if (!Number.isSafeInteger(fee) || fee > 10_0000000)
      throw Error("Transaction exceeds sponsorship fee limit");
    tx.sign(key);
    return confirm(tx);
  });
}
export async function deploy(credential: string, publicKey: Uint8Array) {
  return serialized(async () => {
    const key = payer();
    const tx = await Client.deploy(
      {
        signer: {
          tag: "Secp256r1",
          values: [
            Buffer.from(credential, "base64url"),
            Buffer.from(publicKey),
            [undefined],
            [undefined],
            { tag: "Persistent", values: undefined },
          ],
        },
      },
      {
        rpcUrl: RPC,
        wasmHash: WASM,
        networkPassphrase: NETWORK,
        publicKey: key.publicKey(),
        salt: hash(Buffer.from(credential, "base64url")),
        timeoutInSeconds: 60,
      },
    );
    if (!tx.built) throw Error("Deployment was not assembled");
    if (Number(tx.built.fee) > 10_0000000)
      throw Error("Deployment exceeds fee limit");
    tx.built.sign(key);
    const txHash = await confirm(tx.built);
    return { contract: tx.result.options.contractId, hash: txHash };
  });
}
export async function fund(contract: string) {
  const key = payer();
  return invoke(
    xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(TOKEN).toScAddress(),
        functionName: "transfer",
        args: [
          new Address(key.publicKey()).toScVal(),
          new Address(contract).toScVal(),
          nativeToScVal(100_0000000n, { type: "i128" }),
        ],
      }),
    ),
  );
}
export async function balance(contract: string) {
  const account = await rpc.getAccount(payer().publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: TOKEN,
        function: "balance",
        args: [new Address(contract).toScVal()],
      }),
    )
    .setTimeout(30)
    .build();
  const result = await rpc.simulateTransaction(tx);
  if (Api.isSimulationError(result) || !result.result)
    throw Error("Could not read wallet balance");
  return String(scValToNative(result.result.retval));
}
