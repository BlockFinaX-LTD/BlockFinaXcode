/**
 * Passkey smart accounts on EVM testnets (Base Sepolia).
 *
 * The account is Coinbase Smart Wallet v1.1 (open source, audited, already deployed),
 * owned by the same P-256 passkey that owns the user's Stellar smart account. We do not
 * write wallet contracts. BlockFinaX acts as the bundler for its own users: the relayer
 * submits each signed UserOperation to the ERC-4337 EntryPoint v0.6 with a zero gas
 * price, so the account never needs ETH and the relayer pays the network fee. That is
 * the same sponsorship model as the Stellar wallet's fee payer.
 *
 * Signature format (CoinbaseSmartWallet._isValidSignature):
 *   abi.encode(SignatureWrapper{ ownerIndex, signatureData })
 *   signatureData = abi.encode(WebAuthnAuth{ authenticatorData, clientDataJSON,
 *                                            challengeIndex, typeIndex, r, s })
 * with s in the lower half of the curve order, and the WebAuthn challenge set to the
 * 32-byte userOpHash.
 */
import { ethers } from "ethers";

export const CSW_FACTORY = "0x0BA5ED0c6AA8c49038F819E587E2633c4A9F428a";
export const ENTRY_POINT_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";

const P256_N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

const USER_OP = "tuple(address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature)";

export const factoryInterface = new ethers.Interface([
  "function getAddress(bytes[] owners, uint256 nonce) view returns (address)",
  "function createAccount(bytes[] owners, uint256 nonce) payable returns (address)",
]);
export const accountInterface = new ethers.Interface([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
  // Owner management (Coinbase Smart Wallet MultiOwnable), for backup passkeys.
  "function addOwnerPublicKey(bytes32 x, bytes32 y)",
  "function isOwnerPublicKey(bytes32 x, bytes32 y) view returns (bool)",
  "function nextOwnerIndex() view returns (uint256)",
  "function ownerAtIndex(uint256 index) view returns (bytes)",
]);

/** The selector of addOwnerPublicKey, the only self-call the relayer sponsors. */
export const ADD_OWNER_SELECTOR = accountInterface.getFunction("addOwnerPublicKey")!.selector;
export const entryPointInterface = new ethers.Interface([
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  `function getUserOpHash(${USER_OP} userOp) view returns (bytes32)`,
  `function handleOps(${USER_OP}[] ops, address beneficiary)`,
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);

export interface UserOperation {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: string;
  signature: string;
}

export interface Call {
  target: string;
  value: bigint;
  data: string;
}

/** The passkey as a Coinbase Smart Wallet owner: abi.encode(x, y). */
export { passkeyOwner } from "@shared/wallet-trust";

/** Counterfactual account address. Stable before and after the first transaction deploys it. */
export async function smartAccountAddress(provider: ethers.Provider, owner: string): Promise<string> {
  const data = factoryInterface.encodeFunctionData("getAddress", [[owner], 0]);
  const [address] = factoryInterface.decodeFunctionResult("getAddress", await provider.call({ to: CSW_FACTORY, data }));
  return ethers.getAddress(address);
}

export function initCodeFor(owner: string): string {
  return ethers.concat([CSW_FACTORY, factoryInterface.encodeFunctionData("createAccount", [[owner], 0])]);
}

export function callDataFor(calls: Call[]): string {
  if (calls.length === 1) {
    const [c] = calls;
    return accountInterface.encodeFunctionData("execute", [c.target, c.value, c.data]);
  }
  return accountInterface.encodeFunctionData("executeBatch", [calls.map((c) => [c.target, c.value, c.data])]);
}

/** Decode an account's callData back into calls, so policy can inspect what will run. */
export function decodeCalls(callData: string): Call[] {
  const parsed = accountInterface.parseTransaction({ data: callData });
  if (!parsed) throw new Error("Unknown smart account call");
  if (parsed.name === "execute") return [{ target: parsed.args[0], value: parsed.args[1], data: parsed.args[2] }];
  return (parsed.args[0] as any[]).map((c) => ({ target: c[0], value: c[1], data: c[2] }));
}

export function userOpTuple(op: UserOperation) {
  return [op.sender, op.nonce, op.initCode, op.callData, op.callGasLimit, op.verificationGasLimit, op.preVerificationGas, op.maxFeePerGas, op.maxPriorityFeePerGas, op.paymasterAndData, op.signature];
}

/** ERC-4337 v0.6 userOpHash, computed locally (matches EntryPoint.getUserOpHash). */
export function userOpHash(op: UserOperation, chainId: bigint | number, entryPoint = ENTRY_POINT_V06): string {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const packed = coder.encode(
    ["address", "uint256", "bytes32", "bytes32", "uint256", "uint256", "uint256", "uint256", "uint256", "bytes32"],
    [op.sender, op.nonce, ethers.keccak256(op.initCode), ethers.keccak256(op.callData), op.callGasLimit, op.verificationGasLimit,
      op.preVerificationGas, op.maxFeePerGas, op.maxPriorityFeePerGas, ethers.keccak256(op.paymasterAndData)],
  );
  return ethers.keccak256(coder.encode(["bytes32", "address", "uint256"], [ethers.keccak256(packed), entryPoint, chainId]));
}

/** r and s from a DER-encoded ECDSA signature, with s normalized to the lower half. */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("Invalid passkey signature");
  if (der[i] & 0x80) i += 1 + (der[i] & 0x7f); else i += 1;
  const int = () => {
    if (der[i++] !== 0x02) throw new Error("Invalid passkey signature");
    const len = der[i++];
    const value = BigInt(ethers.hexlify(der.slice(i, i + len)));
    i += len;
    return value;
  };
  const r = int();
  let s = int();
  if (s > P256_N / BigInt(2)) s = P256_N - s;
  return { r, s };
}

/** The UserOperation signature for a passkey owner at ownerIndex. */
export function encodeWebAuthnSignature(input: {
  authenticatorData: Uint8Array;
  clientDataJSON: string;
  signature: Uint8Array;
  ownerIndex?: number;
}): string {
  const challengeIndex = input.clientDataJSON.indexOf('"challenge":');
  const typeIndex = input.clientDataJSON.indexOf('"type":"webauthn.get"');
  if (challengeIndex < 0 || typeIndex < 0) throw new Error("Unexpected passkey response");
  const { r, s } = parseDerSignature(input.signature);
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const auth = coder.encode(
    ["tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s)"],
    [[input.authenticatorData, input.clientDataJSON, challengeIndex, typeIndex, r, s]],
  );
  return coder.encode(["tuple(uint256 ownerIndex, bytes signatureData)"], [[input.ownerIndex ?? 0, auth]]);
}

/** A placeholder signature of the right shape, for gas estimation before the user signs. */
export function dummySignature(): string {
  const clientDataJSON = '{"type":"webauthn.get","challenge":"' + "A".repeat(43) + '","origin":"https://blockfinax.com","crossOrigin":false}';
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const auth = coder.encode(
    ["tuple(bytes authenticatorData, string clientDataJSON, uint256 challengeIndex, uint256 typeIndex, uint256 r, uint256 s)"],
    [[new Uint8Array(37), clientDataJSON, 23, 1, BigInt(1), BigInt(1)]],
  );
  return coder.encode(["tuple(uint256 ownerIndex, bytes signatureData)"], [[0, auth]]);
}
