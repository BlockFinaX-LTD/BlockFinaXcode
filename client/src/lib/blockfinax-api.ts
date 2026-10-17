/**
 * Typed client for /api/v2 (Architecture v2.0). Screens call this and a WalletSession;
 * they never call contracts, convert token units or read chain errors.
 */
import type {
  BusinessEvent,
  CurrencyPool,
  ProtectionPosition,
  ProtectionQuote,
  ProtectionRequest,
  RoutingQuote,
  SettlementResult,
  TransactionStatus,
} from "@shared/domain/types";
import type { PreparedTransaction } from "./wallet-provider";

/** The only error the UI handles: a shared code plus a readable message. */
export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error?.code ?? "UNKNOWN", body?.error?.message ?? "Request failed", res.status);
  return body as T;
}

const ref = (r: string) => encodeURIComponent(r);

export interface ChainInfo {
  key: string;
  family: "evm" | "stellar";
  name: string;
  explorer: string;
  state: "ACTIVE" | "DRAINING" | "ACCESS_ONLY" | "DISABLED";
  capabilities: Record<string, boolean>;
  assets: { symbol: string; decimals: number }[];
}

export const blockfinaxApi = {
  chains: () => call<{ environment: string; activeLiquidityHub: string; chains: ChainInfo[] }>("/api/v2/chains"),
  pools: (chain?: string) => call<{ pools: CurrencyPool[] }>(`/api/v2/pools${chain ? `?chain=${encodeURIComponent(chain)}` : ""}`),
  pool: (poolRef: string) => call<CurrencyPool>(`/api/v2/pools/${ref(poolRef)}`),
  options: (pair: string) => call<{ pair: string; tenors: { tenorDays: number; open: boolean; capped: boolean; maxPayoutAvailable: string }[] }>(`/api/v2/options?pair=${encodeURIComponent(pair)}`),
  quote: (req: ProtectionRequest) => call<ProtectionQuote>("/api/v2/quotes", { body: req }),
  prepareHedge: (quote: ProtectionQuote) => call<{ transactions: PreparedTransaction[] }>("/api/v2/hedges/prepare", { body: { quote } }),
  hedges: () => call<{ hedges: { position: ProtectionPosition; settlement: SettlementResult }[] }>("/api/v2/hedges"),
  hedge: (positionRef: string) => call<{ position: ProtectionPosition; settlement: SettlementResult }>(`/api/v2/hedges/${ref(positionRef)}`),
  prepareClaim: (positionRef: string) => call<{ transactions: PreparedTransaction[] }>(`/api/v2/hedges/${ref(positionRef)}/claim/prepare`, { method: "POST" }),
  prepareCreatePool: (input: unknown) => call<{ chain: string; transactions: PreparedTransaction[] }>("/api/v2/pools/prepare", { body: input }),
  prepareSetTenor: (poolRef: string, tenor: { tenorDays: number; active: boolean; markupBps: number }) =>
    call<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${ref(poolRef)}/tenors/prepare`, { body: tenor }),
  prepareDeposit: (poolRef: string, amount: string) => call<{ transactions: PreparedTransaction[] }>(`/api/v2/pools/${ref(poolRef)}/deposits/prepare`, { body: { amount } }),
  accounts: () => call<{ accounts: { chain: string; address: string; walletProvider: string; isPrimary: boolean }[]; provisioning: { required: string[]; missing: string[] } }>("/api/v2/accounts"),
  linkAccount: (a: { chain: string; address: string; walletProvider: string; accountType: string }) => call("/api/v2/accounts", { body: a }),
  balances: () => call<{ balances: { chain: string; symbol: string; amount: string | null }[] }>("/api/v2/balances"),
  routingQuote: (r: { kind: "fund" | "withdraw"; network: string; amount: string; symbol?: string }) =>
    call<{ quotes: { quote: RoutingQuote; score: number }[] }>("/api/v2/routing/quote", { body: r }),
  transaction: (chain: string, hash: string) => call<TransactionStatus>(`/api/v2/transactions/${encodeURIComponent(chain)}/${encodeURIComponent(hash)}`),
  relay: (chain: string, xdr: string) => call<TransactionStatus>("/api/v2/transactions/relay", { body: { chain, xdr } }),
};

/** Confirmation watcher for WalletSession: polls the API until the transaction settles. */
export async function watchTransaction(chain: string, hash: string, timeoutMs = 120_000): Promise<"CONFIRMED" | "FAILED"> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const s = await blockfinaxApi.transaction(chain, hash).catch(() => null);
    if (s?.state === "CONFIRMED" || s?.state === "FAILED") return s.state;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return "FAILED";
}

export type { BusinessEvent };
