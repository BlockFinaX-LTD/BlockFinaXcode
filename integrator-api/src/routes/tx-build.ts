/**
 * Calldata builder endpoints — one per state-changing contract function.
 *
 * Each POST returns a `BuiltTx` ({ chainId, to, data, value, function, args,
 * estimatedGas }). The caller signs the data with their own wallet and
 * broadcasts wherever they want.
 *
 * Organized by facet to mirror contracts/src/facets/.
 */

import { Router } from "express";
import { z } from "zod";
import { ethers } from "ethers";
import { getChain } from "../lib/chains";
import { buildDiamondCall, buildErc20Approve, BuiltTx } from "../lib/calldata";
import { HEDGE_FACET_ABI, ORACLE_FACET_ABI, OWNERSHIP_FACET_ABI, TIMELOCK_FACET_ABI } from "../lib/abi";
import { ok } from "../lib/respond";
import { asyncHandler } from "../lib/errors";
import { validate } from "../lib/validate";
import { openapi, BuiltTxSchema, standardErrorResponses } from "../lib/openapi";

const router = Router();

// ── Shared shapes ───────────────────────────────────────────────────────

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "must be 0x-prefixed 40-char hex address");
const Uint256Schema = z.union([
  z.string().regex(/^\d+$/, "must be a non-negative decimal integer string"),
  z.number().int().nonnegative(),
]).transform(v => String(v));

const txResponse = {
  200: { description: "Built transaction", content: { "application/json": { schema: z.object({ data: BuiltTxSchema }) } } },
  ...standardErrorResponses,
};

/** Tiny helper: every endpoint takes optional `from` for gas estimation. */
const fromOpt = z.object({ from: AddressSchema.optional() });

// ─────────────────────────────────────────────────────────────────────────
// ERC-20 — token approval (required before deposit / buyProtection / createEvent)
// ─────────────────────────────────────────────────────────────────────────

const Erc20ApproveBody = fromOpt.extend({
  chainId: z.number().int(),
  token: AddressSchema.describe("Token contract (USDC/USDT)"),
  spender: AddressSchema.describe("Diamond proxy address"),
  amount: Uint256Schema.describe("Amount in token's smallest unit"),
});
router.post("/erc20/approve", validate({ body: Erc20ApproveBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof Erc20ApproveBody>;
    ok(res, await buildErc20Approve({ chainId: b.chainId, token: b.token, spender: b.spender, amount: b.amount, from: b.from }));
  }),
);
openapi.registerPath({
  method: "post", path: "/tx/erc20/approve", tags: ["Tx · ERC-20"],
  summary: "Build ERC-20 approve calldata",
  description: "Required before any hedge action that pulls tokens (createEvent, deposit, buyProtection).",
  request: { body: { content: { "application/json": { schema: Erc20ApproveBody } } } },
  responses: txResponse,
});

// ─────────────────────────────────────────────────────────────────────────
// Hedge facet — user-facing actions
// ─────────────────────────────────────────────────────────────────────────

const CreateEventBody = fromOpt.extend({
  chainId: z.number().int(),
  name: z.string().min(1),
  underlying: z.string().min(3).describe("e.g. USD/GHS"),
  strike: Uint256Schema.describe("Strike price in 1e6 fixed-point"),
  payoutCap: Uint256Schema.describe("Range upper bound (1e6). Pass 0 for single-strike events"),
  premiumRate: Uint256Schema.describe("Rate in 1e6 (e.g. 25000 = 2.5%)"),
  expiry: Uint256Schema.describe("Unix-seconds expiry"),
  allowExternalLp: z.boolean(),
  initialLiquidity: Uint256Schema.describe("Seed liquidity in payment-token decimals"),
  initialRate: Uint256Schema.describe("Spot rate at creation (1e6)"),
  strikeAbove: z.boolean().describe("true = pays out if rate rises above strike"),
  paymentToken: AddressSchema,
  signature: z.string().default("0x").describe("Pricing-engine attestation; \"0x\" for self-priced"),
  quoteTimestamp: Uint256Schema.default("0"),
  quoteNonce: z.string().default(ethers.ZeroHash),
});
router.post("/hedge/create-event", validate({ body: CreateEventBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof CreateEventBody>;
    const tx = await buildDiamondCall({
      chainId: b.chainId, abi: HEDGE_FACET_ABI, fnName: "createEvent", from: b.from,
      args: [[
        b.name, b.underlying, b.strike, b.payoutCap, b.premiumRate, b.expiry,
        b.allowExternalLp, b.initialLiquidity, b.initialRate, b.strikeAbove,
        b.paymentToken, b.signature, b.quoteTimestamp, b.quoteNonce,
      ]],
      prettyArgs: {
        name: b.name, underlying: b.underlying, strike: b.strike, payoutCap: b.payoutCap,
        premiumRate: b.premiumRate, expiry: b.expiry, allowExternalLp: b.allowExternalLp,
        initialLiquidity: b.initialLiquidity, initialRate: b.initialRate,
        strikeAbove: b.strikeAbove, paymentToken: b.paymentToken,
      },
    });
    ok(res, tx);
  }),
);
openapi.registerPath({
  method: "post", path: "/tx/hedge/create-event", tags: ["Tx · Hedge"],
  summary: "Build createEvent calldata",
  description: "Requires a prior ERC-20 approve for (creationFee + initialLiquidity) against the Diamond.",
  request: { body: { content: { "application/json": { schema: CreateEventBody } } } },
  responses: txResponse,
});

const DepositBody = fromOpt.extend({
  chainId: z.number().int(),
  eventId: Uint256Schema,
  amount: Uint256Schema,
});
router.post("/hedge/deposit", validate({ body: DepositBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof DepositBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: HEDGE_FACET_ABI, fnName: "deposit",
      args: [b.eventId, b.amount], from: b.from,
      prettyArgs: { eventId: b.eventId, amount: b.amount },
    }));
  }),
);
openapi.registerPath({
  method: "post", path: "/tx/hedge/deposit", tags: ["Tx · Hedge"],
  summary: "Build LP deposit calldata",
  description: "Requires a prior ERC-20 approve for `amount` against the Diamond.",
  request: { body: { content: { "application/json": { schema: DepositBody } } } },
  responses: txResponse,
});

const BuyProtectionBody = fromOpt.extend({
  chainId: z.number().int(),
  eventId: Uint256Schema,
  notional: Uint256Schema,
  maxCost: Uint256Schema.describe("Slippage cap = premium + platformFee + buffer"),
  deadline: Uint256Schema.describe("Unix-seconds deadline"),
});
router.post("/hedge/buy-protection", validate({ body: BuyProtectionBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof BuyProtectionBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: HEDGE_FACET_ABI, fnName: "buyProtection",
      args: [b.eventId, b.notional, b.maxCost, b.deadline], from: b.from,
      prettyArgs: { eventId: b.eventId, notional: b.notional, maxCost: b.maxCost, deadline: b.deadline },
    }));
  }),
);
openapi.registerPath({
  method: "post", path: "/tx/hedge/buy-protection", tags: ["Tx · Hedge"],
  summary: "Build buyProtection calldata",
  description: "Requires a prior ERC-20 approve for at least `maxCost` against the Diamond.",
  request: { body: { content: { "application/json": { schema: BuyProtectionBody } } } },
  responses: txResponse,
});

const ClaimPayoutBody = fromOpt.extend({ chainId: z.number().int(), positionId: Uint256Schema });
router.post("/hedge/claim-payout", validate({ body: ClaimPayoutBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof ClaimPayoutBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: HEDGE_FACET_ABI, fnName: "claimPayout",
      args: [b.positionId], from: b.from, prettyArgs: { positionId: b.positionId },
    }));
  }),
);
openapi.registerPath({ method: "post", path: "/tx/hedge/claim-payout", tags: ["Tx · Hedge"], summary: "Build claimPayout calldata", request: { body: { content: { "application/json": { schema: ClaimPayoutBody } } } }, responses: txResponse });

const ClaimPremiumsBody = fromOpt.extend({ chainId: z.number().int(), depositId: Uint256Schema });
router.post("/hedge/claim-premiums", validate({ body: ClaimPremiumsBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof ClaimPremiumsBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: HEDGE_FACET_ABI, fnName: "claimPremiums",
      args: [b.depositId], from: b.from, prettyArgs: { depositId: b.depositId },
    }));
  }),
);
openapi.registerPath({ method: "post", path: "/tx/hedge/claim-premiums", tags: ["Tx · Hedge"], summary: "Build claimPremiums calldata", request: { body: { content: { "application/json": { schema: ClaimPremiumsBody } } } }, responses: txResponse });

const WithdrawCapitalBody = fromOpt.extend({ chainId: z.number().int(), depositId: Uint256Schema });
router.post("/hedge/withdraw-capital", validate({ body: WithdrawCapitalBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof WithdrawCapitalBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: HEDGE_FACET_ABI, fnName: "withdrawCapital",
      args: [b.depositId], from: b.from, prettyArgs: { depositId: b.depositId },
    }));
  }),
);
openapi.registerPath({ method: "post", path: "/tx/hedge/withdraw-capital", tags: ["Tx · Hedge"], summary: "Build withdrawCapital calldata", request: { body: { content: { "application/json": { schema: WithdrawCapitalBody } } } }, responses: txResponse });

const SetPoolSettingsBody = fromOpt.extend({
  chainId: z.number().int(),
  eventId: Uint256Schema,
  poolOpen: z.boolean(),
  allowExternalLp: z.boolean(),
});
router.post("/hedge/set-pool-settings", validate({ body: SetPoolSettingsBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof SetPoolSettingsBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: HEDGE_FACET_ABI, fnName: "setPoolSettings",
      args: [b.eventId, b.poolOpen, b.allowExternalLp], from: b.from,
      prettyArgs: { eventId: b.eventId, poolOpen: b.poolOpen, allowExternalLp: b.allowExternalLp },
    }));
  }),
);
openapi.registerPath({ method: "post", path: "/tx/hedge/set-pool-settings", tags: ["Tx · Hedge"], summary: "Build setPoolSettings calldata (creator only)", request: { body: { content: { "application/json": { schema: SetPoolSettingsBody } } } }, responses: txResponse });

const WithdrawCreatorEarningsBody = fromOpt.extend({ chainId: z.number().int(), eventId: Uint256Schema });
router.post("/hedge/withdraw-creator-earnings", validate({ body: WithdrawCreatorEarningsBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof WithdrawCreatorEarningsBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: HEDGE_FACET_ABI, fnName: "withdrawCreatorEarnings",
      args: [b.eventId], from: b.from, prettyArgs: { eventId: b.eventId },
    }));
  }),
);
openapi.registerPath({ method: "post", path: "/tx/hedge/withdraw-creator-earnings", tags: ["Tx · Hedge"], summary: "Build withdrawCreatorEarnings calldata", request: { body: { content: { "application/json": { schema: WithdrawCreatorEarningsBody } } } }, responses: txResponse });

const RecoverExpiredBody = fromOpt.extend({ chainId: z.number().int(), eventId: Uint256Schema });
router.post("/hedge/recover-expired-payouts", validate({ body: RecoverExpiredBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof RecoverExpiredBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: HEDGE_FACET_ABI, fnName: "recoverExpiredPayouts",
      args: [b.eventId], from: b.from, prettyArgs: { eventId: b.eventId },
    }));
  }),
);
openapi.registerPath({ method: "post", path: "/tx/hedge/recover-expired-payouts", tags: ["Tx · Hedge (admin)"], summary: "Build recoverExpiredPayouts calldata (owner only)", request: { body: { content: { "application/json": { schema: RecoverExpiredBody } } } }, responses: txResponse });

// ─────────────────────────────────────────────────────────────────────────
// Hedge facet — admin / governance
// ─────────────────────────────────────────────────────────────────────────

const InitFeesBody = fromOpt.extend({
  chainId: z.number().int(),
  creationFee: Uint256Schema, hedgerFeeRate: Uint256Schema, payoutFeeRate: Uint256Schema,
  lpProfitFeeRate: Uint256Schema, creatorLoyaltyRate: Uint256Schema,
});
router.post("/hedge/initialize-fees", validate({ body: InitFeesBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof InitFeesBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: HEDGE_FACET_ABI, fnName: "initializeHedgeFees",
      args: [b.creationFee, b.hedgerFeeRate, b.payoutFeeRate, b.lpProfitFeeRate, b.creatorLoyaltyRate],
      from: b.from,
      prettyArgs: { creationFee: b.creationFee, hedgerFeeRate: b.hedgerFeeRate, payoutFeeRate: b.payoutFeeRate, lpProfitFeeRate: b.lpProfitFeeRate, creatorLoyaltyRate: b.creatorLoyaltyRate },
    }));
  }),
);
openapi.registerPath({ method: "post", path: "/tx/hedge/initialize-fees", tags: ["Tx · Hedge (admin)"], summary: "Build initializeHedgeFees calldata", request: { body: { content: { "application/json": { schema: InitFeesBody } } } }, responses: txResponse });

const SettleEventBody = fromOpt.extend({ chainId: z.number().int(), eventId: Uint256Schema, settlementPrice: Uint256Schema });
router.post("/hedge/settle-event", validate({ body: SettleEventBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof SettleEventBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: HEDGE_FACET_ABI, fnName: "settleEvent",
      args: [b.eventId, b.settlementPrice], from: b.from,
      prettyArgs: { eventId: b.eventId, settlementPrice: b.settlementPrice },
    }));
  }),
);
openapi.registerPath({ method: "post", path: "/tx/hedge/settle-event", tags: ["Tx · Hedge (admin)"], summary: "Build settleEvent calldata (oracle admin / owner)", request: { body: { content: { "application/json": { schema: SettleEventBody } } } }, responses: txResponse });

const NoArgsBody = fromOpt.extend({ chainId: z.number().int() });
const AmountBody = fromOpt.extend({ chainId: z.number().int(), amount: Uint256Schema });
const TokenAmountBody = fromOpt.extend({ chainId: z.number().int(), token: AddressSchema, amount: Uint256Schema });
const TokenToBody = fromOpt.extend({ chainId: z.number().int(), token: AddressSchema, to: AddressSchema });
const SetAddressBody = fromOpt.extend({ chainId: z.number().int(), address: AddressSchema });
const ToBody = fromOpt.extend({ chainId: z.number().int(), to: AddressSchema });
const TokenAllowedBody = fromOpt.extend({ chainId: z.number().int(), token: AddressSchema, allowed: z.boolean() });

const adminWrite = (path: string, fnName: string, summary: string, schema: z.ZodTypeAny, mapArgs: (b: any) => unknown[], mapPretty: (b: any) => Record<string, any>) => {
  router.post(path, validate({ body: schema }), asyncHandler(async (req, res) => {
    const b = req.body;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: HEDGE_FACET_ABI, fnName, args: mapArgs(b), from: b.from, prettyArgs: mapPretty(b),
    }));
  }));
  openapi.registerPath({ method: "post", path: `/tx${path}`, tags: ["Tx · Hedge (admin)"], summary, request: { body: { content: { "application/json": { schema } } } }, responses: txResponse });
};

adminWrite("/hedge/pause",                   "pause",                   "Build pause calldata",                   NoArgsBody,        () => [],                () => ({}));
adminWrite("/hedge/unpause",                 "unpause",                 "Build unpause calldata",                 NoArgsBody,        () => [],                () => ({}));
adminWrite("/hedge/activate-oracle-v2",      "activateOracleV2",        "Build activateOracleV2 calldata",        NoArgsBody,        () => [],                () => ({}));
adminWrite("/hedge/set-oracle-admin",        "setOracleAdmin",          "Build setOracleAdmin calldata",          SetAddressBody,    b => [b.address],        b => ({ address: b.address }));
adminWrite("/hedge/set-pricing-engine-signer","setPricingEngineSigner", "Build setPricingEngineSigner calldata", SetAddressBody,    b => [b.address],        b => ({ address: b.address }));
adminWrite("/hedge/withdraw-platform-fees",  "withdrawPlatformFees",    "Build withdrawPlatformFees calldata (USDC)", AmountBody,    b => [b.amount],         b => ({ amount: b.amount }));
adminWrite("/hedge/withdraw-platform-fees-by-token", "withdrawPlatformFeesByToken", "Build withdrawPlatformFeesByToken calldata", TokenAmountBody, b => [b.token, b.amount], b => ({ token: b.token, amount: b.amount }));
adminWrite("/hedge/rescue-eth",              "rescueETH",               "Build rescueETH calldata",               ToBody,            b => [b.to],             b => ({ to: b.to }));
adminWrite("/hedge/rescue-erc20",            "rescueERC20",             "Build rescueERC20 calldata",             TokenToBody,       b => [b.token, b.to],    b => ({ token: b.token, to: b.to }));
adminWrite("/hedge/set-allowed-payment-token","setAllowedPaymentToken", "Build setAllowedPaymentToken calldata", TokenAllowedBody,  b => [b.token, b.allowed], b => ({ token: b.token, allowed: b.allowed }));

// ─────────────────────────────────────────────────────────────────────────
// Oracle facet
// ─────────────────────────────────────────────────────────────────────────

const SubmitRateBody = fromOpt.extend({ chainId: z.number().int(), eventId: Uint256Schema, price: Uint256Schema });
router.post("/oracle/submit-rate", validate({ body: SubmitRateBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof SubmitRateBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: ORACLE_FACET_ABI, fnName: "submitRate",
      args: [b.eventId, b.price], from: b.from,
      prettyArgs: { eventId: b.eventId, price: b.price },
    }));
  }),
);
openapi.registerPath({ method: "post", path: "/tx/oracle/submit-rate", tags: ["Tx · Oracle"], summary: "Build submitRate calldata (authorised oracles only)", request: { body: { content: { "application/json": { schema: SubmitRateBody } } } }, responses: txResponse });

const oracleAdminWrite = (path: string, fnName: string, summary: string, schema: z.ZodTypeAny, mapArgs: (b: any) => unknown[], mapPretty: (b: any) => Record<string, any>) => {
  router.post(path, validate({ body: schema }), asyncHandler(async (req, res) => {
    const b = req.body;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: ORACLE_FACET_ABI, fnName, args: mapArgs(b), from: b.from, prettyArgs: mapPretty(b),
    }));
  }));
  openapi.registerPath({ method: "post", path: `/tx${path}`, tags: ["Tx · Oracle (admin)"], summary, request: { body: { content: { "application/json": { schema } } } }, responses: txResponse });
};

const SetUintBody = fromOpt.extend({ chainId: z.number().int(), value: Uint256Schema });
const EventIdBody = fromOpt.extend({ chainId: z.number().int(), eventId: Uint256Schema });

oracleAdminWrite("/oracle/add-oracle",              "addOracle",            "Build addOracle calldata",            SetAddressBody, b => [b.address],     b => ({ address: b.address }));
oracleAdminWrite("/oracle/remove-oracle",           "removeOracle",         "Build removeOracle calldata",         SetAddressBody, b => [b.address],     b => ({ address: b.address }));
oracleAdminWrite("/oracle/set-required-signers",    "setRequiredSigners",   "Build setRequiredSigners calldata",   SetUintBody,    b => [b.value],       b => ({ value: b.value }));
oracleAdminWrite("/oracle/set-tolerance-bps",       "setToleranceBps",      "Build setToleranceBps calldata",      SetUintBody,    b => [b.value],       b => ({ value: b.value }));
oracleAdminWrite("/oracle/clear-stale-submissions", "clearStaleSubmissions","Build clearStaleSubmissions calldata", EventIdBody,    b => [b.eventId],     b => ({ eventId: b.eventId }));

// ─────────────────────────────────────────────────────────────────────────
// Ownership facet
// ─────────────────────────────────────────────────────────────────────────

router.post("/ownership/transfer-ownership", validate({ body: SetAddressBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof SetAddressBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: OWNERSHIP_FACET_ABI, fnName: "transferOwnership",
      args: [b.address], from: b.from, prettyArgs: { newOwner: b.address },
    }));
  }),
);
openapi.registerPath({ method: "post", path: "/tx/ownership/transfer-ownership", tags: ["Tx · Ownership"], summary: "Build transferOwnership calldata", request: { body: { content: { "application/json": { schema: SetAddressBody } } } }, responses: txResponse });

router.post("/ownership/accept-ownership", validate({ body: NoArgsBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof NoArgsBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: OWNERSHIP_FACET_ABI, fnName: "acceptOwnership",
      args: [], from: b.from, prettyArgs: {},
    }));
  }),
);
openapi.registerPath({ method: "post", path: "/tx/ownership/accept-ownership", tags: ["Tx · Ownership"], summary: "Build acceptOwnership calldata", request: { body: { content: { "application/json": { schema: NoArgsBody } } } }, responses: txResponse });

// ─────────────────────────────────────────────────────────────────────────
// TimelockCutFacet — governance proposal lifecycle (owner-only on-chain)
// ─────────────────────────────────────────────────────────────────────────

const Bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, "must be 0x-prefixed 32-byte hex");
const Bytes4Schema  = z.string().regex(/^0x[a-fA-F0-9]{8}$/,  "must be 0x-prefixed 4-byte selector");
const HexBytes      = z.string().regex(/^0x([a-fA-F0-9]{2})*$/, "must be a 0x-prefixed hex string");
const FacetCutAction = z.union([z.literal(0), z.literal(1), z.literal(2)])
  .describe("0 = Add, 1 = Replace, 2 = Remove (matches EIP-2535)");

const FacetCutSchema = z.object({
  facetAddress: AddressSchema,
  action: FacetCutAction,
  functionSelectors: z.array(Bytes4Schema),
});

const DiamondCutBody = fromOpt.extend({
  chainId: z.number().int(),
  cuts: z.array(FacetCutSchema),
  init: AddressSchema.default(ethers.ZeroAddress).describe("Initializer contract; ZeroAddress if no init call"),
  initData: HexBytes.default("0x").describe("Calldata for the init call; \"0x\" when init is ZeroAddress"),
});
router.post("/governance/diamond-cut", validate({ body: DiamondCutBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof DiamondCutBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: TIMELOCK_FACET_ABI, fnName: "diamondCut",
      args: [b.cuts.map(c => [c.facetAddress, c.action, c.functionSelectors]), b.init, b.initData],
      from: b.from,
      prettyArgs: { cutCount: b.cuts.length, init: b.init },
    }));
  }),
);
openapi.registerPath({
  method: "post", path: "/tx/governance/diamond-cut", tags: ["Tx · Governance"],
  summary: "Build diamondCut calldata (queues an upgrade through the timelock)",
  description: "Owner-only on-chain. The proposal must then sit through the timelock delay before executeCut() can run it.",
  request: { body: { content: { "application/json": { schema: DiamondCutBody } } } },
  responses: txResponse,
});

const ProposalBody = fromOpt.extend({ chainId: z.number().int(), proposalId: Bytes32Schema });
router.post("/governance/execute-cut", validate({ body: ProposalBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof ProposalBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: TIMELOCK_FACET_ABI, fnName: "executeCut",
      args: [b.proposalId], from: b.from, prettyArgs: { proposalId: b.proposalId },
    }));
  }),
);
openapi.registerPath({
  method: "post", path: "/tx/governance/execute-cut", tags: ["Tx · Governance"],
  summary: "Build executeCut calldata (apply a proposal after the delay)",
  request: { body: { content: { "application/json": { schema: ProposalBody } } } },
  responses: txResponse,
});

router.post("/governance/cancel-cut", validate({ body: ProposalBody }),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof ProposalBody>;
    ok(res, await buildDiamondCall({
      chainId: b.chainId, abi: TIMELOCK_FACET_ABI, fnName: "cancelCut",
      args: [b.proposalId], from: b.from, prettyArgs: { proposalId: b.proposalId },
    }));
  }),
);
openapi.registerPath({
  method: "post", path: "/tx/governance/cancel-cut", tags: ["Tx · Governance"],
  summary: "Build cancelCut calldata (abort a pending proposal)",
  request: { body: { content: { "application/json": { schema: ProposalBody } } } },
  responses: txResponse,
});

export default router;
