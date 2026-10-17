/**
 * One BlockFinaX user, many chain accounts (Architecture v2.0, docs/architecture/v2/wallet-v2.0.md).
 *
 * The BlockFinaX account is the identity; chain addresses are its children, stored in
 * `chain_wallet_accounts` (shared/chain-wallet-schema.ts). Keys are never held here: a
 * wallet provider in the browser creates or connects the account and the server links
 * it, after checking the address is valid for that chain family.
 *
 * Signup provisions on the registry's `provisionAtSignup` networks; any other network is
 * added lazily the first time the user needs it (to fund from it, withdraw to it, or
 * hedge on it after a hub migration).
 */
import { StrKey } from "@stellar/stellar-sdk";
import { ethers } from "ethers";
import type { ChainRegistry } from "@shared/chains/registry";
import { ApplicationError, type ChainKey } from "@shared/domain/types";

export interface LinkedAccount {
  userId: number;
  chain: ChainKey;
  address: string;
  walletProvider: string;
  accountType: "eoa" | "smart_account" | "soroban_contract" | "external";
  isPrimary: boolean;
}

export interface AccountRepository {
  list(userId: number): Promise<LinkedAccount[]>;
  insert(account: LinkedAccount): Promise<void>;
  findByAddress(chain: ChainKey, address: string): Promise<LinkedAccount | undefined>;
}

export class AccountService {
  constructor(private readonly chains: ChainRegistry, private readonly repo: AccountRepository) {}

  /** Networks the user must have an account on after signup, and which are still missing. */
  async provisioningPlan(userId: number) {
    const have = new Set((await this.repo.list(userId)).map((a) => a.chain));
    const required = this.chains.all().filter((c) => c.provisionAtSignup && c.state !== "DISABLED").map((c) => c.key);
    return { required, missing: required.filter((k) => !have.has(k)) };
  }

  async accounts(userId: number): Promise<LinkedAccount[]> {
    return this.repo.list(userId);
  }

  /** The user's address on each chain, for quotes and routing. */
  async addressBook(userId: number): Promise<Record<ChainKey, string>> {
    const out: Record<ChainKey, string> = {};
    for (const a of await this.repo.list(userId)) if (!out[a.chain] || a.isPrimary) out[a.chain] = a.address;
    return out;
  }

  /** Link an account a wallet provider created or connected. Idempotent for the same user. */
  async link(userId: number, input: Omit<LinkedAccount, "userId" | "isPrimary">): Promise<LinkedAccount> {
    const chain = this.chains.get(input.chain);
    if (chain.state === "DISABLED") throw new ApplicationError("CHAIN_NOT_ENABLED", `${chain.name} is disabled`);
    const address = canonical(chain.family, input.address);
    const existing = await this.repo.findByAddress(chain.key, address);
    if (existing && existing.userId !== userId) throw new ApplicationError("UNAUTHORIZED", "That address belongs to another BlockFinaX account");
    if (existing) return existing;
    const isPrimary = !(await this.repo.list(userId)).some((a) => a.chain === chain.key);
    const account: LinkedAccount = { ...input, chain: chain.key, address, userId, isPrimary };
    await this.repo.insert(account);
    return account;
  }
}

/** Address validity and canonical form per chain family. */
export function canonical(family: "evm" | "stellar", address: string): string {
  if (family === "evm") {
    if (!ethers.isAddress(address)) throw new ApplicationError("INVALID_REQUEST", "Not a valid EVM address");
    return ethers.getAddress(address);
  }
  if (!StrKey.isValidEd25519PublicKey(address) && !StrKey.isValidContract(address)) {
    throw new ApplicationError("INVALID_REQUEST", "Not a valid Stellar G or C address");
  }
  return address;
}

export class InMemoryAccountRepository implements AccountRepository {
  rows: LinkedAccount[] = [];
  async list(userId: number) { return this.rows.filter((r) => r.userId === userId); }
  async insert(a: LinkedAccount) { this.rows.push(a); }
  async findByAddress(chain: ChainKey, address: string) { return this.rows.find((r) => r.chain === chain && r.address === address); }
}

/** Postgres repository over chain_wallet_accounts. */
export async function drizzleAccountRepository(chains: ChainRegistry): Promise<AccountRepository> {
  const { db } = await import("../db");
  const { chainWalletAccounts } = await import("@shared/chain-wallet-schema");
  const { and, eq } = await import("drizzle-orm");
  const familyOf = (chain: ChainKey) => (chains.get(chain).family === "evm" ? "eip155" : "stellar");
  const toLinked = (r: typeof chainWalletAccounts.$inferSelect): LinkedAccount => ({
    userId: r.userId, chain: r.networkKey, address: r.address, walletProvider: r.walletProvider,
    accountType: r.accountType as LinkedAccount["accountType"], isPrimary: r.isPrimary,
  });
  return {
    async list(userId) {
      return (await db.select().from(chainWalletAccounts).where(and(eq(chainWalletAccounts.userId, userId), eq(chainWalletAccounts.status, "active")))).map(toLinked);
    },
    async insert(a) {
      await db.insert(chainWalletAccounts).values({
        userId: a.userId, chainNamespace: familyOf(a.chain), networkKey: a.chain, address: a.address, addressCanonical: a.address,
        walletProvider: a.walletProvider, accountType: a.accountType, isPrimary: a.isPrimary,
      });
    },
    async findByAddress(chain, address) {
      const [r] = await db.select().from(chainWalletAccounts)
        .where(and(eq(chainWalletAccounts.networkKey, chain), eq(chainWalletAccounts.addressCanonical, address))).limit(1);
      return r ? toLinked(r) : undefined;
    },
  };
}
