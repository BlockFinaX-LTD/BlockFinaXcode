# BlockFinaX Smart Contracts — Step by Step

This doc walks through every Solidity file in [contracts/src/](../contracts/src/) and explains what it does in plain English, with the math and the intuition behind the math.

If you have never touched the Diamond pattern, start at the top. If you only care about the hedging formulas, jump to [The Hedge Lifecycle and the Math](#the-hedge-lifecycle-and-the-math).

---

## 1. The Big Picture

BlockFinaX is a **parametric FX-protection marketplace**. Two kinds of users meet in a pool:

- **Hedgers** — people exposed to a currency moving against them (e.g. a Ghanaian importer who must pay USD invoices but earns GHS). They want insurance against bad moves.
- **Liquidity Providers (LPs)** — people who lend USDC to back that insurance. In exchange they collect premiums.

A neutral piece of code (the contract) holds the money, runs the math, and pays out automatically when an oracle confirms the trigger price was hit.

The whole protocol is built as a single upgradeable contract using **EIP-2535, the Diamond Standard**. Think of the Diamond as one address with many "facets" (modules) plugged into it.

---

## 2. Diamond Pattern Primer (so the rest makes sense)

A normal smart contract is one binary at one address. If you want to upgrade it, you typically deploy a proxy that delegates to an implementation. The Diamond extends this idea: instead of one implementation, you have **many implementations (facets)**, and the proxy routes each function call to the right facet based on its 4-byte selector.

### Why?

- One contract address forever (good for users, integrators, indexers).
- Bypasses the 24 KB contract size limit by spreading code across facets.
- Can add, replace, or remove individual functions without redeploying everything.

### The three storage slots

If multiple facets share the same `delegatecall` storage, slot collisions would corrupt state. The Diamond pattern solves this with **deterministic storage positions**: each library picks a unique `keccak256("...")` hash and writes to that slot. Three slots are used here:

| Slot key | Defined in | Holds |
|---|---|---|
| `keccak256("diamond.standard.diamond.storage")` | [LibDiamond.sol:7](../contracts/src/libraries/LibDiamond.sol#L7) | Selector → facet routing table, owner |
| `keccak256("blockfinax.app.storage")` | [LibAppStorage.sol:24](../contracts/src/libraries/LibAppStorage.sol#L24) | All hedge events, positions, deposits, fees |
| `keccak256("blockfinax.oracle.v2.storage")` | [LibOracleStorage.sol:28](../contracts/src/libraries/LibOracleStorage.sol#L28) | Oracle registry and price submissions |

Because these positions are 256-bit hashes, the chance of accidental collision is effectively zero.

---

## 3. The Files, One by One

### 3.1 [Diamond.sol](../contracts/src/Diamond.sol) — The Front Door

This is the only address users interact with.

**Constructor** ([Diamond.sol:9-31](../contracts/src/Diamond.sol#L9-L31)):

1. Sets the contract owner.
2. Stores the USDC token address into AppStorage.
3. Wires in the *DiamondCut facet* so the owner can later add more facets.

**Fallback function** ([Diamond.sol:35-55](../contracts/src/Diamond.sol#L35-L55)):

Every external call lands here. The pattern is:

```
1. Look up: facet = selectorToFacetAndPosition[msg.sig]
2. Require facet != address(0)
3. delegatecall to that facet with the original calldata
4. Return whatever the facet returned
```

`delegatecall` is the magic word. It runs the facet's bytecode but in the Diamond's storage. So even though the code lives at facet addresses, the data lives at the Diamond.

**Receive function** ([Diamond.sol:63-65](../contracts/src/Diamond.sol#L63-L65)): rejects raw ETH because this contract only handles USDC. (Stuck ETH from before this fix can be rescued by `HedgeFacet.rescueETH()`.)

### 3.2 [IDiamondCut.sol](../contracts/src/interfaces/IDiamondCut.sol) and [IDiamondLoupe.sol](../contracts/src/interfaces/IDiamondLoupe.sol)

Standard EIP-2535 interfaces.

- **Cut** = mutate the facet table (Add, Replace, Remove function selectors).
- **Loupe** = read the facet table (which selectors map to which facets).

### 3.3 [LibDiamond.sol](../contracts/src/libraries/LibDiamond.sol) — The Routing Table Logic

Holds:

```solidity
struct DiamondStorage {
    mapping(bytes4 => address) selectorToFacetAndPosition;  // function → facet
    mapping(address => bytes4[]) facetFunctionSelectors;    // facet → its functions
    address[] facetAddresses;                               // all known facets
    address contractOwner;
    address pendingOwner;                                    // 2-step transfer
}
```

Key functions: `addFunctions`, `replaceFunctions`, `removeFunctions`, plus `transferOwnership` / `acceptOwnership` (two-step pattern so a typo in the new owner address can't permanently lock out the protocol).

### 3.4 [BlockFinaXDiamondCutFacet.sol](../contracts/src/facets/BlockFinaXDiamondCutFacet.sol) — The Default Cut Facet

A 16-line facet whose only job is to expose `diamondCut(...)` and gate it behind `enforceIsContractOwner()`. Calling this lets the owner upgrade the protocol immediately.

This is the *unsafe* version. In production it gets replaced with the timelock version below.

### 3.5 [BlockFinaXTimelockCutFacet.sol](../contracts/src/facets/BlockFinaXTimelockCutFacet.sol) — The Safe Cut Facet

Same `diamondCut(...)` selector, totally different behaviour. Now an upgrade is a **two-step process**:

1. **Propose**: owner calls `diamondCut(...)`. The proposal is stored, a 48-hour timer starts (`TIMELOCK_DELAY = 48 hours`), `CutProposed` is emitted.
2. **Wait** 48 hours. The community sees the proposed change and can react.
3. **Execute**: owner calls `executeCut(proposalId)`. Now the upgrade actually happens.

The owner can also `cancelCut(proposalId)` at any time before execution. Proposals expire after 30 days (`MAX_PROPOSAL_AGE`) to prevent stale upgrades from being executed long after they were forgotten.

**The math here is small but important — collision-free proposal IDs**:

```solidity
proposalId = keccak256(abi.encode(
    facetCuts, init, callData,
    block.timestamp, block.number,
    ++ts.nonce
));
```

The nonce is incremented before hashing. Without it, two identical proposals submitted in the same block would produce the same ID and one would overwrite the other.

Validation runs at proposal time: every Add/Replace target must have non-zero bytecode. This catches typos (e.g. proposing an EOA address) **before** the 48-hour wait, not after.

### 3.6 [BlockFinaXDiamondLoupeFacet.sol](../contracts/src/facets/BlockFinaXDiamondLoupeFacet.sol) and [BlockFinaXOwnershipFacet.sol](../contracts/src/facets/BlockFinaXOwnershipFacet.sol)

Read-only facets.

- **Loupe** lets indexers / block explorers enumerate facets and selectors. Required by EIP-2535.
- **Ownership** exposes `owner()`, `pendingOwner()`, `transferOwnership()`, `acceptOwnership()` — thin wrappers around the LibDiamond two-step pattern.

### 3.7 [LibAppStorage.sol](../contracts/src/libraries/LibAppStorage.sol) — Where Hedge Data Lives

The single struct `AppStorage` contains every piece of hedge state. Critical fields:

```solidity
mapping(uint256 => HedgeEvent)     hedgeEvents;       // every market
mapping(uint256 => HedgePosition)  hedgePositions;    // every hedger
mapping(uint256 => HedgeLpDeposit) hedgeLpDeposits;   // every LP deposit

HedgeFeeConfig hedgeFeeConfig;                         // global fees
bool hedgeReentrancyLock;                              // shared mutex
bool paused;                                           // emergency stop
mapping(address => uint256) tokenReserves;             // C-2 anti-donation
```

Two patterns to notice:

1. **Reentrancy lock in storage, not in a contract variable**. Because facets share storage via delegatecall, the lock has to live in AppStorage so any facet (HedgeFacet, OracleFacet) sees the same flag.
2. **Internal `tokenReserves` accounting**. The contract never trusts `IERC20.balanceOf(this)` for fee math. Instead it increments/decrements its own ledger on every transfer. This blocks "donation attacks" where an attacker sends extra tokens to inflate the balance and trick fee logic.

### 3.8 [LibOracleStorage.sol](../contracts/src/libraries/LibOracleStorage.sol) — Where Oracle Data Lives

Holds the registered oracles, the consensus parameters, and per-event submissions:

```solidity
struct OracleStorage {
    address[] oracles;
    mapping(address => bool) isOracle;
    uint256 requiredSigners;     // e.g. 2-of-3
    uint256 toleranceBps;        // e.g. 100 = 1% spread allowed
    mapping(uint256 => mapping(address => Submission)) submissions;
    mapping(uint256 => address[]) submitters;
    mapping(uint256 => mapping(address => uint256)) lastSubmitTime;
}
```

It deliberately uses its own storage slot (a different keccak256 hash) so it cannot collide with AppStorage even if added later.

---

## 4. The Hedge Lifecycle and the Math

This is the heart of the system. All of it lives in [BlockFinaXHedgeFacet.sol](../contracts/src/facets/BlockFinaXHedgeFacet.sol).

A few constants to keep in mind:

| Constant | Value | Meaning |
|---|---|---|
| `PRECISION` | `1e6` | Denominator for percentages (so 25_000 / 1e6 = 2.5%) |
| `SHARES_PRECISION` | `1e18` | Multiplier for first-deposit share minting |
| `ACC_PREMIUM_MULTIPLIER` | `1e18` | Resolution for the per-share premium accumulator |
| `MAX_POSITIONS_PER_EVENT` | `500` | Caps the settlement loop's gas cost |
| `MAX_DEPOSITS_PER_EVENT` | `200` | Caps deposit growth per event |

USDC has **6 decimals** — every monetary number you see (10 * PRECISION = 10_000_000) is just $10.

### Step 1 — Owner initializes fees ([initializeHedgeFees](../contracts/src/facets/BlockFinaXHedgeFacet.sol#L267))

Sets the global fee schedule. All rates are stored as fractions of `PRECISION = 1e6`:

| Field | Cap | What it taxes |
|---|---|---|
| `eventCreationFee` | $1,000 | Flat fee at event creation |
| `hedgerFeeRate` | 10% | % of notional, charged when hedger buys |
| `hedgerPayoutFeeRate` | 10% | % of gross payout, deducted at claim |
| `lpProfitFeeRate` | 10% | % of premium claim, deducted at LP claim |
| `creatorLoyaltyRate` | 50% | % of every fee that goes back to the event creator |

### Step 2 — Creator opens an event ([createEvent](../contracts/src/facets/BlockFinaXHedgeFacet.sol#L732))

The creator picks:

- A currency pair label (`"USD/GHS"`).
- A `strike` price (the trigger).
- A `premiumRate` (what hedgers pay per unit of coverage).
- An `initialRate` (today's market price).
- A direction: `strikeAbove = true` means hedgers win if price **rises** to the strike (USD weakens vs GHS); `false` means hedgers win on a fall.
- An `expiryDate` (max 365 days out).
- An `initialLiquidity` (their own seed deposit, ≥ 10 USDC).

#### Sanity check on the strike

```solidity
if (strikeAbove)  require(strike > initialRate, ...);
else              require(strike < initialRate, ...);
```

Otherwise the event would be triggered the moment it was created.

#### The 10× delta cap (M-02 fix)

```solidity
priceDelta = strikeAbove ? strike - initialRate : initialRate - strike;
require(priceDelta <= initialRate * 10, ...);
```

**Why?** The predetermined payout per dollar of notional is `priceDelta / initialRate` (see Step 4). If the creator could set `strike = 1000 × initialRate`, every hedger would get 1000× their notional — draining the pool with one tiny purchase. Capping `priceDelta ≤ 10 × initialRate` keeps payouts at ≤ 10× notional, which already covers any realistic FX move.

#### Creator's seed deposit becomes the first LP deposit

```solidity
shares = amount * SHARES_PRECISION / PRECISION
       = amount * 1e18 / 1e6
       = amount * 1e12
```

A 100 USDC deposit (`amount = 100 * 1e6`) mints `1e20` shares. The 1e12 multiplier just gives plenty of resolution for later deposits to be priced fairly.

### Step 3 — More LPs deposit ([deposit](../contracts/src/facets/BlockFinaXHedgeFacet.sol#L987))

For deposits **after** the first one:

```
shares = amount * totalActiveShares / totalLiquidity
```

This is the classic **Balancer / Uniswap-V2 style minting**. The intuition:

> A new LP should own a fraction of the pool equal to the fraction of capital they just put in.

If the pool currently has 1000 USDC backed by 1e20 shares, and you deposit 100 USDC:

```
shares = 100e6 * 1e20 / 1000e6 = 1e19   (10% of the post-deposit pool)
```

So you walk away with 10% of the pool's shares — perfectly proportional.

**M-03 fix — the zero-share guard**:

```solidity
require(shares > 0, "Deposit too small relative to pool size...");
```

Without this, if the pool is enormous and your deposit is tiny, integer division could produce 0 shares — you'd add liquidity with no claim on it. That'd be a free donation to existing LPs. Reverting protects naive depositors.

**MasterChef reward debt** (set on every deposit):

```
rewardDebt = shares * accPremiumPerShare / ACC_PREMIUM_MULTIPLIER
```

This is the trick that lets the contract distribute premiums in O(1). We'll explain it fully in Step 5.

### Step 4 — A hedger buys protection ([buyProtection](../contracts/src/facets/BlockFinaXHedgeFacet.sol#L1091))

The hedger picks a `notional` (size of coverage in USDC). The contract computes everything:

#### a) Predetermined payout

```
priceDelta          = |strike - initialRate|
predeterminedPayout = notional * priceDelta / initialRate
```

**Intuition.** This is just the percentage move from initial to strike, multiplied by the notional. If the rate has to move 10% to reach the strike, a $1,000 notional pays out $100. The payout is **fixed at purchase time**, so the hedger knows exactly what they get if the strike is touched. That's why it's called *parametric* insurance: there's no claims process, no damage assessment, just a fixed dollar payout if a single objective condition is true.

#### b) Premium

```
premium = notional * premiumRate / PRECISION
```

A 2.5% premium on $1,000 notional = $25. This goes straight to LPs (Step 5).

#### c) Platform fee

```
platformFee = notional * hedgerFeeRate / PRECISION
```

This is on top of the premium and is split between the protocol and the event creator (creator loyalty).

#### d) Total cost

```
totalCost = premium + platformFee
```

The hedger transfers `totalCost` USDC and a position is created.

#### e) Solvency check — pool has to be able to pay

```
availableLiquidity = totalLiquidity - totalMaxPayout
require(predeterminedPayout <= availableLiquidity);
```

`totalMaxPayout` is the running sum of all promised payouts. We never let it exceed `totalLiquidity`. This is the single most important invariant of the contract: **the pool can always pay every winner**.

#### f) Slippage and deadline guards (M-3 fix)

```
require(block.timestamp <= _deadline);
require(totalCost <= _maxCost);
```

If the user's transaction sits in the mempool while fees change, they can revert it instead of overpaying — same idea as Uniswap's `amountOutMin` and `deadline`.

#### g) Fee snapshot (Fix 1)

The first call to `_eventFees` returns rates **snapshotted at event-creation time**, not the live config:

```
if (evt.feeSnapshotSet) return (evt.snapshotHedgerFeeRate, ...);
```

This guarantees that an owner who later raises fees can't retroactively tax a hedger who already paid in good faith.

### Step 5 — Premiums get distributed ([_distributePremiumToLps](../contracts/src/facets/BlockFinaXHedgeFacet.sol#L1813))

Every `buyProtection()` call ends with the premium being split among LPs in proportion to their shares. **The naive approach would loop over every LP**:

```
for each LP: LP.earned += premium * LP.shares / totalShares     // O(n), expensive
```

Instead, the contract uses the **MasterChef accumulator pattern** (popularized by SushiSwap / PancakeSwap). It's O(1) per buy and O(1) per claim, no matter how many LPs.

#### The accumulator

We maintain a single per-event scalar `accPremiumPerShare`. Conceptually it tracks "if you had owned 1 share since the very beginning, how many tokens would you have earned in total?" Multiplied by `ACC_PREMIUM_MULTIPLIER = 1e18` for resolution.

On every premium distribution:

```
increment           = premium * 1e18 / totalActiveShares
accPremiumPerShare += increment
```

So if the pool has 1e20 shares and the premium is 25 USDC (25e6):

```
increment = 25e6 * 1e18 / 1e20 = 25e4
```

That tiny number gets added to the global accumulator.

#### Reward debt

When an LP deposits, they store `rewardDebt = shares * accPremiumPerShare / 1e18` — that's "what I would have earned if I had been here from the start." Later they can claim:

```
accrued    = shares * accPremiumPerShare / 1e18
claimable  = accrued - rewardDebt
```

The subtraction means they only get premiums distributed **after** they joined. The contract never has to remember the per-LP history — it just remembers the global accumulator and the personal "starting line."

#### Dust handling (H-2 fix)

```
scaledPremium = premium * 1e18
increment     = scaledPremium / totalActiveShares
remainder     = scaledPremium % totalActiveShares
```

Integer division loses up to `(totalActiveShares - 1)` units per buy. That's silently lost dust. The fix accumulates it in `evt.premiumDust` and flushes it whenever the dust grows past `totalActiveShares`:

```
evt.premiumDust += remainder;
if (evt.premiumDust >= totalActiveShares) {
    bonusIncrements    = evt.premiumDust / totalActiveShares;
    increment         += bonusIncrements;
    evt.premiumDust    = evt.premiumDust % totalActiveShares;
}
```

Now zero premiums are lost over the long run.

### Step 6 — Settlement ([settleEvent](../contracts/src/facets/BlockFinaXHedgeFacet.sol#L1198))

An authorised oracle (or the multi-oracle facet, see §5) posts the final FX rate. The trigger is one-touch / European-style:

```
triggered = strikeAbove
  ? settlementPrice >= strike
  : settlementPrice <= strike;
```

Several timing & sanity checks fire:

- The oracle can only settle **before expiry** if the strike has already been touched (the event is economically resolved). After expiry, settlement is always allowed.
- `settlementPrice` must be within `[initialRate / 100, initialRate * 100]` — a 100× sanity band that catches off-by-six-zero typos.
- The event must have ≥ 1 hedger position OR be expired. Otherwise an oracle could settle an empty event before any user has had a chance to participate.

When triggered, every Active position becomes `Claimable`. When not triggered, every Active position becomes `Expired` with `payoutAmount = 0`.

**C-1 fix — snapshot the pool size**:

```
evt.liquidityAtSettlement = evt.totalLiquidity;
```

This number is later used as the denominator when LPs withdraw. Without it, the denominator would shrink as LPs leave one by one, and late withdrawers would be charged a disproportionately large share of the remaining payouts.

### Step 7 — Hedger claims payout ([claimPayout](../contracts/src/facets/BlockFinaXHedgeFacet.sol#L1282))

```
grossPayout    = pos.payoutAmount
payoutFee      = grossPayout * payoutFeeRate / PRECISION
netPayout      = grossPayout - payoutFee
creatorReward  = payoutFee * creatorLoyaltyRate / PRECISION
netPayoutFee   = payoutFee - creatorReward
```

The platform takes its fee, the creator gets a slice (loyalty), and the hedger gets the rest.

A subtle but important detail:

```
evt.totalMaxPayout -= grossPayout;
```

As hedgers claim, the reservation shrinks. Otherwise LPs who withdraw later would still be deducted for payouts that have already been mailed out.

### Step 8 — LP claims premiums ([claimPremiums](../contracts/src/facets/BlockFinaXHedgeFacet.sol#L1358))

The MasterChef formula again:

```
accrued    = dep.shares * evt.accPremiumPerShare / 1e18
claimable  = accrued - dep.rewardDebt
```

After the claim, `dep.rewardDebt = accrued` — the personal "starting line" advances so they don't double-claim next time.

`lpProfitFeeRate` and `creatorLoyaltyRate` are then applied the same way as in Step 7.

The H-01 fix blocks `claimPremiums()` after `withdrawn = true`, otherwise (since shares aren't zeroed on withdrawal) an LP could keep claiming forever after pulling their capital.

### Step 9 — LP withdraws capital ([withdrawCapital](../contracts/src/facets/BlockFinaXHedgeFacet.sol#L1434))

Only allowed after the event is no longer Open. The math:

```
if (triggered && totalMaxPayout > 0):
    refLiquidity   = liquidityAtSettlement (snapshot)
    lpPayoutShare  = totalMaxPayout * dep.amount / refLiquidity
    withdrawAmount = max(0, dep.amount - lpPayoutShare)
else:
    withdrawAmount = dep.amount
```

**Intuition.** If hedgers won, LPs collectively owe `totalMaxPayout`. Each LP pays a slice **proportional to how much they put in**. If you contributed 10% of the pool, you absorb 10% of the loss. Everything else comes back to you.

If hedgers lost, you get your full deposit back **plus** all the premiums you've collected along the way. That's the LP's profit case.

### Step 10 — Cleanup: recover expired payouts ([recoverExpiredPayouts](../contracts/src/facets/BlockFinaXHedgeFacet.sol#L448))

Hedgers have 90 days after settlement to claim. Anything still unclaimed gets swept into platform fees so funds don't sit forever. The function:

1. Walks all `Claimable` positions.
2. Sums their `payoutAmount` into `residual` and marks them `Expired`.
3. Subtracts `residual` from `totalMaxPayout`.
4. Reconciles against `tokenReserves[token]` (never trusting raw `balanceOf`).
5. Credits `residual` to platform fees.

---

## 5. The Multi-Oracle Settlement Path

[BlockFinaXOracleFacet.sol](../contracts/src/facets/BlockFinaXOracleFacet.sol) is an additive upgrade that replaces single-key oracle settlement with **multi-signer consensus**. The lifecycle:

1. Owner registers up to `MAX_ORACLES = 10` oracle wallets.
2. Owner picks `requiredSigners` (default 2) and `toleranceBps` (default 100 = 1%).
3. Each oracle node independently calls `submitRate(eventId, price)` when it sees the strike has been touched.
4. After every submission, `_checkConsensus()` runs.
5. Once enough agreeing submissions land, the event auto-settles in the same transaction.

### The math: spread, average, and stale filtering

Each call collects all submissions whose age is `≤ STALE_THRESHOLD = 15 min`:

```
spread = (maxPrice - minPrice) * 10000 / minPrice         // basis points
```

10000 bps = 100%. So `spread = 50` means the highest submission is 0.5% above the lowest. Compared to `toleranceBps`:

- `spread > toleranceBps` → all submissions cleared, oracles must resubmit.
- `spread ≤ toleranceBps` → consensus reached.

The agreed price is the **integer mean**:

```
agreedPrice = sum(validPrices) / validCount
```

Then `_settleEvent()` mirrors the HedgeFacet logic — same field writes, same loop, so downstream `claimPayout` / `withdrawCapital` work identically regardless of which path settled the event.

### Defences against malicious oracles

- **`RESUBMIT_COOLDOWN = 5 min`**: an oracle can't resubmit a new price too quickly. Without this, a malicious node could oscillate prices to perpetually clear consensus and DoS settlement.
- **H-3 fix**: when consensus fails by disagreement, `lastSubmitTime` is **preserved**, so the cooldown stays in effect. When consensus succeeds, it's deleted (no need anymore).
- **M-6 fix**: `removeOracle()` reverts if the resulting oracle count would fall below `requiredSigners` — otherwise the protocol could end up in a state where consensus is mathematically impossible.
- **Cross-facet reentrancy lock**: both HedgeFacet and OracleFacet share `s.hedgeReentrancyLock` from AppStorage, so a re-entrant call from one facet into the other is blocked.

### Coexistence with the single-key path

The HedgeFacet still has `settleEvent()` for the single-key oracle admin. Once oracles are tested in production, the owner calls `activateOracleV2()` — a one-way switch that **permanently disables** the single-key path. From then on, only multi-oracle consensus can settle events.

---

## 6. Recap of Every Math Formula (Cheat Sheet)

| Where | Formula | Why |
|---|---|---|
| Initial LP deposit | `shares = amount * 1e18 / 1e6` | Bootstraps the share supply with high resolution |
| Subsequent LP deposits | `shares = amount * totalActiveShares / totalLiquidity` | Proportional minting (Balancer-style) |
| Predetermined payout | `payout = notional * |strike − initialRate| / initialRate` | Fixed payout at purchase, parametric trigger |
| Premium | `premium = notional * premiumRate / 1e6` | Fee structure with PRECISION denominator |
| Platform fee (hedger) | `fee = notional * hedgerFeeRate / 1e6` | Same idea |
| Total cost to hedger | `totalCost = premium + platformFee` | What the hedger pays |
| Pool solvency check | `predeterminedPayout ≤ totalLiquidity − totalMaxPayout` | Pool must always be able to pay all winners |
| Premium accumulator | `accPremiumPerShare += premium * 1e18 / totalActiveShares` | O(1) MasterChef distribution |
| LP claimable | `claimable = shares * accPremiumPerShare / 1e18 − rewardDebt` | Lazy pull of LP's earned share |
| LP loss share at withdraw | `lpPayoutShare = totalMaxPayout * dep.amount / liquidityAtSettlement` | Proportional loss absorption |
| Strike trigger | `triggered = strikeAbove ? price ≥ strike : price ≤ strike` | One-touch parametric trigger |
| Oracle spread | `spread = (max − min) * 10000 / min` | Basis-points disagreement metric |
| Oracle agreed price | `agreedPrice = sum(validPrices) / validCount` | Simple mean of fresh submissions |
| Pool utilization | `utilization = totalMaxPayout * 100 * 1e6 / totalLiquidity` | Reserved fraction of liquidity |

---

## 7. Patterns and Defences You Will See Repeatedly

- **CEI ordering** (Checks → Effects → Interactions): every state change happens **before** any external call (`safeTransfer` / `safeTransferFrom`). Combined with the Diamond-shared `nonReentrant` lock, this neutralizes reentrancy.
- **Internal `tokenReserves` ledger** (C-2 fix): never trust `IERC20.balanceOf(this)`. Every `safeTransferFrom` increments the ledger; every `safeTransfer` decrements it. Donation attacks become economically meaningless.
- **Two-step ownership**: prevents typo-induced lockout. Same idea applied to `activateOracleV2` (one-way) and timelocked diamond cuts (proposal → wait → execute).
- **Snapshots over live values**: fee rates snapshotted at `createEvent`; pool size snapshotted at `settleEvent`. Both protect users from later config changes that would otherwise rewrite their economics.
- **Loop bounds**: `MAX_POSITIONS_PER_EVENT = 500`, `MAX_DEPOSITS_PER_EVENT = 200`, `MAX_ORACLES = 10`. Prevents an attacker from filling an array so big that the settlement loop runs out of gas.
- **Storage slot isolation**: every library writes to its own deterministic `keccak256` slot. Adding new facets in the future cannot collide with the existing data.
- **Multi-token accounting**: every fee/balance is tracked both per-token and (legacy) USDC-only, so USDT events and USDC events coexist cleanly.

That's the whole protocol.
