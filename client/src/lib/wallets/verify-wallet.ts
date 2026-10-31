/**
 * The app's own check that the wallet and addresses the server names really belong to the
 * user's passkey (see shared/wallet-trust.ts for why). Everything here reads the chain
 * through the network settings built into the app, not the server's.
 *
 *   1. The Stellar wallet runs the pinned Passkey Kit code.
 *   2. This device's passkey is a signer of it. When the device has seen the passkey sign
 *      (at registration or passkey sign-in), the key it saw must still be the key on chain.
 *   3. The Base account is the one the primary passkey's key creates.
 *   4. Every deposit address is the one the deposit factory creates for this wallet.
 */
import { useCallback, useEffect, useState } from "react";
import {
  PASSKEY_WALLET_WASM_HASH, CSW_FACTORY, assertionMatchesKey, depositAddressFor, fromBase64Url, keyXY,
  passkeyOwner, rawKeyFromSpki, trustedChains,
} from "@shared/wallet-trust";
import type { PasskeySession } from "./passkey-wallet";

const ENV: "testnet" | "mainnet" = import.meta.env.VITE_NETWORK_MODE === "mainnet" ? "mainnet" : "testnet";
const CHAINS = trustedChains(ENV);
const STELLAR = CHAINS.find((c) => c.family === "stellar")!;
const STELLAR_RPC = (import.meta.env.VITE_STELLAR_RPC_URL as string | undefined) || STELLAR.rpcUrls[0];
const PROOF_KEY = (contract: string) => `bfx:wallet-proof:${contract}`;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function buffer() {
  const { Buffer } = await import("buffer");
  (globalThis as any).Buffer ??= Buffer;
  return Buffer;
}

/** The wallet's code fingerprint, read from its contract instance on chain. */
async function walletWasmHash(contract: string): Promise<string> {
  const { rpc, xdr, Address } = await import("@stellar/stellar-sdk");
  const server = new rpc.Server(STELLAR_RPC!);
  const key = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract: new Address(contract).toScAddress(),
    key: xdr.ScVal.scvLedgerKeyContractInstance(),
    durability: xdr.ContractDataDurability.persistent(),
  }));
  const res = await server.getLedgerEntries(key);
  const entry = res.entries[0];
  if (!entry) throw new Error("The Stellar wallet was not found on chain");
  return entry.val.contractData().val().instance().executable().wasmHash().toString("hex");
}

/** The public key stored on chain for a passkey signer, and whether it is an admin. Null if not a signer. */
async function onChainSigner(contract: string, credentialId: string): Promise<{ key: Uint8Array; admin: boolean } | null> {
  const Buffer = await buffer();
  const { Client } = await import("passkey-kit-sdk");
  const client = new Client({ contractId: contract, rpcUrl: STELLAR_RPC!, networkPassphrase: STELLAR.networkId } as any);
  const tx = await client.get_signer({ signer_key: { tag: "Secp256r1", values: [Buffer.from(fromBase64Url(credentialId))] } as any });
  const val: any = tx.result;
  if (!val || val.tag !== "Secp256r1") return null;
  const limits = val.values[2];
  return { key: new Uint8Array(val.values[0]), admin: !limits || limits[0] === undefined || limits[0] === null };
}

function remembered(contract: string, credentialId: string): string | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROOF_KEY(contract)) || "null");
    return p && p.credentialId === credentialId ? String(p.key) : null;
  } catch { return null; }
}
function remember(contract: string, credentialId: string, key: Uint8Array) {
  try { localStorage.setItem(PROOF_KEY(contract), JSON.stringify({ credentialId, key: hex(key) })); } catch { /* proof is asked again next time */ }
}

/**
 * Record that this device's passkey holds the on-chain key, from a passkey response the app
 * already has: a registration (its public key) or a sign-in (its signature). Silent; a
 * failure here only means this device has no key to compare with later.
 */
export async function recordPasskeyProof(
  contract: string | undefined,
  credentialId: string | null | undefined,
  response: { response?: { publicKey?: string; authenticatorData?: string; clientDataJSON?: string; signature?: string } },
) {
  if (!contract || !credentialId || !response?.response) return;
  try {
    const signer = await onChainSigner(contract, credentialId);
    if (!signer) return;
    const r = response.response;
    const ok = r.publicKey
      ? hex(rawKeyFromSpki(fromBase64Url(r.publicKey))) === hex(signer.key)
      : r.authenticatorData && r.clientDataJSON && r.signature
        ? await assertionMatchesKey(signer.key, { authenticatorData: fromBase64Url(r.authenticatorData), clientDataJSON: fromBase64Url(r.clientDataJSON), signature: fromBase64Url(r.signature) })
        : false;
    if (ok) remember(contract, credentialId, signer.key);
  } catch { /* nothing recorded, so nothing to compare with later */ }
}

/** The Base account the primary passkey's key creates (Coinbase Smart Wallet, nonce 0). */
async function expectedBaseAccount(rpcUrl: string, key: Uint8Array): Promise<string> {
  const { ethers } = await import("ethers");
  const { x, y } = keyXY(key);
  const iface = new ethers.Interface(["function getAddress(bytes[] owners, uint256 nonce) view returns (address)"]);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const out = await provider.call({ to: CSW_FACTORY, data: iface.encodeFunctionData("getAddress", [[passkeyOwner(x, y)], 0]) });
  return ethers.getAddress(iface.decodeFunctionResult("getAddress", out)[0]);
}

export type WalletCheck =
  | { status: "checking" }
  | { status: "ok" }
  | { status: "failed"; problems: string[] };

/** Runs every check that needs no passkey prompt. */
export async function checkWallet(session: PasskeySession, depositAddresses: { chain: string; address: string }[] = []): Promise<WalletCheck> {
  const problems: string[] = [];
  const stellar = session.accounts.find((a) => a.chain === STELLAR.key);
  const credentialId = session.credentialId;
  if (!stellar || !credentialId) return { status: "failed", problems: ["No Stellar wallet or passkey on this account yet."] };
  if (!STELLAR_RPC) return { status: "failed", problems: ["This app was built without a Stellar network address, so the wallet cannot be checked."] };

  const wasm = await walletWasmHash(stellar.address);
  if (wasm !== PASSKEY_WALLET_WASM_HASH) problems.push("Your Stellar wallet is not running the standard BlockFinaX wallet code.");

  const signer = await onChainSigner(stellar.address, credentialId);
  if (!signer) problems.push("This device's passkey is not a signer of the Stellar wallet shown.");
  else if (!signer.admin) problems.push("This device's passkey does not have full control of the Stellar wallet shown.");

  // Every deposit address must be the one the factory creates for this wallet.
  for (const d of depositAddresses) {
    const c = CHAINS.find((x) => x.key === d.chain);
    const f = c?.cctp?.depositFactory, impl = c?.cctp?.depositImplementation;
    if (!f || !impl) { problems.push(`The ${d.chain} deposit address is on a network this app does not know.`); continue; }
    if (!same(depositAddressFor(f, impl, stellar.address), d.address)) problems.push(`The ${c!.name} deposit address does not lead to your Stellar wallet.`);
  }

  // The Base account must be the one the primary passkey's on-chain key creates.
  const primary = session.passkeys?.find((p: any) => p.role === "primary")?.credentialId ?? credentialId;
  for (const acct of session.accounts) {
    const c = CHAINS.find((x) => x.key === acct.chain);
    if (!c || c.family !== "evm" || !c.rpcUrls[0]) continue;
    const primarySigner = primary === credentialId ? signer : await onChainSigner(stellar.address, primary);
    if (!primarySigner) { problems.push("Your primary passkey is not a signer of the Stellar wallet shown."); continue; }
    try {
      if (!same(await expectedBaseAccount(c.rpcUrls[0], primarySigner.key), acct.address)) problems.push(`The ${c.name} account shown is not the one your passkey creates.`);
    } catch { /* network unreachable: not proof of a problem; checked again next time */ }
  }

  if (problems.length) return { status: "failed", problems };
  const seen = remembered(stellar.address, credentialId);
  if (seen && seen !== hex(signer!.key)) return { status: "failed", problems: ["The key on your Stellar wallet is not the one this device's passkey signs with."] };
  return { status: "ok" };
}

/** The check for the current session, re-run when the session or the addresses change. */
export function useWalletCheck(session: PasskeySession | null, depositAddresses: { chain: string; address: string }[] | undefined, ready: boolean) {
  const [state, setState] = useState<WalletCheck>({ status: "checking" });
  const deps = JSON.stringify([session?.credentialId, session?.accounts, depositAddresses]);
  const run = useCallback(async () => {
    if (!session || !ready) return;
    setState({ status: "checking" });
    try { setState(await checkWallet(session, depositAddresses ?? [])); }
    catch (e) { setState({ status: "failed", problems: [`The wallet could not be checked: ${(e as Error).message}`] }); }
  }, [deps, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, [run]);
  return { state, recheck: run };
}
