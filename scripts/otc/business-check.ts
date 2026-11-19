/**
 * End-to-end check of OTC from a BUSINESS account on Stellar testnet.
 *
 *   npx tsx scripts/otc/business-check.ts
 *
 * Deploys a real OpenZeppelin business account with software passkeys (an admin and an
 * operator), sets the operator up with the production planner (so they get the
 * "Operators: OTC" rule with the function allow-list policy), funds it with test USDC,
 * and trades against the live escrow through the production relay rules. The merchant is
 * the approved CLI identity `bfx-otc-smoke-merchant` (run scripts/otc/testnet-check.ts once
 * first). The fee sponsor is a throwaway Friendbot account set for this process only.
 *
 * Proves on chain:
 *   1. an operator buys USDC for the business: opens an order, marks it paid, receives it;
 *   2. an operator cannot release the business's escrowed USDC, even sent straight to the
 *      chain without the app's relay rules (the function allow-list policy refuses it);
 *   3. an operator cannot lock the business's USDC to sell it (the transfer allow-list refuses it);
 *   4. an admin can sell the business's USDC and release it.
 */
import { execFileSync } from "node:child_process";
import { Keypair, Networks, rpc, xdr } from "@stellar/stellar-sdk";

const payer = Keypair.random();
process.env.BLOCKFINAX_ENV = "testnet";
process.env.STELLAR_FEE_PAYER_SECRET = payer.secret();
delete process.env.STELLAR_RELAYER_URL;
delete process.env.STELLAR_RATE_POOL_CONTRACT;

const USDC = "CDU3TKFB7XVS3UJXAS37HKMNHVHVC4L6YT3EOPOX5DEGJKTICZNFXC5A";
const results: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const cli = (...args: string[]) => execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").pop()!.replace(/"/g, "");
const expectFailure = async (name: string, fn: () => Promise<unknown>) => {
  try { await fn(); check(name, false, "it went through"); } catch (e) { check(name, true, `refused: ${String((e as Error).message).slice(0, 100)}`); }
};

async function main() {
  const fb = await fetch(`https://friendbot.stellar.org?addr=${payer.publicKey()}`);
  if (!fb.ok) throw new Error(`Friendbot failed: ${fb.status}`);
  const { chainRegistry } = await import("../../server/chain/config");
  const { StellarAdapter } = await import("../../server/chain/stellar-adapter");
  const { StellarOtcGateway } = await import("../../server/otc/chain");
  const { deployOrganisationAccount, prepareStep, confirmedReturn } = await import("../../server/organisations/chain");
  const { relay } = await import("../../server/chain/stellar-relay");
  const { contextRuleIdsFor, planAddMember } = await import("../../shared/organisations");
  const { authContextTargets, organisationContracts, OZ_ACCOUNT_WASM_HASH, signOrganisationEntry } = await import("../../shared/smart-accounts");
  const { softwarePasskey } = await import("../../shared/testing/software-passkey");

  const chain = chainRegistry()!.hub;
  const sa = chain.smartAccounts!;
  const contracts = organisationContracts({ currencyPool: chain.contracts.currencyPool!, ratePool: null, usdc: USDC, otcEscrow: chain.contracts.otcEscrow, smartAccounts: sa });
  const adapter = new StellarAdapter(chain);
  const otc = new StellarOtcGateway(chain);
  const server = new rpc.Server(chain.rpcUrls[0]);
  const net = { rpcUrl: chain.rpcUrls[0], networkPassphrase: Networks.TESTNET, smartAccounts: sa, sponsorPublicKey: payer.publicKey() };
  const balance = async (who: string) => Number(await adapter.getBalance(who, "USDC"));
  const ESCROW = otc.contractId;
  const merchant = cli("keys", "address", "bfx-otc-smoke-merchant");
  const merchantCall = (...args: string[]) => cli("contract", "invoke", "--network", "testnet", "--id", ESCROW, "--source", "bfx-otc-smoke-merchant", "--", ...args);

  const admin = softwarePasskey(sa.webauthnVerifier);
  const operator = softwarePasskey(sa.webauthnVerifier);
  const signerFor = (id: string) => [admin, operator].find((p) => p.credentialId === id)!.signer;

  // 1. The business account, funded with 40 test USDC.
  const { contract: org } = await deployOrganisationAccount({ chain: net, feePayerSecret: payer.secret(), organisationId: Math.floor(Math.random() * 1e9), admin: admin.signer });
  console.log(`Business account: ${org}`);
  cli("contract", "invoke", "--network", "testnet", "--id", USDC, "--source", "bfx-tn-usdc-treasury", "--", "transfer",
    "--from", cli("keys", "address", "bfx-tn-usdc-treasury"), "--to", org, "--amount", "400000000");
  cli("contract", "invoke", "--network", "testnet", "--id", USDC, "--source", "bfx-tn-usdc-treasury", "--", "transfer",
    "--from", cli("keys", "address", "bfx-tn-usdc-treasury"), "--to", merchant, "--amount", "400000000");
  check("business account holds 40 USDC", (await balance(org)) === 40);

  /** Sign an envelope's entries as `who` with the rules their role names, and put them back. */
  const ruleIds: any = { admins: 0, operatorsPool: null, operatorsRatePool: null, operatorsUsdc: null, operatorsOtc: null };
  async function signAs(envelopeXdr: string, who: typeof admin, role: "admin" | "operator", forceRules?: number[]) {
    const env = xdr.TransactionEnvelope.fromXDR(envelopeXdr, "base64");
    const op = env.v1().tx().operations()[0].body().invokeHostFunctionOp();
    const expiration = (await server.getLatestLedger()).sequence + 60;
    const signed = [];
    for (const entry of op.auth()) {
      const ids = forceRules ?? contextRuleIdsFor(role, authContextTargets(entry), ruleIds, contracts);
      signed.push(await signOrganisationEntry(entry, org, who, { networkPassphrase: Networks.TESTNET, accountWasmHash: OZ_ACCOUNT_WASM_HASH, contextRuleIds: ids, expiration }));
    }
    op.auth(signed);
    return { xdr: env.toXDR("base64"), op };
  }
  /** Through the production relay rules for this role, then wait for the chain. */
  async function viaRelay(envelopeXdr: string, who: typeof admin, role: "admin" | "operator") {
    const { xdr: signedXdr } = await signAs(envelopeXdr, who, role);
    const sent = await adapter.relayUserTransaction(signedXdr, org, { organisationRole: role });
    const done = await confirmedReturn(net, sent.hash);
    if (!done.ok) throw new Error(`transaction failed: ${sent.hash}`);
    return done;
  }

  // 2. The admin adds the operator with the production planner.
  const steps = planAddMember({ ruleIds, active: [{ memberId: 1, role: "admin", credentialId: admin.credentialId }], adminApprovals: 1, contracts }, { memberId: 2, role: "operator", credentialId: operator.credentialId });
  check("planner gives the operator an OTC rule with the function policy", steps.some((s) => s.op === "add_context_rule" && s.rule === "operatorsOtc" && s.policies[0].kind === "functionAllowlist"));
  for (const step of steps) {
    const prepared = await prepareStep(net, org, ruleIds, step, signerFor);
    const env = xdr.TransactionEnvelope.fromXDR(prepared, "base64");
    const op = env.v1().tx().operations()[0].body().invokeHostFunctionOp();
    const expiration = (await server.getLatestLedger()).sequence + 60;
    const auth = [];
    for (const entry of op.auth()) auth.push(await signOrganisationEntry(entry, org, admin, { networkPassphrase: Networks.TESTNET, accountWasmHash: OZ_ACCOUNT_WASM_HASH, contextRuleIds: authContextTargets(entry).map(() => 0), expiration }));
    const done = await confirmedReturn(net, await relay(server, Networks.TESTNET, payer.secret(), op.hostFunction(), auth));
    if (step.op === "add_context_rule") ruleIds[step.rule] = Number((done.value as { id: number }).id);
  }
  check("operator rules created on chain", ruleIds.operatorsOtc != null && ruleIds.operatorsUsdc != null, JSON.stringify(ruleIds));

  // 3. The merchant posts a selling offer and a buying offer.
  const sellOffer = merchantCall("create_offer", "--merchant", merchant, "--side", "0", "--currency", "NGN", "--rate", "1520000000", "--amount", "200000000", "--min_order", "10000000", "--max_order", "200000000");
  const buyOffer = merchantCall("create_offer", "--merchant", merchant, "--side", "1", "--currency", "NGN", "--rate", "1500000000", "--amount", "200000000", "--min_order", "10000000", "--max_order", "200000000");

  // 4. The operator buys 5 USDC for the business.
  const before = await balance(org);
  const open = await otc.prepare("open", "open_order", { taker: org, offer_id: BigInt(sellOffer), amount: BigInt(50_000_000) });
  await viaRelay((open[0].payload as { xdr: string }).xdr, operator, "operator");
  const orderId = await latestOrderFor(org);
  check("operator opens an order on a selling offer for the business", orderId > 0, `order ${orderId}`);
  const paid = await otc.prepare("paid", "mark_paid", { order_id: BigInt(orderId), proof_hash: Buffer.alloc(32, 9) });
  await viaRelay((paid[0].payload as { xdr: string }).xdr, operator, "operator");
  check("operator marks it paid", (await otc.getOrder(orderId))!.status === "paid");
  merchantCall("release", "--order_id", String(orderId));
  check("the business receives the USDC", (await balance(org)) - before === 5, `${(await balance(org)) - before} USDC`);

  // 5. What an operator must not do.
  await expectFailure("operator cannot lock the business's USDC to sell it (relay or chain refuses)", async () => {
    const tx = await otc.prepare("sell", "open_order", { taker: org, offer_id: BigInt(buyOffer), amount: BigInt(20_000_000) });
    await viaRelay((tx[0].payload as { xdr: string }).xdr, operator, "operator");
  });
  // An order where the business holds the USDC: the admin sells 2 USDC on the buying offer.
  const sale = await otc.prepare("sell", "open_order", { taker: org, offer_id: BigInt(buyOffer), amount: BigInt(20_000_000) });
  await viaRelay((sale[0].payload as { xdr: string }).xdr, admin, "admin");
  const saleId = await latestOrderFor(org);
  check("admin locks the business's USDC to sell it", (await otc.getOrder(saleId))!.usdcFrom === org);
  merchantCall("mark_paid", "--order_id", String(saleId), "--proof_hash", "0909090909090909090909090909090909090909090909090909090909090909");
  const release = await otc.prepare("release", "release", { order_id: BigInt(saleId) });
  const releaseXdr = (release[0].payload as { xdr: string }).xdr;
  await expectFailure("operator cannot release through the app's relay", () => viaRelay(releaseXdr, operator, "operator"));
  await expectFailure("operator cannot release even sent straight to the chain (function policy)", async () => {
    const { op } = await signAs(releaseXdr, operator, "operator", [ruleIds.operatorsOtc]);
    const hash = await relay(server, Networks.TESTNET, payer.secret(), op.hostFunction(), op.auth());
    const done = await confirmedReturn(net, hash);
    if (!done.ok) throw new Error("failed on chain");
  });
  await viaRelay(releaseXdr, admin, "admin");
  check("admin releases the business's USDC", (await otc.getOrder(saleId))!.status === "released");

  merchantCall("close_offer", "--offer_id", sellOffer);
  merchantCall("close_offer", "--offer_id", buyOffer);

  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed. Business account ${org}.`);
  process.exit(failed ? 1 : 0);

  /** The newest order this account is the taker on. */
  async function latestOrderFor(taker: string) {
    for (let id = 1, last = 0; ; id++) {
      const o = await otc.getOrder(id);
      if (!o) return last;
      if (o.taker === taker) last = id;
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
