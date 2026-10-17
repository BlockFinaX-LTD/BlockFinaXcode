import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { ChainRegistry, beginHubMigration, completeDrain, type ChainRegistryConfig } from "@shared/chains/registry";
import { ApplicationError, type CurrencyPool, type EconomicQuote } from "@shared/domain/types";
import { AdapterRegistry } from "../../chain";
import { EvmAdapter } from "../../chain/evm-adapter";
import { StellarAdapter } from "../../chain/stellar-adapter";
import { mapEvmError, mapStellarError } from "../../chain/errors";
import { stellarQuoteDigest } from "../../chain/stellar-quote";
import { AccountService, InMemoryAccountRepository } from "../../accounts/service";
import { QuoteService, type FairPricer } from "../../domain/quote-service";
import { BalanceLedger } from "../../domain/ledger";
import { settlementResult } from "../../domain/settlement";
import { RoutingEngine } from "../../routing/engine";
import { CctpProvider, DirectProvider, PrefundedProvider, type CctpPort, type TreasuryPort } from "../../routing/providers";
import { InMemoryRouteStore, type RouteRequest } from "../../routing/types";
import { WalletSession } from "../../../client/src/lib/wallet-session";
import type { WalletProvider } from "../../../client/src/lib/wallet-provider";


/**
 * Architecture v2.0 tests: one user with many chain accounts, network switching without
 * logout, multi-chain funding and withdrawal through the routing layer, recovery after
 * routing failure, adapter parity, and moving the liquidity hub from Base to Stellar.
 */

const BASE_DIAMOND = "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef";
const STELLAR_POOL = "CCIOOBT4HMBRG3OHDKN7R62U6PZTIQBTCN7KVI3YXYF4M2MREFSVQZFG";
const EVM_USER = "0x1111111111111111111111111111111111111111";
const STELLAR_USER = "GBU4JP2FM7WUENJSUW7O6ATJ3WOBGGUWFOJ3E4HNZQ5W7FLAWNPXLOZX";

function config(): ChainRegistryConfig {
  return {
    environment: "test",
    activeLiquidityHub: "base",
    chains: [
      { key: "base", family: "evm", name: "Base", networkId: "8453", rpcUrls: ["http://127.0.0.1:1"], explorer: "", state: "ACTIVE", provisionAtSignup: true,
        contracts: { currencyPool: BASE_DIAMOND }, assets: { USDC: { decimals: 6, addressOrContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" } } },
      { key: "stellar", family: "stellar", name: "Stellar", networkId: "Test SDF Network ; September 2015", rpcUrls: ["https://soroban-testnet.invalid"], explorer: "", state: "ACCESS_ONLY", provisionAtSignup: true,
        contracts: { currencyPool: STELLAR_POOL }, assets: { USDC: { decimals: 7, addressOrContract: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA" } } },
    ],
  };
}

// ── Registry and liquidity-hub migration ──────────────────────────────────────

test("registry: one hub, other chains are funding and withdrawal networks only", () => {
  const r = new ChainRegistry(config());
  assert.equal(r.hub.key, "base");
  assert.equal(r.executionNetworkFor("stellar").key, "base");
  assert.deepEqual(r.fundingNetworks().map((c) => c.key), ["base", "stellar"]);
  assert.equal(r.capabilities("stellar").newHedges, false);
  assert.throws(() => new ChainRegistry({ ...config(), chains: config().chains.map((c) => ({ ...c, state: "ACTIVE" as const })) }), /not the liquidity hub/);
});

test("hub migration: Base drains and keeps settling, Stellar takes new pools and hedges", () => {
  const before = new ChainRegistry(config());
  const during = new ChainRegistry(beginHubMigration(before.config, "stellar"));
  assert.equal(during.hub.key, "stellar");
  assert.equal(during.get("base").state, "DRAINING");
  assert.equal(during.capabilities("base").newHedges, false);
  assert.equal(during.capabilities("base").settlement, true);
  assert.equal(during.capabilities("base").claims, true);
  assert.equal(during.capabilities("stellar").newHedges, true);
  assert.throws(() => during.require("base", "newHedges"), (e: ApplicationError) => e.code === "CHAIN_DRAINING");
  assert.equal(during.executionNetworkFor("base").key, "stellar");
  assert.deepEqual(during.settlementNetworks().map((c) => c.key).sort(), ["base", "stellar"]);

  assert.throws(() => completeDrain(during.config, "base", { activePositions: 3, remainingLiquidity: "0" }), /still has 3 active hedges/);
  const after = new ChainRegistry(completeDrain(during.config, "base", { activePositions: 0, remainingLiquidity: "0" }));
  assert.equal(after.get("base").state, "ACCESS_ONLY");
  assert.equal(after.capabilities("base").funding, true);
  assert.deepEqual(after.settlementNetworks().map((c) => c.key), ["stellar"]);
});

// ── Accounts and wallets ──────────────────────────────────────────────────────

test("one BlockFinaX user holds an EVM and a Stellar account", async () => {
  const svc = new AccountService(new ChainRegistry(config()), new InMemoryAccountRepository());
  assert.deepEqual((await svc.provisioningPlan(7)).missing, ["base", "stellar"]);
  await svc.link(7, { chain: "base", address: EVM_USER.toLowerCase(), walletProvider: "rift", accountType: "smart_account" });
  await svc.link(7, { chain: "stellar", address: STELLAR_USER, walletProvider: "stellar-passkey", accountType: "soroban_contract" });
  await svc.link(7, { chain: "stellar", address: STELLAR_USER, walletProvider: "stellar-passkey", accountType: "soroban_contract" });
  assert.equal((await svc.accounts(7)).length, 2);
  assert.deepEqual(await svc.addressBook(7), { base: ethers.getAddress(EVM_USER), stellar: STELLAR_USER });
  assert.deepEqual((await svc.provisioningPlan(7)).missing, []);
  await assert.rejects(svc.link(8, { chain: "base", address: EVM_USER, walletProvider: "rift", accountType: "smart_account" }), /another BlockFinaX account/);
  await assert.rejects(svc.link(7, { chain: "stellar", address: EVM_USER, walletProvider: "x", accountType: "external" }), /Stellar G or C/);
});

function fakeProvider(namespace: "eip155" | "stellar", networkKey: string, address: string, opts: { reject?: boolean } = {}): WalletProvider {
  return {
    id: namespace, namespaces: [namespace],
    getAccounts: async () => [{ chainNamespace: namespace, networkKey, address, accountType: "smart_account", provider: namespace }],
    connect: async () => [], disconnect: async () => {},
    sendTransaction: async () => {
      if (opts.reject) throw new Error("User rejected the request");
      return { chainNamespace: namespace, networkKey, transactionHash: `0x${networkKey}` };
    },
  };
}

test("switching network keeps the same user, session and accounts", async () => {
  const session = new WalletSession("user-7", [fakeProvider("eip155", "base", EVM_USER), fakeProvider("stellar", "stellar", STELLAR_USER)], async () => "CONFIRMED");
  await session.refresh();
  assert.equal(session.activeNetwork, "base");
  assert.equal(session.switchNetwork("stellar").address, STELLAR_USER);
  assert.equal(session.userId, "user-7");
  assert.equal(session.allAccounts().length, 2);
  session.switchNetwork("base");
  assert.equal(session.activeAccount()?.address, EVM_USER);
  assert.throws(() => session.switchNetwork("solana"), /No account/);
});

test("every chain's transaction runs through one lifecycle", async () => {
  const session = new WalletSession("u", [fakeProvider("eip155", "base", EVM_USER), fakeProvider("stellar", "stellar", STELLAR_USER, { reject: true })], async () => "CONFIRMED");
  const seen: string[] = [];
  const evm = await session.send([{ chain: "base", family: "evm", label: "Buy", payload: { kind: "evm", chainId: 8453, to: BASE_DIAMOND, data: "0x", value: "0" } }], (p) => seen.push(p[0].state));
  assert.deepEqual(seen, ["PREPARED", "AWAITING_SIGNATURE", "SUBMITTED", "CONFIRMED"]);
  assert.equal(evm[0].hash, "0xbase");
  const st = await session.send([{ chain: "stellar", family: "stellar", label: "Buy", payload: { kind: "stellar", networkPassphrase: "x", xdr: "AAAA" } }], () => {});
  assert.equal(st[0].state, "FAILED");
  assert.equal(st[0].error, "TRANSACTION_REJECTED");
});

// ── Shared quote service across adapters ──────────────────────────────────────

function pool(chain: string, decimals: number, markup: number): CurrencyPool {
  return {
    ref: { chain, contract: "c", id: "pool/1" }, chain, poolId: 1, creator: "x", pair: "USD/GHS", direction: "up",
    asset: { symbol: "USDC", chain, decimals, addressOrContract: "t" }, acceptingHedges: true, allowExternalLp: true,
    structures: { open: true, capped: true, minCapDistanceBps: 300, maxCapDistanceBps: 2000, openMaxPayoutBps: 3000 },
    tenors: [{ tenorDays: 14, active: true, markupBps: markup }],
    fees: { hedgerFeeRateE6: 5000, payoutFeeRateE6: 10000, lpProfitFeeRateE6: 10000, creatorShareE6: 50000 },
    liquidity: { cash: "500000", reserved: "0", deferredPremium: "0", nav: "500000", free: "500000", holdback: "0", capacity: "500000" },
    creatorEarnings: "0", activePositions: 0, latestExpiry: 0,
  };
}

function fakeAdapter(chain: string, decimals: number) {
  return {
    listPools: async () => [pool(chain, decimals, 11613)],
    signQuote: async (economic: EconomicQuote, buyer: string) => ({ economic, buyer, expiresAt: 0, executable: { signedOn: chain } }),
  } as any;
}

const pricer: FairPricer = { spot: async () => "11.2", fair: async () => ({ fairRateE6: 15500, spot: "11.2" }) };
const request = { pair: "USD/GHS", notional: "100000", tenorDays: 14, structure: "capped" as const, direction: "up" as const, strike: "11.6", cap: "12.5" };

test("one quote service prices the same economic quote on either chain", async () => {
  const before = new ChainRegistry(config());
  const adapters = (r: ChainRegistry) => new AdapterRegistry(r, { base: fakeAdapter("base", 6), stellar: fakeAdapter("stellar", 7) });
  const onBase = await new QuoteService(before, adapters(before), pricer).quote(request, { base: EVM_USER, stellar: STELLAR_USER });
  const after = new ChainRegistry(beginHubMigration(before.config, "stellar"));
  const onStellar = await new QuoteService(after, adapters(after), pricer).quote(request, { base: EVM_USER, stellar: STELLAR_USER });

  assert.equal(onBase.economic.executionChain, "base");
  assert.equal(onStellar.economic.executionChain, "stellar");
  assert.equal(onStellar.buyer, STELLAR_USER);
  for (const q of [onBase, onStellar]) {
    assert.equal(q.economic.offerRateE6, 18000);
    assert.equal(q.economic.premium, "1800");
    assert.equal(q.economic.hedgerFee, "9");
  }
  // 6 vs 7 decimals: the only difference is the extra digit (parity vectors allow it).
  assert.equal(onBase.economic.maxPayout, "8035.714285");
  assert.equal(onStellar.economic.maxPayout, "8035.7142857");
  await assert.rejects(new QuoteService(after, adapters(after), pricer).quote(request, { base: EVM_USER }), /No Stellar account/);
});

test("a quote only uses pools that sell the requested direction", async () => {
  const r = new ChainRegistry(beginHubMigration(config(), "stellar"));
  const qs = new QuoteService(r, new AdapterRegistry(r, { base: fakeAdapter("base", 6), stellar: fakeAdapter("stellar", 7) }), pricer);
  await assert.rejects(
    qs.quote({ ...request, direction: "down", strike: "10.8", cap: "10" }, { stellar: STELLAR_USER }),
    (e: ApplicationError) => e.code === "TENOR_DISABLED" && /falling-rate/.test(e.message),
  );
  assert.deepEqual((await qs.options("USD/GHS", "down")).tenors, []);
  // A request for one specific pool only uses that pool.
  await assert.rejects(qs.quote({ ...request, pool: "stellar:c:pool/9" }, { stellar: STELLAR_USER }), (e: ApplicationError) => e.code === "TENOR_DISABLED");
  assert.equal((await qs.quote({ ...request, pool: "stellar:c:pool/1" }, { stellar: STELLAR_USER })).economic.pool.id, "pool/1");
  assert.equal((await qs.options("USD/GHS", "up")).tenors.length, 1);
});

// ── Routing: multi-chain funding, withdrawal, failure ─────────────────────────

function treasury(opts: { sourceFails?: boolean; payoutFails?: boolean } = {}): TreasuryPort {
  return {
    available: async () => "1000000",
    address: () => "TREASURY",
    payout: async () => (opts.payoutFails ? "failed" : "confirmed"),
    sourceStatus: async () => (opts.sourceFails ? "failed" : "confirmed"),
    refund: async () => "confirmed",
    prepareSourceTransfer: async () => [],
  };
}

function routeReq(r: ChainRegistry, kind: "fund" | "withdraw", source: string, destination: string, amount: string, action: RouteRequest["action"] = { type: "credit" }): RouteRequest {
  return {
    userId: "7", kind, sourceChain: source, destinationChain: destination,
    asset: r.asset(source, "USDC"), destinationAsset: r.asset(destination, "USDC"), amount,
    sender: source === "base" ? EVM_USER : STELLAR_USER, recipient: destination === "base" ? EVM_USER : STELLAR_USER, action,
  };
}

test("an underwriter funds from Base while the hub is Stellar; the TVL lands on Stellar", async () => {
  const r = new ChainRegistry(beginHubMigration(config().chains.length ? config() : config(), "stellar"));
  const ledger = new BalanceLedger(() => 1);
  ledger.credit({ owner: "treasury", location: "stellar", bucket: "float" }, "USDC", "1000000", "treasury seed");
  const engine = new RoutingEngine(r, [new DirectProvider(), new PrefundedProvider(treasury())], new InMemoryRouteStore(), ledger, async () => "completed");

  assert.equal(engine.destinationFor("base"), "stellar");
  const [best] = await engine.quote(routeReq(r, "fund", "base", "stellar", "100000", { type: "lp_deposit", poolId: 1 }));
  assert.equal(best.quote.provider, "blockfinax-prefunded");
  const { route } = await engine.start(routeReq(r, "fund", "base", "stellar", "100000", { type: "lp_deposit", poolId: 1 }), best.quote);
  const done = await engine.advance(route.id);

  assert.deepEqual(done.history.map((h) => h.state), ["REQUESTED", "SOURCE_CONFIRMED", "ROUTING", "DESTINATION_CONFIRMED", "ACTION_PENDING", "ACTION_COMPLETED"]);
  assert.equal(ledger.balance({ owner: "7", location: "stellar", bucket: "reserved" }, "USDC"), "99900");
  assert.equal(ledger.balance({ owner: "treasury", location: "base", bucket: "float" }, "USDC"), "100000");
  assert.equal(ledger.balance({ owner: "treasury", location: "stellar", bucket: "float" }, "USDC"), "900100");
  assert.equal(ledger.conservationCheck("USDC").balanced, true);
});

test("a payout is withdrawn to a different network than the hub", async () => {
  const r = new ChainRegistry(beginHubMigration(config(), "stellar"));
  const ledger = new BalanceLedger();
  ledger.credit({ owner: "treasury", location: "base", bucket: "float" }, "USDC", "50000", "treasury seed");
  const engine = new RoutingEngine(r, [new PrefundedProvider(treasury())], new InMemoryRouteStore(), ledger, async () => "completed");
  const req = routeReq(r, "withdraw", "stellar", "base", "2500");
  const [best] = await engine.quote(req);
  const { route } = await engine.start(req, best.quote);
  const done = await engine.advance(route.id);
  assert.equal(done.state, "ACTION_COMPLETED");
  assert.equal(ledger.balance({ owner: "7", location: "base", bucket: "available" }, "USDC"), "2497.5");
  assert.equal(ledger.conservationCheck("USDC").balanced, true);
});

test("routing failure leaves funds recoverable and refunds them in full", async () => {
  const r = new ChainRegistry(beginHubMigration(config(), "stellar"));
  const ledger = new BalanceLedger();
  ledger.credit({ owner: "treasury", location: "stellar", bucket: "float" }, "USDC", "1000000", "seed");
  let fail = false;
  const port: TreasuryPort = { ...treasury(), sourceStatus: async () => "confirmed", payout: async () => (fail ? "failed" : "confirmed") };
  fail = true;
  const engine = new RoutingEngine(r, [new PrefundedProvider(port)], new InMemoryRouteStore(), ledger, async () => "completed");
  const req = routeReq(r, "fund", "base", "stellar", "5000");
  const [best] = await engine.quote(req);
  const { route } = await engine.start(req, best.quote);

  const stuck = await engine.advance(route.id);
  assert.equal(stuck.state, "RECOVERY_REQUIRED");
  assert.equal(ledger.balance({ owner: "7", location: `transit:${route.id}`, bucket: "pending_routing" }, "USDC"), "5000");
  assert.equal(ledger.conservationCheck("USDC").balanced, true);

  const recovered = await engine.recover(route.id);
  assert.equal(recovered.state, "REFUNDED");
  assert.equal(ledger.balance({ owner: "7", location: `transit:${route.id}`, bucket: "pending_routing" }, "USDC"), "0");
  assert.equal(ledger.conservationCheck("USDC").balanced, true);
});

test("funds that arrive but cannot be hedged stay with the user on the hub", async () => {
  const r = new ChainRegistry(beginHubMigration(config(), "stellar"));
  const ledger = new BalanceLedger();
  ledger.credit({ owner: "treasury", location: "stellar", bucket: "float" }, "USDC", "1000000", "seed");
  let ok = false;
  const engine = new RoutingEngine(r, [new PrefundedProvider(treasury())], new InMemoryRouteStore(), ledger, async () => (ok ? "completed" : "failed"));
  const req = routeReq(r, "fund", "base", "stellar", "1000", { type: "hedge", quoteRef: "q" });
  const [best] = await engine.quote(req);
  const { route } = await engine.start(req, best.quote);
  const first = await engine.advance(route.id);
  assert.equal(first.state, "RECOVERY_REQUIRED");
  assert.equal(ledger.balance({ owner: "7", location: "stellar", bucket: "available" }, "USDC"), "999");
  ok = true;
  const retried = await engine.advance(route.id);
  assert.equal(retried.state, "ACTION_COMPLETED");
  assert.equal(ledger.balance({ owner: "7", location: "stellar", bucket: "reserved" }, "USDC"), "999");
});

test("best execution weighs amount, time and risk, not only the fee", async () => {
  const r = new ChainRegistry(beginHubMigration(config(), "stellar"));
  const cctp: CctpPort = { prepareBurn: async () => [], status: async () => "minted", retryMint: async () => true };
  const engine = new RoutingEngine(r, [new PrefundedProvider(treasury(), { feeBps: 10, maxAmount: "250000" }), new CctpProvider(cctp, { base: 6, stellar: 27 })], new InMemoryRouteStore(), new BalanceLedger(), async () => "completed");
  const small = await engine.quote(routeReq(r, "fund", "base", "stellar", "1000"));
  assert.equal(small.length, 2);
  assert.ok(small[0].score >= small[1].score);
  const huge = await engine.quote(routeReq(r, "fund", "base", "stellar", "300000"));
  assert.deepEqual(huge.map((q) => q.quote.provider), ["circle-cctp"]);
});

// ── Adapter parity ────────────────────────────────────────────────────────────

test("EVM reverts and Soroban errors map to the same application errors", () => {
  const pairs: [string, number, string][] = [
    ["Insufficient pool capacity", 17, "INSUFFICIENT_LIQUIDITY"],
    ["Tenor not offered", 10, "TENOR_DISABLED"],
    ["Cap outside the pool's boundaries", 15, "INVALID_CAP"],
    ["Quote nonce already used", 20, "QUOTE_USED"],
    ["Quote expired (signed > 120s ago)", 19, "QUOTE_EXPIRED"],
    ["Position already settled", 23, "POSITION_SETTLED"],
    ["Protocol is paused", 8, "PAUSED"],
    ["Pool does not sell this direction", 37, "DIRECTION_NOT_OFFERED"],
  ];
  for (const [reason, n, code] of pairs) {
    assert.equal(mapEvmError(new Error(`execution reverted: "${reason}"`)).code, code);
    assert.equal(mapStellarError(new Error(`HostError: Error(Contract, #${n})`)).code, code);
  }
  assert.equal(mapEvmError({ code: "ACTION_REJECTED", message: "user rejected" }).code, "TRANSACTION_REJECTED");
});

test("an EVM log and a Soroban event become the same business event", () => {
  const r = new ChainRegistry(config());
  const evm = new EvmAdapter(r.get("base"), new ethers.JsonRpcProvider("http://127.0.0.1:1", 8453, { staticNetwork: ethers.Network.from(8453) }));
  const iface = new ethers.Interface(["event PoolProtectionPurchased(uint256 indexed positionId, uint256 indexed poolId, address indexed hedger, uint8 structure, uint32 tenorDays, uint256 notional, uint256 premium, uint256 platformFee, uint256 maxPayout, uint256 expiry)"]);
  const log = iface.encodeEventLog("PoolProtectionPurchased", [3, 1, EVM_USER, 1, 14, 100_000_000_000n, 1_800_000_000n, 9_000_000n, 8_035_714_285n, 1_801_209_600]);
  const fromEvm = evm.decodeLog({ ...log, blockNumber: 10, index: 0, transactionHash: "0xabc" })!;

  const stellar = new StellarAdapter(r.get("stellar"), {});
  const fromSoroban = stellar.decodeEvent(["protection_purchased", 1, 3], {
    hedger: STELLAR_USER, structure: 1, strike_above: true, tenor_days: 14, notional: 1_000_000_000_000n, spot: 11_200_000n,
    strike: 11_600_000n, cap: 12_500_000n, fair_rate: 15500, premium_rate: 18000, premium: 18_000_000_000n, fee: 90_000_000n,
    max_payout: 80_357_142_857n, expiry: 1_801_209_600n,
  }, { height: 20, index: 0, tx: "abc" })!;

  assert.equal(fromEvm.type, "HedgeCreated");
  assert.equal(fromSoroban.type, "HedgeCreated");
  assert.equal(fromEvm.subject, `base:${BASE_DIAMOND}:position/3`);
  assert.equal(fromSoroban.subject, `stellar:${STELLAR_POOL}:position/3`);
  for (const k of ["structure", "tenorDays", "notional", "premium", "fee", "expiry"]) {
    assert.equal(fromEvm.data[k], fromSoroban.data[k], k);
  }
});

test("the Stellar adapter signs the digest the contract verifies (golden vector)", () => {
  const digest = stellarQuoteDigest(STELLAR_POOL, STELLAR_USER, {
    pool_id: 1, notional: 1_000_000_000_000n, tenor_days: 7, structure: 1, strike_above: true, spot: 11_200_000n,
    strike: 11_600_000n, cap: 12_500_000n, fair_rate: 17_500, max_cost: 0n, deadline: 0n, quote_timestamp: 1_700_000_000n,
    quote_nonce: Buffer.alloc(32, 1),
  });
  assert.equal(digest.toString("hex"), "8f080c0e1290f8e2ba53a464ef9a75e76db19ad354c1521359886aac62f5e11c");
});

test("settlement results read the same on every chain", () => {
  const position = {
    ref: { chain: "stellar", contract: STELLAR_POOL, id: "position/3" }, status: "settled", payout: "3571.4285714", settlementPrice: "12",
  } as any;
  assert.deepEqual(settlementResult(position, 10_000, 7), {
    position: `stellar:${STELLAR_POOL}:position/3`, settlementPrice: "12", grossPayout: "3571.4285714", fee: "35.7142857", netPayout: "3535.7142857", status: "settled_claimable",
  });
});
