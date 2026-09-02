/**
 * predict-api.ts — talking to the prediction market.
 *
 * Every route that moves money is signed, because the server takes the acting
 * account from the signature and never from the body. That is the whole reason
 * a request cannot spend someone else's balance by naming their address.
 *
 * Reads are unsigned: a prediction market's prices are meant to be public.
 */
import { walletManager } from "./wallet";
import { createSignedHeaders } from "./api-signer";

export interface PredictAccount {
  account: string;
  balance: number;
  depositAddress: string | null;
  minWithdrawal: number;
  entries: Array<{ id: number; kind: string; amount: string; txHash: string | null; createdAt: string }>;
  withdrawals: Array<{ id: number; amount: string; status: string; txHash: string | null }>;
}

async function signed(method: "GET" | "POST", path: string, body: Record<string, any> | null, chainId: number) {
  const signer = await walletManager.getSigner(chainId);
  if (!signer) throw new Error("Unlock your wallet first.");
  const headers = await createSignedHeaders(method, path, body, signer.privateKey, signer.address);
  const res = await fetch(path, {
    method,
    headers: { ...headers } as Record<string, string>,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed.");
  return json;
}

export const predictApi = {
  markets: async () => (await fetch("/api/predict/markets").then((r) => r.json())).markets ?? [],

  quote: async (marketId: number, side: "yes" | "no", stake: number, signal?: AbortSignal) => {
    const r = await fetch("/api/predict/quote", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketId, side, stake }), signal,
    });
    if (!r.ok) throw new Error("quote failed");
    return r.json();
  },

  account: (chainId: number): Promise<PredictAccount> =>
    signed("GET", "/api/predict/account", null, chainId),

  stake: (chainId: number, marketId: number, side: "yes" | "no", stake: number) =>
    signed("POST", "/api/predict/stake", { marketId, side, stake }, chainId),

  /**
   * Credit a deposit from its transaction hash.
   *
   * The hash is all that is sent. Amount, token, sender and recipient are read
   * from the chain by the server, so nothing here can inflate a deposit.
   */
  deposit: (chainId: number, txHash: string) =>
    signed("POST", "/api/predict/deposit", { txHash }, chainId),

  withdraw: (chainId: number, amount: number) =>
    signed("POST", "/api/predict/withdraw", { amount }, chainId),
};
