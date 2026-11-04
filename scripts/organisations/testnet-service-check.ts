/**
 * End-to-end check of the organisation SERVICE on Stellar testnet: the real
 * OrganisationService and production gateway (config/chains/testnet.json), an in-memory
 * database, software passkeys, and a throwaway Friendbot-funded fee payer. No BlockFinaX
 * key is read: the fee payer secret is set for this process only.
 *
 *   npx tsx scripts/organisations/testnet-service-check.ts
 *
 * Flow: create a business (deploys its account), invite a second admin, accept, add them
 * to the account, confirm from chain, then remove them and confirm again.
 */
import { Keypair, Networks, rpc, xdr } from "@stellar/stellar-sdk";
import { contextRuleIdsFor } from "../../shared/organisations";
import { authContextTargets, OZ_ACCOUNT_WASM_HASH, signOrganisationEntry } from "../../shared/smart-accounts";
import { softwarePasskey } from "../../shared/testing/software-passkey";

const payer = Keypair.random();
process.env.BLOCKFINAX_ENV = "testnet";
process.env.STELLAR_FEE_PAYER_SECRET = payer.secret();
delete process.env.STELLAR_RATE_POOL_CONTRACT;

const results: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

async function main() {
  const fb = await fetch(`https://friendbot.stellar.org?addr=${payer.publicKey()}`);
  if (!fb.ok) throw new Error(`Friendbot failed: ${fb.status}`);

  const { stellarGateway, organisationChainConfig } = await import("../../server/organisations/gateway");
  const { InMemoryOrganisationRepository } = await import("../../server/organisations/repository");
  const { OrganisationService } = await import("../../server/organisations/service");
  const { relay } = await import("../../server/chain/stellar-relay");
  const { ruleHasSigner } = await import("../../server/organisations/chain");

  const gateway = stellarGateway();
  if (!gateway) throw new Error("No organisation gateway: is smartAccounts set in config/chains/testnet.json?");
  const verifier = "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F";
  const founder = softwarePasskey(verifier);
  const second = softwarePasskey(verifier);
  const users = new Map([
    [1, { email: "founder@check.test", passkey: founder }],
    [2, { email: "second@check.test", passkey: second }],
  ]);
  const service = new OrganisationService(new InMemoryOrganisationRepository(), gateway, {
    passkeyOf: async (id) => { const p = users.get(id)?.passkey; return p ? { credentialId: p.credentialId, publicKey: p.publicKey } : null; },
    emailOf: async (id) => users.get(id)?.email ?? null,
  });
  const server = new rpc.Server("https://soroban-testnet.stellar.org");
  const net = { rpcUrl: "https://soroban-testnet.stellar.org", networkPassphrase: Networks.TESTNET, smartAccounts: organisationChainConfig()!.smartAccounts!, sponsorPublicKey: payer.publicKey() };

  /** Approve a prepared step as the founder and send it, as the browser and relay would. */
  async function approve(step: { xdr: string; account: string }, ruleIds: Parameters<typeof contextRuleIdsFor>[2]) {
    const env = xdr.TransactionEnvelope.fromXDR(step.xdr, "base64");
    const op = env.v1().tx().operations()[0].body().invokeHostFunctionOp();
    const expiration = (await server.getLatestLedger()).sequence + 60;
    const auth = [];
    for (const entry of op.auth()) {
      const ids = contextRuleIdsFor("admin", authContextTargets(entry), ruleIds, gateway!.contracts());
      auth.push(await signOrganisationEntry(entry, step.account, founder, { networkPassphrase: Networks.TESTNET, accountWasmHash: OZ_ACCOUNT_WASM_HASH, contextRuleIds: ids, expiration }));
    }
    return relay(server, Networks.TESTNET, payer.secret(), op.hostFunction(), auth);
  }

  async function runToEnd(orgId: number, memberId: number, first: any) {
    let r = first;
    while (!r.done) {
      const org = await service.acting(1, orgId);
      const hash = await approve(r, org.ruleIds);
      for (let i = 0; ; i++) {
        try { r = await service.confirm(1, orgId, memberId, hash); break; } catch (e: any) { if (e.code !== "NOT_CONFIRMED" || i > 6) throw e; await new Promise((ok) => setTimeout(ok, 2500)); }
      }
    }
    return r;
  }

  const org = await service.create(1, "Testnet Check Ltd");
  console.log(`Organisation account: ${org.account}`);
  check("service creates the business and deploys its account", org.status === "active" && Boolean(org.account));

  const { member, token } = await service.invite(1, org.id, { email: "second@check.test", role: "admin" });
  const accepted = await service.accept(2, token);
  check("invitee accepts", accepted.status === "accepted");

  const added = await runToEnd(org.id, member.id, await service.start(1, org.id, member.id, { kind: "activate" }));
  check("second admin activated through the service", added.member.status === "active");
  check("chain shows the second admin on the admins' rule", await ruleHasSigner(net, org.account!, 0, second.signer));
  check("second admin can now act for the business", (await service.acting(2, org.id)).role === "admin");

  const removed = await runToEnd(org.id, member.id, await service.start(1, org.id, member.id, { kind: "remove" }));
  check("second admin removed through the service", removed.member.status === "removed");
  check("chain no longer shows them", !(await ruleHasSigner(net, org.account!, 0, second.signer)));
  let refused = false;
  try { await service.acting(2, org.id); } catch { refused = true; }
  check("removed admin cannot act for the business", refused);

  const kinds = (await service.history(1, org.id)).map((e) => e.kind);
  check("history records the whole story", ["created", "account_deployed", "invited", "accepted", "activated", "removed"].every((k) => kinds.includes(k)));

  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("ERROR", e); process.exit(1); });
