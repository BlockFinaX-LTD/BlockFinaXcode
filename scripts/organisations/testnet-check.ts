/**
 * End-to-end check of organisation accounts on Stellar testnet.
 *
 *   npx tsx scripts/organisations/testnet-check.ts
 *
 * Uses a throwaway account funded by Friendbot (no BlockFinaX key is read) and software
 * passkeys (real P-256 WebAuthn-shaped assertions). It drives the production code:
 * server/organisations/chain.ts to deploy and prepare changes, shared/smart-accounts.ts to
 * sign, and server/chain/stellar-relay.ts to submit. Test XLM stands in for USDC.
 *
 * What it proves on chain:
 *   1. an organisation account deploys with its creator's passkey as admin;
 *   2. the admin can withdraw to any address;
 *   3. the admin can add a second admin, who can then withdraw;
 *   4. an operator on a rule scoped to one token can pay through it;
 *   5. the operator cannot change the account, and cannot claim the admins' rule;
 *   6. a removed admin's passkey stops working.
 * It does not cover the transfer allow-list policy, which needs the Rust build first.
 */
import { Address, Keypair, Networks, Operation, TransactionBuilder, BASE_FEE, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { deployOrganisationAccount, prepareStep, confirmedReturn, readRule, ruleHasSigner, accountWasmHash, isTrustedAccountCode, type OrganisationChain } from "../../server/organisations/chain";
import { relay } from "../../server/chain/stellar-relay";
import { signOrganisationEntry, OZ_ACCOUNT_WASM_HASH, type DigestSigner } from "../../shared/smart-accounts";
import { softwarePasskey } from "../../shared/testing/software-passkey";

const RPC = "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const SMART_ACCOUNTS = {
  accountWasmHash: OZ_ACCOUNT_WASM_HASH,
  webauthnVerifier: "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
  thresholdPolicy: "CAZ2WFUDXGX265LOEARFEOYYUL6F4BYWXZLGUAWZNJY3MRFPNLSZVS4S",
  spendingLimitPolicy: "CC3CEYQAP6NPNFIYSWL5MVZRCPJZGWX4XO7WDEJOUVGO2FZX5OONYPA5",
  transferAllowlistPolicy: "CA5BPWHNBVIPNQ5J66UBZDSW2J4VITR7OJLU6IVHOHR6ESE2JM2H4WKQ",
};

const server = new rpc.Server(RPC);
const results: Array<[string, boolean, string?]> = [];
const check = (name: string, ok: boolean, detail?: string) => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

async function balance(address: string): Promise<bigint> {
  const src = await server.getAccount(payer.publicKey());
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(Operation.invokeContractFunction({ contract: XLM, function: "balance", args: [nativeToScVal(address, { type: "address" })] }))
    .setTimeout(60).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return BigInt((sim as rpc.Api.SimulateTransactionSuccessResponse).result!.retval.i128().lo().toString());
}

/** Simulate an op, sign the organisation's auth entry, then submit through the production relay. */
async function signAndRelay(envelopeXdr: string, account: string, signer: DigestSigner, ruleIds: number[] | ((n: number) => number[])): Promise<string> {
  const env = xdr.TransactionEnvelope.fromXDR(envelopeXdr, "base64");
  const op = env.v1().tx().operations()[0].body().invokeHostFunctionOp();
  const latest = (await server.getLatestLedger()).sequence;
  const signed: xdr.SorobanAuthorizationEntry[] = [];
  for (const entry of op.auth()) {
    const contexts = countContexts(entry);
    await signOrganisationEntry(entry, account, signer, {
      networkPassphrase: NETWORK, accountWasmHash: OZ_ACCOUNT_WASM_HASH,
      contextRuleIds: typeof ruleIds === "function" ? ruleIds(contexts) : ruleIds, expiration: latest + 60,
    });
    signed.push(entry);
  }
  const hash = await relay(server, NETWORK, payer.secret(), op.hostFunction(), signed);
  const done = await confirmedReturn(chain, hash);
  if (!done.ok) throw new Error(`transaction failed: ${hash}`);
  return hash;
}

function countContexts(entry: xdr.SorobanAuthorizationEntry) {
  let n = 0;
  const walk = (inv: xdr.SorobanAuthorizedInvocation) => { n++; inv.subInvocations().forEach(walk); };
  walk(entry.rootInvocation());
  return n;
}

async function prepareTransfer(from: string, to: string, stroops: bigint): Promise<string> {
  const src = await server.getAccount(payer.publicKey());
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(Operation.invokeContractFunction({ contract: XLM, function: "transfer", args: [
      nativeToScVal(from, { type: "address" }), nativeToScVal(to, { type: "address" }), nativeToScVal(stroops, { type: "i128" }),
    ] }))
    .setTimeout(120).build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return rpc.assembleTransaction(tx, sim).build().toXDR();
}

const expectFailure = async (name: string, fn: () => Promise<unknown>) => {
  try { await fn(); check(name, false, "it went through"); } catch (e) { check(name, true, `refused: ${String((e as Error).message).slice(0, 90)}`); }
};

const payer = Keypair.random();
const chain: OrganisationChain = { rpcUrl: RPC, networkPassphrase: NETWORK, smartAccounts: SMART_ACCOUNTS, sponsorPublicKey: payer.publicKey() };

async function main() {
  console.log("Funding a throwaway testnet account from Friendbot...");
  const fb = await fetch(`https://friendbot.stellar.org?addr=${payer.publicKey()}`);
  if (!fb.ok) throw new Error(`Friendbot failed: ${fb.status}`);

  const admin = softwarePasskey(SMART_ACCOUNTS.webauthnVerifier);
  const admin2 = softwarePasskey(SMART_ACCOUNTS.webauthnVerifier);
  const operator = softwarePasskey(SMART_ACCOUNTS.webauthnVerifier);
  const outsider = Keypair.random().publicKey();
  await fetch(`https://friendbot.stellar.org?addr=${outsider}`);

  // 1. Deploy.
  const orgId = Math.floor(Math.random() * 1e9);
  const { contract: org } = await deployOrganisationAccount({ chain, feePayerSecret: payer.secret(), organisationId: orgId, admin: admin.signer });
  console.log(`Organisation account: ${org}`);
  check("deploys on the pinned OpenZeppelin account code", isTrustedAccountCode(await accountWasmHash(chain, org)));
  check("creator's passkey is the admin on rule 0", await ruleHasSigner(chain, org, 0, admin.signer));

  // Fund it with 50 test XLM.
  const fund = await prepareTransfer(payer.publicKey(), org, 500_000_000n);
  const fundTx = TransactionBuilder.fromXDR(fund, NETWORK);
  fundTx.sign(payer);
  await confirmedReturn(chain, (await server.sendTransaction(fundTx as never)).hash);
  check("account holds funds", (await balance(org)) === 500_000_000n);

  // 2. Admin withdraws to an outside address.
  const before = await balance(outsider);
  await signAndRelay(await prepareTransfer(org, outsider, 10_000_000n), org, admin, [0]);
  check("admin withdraws to an outside address", (await balance(outsider)) - before === 10_000_000n);

  // 3. Admin adds a second admin, who then withdraws.
  const ruleIds = { admins: 0, operatorsPool: null, operatorsRatePool: null, operatorsUsdc: null };
  const signerFor = (id: string) => [admin, admin2, operator].find((p) => p.credentialId === id)!.signer;
  await signAndRelay(await prepareStep(chain, org, ruleIds, { op: "add_signer", rule: "admins", credentialId: admin2.credentialId }, signerFor), org, admin, [0]);
  check("second admin added to rule 0", await ruleHasSigner(chain, org, 0, admin2.signer));
  await signAndRelay(await prepareTransfer(org, outsider, 10_000_000n), org, admin2, [0]);
  check("second admin can withdraw", true);

  // 4. Operator rule scoped to one token contract (XLM standing in for USDC).
  const addRule = await signAndRelay(await prepareStep(chain, org, ruleIds, {
    op: "add_context_rule", rule: "operatorsUsdc", name: "Operators: USDC", context: { tag: "CallContract", contract: XLM },
    credentialIds: [operator.credentialId], policies: [{ kind: "threshold", policy: SMART_ACCOUNTS.thresholdPolicy, threshold: 1 }],
  }, signerFor), org, admin, [0]);
  const created = await confirmedReturn(chain, addRule);
  const opRule = Number((created.value as { id: number }).id);
  check("operator rule created", Number.isInteger(opRule) && opRule > 0, `rule ${opRule}`);
  check("operator rule holds the operator's passkey", Boolean((await readRule(chain, org, opRule))?.signers.length === 1));
  await signAndRelay(await prepareTransfer(org, payer.publicKey(), 1_000_000n), org, operator, [opRule]);
  check("operator pays through their scoped rule", true);

  // 5. What an operator must not be able to do.
  const tryAddSigner = await prepareStep(chain, org, ruleIds, { op: "add_signer", rule: "admins", credentialId: operator.credentialId }, signerFor);
  await expectFailure("operator cannot change the account using their rule", () => signAndRelay(tryAddSigner, org, operator, [opRule]));
  await expectFailure("operator cannot claim the admins' rule", () => signAndRelay(tryAddSigner, org, operator, [0]));

  // 6b. An operator on a token rule guarded by the BlockFinaX transfer allow-list policy:
  //     paying a listed recipient (standing in for a pool) works; paying anyone else,
  //     or approving an allowance, is refused by the chain.
  const pool = Keypair.random().publicKey(); // stands in for a pool contract
  await fetch(`https://friendbot.stellar.org?addr=${pool}`);
  const op2 = softwarePasskey(SMART_ACCOUNTS.webauthnVerifier);
  const signerFor2 = (id: string) => [admin, admin2, operator, op2].find((p) => p.credentialId === id)!.signer;
  const guarded = await signAndRelay(await prepareStep(chain, org, ruleIds, {
    op: "add_context_rule", rule: "operatorsUsdc", name: "Operators: guarded", context: { tag: "CallContract", contract: XLM },
    credentialIds: [op2.credentialId], policies: [{ kind: "transferAllowlist", policy: SMART_ACCOUNTS.transferAllowlistPolicy!, recipients: [pool] }],
  }, signerFor2), org, admin, [0]);
  const guardedRule = Number(((await confirmedReturn(chain, guarded)).value as { id: number }).id);
  check("operator rule with the allow-list policy created", Number.isInteger(guardedRule), `rule ${guardedRule}`);
  const poolBefore = await balance(pool);
  await signAndRelay(await prepareTransfer(org, pool, 2_000_000n), org, op2, [guardedRule]);
  check("operator pays a listed recipient (a pool)", (await balance(pool)) - poolBefore === 2_000_000n);
  await expectFailure("operator cannot pay anyone else: the policy refuses on chain", async () =>
    signAndRelay(await prepareTransfer(org, outsider, 1_000_000n), org, op2, [guardedRule]));
  const approve = async () => {
    const src = await server.getAccount(payer.publicKey());
    const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: NETWORK })
      .addOperation(Operation.invokeContractFunction({ contract: XLM, function: "approve", args: [
        nativeToScVal(org, { type: "address" }), nativeToScVal(pool, { type: "address" }), nativeToScVal(1_000_000n, { type: "i128" }),
        nativeToScVal((await server.getLatestLedger()).sequence + 1000, { type: "u32" }),
      ] })).setTimeout(120).build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
    return signAndRelay(rpc.assembleTransaction(tx, sim).build().toXDR(), org, op2, [guardedRule]);
  };
  await expectFailure("operator cannot approve an allowance: the policy refuses on chain", approve);

  // 6. Remove the second admin; their passkey stops working.
  await signAndRelay(await prepareStep(chain, org, ruleIds, { op: "remove_signer", rule: "admins", credentialId: admin2.credentialId }, signerFor), org, admin, [0]);
  check("second admin removed from rule 0", !(await ruleHasSigner(chain, org, 0, admin2.signer)));
  await expectFailure("removed admin can no longer withdraw", async () => signAndRelay(await prepareTransfer(org, outsider, 1_000_000n), org, admin2, [0]));

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Account ${org} on testnet.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error("ERROR", e); process.exit(1); });
