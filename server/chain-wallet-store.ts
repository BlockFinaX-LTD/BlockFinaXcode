import { and, eq } from "drizzle-orm";
import {
  authIdentityLinks,
  chainTransactions,
  chainWalletAccounts,
  type NewAuthIdentityLink,
  type NewChainTransaction,
} from "@shared/schema";
import { db } from "./db";

const NETWORK_KEY = {
  eip155: /^eip155:[1-9][0-9]*$/,
  stellar: /^stellar:(?:pubnet|testnet|futurenet|local|[a-z0-9-]+)$/,
} as const;

export class ChainWalletConflictError extends Error {
  constructor() {
    super("This wallet account is already linked to a different platform user");
    this.name = "ChainWalletConflictError";
  }
}

function normalizeAddress(chainNamespace: "eip155" | "stellar", address: string) {
  const value = address.trim();
  if (chainNamespace === "eip155") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("Invalid EVM wallet address");
    return value.toLowerCase();
  }
  if (!/^[GC][A-Z2-7]{55}$/.test(value)) throw new Error("Invalid Stellar account or contract address");
  return value;
}

export async function linkChainWallet(input: {
  userId: number;
  chainNamespace: "eip155" | "stellar";
  networkKey: string;
  address: string;
  walletProvider: string;
  accountType: string;
  displayName?: string | null;
}) {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
    throw new Error("A valid platform user is required");
  }
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(input.walletProvider)) {
    throw new Error("Invalid wallet provider identifier");
  }
  if (!["eoa", "smart_account", "soroban_contract", "external"].includes(input.accountType)) {
    throw new Error("Invalid wallet account type");
  }
  if (!NETWORK_KEY[input.chainNamespace].test(input.networkKey)) {
    throw new Error(`Network key does not match chain namespace: ${input.networkKey}`);
  }
  const addressCanonical = normalizeAddress(input.chainNamespace, input.address);
  const [created] = await db
    .insert(chainWalletAccounts)
    .values({ ...input, addressCanonical })
    .onConflictDoNothing({
      target: [
        chainWalletAccounts.chainNamespace,
        chainWalletAccounts.networkKey,
        chainWalletAccounts.addressCanonical,
      ],
    })
    .returning();
  if (created) return created;

  const [existing] = await db
    .select()
    .from(chainWalletAccounts)
    .where(and(
      eq(chainWalletAccounts.chainNamespace, input.chainNamespace),
      eq(chainWalletAccounts.networkKey, input.networkKey),
      eq(chainWalletAccounts.addressCanonical, addressCanonical),
    ))
    .limit(1);
  if (!existing || existing.userId !== input.userId) throw new ChainWalletConflictError();
  return existing;
}

export async function listChainWalletsForUser(userId: number) {
  return db
    .select()
    .from(chainWalletAccounts)
    .where(eq(chainWalletAccounts.userId, userId))
    .orderBy(chainWalletAccounts.createdAt);
}

export async function linkAuthIdentity(input: NewAuthIdentityLink) {
  const [created] = await db
    .insert(authIdentityLinks)
    .values(input)
    .onConflictDoNothing({
      target: [authIdentityLinks.provider, authIdentityLinks.providerSubject],
    })
    .returning();
  if (created) return created;

  const [existing] = await db
    .select()
    .from(authIdentityLinks)
    .where(and(
      eq(authIdentityLinks.provider, input.provider),
      eq(authIdentityLinks.providerSubject, input.providerSubject),
    ))
    .limit(1);
  if (!existing || existing.userId !== input.userId) {
    throw new Error("This external identity is already linked to a different platform user");
  }
  return existing;
}

export async function createChainTransaction(input: NewChainTransaction) {
  if (input.chainNamespace !== "eip155" && input.chainNamespace !== "stellar") {
    throw new Error("Unsupported chain namespace");
  }
  if (!input.idempotencyKey?.trim()) throw new Error("A chain transaction requires an idempotency key");
  if (input.idempotencyKey.length > 128) throw new Error("Idempotency key exceeds 128 characters");
  if (!NETWORK_KEY[input.chainNamespace].test(input.networkKey)) {
    throw new Error(`Network key does not match chain namespace: ${input.networkKey}`);
  }
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(input.operation)) {
    throw new Error("Invalid chain transaction operation");
  }
  if (!["created", "submitted", "pending", "confirmed", "failed", "cancelled"].includes(input.status)) {
    throw new Error("Invalid chain transaction status");
  }
  const [wallet] = await db
    .select({ id: chainWalletAccounts.id })
    .from(chainWalletAccounts)
    .where(and(
      eq(chainWalletAccounts.id, input.walletAccountId),
      eq(chainWalletAccounts.userId, input.userId),
      eq(chainWalletAccounts.chainNamespace, input.chainNamespace),
      eq(chainWalletAccounts.networkKey, input.networkKey),
    ))
    .limit(1);
  if (!wallet) throw new Error("Transaction wallet does not belong to this user and chain network");

  const [created] = await db
    .insert(chainTransactions)
    .values(input)
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [existing] = await db
    .select()
    .from(chainTransactions)
    .where(and(
      eq(chainTransactions.chainNamespace, input.chainNamespace),
      eq(chainTransactions.networkKey, input.networkKey),
      eq(chainTransactions.idempotencyKey, input.idempotencyKey),
    ))
    .limit(1);
  if (!existing || existing.userId !== input.userId || existing.walletAccountId !== input.walletAccountId) {
    throw new Error("Chain transaction conflicts with an existing network record");
  }
  return existing;
}
