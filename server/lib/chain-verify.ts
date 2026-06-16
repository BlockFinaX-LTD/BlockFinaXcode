/**
 * chain-verify.ts — server-side proof that an on-chain hedge action really
 * happened, sent by the claiming wallet, against the Cover Diamond.
 *
 * Used to gate Earn "on-chain" tasks so they can't be spoofed by POSTing a
 * fake activity row. We confirm: the tx receipt exists and succeeded, the
 * sender is the wallet, the tx hit the Cover Diamond, and (for the three
 * reward-bearing actions) the matching event topic was emitted.
 */
import { ethers } from 'ethers';

interface ChainCfg { rpc: string; diamond: string; }

const CHAINS: Record<number, ChainCfg> = {
  8453: {
    rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    diamond: (process.env.BASE_DIAMOND_ADDRESS || '0xbCC51E62C4948FD35ab505bd71804C849601e4Ef').toLowerCase(),
  },
  56: {
    rpc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
    diamond: (process.env.BSC_DIAMOND_ADDRESS || '0xaC939C0897981Abc0711ec4e37527F13106180fc').toLowerCase(),
  },
};

// topic0 of the events the Diamond emits for each reward-bearing action.
const ACTION_TOPIC: Record<string, string> = {
  buy_protection: '0x4481909ec72817de979b2b76609a83284e6faacdfa26174543ad38431274eed5',
  lp_deposit: '0xbff736a88c4d6fc1bc430cb94a5d36706a0d4b369de04ea80fc121296def3cb2',
  create_event: '0x971a52d02f8b95a7a75a0f42d1fb5ab027b59b71c15f1f6095e5323ddd308736',
};

const providers = new Map<number, ethers.JsonRpcProvider>();
function providerFor(chainId: number): ethers.JsonRpcProvider | null {
  const cfg = CHAINS[chainId];
  if (!cfg) return null;
  let p = providers.get(chainId);
  if (!p) { p = new ethers.JsonRpcProvider(cfg.rpc); providers.set(chainId, p); }
  return p;
}

export interface VerifyResult { ok: boolean; reason?: string }

/**
 * Verify a hedge tx for the given action and expected sender. Returns ok=true
 * only when the on-chain receipt proves it. Network/RPC failures return ok=false
 * with a reason so the caller can decide (we never award on an unverified tx).
 */
export async function verifyHedgeTx(
  chainId: number,
  txHash: string,
  expectedFrom: string,
  actionType: string,
): Promise<VerifyResult> {
  const cfg = CHAINS[chainId];
  if (!cfg) return { ok: false, reason: `Unsupported chain ${chainId}` };
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) return { ok: false, reason: 'Malformed tx hash' };
  const provider = providerFor(chainId);
  if (!provider) return { ok: false, reason: 'No RPC for chain' };

  let receipt: ethers.TransactionReceipt | null;
  try {
    receipt = await provider.getTransactionReceipt(txHash);
  } catch (e: any) {
    return { ok: false, reason: `RPC error: ${e?.message || e}` };
  }
  if (!receipt) return { ok: false, reason: 'Transaction not found on-chain yet' };
  if (receipt.status !== 1) return { ok: false, reason: 'Transaction reverted on-chain' };

  if (receipt.from?.toLowerCase() !== expectedFrom.toLowerCase()) {
    return { ok: false, reason: 'Transaction was not sent by your wallet' };
  }
  if ((receipt.to || '').toLowerCase() !== cfg.diamond) {
    return { ok: false, reason: 'Transaction did not interact with the Cover contract' };
  }

  // For the three reward-bearing actions, require the matching event topic so a
  // user can't pass off (say) a withdraw as a buy.
  const wantTopic = ACTION_TOPIC[actionType];
  if (wantTopic) {
    const emitted = receipt.logs.some(
      (l) => (l.address || '').toLowerCase() === cfg.diamond && l.topics?.[0]?.toLowerCase() === wantTopic,
    );
    if (!emitted) return { ok: false, reason: 'Transaction is not a ' + actionType + ' action' };
  }
  return { ok: true };
}

/** Actions whose points we gate behind an on-chain proof. */
export const VERIFIABLE_ACTIONS = new Set(Object.keys(ACTION_TOPIC));
