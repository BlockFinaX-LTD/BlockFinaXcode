/**
 * Organisation accounts on Stellar: deploying them, preparing changes to who controls
 * them, and reading back what the chain says.
 *
 * The server never signs for an organisation. It deploys the account (the platform fee
 * payer pays), and it prepares unsigned transactions that an admin's passkey approves in
 * the browser. Confirmation always reads the chain, never trusts the client.
 */
import { createHash } from "node:crypto";
import { Keypair, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { Client as AccountClient } from "smart-account-kit-bindings";
import type { ChainStep, OrganisationRuleIds } from "@shared/organisations";
import {
  bindingsContext, OZ_ACCEPTED_ACCOUNT_WASM_HASHES, policyParams, thresholdParams,
  type ContractSigner, type SmartAccountChainConfig,
} from "@shared/smart-accounts";
import { signersEqual } from "@shared/vendor/oz-auth-payload";

export interface OrganisationChain {
  rpcUrl: string;
  networkPassphrase: string;
  smartAccounts: SmartAccountChainConfig;
  /** The platform fee payer's public key: the source of prepared transactions. */
  sponsorPublicKey: string;
}

/** The most the fee payer spends deploying one organisation account (30 XLM, as for personal wallets). */
const MAX_DEPLOY_FEE_STROOPS = BigInt(300_000_000);

function accountClient(chain: OrganisationChain, account: string) {
  return new AccountClient({
    contractId: account, rpcUrl: chain.rpcUrl, networkPassphrase: chain.networkPassphrase, publicKey: chain.sponsorPublicKey,
  });
}

/** A fixed salt per organisation, so a retried deployment lands on the same address. */
export function organisationSalt(networkPassphrase: string, organisationId: number): Buffer {
  return createHash("sha256").update(`blockfinax-organisation:${networkPassphrase}:${organisationId}`).digest();
}

/**
 * Deploy an organisation account with its creator as the only admin.
 * Rule 0 (Default) gets the creator's passkey and a threshold policy of 1.
 */
export async function deployOrganisationAccount(input: {
  chain: OrganisationChain;
  feePayerSecret: string;
  organisationId: number;
  admin: ContractSigner;
}): Promise<{ contract: string; hash: string }> {
  const { chain } = input;
  const payer = Keypair.fromSecret(input.feePayerSecret);
  if (payer.publicKey() !== chain.sponsorPublicKey) throw new Error("Fee payer does not match the sponsor key");
  const server = new rpc.Server(chain.rpcUrl);
  const tx = await AccountClient.deploy(
    { signers: [input.admin as never], policies: new Map([[chain.smartAccounts.thresholdPolicy, thresholdParams(1)]]) },
    {
      rpcUrl: chain.rpcUrl, networkPassphrase: chain.networkPassphrase, publicKey: payer.publicKey(),
      wasmHash: chain.smartAccounts.accountWasmHash, salt: organisationSalt(chain.networkPassphrase, input.organisationId), timeoutInSeconds: 60,
    },
  );
  if (!tx.built) throw new Error("The organisation account deployment was not assembled");
  if (BigInt(tx.built.fee) > MAX_DEPLOY_FEE_STROOPS) throw new Error("Deploying the organisation account costs more than the sponsorship cap");
  tx.built.sign(payer);
  const sent = await server.sendTransaction(tx.built);
  if (sent.status === "ERROR") throw new Error("Stellar rejected the organisation account deployment");
  const done = await waitFor(server, sent.hash);
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error("The organisation account deployment failed");
  return { contract: (tx.result as unknown as { options: { contractId: string } }).options.contractId, hash: sent.hash };
}

export async function waitFor(server: rpc.Server, hash: string, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const found = await server.getTransaction(hash);
    if (found.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) return found;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Transaction still pending: ${hash}`);
}

/** The on-chain id the account gave a signer, or null when it is not registered. */
export async function signerId(chain: OrganisationChain, account: string, signer: ContractSigner): Promise<number | null> {
  try {
    const r = await (accountClient(chain, account) as unknown as {
      get_signer_id: (a: { signer: ContractSigner }) => Promise<{ result: unknown }>;
    }).get_signer_id({ signer });
    const v = unwrapResult(r.result);
    return v === null || v === undefined ? null : Number(v);
  } catch {
    return null;
  }
}

function unwrapResult(v: unknown): unknown {
  if (v && typeof v === "object" && "isOk" in (v as object)) {
    const r = v as { isOk(): boolean; unwrap(): unknown };
    return r.isOk() ? r.unwrap() : null;
  }
  return v;
}

/** A rule as the chain holds it, or null if it does not exist. */
export async function readRule(chain: OrganisationChain, account: string, ruleId: number) {
  try {
    const r = await accountClient(chain, account).get_context_rule({ context_rule_id: ruleId });
    return unwrapResult(r.result) as { id: number; name: string; signers: ContractSigner[]; policies: string[] } | null;
  } catch {
    return null;
  }
}

/** Whether a signer is on a rule right now. */
export async function ruleHasSigner(chain: OrganisationChain, account: string, ruleId: number, signer: ContractSigner) {
  const rule = await readRule(chain, account, ruleId);
  return Boolean(rule?.signers.some((s) => signersEqual(s as ContractSigner, signer)));
}

/** The account's code fingerprint, read from the chain. */
export async function accountWasmHash(chain: OrganisationChain, account: string): Promise<string | null> {
  const server = new rpc.Server(chain.rpcUrl);
  try {
    const wasm = await server.getContractWasmByContractId(account);
    return createHash("sha256").update(wasm).digest("hex");
  } catch {
    return null;
  }
}

export function isTrustedAccountCode(hash: string | null) {
  return Boolean(hash && OZ_ACCEPTED_ACCOUNT_WASM_HASHES.includes(hash));
}

/**
 * Prepare one planned step as an unsigned transaction on the organisation account, with
 * the sponsor as source. `signerFor` turns a member's credential id into their passkey
 * signer. Returns the transaction XDR for an admin to approve.
 */
export async function prepareStep(
  chain: OrganisationChain,
  account: string,
  ruleIds: OrganisationRuleIds,
  step: ChainStep,
  signerFor: (credentialId: string) => ContractSigner,
): Promise<string> {
  const c = accountClient(chain, account);
  const ruleId = (rule: keyof OrganisationRuleIds) => {
    const id = ruleIds[rule];
    if (id === null || id === undefined) throw new Error(`The ${rule} rule does not exist yet`);
    return id;
  };
  switch (step.op) {
    case "add_signer":
      return (await c.add_signer({ context_rule_id: ruleId(step.rule), signer: signerFor(step.credentialId) as never })).toXDR();
    case "remove_signer": {
      const id = await signerId(chain, account, signerFor(step.credentialId));
      if (id === null) throw new Error("That passkey is not on the account");
      return (await c.remove_signer({ context_rule_id: ruleId(step.rule), signer_id: id })).toXDR();
    }
    case "add_context_rule": {
      if (step.policies.some((p) => p.kind === "transferAllowlist" && !p.policy)) {
        throw new Error("Operators need the transfer allow-list policy, which is not deployed on this network yet");
      }
      return (await c.add_context_rule({
        context_type: bindingsContext(step.context) as never,
        name: step.name,
        valid_until: undefined,
        signers: step.credentialIds.map(signerFor) as never,
        policies: new Map(step.policies.map((p) => [p.policy, policyParams(p)])),
      })).toXDR();
    }
    case "remove_context_rule":
      return (await c.remove_context_rule({ context_rule_id: ruleId(step.rule) })).toXDR();
    case "set_threshold":
      throw new Error("Changing how many admins must approve is not available yet");
  }
}

/** What a confirmed account change returned: the new rule's id, or a new signer's id. */
export async function confirmedReturn(chain: OrganisationChain, hash: string): Promise<{ ok: boolean; value: unknown }> {
  const server = new rpc.Server(chain.rpcUrl);
  const tx = await waitFor(server, hash);
  if (tx.status !== rpc.Api.GetTransactionStatus.SUCCESS) return { ok: false, value: null };
  const rv = (tx as rpc.Api.GetSuccessfulTransactionResponse).returnValue as xdr.ScVal | undefined;
  return { ok: true, value: rv ? scValToNative(rv) : null };
}
