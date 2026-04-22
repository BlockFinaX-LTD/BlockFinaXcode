# BlockFinaX — Master TODO List

> Generated 2026-04-17 from deployment files, code review, and V2 audit findings.
> Verify each item on-chain before acting — deployment JSONs may be stale.

---

## CRITICAL — Ownership Transfers

All v3-fixed Diamonds have `transferOwnership()` completed (Step 1) but
`acceptOwnership()` (Step 2) may still be pending. The deployer EOA retains
full control until the Safe calls `acceptOwnership()`.

| # | Chain | Diamond | Safe (pendingOwner) | Action |
|---|-------|---------|---------------------|--------|
| 1 | Lisk v3-fixed | `0x885E6636...D31E3D700` | `0xfce89FA9...14699D` (2-of-2) | Safe calls `acceptOwnership()` |
| 2 | Base v3-fixed | `0xcC594031...115E6E6` | `0x7909a2f1...189Bb` (2-of-3) | Safe calls `acceptOwnership()` |
| 3 | BSC v3-fixed | `0xcC594031...115E6E6` | `0x2a0ab363...10807` (2-of-3) | Safe calls `acceptOwnership()` |
| 4 | Lisk Sepolia | `0x3582D8f5...445bf` | `0x60719b73...05fDB` (2-of-3) | Safe calls `acceptOwnership()` |

**Script:** `npx hardhat run scripts/safe-accept-ownership.js --network <network>`
Requires env vars: `SAFE_OWNER_KEY_1`, `SAFE_OWNER_KEY_2`

---

## CRITICAL — Activate Oracle V2

`activateOracleV2()` has **not** been called on any chain. Until it is, the deployer
EOA (`0xef5Bed...037d`) can unilaterally settle any event via `settleEvent()`.

| # | Chain | Diamond | oracleV2Active | Action |
|---|-------|---------|----------------|--------|
| 5 | Lisk v3-fixed | `0x885E6636...` | `false` | Owner calls `activateOracleV2()` |
| 6 | Lisk v2 | `0x69cB5B...8465` | `false` | Owner calls `activateOracleV2()` |
| 7 | Base | `0xbCC51E...88Ef` | `false` | Owner calls `activateOracleV2()` |
| 8 | BSC | `0xaC939C...80fc` | `false` | Owner calls `activateOracleV2()` |

**Prerequisite:** Confirm all 3 oracle nodes are live and submitting rates correctly
before calling. This is a **one-way irreversible** switch.

---

## HIGH — V2 Audit Fix Deployment

The V2 audit found a dead-migration bug and added `migrateLegacyPlatformFees()`.
These changes need to be deployed to all chains.

| # | Action | Details |
|---|--------|---------|
| 9 | Deploy new HedgeFacet to all chains | Includes `migrateLegacyPlatformFees()`, fixed `withdrawPlatformFees()`, `onlyOwner` on `recoverExpiredPayouts` |
| 10 | Deploy new OracleFacet to all chains | Includes median pricing, tolerance bounds 1-200 bps |
| 11 | Diamond cut (upgrade) on each chain | Replace HedgeFacet + OracleFacet selectors via timelock proposal |
| 12 | Call `migrateLegacyPlatformFees()` on each chain | One-time migration of pre-v3 USDC fees into per-token mapping |

**Note:** On timelocked chains, Step 11 requires a 48-hour wait between proposal and execution.

---

## HIGH — V6 Timelock Proposal (Lisk v3-fixed)

A v6-audit upgrade was proposed but may not have been executed yet.

| # | Detail | Value |
|---|--------|-------|
| 13 | Diamond | `0x885E663645173a0791b82f0e6608921D31E3D700` |
| | Proposal ID | `0x79db6615...ee955ce` |
| | ETA | 2026-04-04T13:31:31Z |
| | Action | Check if executed. If not, call `executeCut(proposalId)` or re-propose if expired (30-day MAX_PROPOSAL_AGE) |

---

## MEDIUM — Oracle Admin Rotation

The oracle admin on all chains is still the deployer EOA. After `activateOracleV2()`
this becomes irrelevant, but until then it should be rotated to a more secure address
or set to `address(0)`.

| # | Chain | Current Oracle Admin | Action |
|---|-------|---------------------|--------|
| 14 | All chains | `0xef5Bed7c...037d` (deployer EOA) | `setOracleAdmin(address(0))` after activating V2, or rotate to a dedicated key |

---

## MEDIUM — Contract Verification

| # | Chain | Action |
|---|-------|--------|
| 15 | Lisk Mainnet (v1) | Verify all contracts on Blockscout |
| 16 | Lisk v3-fixed | Verify new facets on Blockscout |
| 17 | Base | Verify via Etherscan (`npx hardhat verify`) |
| 18 | BSC | Verify via BscScan (`npx hardhat verify`) |

**Script:** `npx hardhat run scripts/verify-all-chains.js`

---

## MEDIUM — Test Suite Expansion

A 43-test suite was created in the V2 audit. The following areas still need coverage:

| # | Test Area | Priority |
|---|-----------|----------|
| 19 | Max deposits per event (200 cap) | Medium |
| 20 | Max positions per event (500 cap) | Medium |
| 21 | Premium dust accumulation over many buyProtection rounds | Medium |
| 22 | Multi-token events (USDT payment token) | Medium |
| 23 | LP withdrawal order independence (C-1 fix verification) | High |
| 24 | Oracle disagreement + stale threshold scenarios | Medium |
| 25 | Oracle resubmit cooldown enforcement | Medium |
| 26 | Timelock proposal → wait → execute flow | Medium |
| 27 | claimPremiums MasterChef accumulator accuracy | High |
| 28 | recoverExpiredPayouts after 90-day grace period | Medium |

---

## LOW — Lisk Mainnet v1 Pending Actions

From `deployments-diamond-liskMainnet.json`:

| # | Action | Status |
|---|--------|--------|
| 29 | Register oracle wallets (`addOracle` x3) | Check on-chain — may already be done |
| 30 | `setRequiredSigners(2)` | Check on-chain |
| 31 | `transferOwnership()` to Safe `0x60719b...5fDB` | Check on-chain |
| 32 | Safe calls `acceptOwnership()` | Check on-chain |

---

## LOW — Feature: Range Strike & LP Tokens

From `docs/range-strike-lp-token-design.md` — status: **Proposed, not implemented**.

| # | Open Question | Notes |
|---|--------------|-------|
| 33 | Minimum strike step — fixed bps or creator-configurable? | Architectural decision needed |
| 34 | Should distance-based premium formula be independently upgradeable? | Facet design decision |
| 35 | Max positions per event with per-position strikes? | Gas risk in settlement loop |
| 36 | Support both directions (above AND below) in one event? | Product decision |
| 37 | How does `recoverExpiredPayouts` work with per-position strikes? | Implementation detail |

---

## Summary by Priority

| Priority | Count | Items |
|----------|-------|-------|
| **CRITICAL** | 8 | #1-8 (ownership transfers + oracle V2 activation) |
| **HIGH** | 5 | #9-13 (V2 audit deployment + V6 proposal check) |
| **MEDIUM** | 15 | #14-28 (oracle admin, verification, tests) |
| **LOW** | 9 | #29-37 (v1 checks, range strike design) |
| **Total** | **37** | |
