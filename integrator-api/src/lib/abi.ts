/**
 * Hand-curated ABI fragments — only the functions the integrator API
 * exposes. Avoids shipping the full compiled artifact (megabytes) and
 * makes the surface area visible at a glance.
 *
 * Each fragment is grouped by facet to mirror contracts/src/facets/.
 */

// ── ERC-20 (USDC / USDT) ─────────────────────────────────────────────────

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// ── BlockFinaXHedgeFacet — core business logic ──────────────────────────

export const HEDGE_FACET_ABI = [
  // ── Public actions (anyone can call) ─────────────────────────────────
  "function createEvent(tuple(string name, string underlying, uint256 strike, uint256 payoutCap, uint256 premiumRate, uint256 expiry, bool allowExternalLp, uint256 initialLiquidity, uint256 initialRate, bool strikeAbove, address paymentToken, bytes signature, uint256 quoteTimestamp, bytes32 quoteNonce) params) returns (uint256 eventId)",
  "function deposit(uint256 eventId, uint256 amount) returns (uint256 depositId)",
  "function buyProtection(uint256 eventId, uint256 notional, uint256 maxCost, uint256 deadline) returns (uint256 positionId)",
  "function claimPayout(uint256 positionId)",
  "function claimPremiums(uint256 depositId)",
  "function withdrawCapital(uint256 depositId)",

  // ── Creator-only ─────────────────────────────────────────────────────
  "function setPoolSettings(uint256 eventId, bool poolOpen, bool allowExternalLp)",
  "function withdrawCreatorEarnings(uint256 eventId)",

  // ── Owner / admin ────────────────────────────────────────────────────
  "function initializeHedgeFees(uint256 creationFee, uint256 hedgerFeeRate, uint256 payoutFeeRate, uint256 lpProfitFeeRate, uint256 creatorLoyaltyRate)",
  "function setOracleAdmin(address admin)",
  "function setPricingEngineSigner(address signer)",
  "function activateOracleV2()",
  "function pause()",
  "function unpause()",
  "function withdrawPlatformFees(uint256 amount)",
  "function withdrawPlatformFeesByToken(address token, uint256 amount)",
  "function recoverExpiredPayouts(uint256 eventId)",
  "function rescueETH(address payable to)",
  "function rescueERC20(address token, address to)",
  "function setAllowedPaymentToken(address token, bool allowed)",
  "function settleEvent(uint256 eventId, uint256 settlementPrice)",

  // ── Views ────────────────────────────────────────────────────────────
  // Canonical signatures — verbatim copy from client/src/lib/hedge-contract.ts.
  // Verified against the deployed Diamond on Lisk / Base / BSC. Do NOT rely
  // on audit summaries here; they reorder fields and rename them.
  "function getHedgeEventCore(uint256) view returns (uint256 id, address creator, string name, string underlying, uint256 strike, uint256 premiumRate, uint256 expiryDate, uint8 status, bool poolOpen, bool allowExternalLp, uint256 initialRate, bool strikeAbove)",
  "function getHedgeEventStats(uint256) view returns (uint256 settlementPrice, bool triggered, uint256 settledAt, uint256 creatorEarnings, uint256 totalLiquidity, uint256 totalExposure, uint256 totalPremiums, uint256 lpCount, uint256 hedgerCount, uint256 totalMaxPayout)",
  "function getHedgeEventRange(uint256) view returns (uint256 strike, uint256 payoutCap, uint256 initialRate, bool strikeAbove)",
  "function getHedgePosition(uint256) view returns (uint256 id, uint256 eventId, address hedger, uint256 notional, uint256 premiumPaid, uint256 platformFeePaid, uint256 payoutAmount, uint8 status, bool claimed)",
  "function getHedgeLpDeposit(uint256) view returns (uint256 id, uint256 eventId, address lp, uint256 amount, uint256 shares, uint256 premiumsEarned, uint256 premiumsClaimed, bool withdrawn)",
  "function getEventPositionIds(uint256) view returns (uint256[])",
  "function getEventDepositIds(uint256) view returns (uint256[])",
  "function getCreatorEventIds(address) view returns (uint256[])",
  "function getHedgerPositionIds(address) view returns (uint256[])",
  "function getLpDepositIds(address) view returns (uint256[])",
  "function getHedgeFeeConfig() view returns (uint256 creationFee, uint256 hedgerFeeRate, uint256 payoutFeeRate, uint256 lpProfitFeeRate, uint256 creatorLoyaltyRate)",
  "function getHedgePlatformFees() view returns (uint256)",
  "function getTotalHedgeEvents() view returns (uint256)",
  "function getPoolUtilization(uint256) view returns (uint256 totalLiquidity, uint256 totalExposure, uint256 availableCapacity, uint256 utilizationRate)",
  "function isPaused() view returns (bool)",
  "function isFeesInitialized() view returns (bool)",
  "function getPlatformFeesByToken(address token) view returns (uint256)",
  "function getEventPaymentToken(uint256 eventId) view returns (address)",
  "function isAllowedPaymentToken(address token) view returns (bool)",
  "function getPricingEngineSigner() view returns (address)",
  "function isQuoteNonceUsed(bytes32 nonce) view returns (bool)",
  "function pendingPremiums(uint256 depositId) view returns (uint256)",
  "function quoteRangePayout(uint256 eventId, uint256 hypoSettlement, uint256 notional) view returns (uint256)",
];

// ── BlockFinaXOracleFacet ────────────────────────────────────────────────

export const ORACLE_FACET_ABI = [
  // Admin
  "function addOracle(address oracle)",
  "function removeOracle(address oracle)",
  "function setRequiredSigners(uint256 required)",
  "function setToleranceBps(uint256 bps)",
  "function clearStaleSubmissions(uint256 eventId)",
  // Oracle
  "function submitRate(uint256 eventId, uint256 price)",
  // Views
  "function getOracles() view returns (address[])",
  "function getOracleConfig() view returns (uint256 requiredSigners, uint256 toleranceBps, uint256 oracleCount, uint256 maxOracles)",
  "function isAuthorisedOracle(address) view returns (bool)",
  "function getSubmission(uint256 eventId, address oracle) view returns (uint256 price, uint256 timestamp, bool exists, bool isStale)",
  "function getSubmitterCount(uint256 eventId) view returns (uint256)",
  "function getAllSubmissions(uint256 eventId) view returns (address[] oracles, uint256[] prices, uint256[] timestamps, bool[] stale)",
];

// ── BlockFinaXOwnershipFacet ─────────────────────────────────────────────

export const OWNERSHIP_FACET_ABI = [
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
];

// ── BlockFinaXDiamondLoupeFacet ──────────────────────────────────────────

export const LOUPE_FACET_ABI = [
  "function facets() view returns (tuple(address facetAddress, bytes4[] functionSelectors)[])",
  "function facetFunctionSelectors(address facet) view returns (bytes4[])",
  "function facetAddresses() view returns (address[])",
  "function facetAddress(bytes4 functionSelector) view returns (address)",
];

// ── BlockFinaXTimelockCutFacet (governance) ──────────────────────────────

export const TIMELOCK_FACET_ABI = [
  "function diamondCut(tuple(address facetAddress, uint8 action, bytes4[] functionSelectors)[] cuts, address init, bytes initdata)",
  "function executeCut(bytes32 proposalId)",
  "function cancelCut(bytes32 proposalId)",
  "function getProposal(bytes32 proposalId) view returns (uint8 status, uint256 eta, address init, bytes calldata_)",
  "function getAllCutIds() view returns (bytes32[])",
  "function getPendingCutIds() view returns (bytes32[])",
  "function getPendingCutInfo(bytes32 proposalId) view returns (uint256 eta, bool executed, bool cancelled)",
];

// Union of every selector — used when we need to decode an unknown calldata.
export const ALL_FACETS_ABI = [
  ...HEDGE_FACET_ABI,
  ...ORACLE_FACET_ABI,
  ...OWNERSHIP_FACET_ABI,
  ...LOUPE_FACET_ABI,
  ...TIMELOCK_FACET_ABI,
];
