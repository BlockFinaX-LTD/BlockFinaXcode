import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { Account, Address, Keypair, Operation, StrKey, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { evmAddressBytes32, roundToCctpUnits, stellarContractBytes32, stellarForwardHook } from "../cctp";
import { inspectPoolCall } from "../../chain/stellar-relay";
import { PersistentLedger } from "../store";

const FORWARDER = "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ";

test("forwarder hook: 24 zero bytes, version 0, length, then the recipient strkey", () => {
  const wallet = "CB4IWMDLPUPCFNMQH4KLEFWX6PEN5M2OGNY25E5YA7DUTPOYD4E2YWXU";
  const hook = ethers.getBytes(stellarForwardHook(wallet));
  assert.equal(hook.length, 32 + 56);
  assert.deepEqual(Array.from(hook.slice(0, 28)), new Array(28).fill(0));
  assert.equal(new DataView(hook.buffer).getUint32(28), 56);
  assert.equal(ethers.toUtf8String(hook.slice(32)), wallet);
});

test("Stellar contract and EVM addresses become 32-byte CCTP fields", () => {
  assert.equal(ethers.getBytes(stellarContractBytes32(FORWARDER)).length, 32);
  assert.deepEqual(ethers.getBytes(stellarContractBytes32(FORWARDER)), new Uint8Array(StrKey.decodeContract(FORWARDER)));
  const padded = evmAddressBytes32("0x54733B449882558214641D7a00fbF9C546bbF60B");
  assert.equal(padded.length, 32);
  assert.equal(ethers.hexlify(padded.slice(12)), "0x54733b449882558214641d7a00fbf9c546bbf60b");
});

test("withdrawals drop the seventh decimal CCTP cannot burn", () => {
  assert.equal(roundToCctpUnits("5.1234567", 7), BigInt(51234560));
  assert.equal(roundToCctpUnits("1", 7), BigInt(10000000));
  assert.equal(roundToCctpUnits("2.5", 6), BigInt(2500000));
});

function approveEnvelope(wallet: string, spender: string, amount: bigint, token: string) {
  const source = new Account(Keypair.random().publicKey(), "1");
  const args = [nativeToScVal(wallet, { type: "address" }), nativeToScVal(spender, { type: "address" }), nativeToScVal(amount, { type: "i128" }), nativeToScVal(1000, { type: "u32" })];
  const op = Operation.invokeContractFunction({ contract: token, function: "approve", args });
  const invoke = (op as any).body().invokeHostFunctionOp().hostFunction().invokeContract();
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: Address.fromString(wallet).toScAddress(), nonce: xdr.Int64.fromString("1"), signatureExpirationLedger: 10, signature: xdr.ScVal.scvVoid(),
    } as any)),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invoke), subInvocations: [] }),
  });
  const withAuth = Operation.invokeContractFunction({ contract: token, function: "approve", args, auth: [auth] });
  return new TransactionBuilder(source, { fee: "100", networkPassphrase: "Test SDF Network ; September 2015" }).addOperation(withAuth).setTimeout(60).build().toXDR();
}

test("relay sponsors a USDC allowance only to an approved CCTP contract", () => {
  const wallet = StrKey.encodeContract(Buffer.alloc(32, 7));
  const token = StrKey.encodeContract(Buffer.alloc(32, 1));
  const messenger = StrKey.encodeContract(Buffer.alloc(32, 2));
  const stranger = StrKey.encodeContract(Buffer.alloc(32, 3));
  const pool = StrKey.encodeContract(Buffer.alloc(32, 4));
  const np = "Test SDF Network ; September 2015";
  if (!xdr.SorobanCredentials.sorobanCredentialsAddressV2) return; // older SDKs without V2 credentials
  assert.ok(inspectPoolCall(approveEnvelope(wallet, messenger, BigInt(5), token), np, wallet, pool, [token], [], [messenger]));
  assert.throws(() => inspectPoolCall(approveEnvelope(wallet, stranger, BigInt(5), token), np, wallet, pool, [token], [], [messenger]), /approved transfer contract/);
  assert.throws(() => inspectPoolCall(approveEnvelope(wallet, messenger, BigInt(5), token), np, wallet, pool, [token], [], []), /approved transfer contract/);
});

test("persistent ledger replays its stored entries into the same balances", async () => {
  const rows: { entry: unknown }[] = [];
  const query = async (text: string, params?: unknown[]) => {
    if (text.startsWith("INSERT")) rows.push({ entry: JSON.parse(String(params![0])) });
    return { rows: text.startsWith("SELECT") ? rows : [] };
  };
  const a = await PersistentLedger.load(query);
  const transit = { owner: "1", location: "transit:r1", bucket: "pending_routing" as const };
  const dest = { owner: "1", location: "stellar-testnet", bucket: "available" as const };
  a.credit(transit, "USDC", "10", "source confirmed", "r1");
  a.transfer(transit, dest, "USDC", "9.99", "delivered", "r1");
  a.debit(transit, "USDC", "0.01", "fee", "r1");
  await a.flushed();
  const b = await PersistentLedger.load(query);
  assert.equal(b.balance(dest, "USDC"), a.balance(dest, "USDC"));
  assert.equal(b.balance(transit, "USDC"), "0");
  assert.equal(rows.length, 3);
});
