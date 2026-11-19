/**
 * End-to-end check of the OTC service on Stellar testnet: the real OtcService and escrow
 * gateway (config/chains/testnet.json), a local Postgres, and the Stellar CLI acting for
 * a merchant and a user (two throwaway identities with test USDC trustlines).
 *
 *   OTC_ARBITER_SECRET=$(stellar keys show bfx-tn-otc-arbiter) \
 *   DATABASE_URL=postgresql://localhost:5432/blockfinax_testnet npx tsx scripts/otc/testnet-check.ts
 *
 * The fee sponsor is a throwaway Friendbot account set for this process only.
 * Flow: apply and approve a merchant (arbiter on chain) with a bank and a mobile money
 * account, post a sell offer, see it in the market, open an order paying by mobile money,
 * upload proof, mark paid with the proof's hash, dispute, rule for the buyer, close the
 * offer; then request a quote, have the merchant answer with a quote only the requester can
 * take, and accept it.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import pg from "pg";

const payer = Keypair.random();
process.env.BLOCKFINAX_ENV = "testnet";
process.env.STELLAR_FEE_PAYER_SECRET = payer.secret();
if (!process.env.OTC_ARBITER_SECRET) throw new Error("Set OTC_ARBITER_SECRET (see the header)");
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to a local Postgres");

const USDC = "CDU3TKFB7XVS3UJXAS37HKMNHVHVC4L6YT3EOPOX5DEGJKTICZNFXC5A";
const ASSET = "USDC:GA5ORHPTRUKNZZFHOTNKNXTHUVRQI7MUAYC7SJC67KT7ILCETLGO253Q";
const results: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

const cli = (...args: string[]) => execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n").pop()!.replace(/"/g, "");
const address = (alias: string) => cli("keys", "address", alias);
const ensureIdentity = (alias: string) => {
  try { address(alias); } catch {
    cli("keys", "generate", alias, "--network", "testnet", "--fund");
    cli("tx", "new", "change-trust", "--source", alias, "--line", ASSET, "--network", "testnet");
  }
  return address(alias);
};

async function main() {
  const fb = await fetch(`https://friendbot.stellar.org?addr=${payer.publicKey()}`);
  if (!fb.ok) throw new Error(`Friendbot failed: ${fb.status}`);
  const { chainRegistry } = await import("../../server/chain/config");
  const { StellarOtcGateway } = await import("../../server/otc/chain");
  const { OtcService } = await import("../../server/otc/service");
  const chain = chainRegistry()!.all().find((c) => c.contracts.otcEscrow)!;
  const gateway = new StellarOtcGateway(chain);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const otc = new OtcService(db as never, gateway, async () => "1000000");
  const ESCROW = gateway.contractId;
  const call = (source: string, ...args: string[]) => cli("contract", "invoke", "--network", "testnet", "--id", ESCROW, "--source", source, "--", ...args);

  const merchant = ensureIdentity("bfx-otc-smoke-merchant");
  const user = ensureIdentity("bfx-otc-smoke-user");
  cli("contract", "invoke", "--network", "testnet", "--id", USDC, "--source", "bfx-tn-usdc-treasury", "--", "transfer",
    "--from", address("bfx-tn-usdc-treasury"), "--to", merchant, "--amount", "500000000");

  // Fresh rows for these two test users (ids far above real ones).
  const MERCHANT_UID = 990_001, USER_UID = 990_002;
  await otc.merchants(); // creates the tables
  await db.query(`DELETE FROM otc_merchants WHERE user_id IN ($1,$2) OR wallet IN ($3,$4)`, [MERCHANT_UID, USER_UID, merchant, user]);

  // 1. Apply and approve.
  const BANK = { type: "bank", bankName: "GTBank", accountNumber: "0123456789", accountName: "Smoke Test FX Ltd" };
  const MOMO = { type: "momo", provider: "OPay", phone: "+2348012345678", accountName: "Smoke Test FX Ltd" };
  await otc.apply(MERCHANT_UID, merchant, null, { displayName: "Smoke Test FX", markets: ["NGN"], paymentDetails: { NGN: [BANK, MOMO] } });
  const approved = await otc.decideMerchant((await otc.merchant(merchant))!.id, "approve", "testnet-check");
  check("merchant approved in the database", approved?.status === "approved");
  check("merchant approved on chain by the arbiter", await gateway.isMerchant(merchant));

  // 2. Post a sell offer (prepared by the service, sent by the CLI as the merchant).
  const prepared = await otc.prepareCreateOffer(merchant, { side: "sell", currency: "NGN", rate: "1520", amount: "40", minOrder: "5", maxOrder: "40" });
  check("service prepares a create_offer transaction", prepared.length === 1 && prepared[0].payload.kind === "stellar");
  const offerId = Number(call("bfx-otc-smoke-merchant", "create_offer", "--merchant", merchant, "--side", "0", "--currency", "NGN",
    "--rate", "1520000000", "--amount", "400000000", "--min_order", "50000000", "--max_order", "400000000"));
  await otc.afterTransaction({ offerId });
  const market = await otc.market("NGN", "buy");
  const listed = market.find((o) => o.id === offerId);
  check("offer appears in the NGN market for buyers, with how to pay", Boolean(listed) && listed!.merchantName === "Smoke Test FX" && listed!.available === "40" && listed!.methods.join() === "Bank transfer,OPay");

  // 3. The user opens an order for 10 USDC.
  await otc.prepareOpenOrder(USER_UID, user, { offerId, amount: "10", methodIndex: 1 });
  const orderId = Number(call("bfx-otc-smoke-user", "open_order", "--taker", user, "--offer_id", String(offerId), "--amount", "100000000"));
  await otc.afterTransaction({ orderId });
  const opened = await otc.order(user, orderId);
  check("order shows the user the mobile money account they chose to pay", opened.status === "open" && opened.payTo?.type === "momo" && (opened.payTo as any).provider === "OPay" && (opened.payTo as any).phone === MOMO.phone && opened.localAmount === "15200");
  check("the user pays and the merchant releases", Boolean(opened.me?.pays) && !(await otc.order(merchant, orderId)).me?.pays);
  const { rows: [linked] } = await db.query(`SELECT taker_user_id FROM otc_orders WHERE id = $1`, [orderId]);
  check("order linked to the user who opened it", linked?.taker_user_id === USER_UID);
  await otc.order(c(3), orderId).then(() => check("a stranger cannot read the order", false), () => check("a stranger cannot read the order", true));

  // 4. Proof, then mark paid with its hash.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await otc.prepareMarkPaid(user, orderId).then(() => check("mark paid needs proof first", false), () => check("mark paid needs proof first", true));
  const { sha256 } = await otc.uploadProof(USER_UID, user, orderId, { type: "image/png", data: png.toString("base64") });
  check("proof stored with its sha256", sha256 === createHash("sha256").update(png).digest("hex"));
  await otc.prepareMarkPaid(user, orderId);
  call("bfx-otc-smoke-user", "mark_paid", "--order_id", String(orderId), "--proof_hash", sha256);
  await otc.afterTransaction({ orderId });
  const paid = await otc.order(user, orderId);
  check("order marked paid on chain with the proof's hash", paid.status === "paid" && (await gateway.getOrder(orderId))!.proofHash === sha256);

  // 5. Dispute and rule for the buyer.
  await otc.prepareDispute(user, orderId, "I paid but the merchant has not released after two hours");
  call("bfx-otc-smoke-user", "dispute", "--caller", user, "--order_id", String(orderId));
  await otc.afterTransaction({ orderId });
  const disputed = await otc.adminOrders("disputed");
  check("BlockFinaX sees the dispute with its reason", disputed.some((o) => o.id === orderId && o.dispute?.reason.startsWith("I paid")));
  const before = Number(cli("contract", "invoke", "--network", "testnet", "--id", USDC, "--source", "bfx-otc-smoke-user", "--send=no", "--", "balance", "--id", user));
  await otc.resolve(orderId, true, "testnet-check", "Bank statement shows the payment arrived");
  const after = Number(cli("contract", "invoke", "--network", "testnet", "--id", USDC, "--source", "bfx-otc-smoke-user", "--send=no", "--", "balance", "--id", user));
  const ruled = await otc.order(user, orderId);
  check("ruling releases the USDC to the buyer", ruled.status === "resolved_released" && after - before === 100_000_000, `${(after - before) / 1e7} USDC`);
  const msgs = await otc.messages(user, orderId);
  check("both sides see BlockFinaX's ruling in the messages", msgs.some((m) => m.from === "BlockFinaX" && m.body.includes("Bank statement")));

  // 6. Close the offer.
  call("bfx-otc-smoke-merchant", "close_offer", "--offer_id", String(offerId));
  await otc.afterTransaction({ offerId });
  check("closed offer leaves the market", !(await otc.market("NGN", "buy")).some((o) => o.id === offerId));

  // 7. Request a quote: the user asks to buy 12 USDC by bank; the merchant answers.
  const { id: requestId } = await otc.createRequest(USER_UID, user, null, { side: "buy", currency: "NGN", amount: "12", methodType: "bank" });
  check("merchant sees the request", (await otc.openRequests(merchant)).some((r) => r.id === requestId));
  const { quoteId } = await otc.prepareQuote(merchant, requestId, "1510");
  const quoteOffer = Number(call("bfx-otc-smoke-merchant", "create_offer", "--merchant", merchant, "--side", "0", "--currency", "NGN",
    "--rate", "1510000000", "--amount", "120000000", "--min_order", "120000000", "--max_order", "120000000", "--taker", JSON.stringify(user)));
  const link = await otc.linkQuote(merchant, quoteId);
  check("quote linked to its reserved escrow offer", link.linked);
  check("a quote never shows in the public market", !(await otc.market("NGN", "buy")).some((o) => o.id === quoteOffer));
  const mine = (await otc.myRequests(user)).find((r) => r.id === requestId);
  check("user sees the quote with the local amount", mine?.quotes[0]?.offerId === quoteOffer && mine?.quotes[0]?.localAmount === "18120");
  let refused = false;
  try { call("bfx-tn-otc-arbiter", "open_order", "--taker", address("bfx-tn-otc-arbiter"), "--offer_id", String(quoteOffer), "--amount", "120000000"); } catch { refused = true; }
  check("someone else cannot take the quote on chain", refused);
  await otc.prepareOpenOrder(USER_UID, user, { offerId: quoteOffer, amount: "12", methodIndex: 0 });
  const qOrder = Number(call("bfx-otc-smoke-user", "open_order", "--taker", user, "--offer_id", String(quoteOffer), "--amount", "120000000"));
  await otc.afterTransaction({ orderId: qOrder });
  const closed = (await otc.myRequests(user)).find((r) => r.id === requestId);
  check("accepting the quote opens the order and closes the request", closed?.status === "accepted" && (await otc.order(user, qOrder)).payTo?.type === "bank");
  call("bfx-otc-smoke-user", "cancel", "--caller", user, "--order_id", String(qOrder));
  call("bfx-otc-smoke-merchant", "close_offer", "--offer_id", String(quoteOffer));

  await db.end();
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

const c = (n: number) => `C${String(n).repeat(55)}`;

main().catch((err) => { console.error(err); process.exit(1); });
