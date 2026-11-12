/**
 * Organisation (business) accounts in the browser.
 *
 * Signing: the member's own passkey approves for the organisation account. The digest it
 * signs commits to the account, the transaction and the context rules the member claims,
 * so the same passkey's approvals for a personal wallet and a business account can never
 * be swapped. Rule ids come from the member's role: admins claim the admins' rule,
 * operators claim the pool and USDC rules, viewers cannot sign.
 *
 * Trust: before showing an organisation as ready, the browser checks the chain itself: the
 * account runs the pinned OpenZeppelin code, and this member's passkey is on the rule their
 * role says. A compromised server could otherwise point a business at an account it controls.
 */
import { startAuthentication } from "@simplewebauthn/browser";
import { contextRuleIdsFor, type ChainStep, type OrganisationContracts, type OrganisationRole, type OrganisationRuleIds } from "@shared/organisations";
import {
  authContextTargets, authEntryAddress, fromBase64Url, OZ_ACCEPTED_ACCOUNT_WASM_HASHES, passkeySigner, passkeySignatureBytes, signOrganisationEntry, toBase64Url,
  type DigestSigner, type SmartAccountChainConfig,
} from "@shared/smart-accounts";
import { signersEqual } from "@shared/vendor/oz-auth-payload";
import { actingOrganisation, setActingOrganisation, type ActingOrganisation } from "./acting-organisation";
import { api, walletConfig } from "./wallets/passkey-wallet";

export interface OrganisationsConfig {
  available: boolean;
  chain: string | null;
  smartAccounts: SmartAccountChainConfig | null;
  contracts: OrganisationContracts | null;
  operatorsAvailable: boolean;
}
export interface OrganisationSummary {
  id: number; name: string; account: string | null; status: "deploying" | "active" | "failed";
  myRole: OrganisationRole; myStatus: string;
}
export interface MemberView {
  id: number; email: string; role: OrganisationRole; status: "invited" | "accepted" | "active" | "removing" | "removed"; userId: number | null;
  pending: { kind: "activate" | "remove" | "role"; role: OrganisationRole | null; stepsLeft: number } | null;
}
export interface OrganisationView {
  id: number; name: string; networkKey: string; account: string | null; status: OrganisationSummary["status"];
  adminApprovals: number; myRole: OrganisationRole; members: MemberView[];
  ruleIds: OrganisationRuleIds; accountWasmHash: string | null;
  me: { memberId: number; credentialId: string | null; publicKey: string | null };
}
interface PreparedStep { memberId: number; step: ChainStep; stepsLeft: number; xdr: string; account: string }
type StepResult = PreparedStep | { done: true; member: MemberView };

let configPromise: Promise<OrganisationsConfig> | null = null;
export const organisationsConfig = () => (configPromise ??= api<OrganisationsConfig>("/api/organisations/config"));

export const listOrganisations = async () => (await api<{ organisations: OrganisationSummary[] }>("/api/organisations")).organisations;
export const getOrganisation = (id: number) => api<OrganisationView>(`/api/organisations/${id}`);
export const createOrganisation = (name: string) => api<OrganisationView>("/api/organisations", { name });
export const retryDeploy = (id: number) => api<OrganisationView>(`/api/organisations/${id}/deploy`, {});
export const organisationHistory = async (id: number) =>
  (await api<{ events: Array<{ id: number; kind: string; detail: Record<string, unknown>; txHash: string | null; createdAt: string }> }>(`/api/organisations/${id}/history`)).events;
export const inviteMember = (id: number, email: string, role: OrganisationRole) =>
  api<{ member: MemberView; link: string; emailed: boolean }>(`/api/organisations/${id}/invites`, { email, role });
export const acceptInvitation = (token: string) => api<{ organisationId: number; status: string }>("/api/organisations/invites/accept", { token });
export const revokeInvitation = (id: number, memberId: number) => api(`/api/organisations/${id}/members/${memberId}/revoke`, {});

/** Act as an organisation (or pass null to act as yourself). */
export function actAs(org: OrganisationView | OrganisationSummary | null) {
  if (!org) return setActingOrganisation(null);
  if (!org.account || org.status !== "active") throw new Error("This organisation's account is not ready yet");
  const acting: ActingOrganisation = { id: org.id, name: org.name, account: org.account, role: org.myRole };
  setActingOrganisation(acting);
}

// ── Signing ──────────────────────────────────────────────────────────────────

/** The shared signing code uses Buffer, which browsers get from the polyfill. */
async function ensureBuffer() {
  const { Buffer } = await import("buffer");
  (globalThis as any).Buffer ??= Buffer;
  return Buffer;
}

/** This member's passkey as a signer for the organisation account. */
async function myPasskeySigner(view: OrganisationView, verifier: string): Promise<DigestSigner & { credentialId: string }> {
  const { me } = view;
  if (!me.credentialId || !me.publicKey) throw new Error("Your passkey is not linked to this organisation");
  const [cfg] = await Promise.all([walletConfig(), ensureBuffer()]);
  const publicKey = fromBase64Url(me.publicKey);
  const credentialId = me.credentialId;
  return {
    credentialId,
    signer: passkeySigner(verifier, publicKey, credentialId),
    async signAuthDigest(digest: Buffer) {
      const assertion = await startAuthentication({
        optionsJSON: {
          challenge: toBase64Url(digest),
          rpId: cfg.rpId,
          userVerification: "required",
          timeout: 60_000,
          allowCredentials: [{ id: credentialId, type: "public-key" }],
        },
      });
      return passkeySignatureBytes(assertion.response);
    },
  };
}

async function latestLedger(rpcUrl: string): Promise<number> {
  const { rpc } = await import("@stellar/stellar-sdk");
  return (await new rpc.Server(rpcUrl).getLatestLedger()).sequence;
}

/**
 * Sign every authorisation the organisation account gives in a prepared transaction.
 * Returns the transaction with the member's approvals, ready for the relay.
 */
export async function signForOrganisation(transactionXdr: string, organisationId: number): Promise<string> {
  await ensureBuffer();
  const [{ xdr }, view, config, wallet] = await Promise.all([
    import("@stellar/stellar-sdk"), getOrganisation(organisationId), organisationsConfig(), walletConfig(),
  ]);
  if (!config.smartAccounts || !config.contracts || !wallet.stellar) throw new Error("Business accounts are not available here");
  if (!view.account || !view.accountWasmHash) throw new Error("The organisation account is not ready yet");
  const signer = await myPasskeySigner(view, config.smartAccounts.webauthnVerifier);
  const expiration = (await latestLedger(wallet.stellar.rpcUrl)) + 60; // about five minutes

  const envelope = xdr.TransactionEnvelope.fromXDR(transactionXdr, "base64");
  const invoke = envelope.v1().tx().operations()[0].body().invokeHostFunctionOp();
  const signed = [];
  let ours = 0;
  for (const entry of invoke.auth()) {
    if (authEntryAddress(entry) !== view.account) { signed.push(entry); continue; }
    ours++;
    const contextRuleIds = contextRuleIdsFor(view.myRole, authContextTargets(entry), view.ruleIds, config.contracts);
    signed.push(await signOrganisationEntry(entry, view.account, signer, {
      networkPassphrase: wallet.stellar.networkPassphrase, accountWasmHash: view.accountWasmHash, contextRuleIds, expiration,
    }));
  }
  if (ours === 0) throw new Error("This transaction does not need the organisation's approval");
  invoke.auth(signed);
  return envelope.toXDR("base64");
}

/** Approve one prepared step and send it through the relay as the organisation. */
async function approveStep(organisationId: number, step: PreparedStep): Promise<string> {
  const wallet = await walletConfig();
  if (!wallet.stellar) throw new Error("Stellar is not enabled");
  const signedXdr = await signForOrganisation(step.xdr, organisationId);
  const sent = await api<{ hash: string }>("/api/v2/transactions/relay", { chain: wallet.stellar.chain, xdr: signedXdr }, { "X-BFX-Organisation": String(organisationId) });
  return sent.hash;
}

const STEP_WORDS: Record<ChainStep["op"], string> = {
  add_signer: "Adding their passkey",
  remove_signer: "Removing their passkey",
  add_context_rule: "Setting up operator permissions",
  remove_context_rule: "Removing operator permissions",
  set_threshold: "Changing approvals",
};

/**
 * Run a member change to the end: approve each step with your passkey, send it, and let
 * the server confirm it on chain. `onStep` reports progress in plain words.
 */
export async function runMemberChange(
  organisationId: number,
  memberId: number,
  change: { kind: "activate" | "remove" | "role"; role?: OrganisationRole } | "resume",
  onStep?: (message: string) => void,
): Promise<MemberView> {
  let r: StepResult = change === "resume"
    ? await api<PreparedStep>(`/api/organisations/${organisationId}/members/${memberId}/next`, {})
    : await api<StepResult>(`/api/organisations/${organisationId}/members/${memberId}/changes`, change);
  while (!("done" in r)) {
    onStep?.(`${STEP_WORDS[r.step.op]}: approve with your passkey (${r.stepsLeft} left)`);
    const hash = await approveStep(organisationId, r);
    onStep?.("Confirming on the network...");
    r = await confirmWithRetry(organisationId, memberId, hash);
  }
  return r.member;
}

async function confirmWithRetry(organisationId: number, memberId: number, hash: string): Promise<StepResult> {
  let last: unknown;
  for (let i = 0; i < 8; i++) {
    try {
      return await api<StepResult>(`/api/organisations/${organisationId}/members/${memberId}/confirm`, { hash });
    } catch (e) {
      last = e;
      if ((e as { code?: string }).code !== "NOT_CONFIRMED") throw e;
      await new Promise((ok) => setTimeout(ok, 2_500));
    }
  }
  throw last;
}

// ── Independent check ────────────────────────────────────────────────────────

export interface OrganisationCheck { ok: boolean; problems: string[] }

/**
 * Check from the chain, not the server, that the organisation account runs the pinned
 * OpenZeppelin code and that this member's passkey sits on the rule their role uses.
 */
export async function checkOrganisationAccount(view: OrganisationView): Promise<OrganisationCheck> {
  const problems: string[] = [];
  const [config, wallet] = await Promise.all([organisationsConfig(), walletConfig()]);
  if (!view.account || !config.smartAccounts || !wallet.stellar) return { ok: false, problems: ["The organisation account is not ready yet"] };
  await ensureBuffer();
  const { rpc } = await import("@stellar/stellar-sdk");
  const server = new rpc.Server(wallet.stellar.rpcUrl);
  try {
    const wasm = await server.getContractWasmByContractId(view.account);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", wasm))).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (!OZ_ACCEPTED_ACCOUNT_WASM_HASHES.includes(digest)) problems.push("The organisation account is not running the expected wallet code");
  } catch {
    problems.push("The organisation account could not be read from the network");
  }
  if (view.myRole !== "viewer" && view.me.credentialId && view.me.publicKey) {
    const rule = view.myRole === "admin" ? view.ruleIds.admins : view.ruleIds.operatorsPool;
    if (rule !== null) {
      try {
        const { Client } = await import("smart-account-kit-bindings");
        const client = new Client({ contractId: view.account, rpcUrl: wallet.stellar.rpcUrl, networkPassphrase: wallet.stellar.networkPassphrase });
        const onChain = (await client.get_context_rule({ context_rule_id: rule })).result as unknown as { signers: Parameters<typeof signersEqual>[0][] };
        const signer = (await myPasskeySigner(view, config.smartAccounts.webauthnVerifier)).signer;
        if (!onChain?.signers?.some((s) => signersEqual(s, signer))) problems.push("Your passkey is not on the organisation account yet");
      } catch {
        problems.push("Your access could not be checked on the network");
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

export { actingOrganisation };
