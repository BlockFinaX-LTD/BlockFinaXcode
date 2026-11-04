/**
 * The production gateway: organisation accounts on the Stellar chain from config, the
 * platform fee payer for deployment, and passkeys from the wallet tables.
 */
import { Keypair } from "@stellar/stellar-sdk";
import { and, asc, eq } from "drizzle-orm";
import type { ChainConfig } from "@shared/chains/registry";
import type { ChainStep, OrganisationRuleIds } from "@shared/organisations";
import { organisationContracts, passkeySigner, uncompressedKey, type ContractSigner } from "@shared/smart-accounts";
import { userAccounts } from "@shared/auth-core-schema";
import { walletPasskeys } from "@shared/chain-wallet-schema";
import { chainRegistry } from "../chain/config";
import {
  accountWasmHash, confirmedReturn, deployOrganisationAccount, isTrustedAccountCode, prepareStep, readRule, ruleHasSigner,
  type OrganisationChain,
} from "./chain";
import type { OrganisationGateway, PasskeyLookup } from "./service";

/** The Stellar chain organisations run on, or null when this deployment does not offer them. */
export function organisationChainConfig(): ChainConfig | null {
  const registry = chainRegistry();
  return registry?.all().find((c) => c.family === "stellar" && c.state !== "DISABLED" && c.smartAccounts && c.contracts.currencyPool) ?? null;
}

export function stellarGateway(env: NodeJS.ProcessEnv = process.env): OrganisationGateway | null {
  const chain = organisationChainConfig();
  const secret = env.STELLAR_FEE_PAYER_SECRET;
  if (!chain?.smartAccounts || !secret || !chain.assets.USDC) return null;
  const sa = chain.smartAccounts;
  const net: OrganisationChain = {
    rpcUrl: chain.rpcUrls[0], networkPassphrase: chain.networkId, smartAccounts: sa, sponsorPublicKey: Keypair.fromSecret(secret).publicKey(),
  };
  const contracts = organisationContracts({
    currencyPool: chain.contracts.currencyPool!, ratePool: env.STELLAR_RATE_POOL_CONTRACT || null, usdc: chain.assets.USDC.addressOrContract, smartAccounts: sa,
  });

  return {
    networkKey: chain.key,
    contracts: () => contracts,
    signerFor: (p) => passkeySigner(sa.webauthnVerifier, p.publicKey, p.credentialId),

    async deploy(organisationId, admin) {
      const { contract } = await deployOrganisationAccount({ chain: net, feePayerSecret: secret, organisationId, admin });
      const wasm = await accountWasmHash(net, contract);
      if (!isTrustedAccountCode(wasm)) throw new Error("The new account is not running the expected code");
      if (!(await ruleHasSigner(net, contract, 0, admin))) throw new Error("The new account's admin is not the creator's passkey");
      return { contract, wasmHash: wasm! };
    },

    prepare: (account, ruleIds, step, signerFor) => prepareStep(net, account, ruleIds, step, signerFor),

    /** Confirm from chain state. The hash only tells us when to look (and a new rule's id). */
    async confirm(account: string, ruleIds: OrganisationRuleIds, step: ChainStep, hash: string, signerFor: (id: string) => ContractSigner) {
      let returned: unknown = null;
      try {
        const r = await confirmedReturn(net, hash);
        if (!r.ok) return { ok: false, reason: "That transaction failed on chain" };
        returned = r.value;
      } catch {
        // Not found yet: fall through and check state, which is the real test.
      }
      switch (step.op) {
        case "add_signer":
          return { ok: await ruleHasSigner(net, account, ruleIds[step.rule]!, signerFor(step.credentialId)) };
        case "remove_signer":
          return { ok: !(await ruleHasSigner(net, account, ruleIds[step.rule]!, signerFor(step.credentialId))) };
        case "add_context_rule": {
          const id = Number((returned as { id?: unknown } | null)?.id);
          if (!Number.isInteger(id)) return { ok: false, reason: "The new rule has not appeared yet" };
          const rule = await readRule(net, account, id);
          const signers = step.credentialIds.map(signerFor);
          const matches = rule?.name === step.name && signers.every((s) => rule.signers.some((x) => sameSigner(x, s)));
          return matches ? { ok: true, ruleId: id } : { ok: false, reason: "The rule on chain does not match this change" };
        }
        case "remove_context_rule":
          return { ok: (await readRule(net, account, ruleIds[step.rule]!)) === null };
        case "set_threshold":
          return { ok: false, reason: "Not supported yet" };
      }
    },
  };
}

function sameSigner(a: ContractSigner, b: ContractSigner) {
  return a.tag === b.tag && a.values[0] === b.values[0]
    && (a.tag === "Delegated" || Buffer.from(a.values[1] as Buffer).equals(Buffer.from(b.values[1] as Buffer)));
}

/** Passkeys and emails from the wallet tables. The primary passkey is the one a member signs with. */
export function databasePasskeys(): PasskeyLookup {
  return {
    async passkeyOf(userId) {
      const { db } = await import("../db");
      const [row] = await db.select().from(walletPasskeys)
        .where(and(eq(walletPasskeys.userId, userId), eq(walletPasskeys.status, "active"), eq(walletPasskeys.role, "primary")))
        .orderBy(asc(walletPasskeys.id)).limit(1);
      return row ? { credentialId: row.credentialId, publicKey: uncompressedKey(row.x, row.y) } : null;
    },
    async emailOf(userId) {
      const { db } = await import("../db");
      const [row] = await db.select({ email: userAccounts.email }).from(userAccounts).where(eq(userAccounts.id, userId));
      return row?.email ?? null;
    },
  };
}
