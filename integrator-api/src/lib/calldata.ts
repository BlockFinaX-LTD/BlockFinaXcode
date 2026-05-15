/**
 * Calldata builder — the central pattern of this API.
 *
 * Every state-changing contract function has a corresponding `POST /v1/tx/...`
 * endpoint that returns a `BuiltTx` object. The caller signs the data with
 * THEIR wallet (Privy, MetaMask, raw key, Rift, anything) and broadcasts
 * with THEIR RPC.
 *
 * Why this pattern:
 *   - We never custody keys or sign on the caller's behalf
 *   - Integrators stay sovereign over key material + tx ordering
 *   - The API stays stateless from a tx-submission perspective
 *   - Mobile, server-side bots, and browser dapps integrate identically
 *
 * If a caller wants us to broadcast, there's also POST /v1/tx/broadcast
 * (it just relays via our RPC — still doesn't sign).
 */

import { ethers } from "ethers";
import { getChain, providerFor } from "./chains";

export interface BuiltTx {
  /** Chain ID — caller must sign on this network. */
  chainId: number;
  /** Recipient — the Diamond proxy for all hedge calls; ERC-20 address for `approve`. */
  to: string;
  /** ABI-encoded function call (selector + args). */
  data: string;
  /** Native value to send, decimal-string in wei. Always "0" for hedge calls. */
  value: string;
  /** Human label: "buyProtection", "createEvent", "approve", etc. */
  function: string;
  /** Pretty-printed args echoed back for the caller to audit before signing. */
  args: Record<string, string | number | boolean | null>;
  /** Optional gas estimate (eth_estimateGas) if we could compute one. */
  estimatedGas: string | null;
}

interface BuildOpts {
  chainId: number;
  to: string;
  abi: readonly string[];
  fnName: string;
  args: unknown[];
  /** Caller's address — used only for gas estimation, NOT included in calldata. */
  from?: string;
  value?: string;
  /** Pretty-printed view of args for the response payload. */
  prettyArgs?: Record<string, string | number | boolean | null>;
}

/**
 * Encode + (best-effort) estimate gas for a call against the configured chain.
 * Gas estimation is wrapped in a try/catch — many calls revert without
 * pre-approvals or other state, so failing to estimate doesn't fail the
 * build. We just return `estimatedGas: null` and let the integrator decide.
 */
export async function buildCall(opts: BuildOpts): Promise<BuiltTx> {
  // Validate chainId up-front so even calldata-only paths (no RPC touch)
  // reject unsupported chains with a clean 400 instead of silently building
  // bytes the caller can't broadcast anywhere.
  getChain(opts.chainId);

  const iface = new ethers.Interface(opts.abi as string[]);
  const data = iface.encodeFunctionData(opts.fnName, opts.args);

  let estimatedGas: string | null = null;
  if (opts.from) {
    try {
      const provider = providerFor(opts.chainId);
      const gas = await provider.estimateGas({
        from: opts.from,
        to: opts.to,
        data,
        value: opts.value ? BigInt(opts.value) : 0n,
      });
      estimatedGas = gas.toString();
    } catch {
      // Reverts because of missing approvals etc. are expected — skip silently.
    }
  }

  return {
    chainId: opts.chainId,
    to: opts.to,
    data,
    value: opts.value ?? "0",
    function: opts.fnName,
    args: opts.prettyArgs ?? {},
    estimatedGas,
  };
}

/**
 * Convenience: build an ERC-20 approve. Used by every action that pulls
 * tokens (createEvent, deposit, buyProtection). The caller still needs to
 * sign + broadcast — we just hand them the calldata.
 */
export async function buildErc20Approve(opts: {
  chainId: number;
  token: string;
  spender: string;
  amount: string;     // decimal-string in token's smallest unit
  from?: string;
}): Promise<BuiltTx> {
  const ERC20 = ["function approve(address spender, uint256 amount) returns (bool)"];
  return buildCall({
    chainId: opts.chainId,
    to: opts.token,
    abi: ERC20,
    fnName: "approve",
    args: [opts.spender, opts.amount],
    from: opts.from,
    prettyArgs: { spender: opts.spender, amount: opts.amount },
  });
}

/** Helper to call into the Diamond on a given chain. */
export async function buildDiamondCall(opts: Omit<BuildOpts, "to"> & { chainId: number }): Promise<BuiltTx> {
  const diamond = getChain(opts.chainId).diamond;
  return buildCall({ ...opts, to: diamond });
}
