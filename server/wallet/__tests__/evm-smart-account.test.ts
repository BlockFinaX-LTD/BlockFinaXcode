import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { ethers } from "ethers";
import { EvmRelayer } from "../evm-relayer";
import { accountInterface, callDataFor, decodeCalls, encodeWebAuthnSignature, parseDerSignature, passkeyOwner, userOpHash, type UserOperation } from "../evm-smart-account";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const POOL = "0x000000000000000000000000000000000000b0b0";
const erc20 = new ethers.Interface(["function approve(address,uint256)", "function transfer(address,uint256)", "function transferFrom(address,address,uint256)"]);
const N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

function relayer() {
  return new EvmRelayer({} as ethers.Provider, 84532, null, { tokens: [USDC], contracts: [POOL], dailyOpsPerUser: 2 });
}

test("the relayer sponsors only approved tokens and BlockFinaX contracts", () => {
  const r = relayer();
  const to = "0x1111111111111111111111111111111111111111";
  r.checkCalls([{ target: USDC, value: BigInt(0), data: erc20.encodeFunctionData("approve", [POOL, 5]) }]);
  r.checkCalls([{ target: USDC, value: BigInt(0), data: erc20.encodeFunctionData("transfer", [to, 5]) }]);
  r.checkCalls([{ target: POOL, value: BigInt(0), data: "0x12345678" }]);
  assert.throws(() => r.checkCalls([{ target: USDC, value: BigInt(0), data: erc20.encodeFunctionData("transferFrom", [to, to, 5]) }]), /approve and transfer/);
  assert.throws(() => r.checkCalls([{ target: to, value: BigInt(0), data: "0x" }]), /not approved/);
  assert.throws(() => r.checkCalls([{ target: POOL, value: BigInt(1), data: "0x" }]), /ETH is not sponsored/);
  assert.throws(() => r.checkCalls([]), /one to four/);
});

test("account calldata round-trips, so policy checks what will actually run", () => {
  const calls = [
    { target: USDC, value: BigInt(0), data: erc20.encodeFunctionData("approve", [POOL, 5]) },
    { target: POOL, value: BigInt(0), data: "0xabcdef01" },
  ];
  const decoded = decodeCalls(callDataFor(calls));
  assert.deepEqual(decoded.map((c) => [ethers.getAddress(c.target), c.data]), calls.map((c) => [ethers.getAddress(c.target), c.data]));
  assert.equal(decodeCalls(callDataFor([calls[0]])).length, 1);
});

test("passkey signatures are encoded for Coinbase Smart Wallet with low s", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const clientDataJSON = JSON.stringify({ type: "webauthn.get", challenge: "abc", origin: "https://x" });
  const authenticatorData = new Uint8Array(37);
  for (let i = 0; i < 20; i++) {
    const der = sign("sha256", Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON + i).digest()]), privateKey);
    const { s } = parseDerSignature(der);
    assert.ok(s <= N / BigInt(2));
  }
  const der = sign("sha256", Buffer.from("x"), privateKey);
  const encoded = encodeWebAuthnSignature({ authenticatorData, clientDataJSON, signature: der });
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const [[ownerIndex, data]] = coder.decode(["tuple(uint256,bytes)"], encoded);
  const [[, json, challengeIndex, typeIndex]] = coder.decode(["tuple(bytes,string,uint256,uint256,uint256,uint256)"], data);
  assert.equal(ownerIndex, BigInt(0));
  assert.equal(json, clientDataJSON);
  assert.equal(json.slice(Number(challengeIndex)).startsWith('"challenge":'), true);
  assert.equal(json.slice(Number(typeIndex)).startsWith('"type":"webauthn.get"'), true);
});

test("the userOp hash matches the EntryPoint v0.6 value recorded on Base Sepolia", () => {
  // Same op checked against EntryPoint.getUserOpHash on chain 84532 on 2026-10-17.
  const owner = passkeyOwner("0x" + "11".repeat(32), "0x" + "22".repeat(32));
  void owner;
  const op: UserOperation = {
    sender: "0xD30E185Dcf335FFEf6e4C0D334201230b171E04d", nonce: BigInt(0),
    initCode: ethers.concat(["0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a", new ethers.Interface(["function createAccount(bytes[] owners, uint256 nonce)"]).encodeFunctionData("createAccount", [[owner], 0])]),
    callData: callDataFor([{ target: USDC, value: BigInt(0), data: "0x" }]),
    callGasLimit: BigInt(300000), verificationGasLimit: BigInt(1000000), preVerificationGas: BigInt(60000),
    maxFeePerGas: BigInt(0), maxPriorityFeePerGas: BigInt(0), paymasterAndData: "0x", signature: "0x",
  };
  assert.equal(userOpHash(op, 84532), "0xed6111aecfd9fe4d01bd57147d4ea7c461bf63cf1088b1f51a1f94e92ca6cd65");
});

test("prepared operations are single use, expire, and belong to one user", async () => {
  let now = 1_800_000_000_000;
  const provider = { getCode: async () => "0x", call: async () => ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0]) } as unknown as ethers.Provider;
  const r = new EvmRelayer(provider, 84532, null, { tokens: [USDC], contracts: [], dailyOpsPerUser: 5 }, () => now);
  const call = { target: USDC, value: BigInt(0), data: erc20.encodeFunctionData("approve", [POOL, 1]) };
  const owner = passkeyOwner("0x" + "11".repeat(32), "0x" + "22".repeat(32));
  const a = await r.prepare({ userId: 1, sender: "0xD30E185Dcf335FFEf6e4C0D334201230b171E04d", owner, calls: [call] });
  assert.throws(() => r.take(a.id, 2), /another user/);
  const b = await r.prepare({ userId: 1, sender: "0xD30E185Dcf335FFEf6e4C0D334201230b171E04d", owner, calls: [call] });
  assert.equal(r.take(b.id, 1).hash, b.hash);
  assert.throws(() => r.take(b.id, 1), /expired/);
  const c = await r.prepare({ userId: 1, sender: "0xD30E185Dcf335FFEf6e4C0D334201230b171E04d", owner, calls: [call] });
  now += 6 * 60_000;
  assert.throws(() => r.take(c.id, 1), /expired/);
});

test("relayer sponsors adding a passkey owner only on the account itself, and only when marked", () => {
  const r = relayer();
  const sender = "0x00000000000000000000000000000000000a11ce";
  const add = accountInterface.encodeFunctionData("addOwnerPublicKey", [ethers.zeroPadValue("0x01", 32), ethers.zeroPadValue("0x02", 32)]);
  // Allowed: one self-call to addOwnerPublicKey, no value.
  r.checkCalls([{ target: sender, value: BigInt(0), data: add }], { sender });
  // Not allowed without the server's owner-change flag.
  assert.throws(() => r.checkCalls([{ target: sender, value: BigInt(0), data: add }]), /not approved/);
  // Not allowed on another account, with value, with another method, or bundled with other calls.
  assert.throws(() => r.checkCalls([{ target: POOL, value: BigInt(0), data: add }], { sender }), /Only adding a passkey owner/);
  assert.throws(() => r.checkCalls([{ target: sender, value: BigInt(1), data: add }], { sender }), /Only adding a passkey owner/);
  assert.throws(() => r.checkCalls([{ target: sender, value: BigInt(0), data: accountInterface.encodeFunctionData("execute", [POOL, 0, "0x"]) }], { sender }), /Only adding a passkey owner/);
  assert.throws(() => r.checkCalls([{ target: sender, value: BigInt(0), data: add }, { target: USDC, value: BigInt(0), data: erc20.encodeFunctionData("transfer", [POOL, 1]) }], { sender }), /Only adding a passkey owner/);
});

test("WebAuthn signature carries the approving passkey's owner index", () => {
  const authenticatorData = new Uint8Array(37);
  const clientDataJSON = '{"type":"webauthn.get","challenge":"abc","origin":"https://x"}';
  const der = new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]);
  const enc = encodeWebAuthnSignature({ authenticatorData, clientDataJSON, signature: der, ownerIndex: 3 });
  const [wrapped] = ethers.AbiCoder.defaultAbiCoder().decode(["tuple(uint256 ownerIndex, bytes signatureData)"], enc);
  assert.equal(Number(wrapped.ownerIndex), 3);
});
