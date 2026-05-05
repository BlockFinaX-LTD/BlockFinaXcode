# Range Strike & LP Token Model — Design Document

**BlockFinaX | HedgeFacet v8 Design**  
**Date:** April 2026  
**Status:** Proposed — pending Solidity implementation

---

## 1. Context

BlockFinaX currently operates a single-strike parametric hedge model. Each event has one fixed strike price. All hedgers in that event share the same trigger threshold — the rate either crosses it or it does not, and every position wins or loses together.

This document proposes two connected upgrades:

1. **Range Strike** — event creators define a price range; hedgers select their own strike within that range
2. **LP Share Token Model** — LP capital and premium accounting uses proportional shares rather than fixed deposit amounts

These two features are designed together because range strike without a fair LP accounting model creates compounding unfairness as pools grow.

---

## 2. Problem with the Current System at Scale

### 2a. Single Strike — Limited Hedging Utility

Imagine a Nigerian importer hedging USD/NGN exposure. The current rate is 1,580. The event creator sets a strike at 1,659 (+5%). The importer either agrees with that strike or does not participate.

But importers have different risk tolerances:
- One importer is comfortable with a 3% move but needs protection beyond that
- Another can absorb a 7% move but wants cheap protection at 10%
- A third needs tight protection at 2% regardless of cost

With a single strike, only one of these importers can be served per event. The others must wait for a different event or go unhedged.

Range strike solves this — one event can serve all three simultaneously.

### 2b. Late LP Fairness Problem

With the current deposit model, LP earnings are tracked as a simple proportion of total deposits at the time of claiming. This creates an exploitable imbalance.

**Scenario:**

- LP A deposits 10,000 USDC into an event pool
- 5 hedgers buy protection, generating 2,000 USDC in premiums
- The pool now holds 12,000 USDC
- LP B deposits 10,000 USDC (joining after premiums were already collected)
- At claim time, both LP A and LP B share the 2,000 USDC premiums equally — 1,000 each

LP A backed 100% of the risk when those premiums were earned. LP B backed none of it. Yet they share equally. As pools grow and more LPs participate at different times, this misallocation becomes significant and will deter serious capital providers.

---

## 3. Range Strike — Design

### 3a. How It Works

The event creator defines:
- **Strike Min** — the lowest available strike (e.g. USD/NGN 1,612 = +2%)
- **Strike Max** — the highest available strike (e.g. USD/NGN 1,896 = +20%)
- **Strike Step** — increment between selectable strikes (e.g. 16 = every 1%)

When a hedger buys protection, they choose their strike within that range. Each position stores its own chosen strike independently.

At settlement, the oracle submits the final rate. The contract evaluates each position individually — a position pays out only if the settlement rate crossed that position's specific chosen strike.

### 3b. Data Model Changes

**HedgeEvent struct (changes only):**

```
Remove:   strike (single uint256)
Add:      strikeMin (uint256)
          strikeMax (uint256)
          strikeStep (uint256)
```

**Position struct (changes only):**

```
Add:      chosenStrike (uint256)
```

**Function signature change:**

```
Current:  buyProtection(eventId, notional)
New:      buyProtection(eventId, notional, chosenStrike)
```

Validation on-chain:
- `chosenStrike >= strikeMin`
- `chosenStrike <= strikeMax`
- `(chosenStrike - strikeMin) % strikeStep == 0`

### 3c. Premium Calculation

Three options were considered:

**Option A — Flat rate (same as current)**  
All strikes pay the same premium rate regardless of distance from current rate.  
Simple but not actuarially fair — a strike 2% away is far more likely to trigger than one 20% away, yet both cost the same.

**Option B — Distance-based (recommended)**  
Premium decreases as the strike moves further from the current reference rate. Strikes closer to the market are more expensive because they are more likely to trigger.

```
premium = baseRate × notional × scalingFactor(distance)
```

This mirrors how options pricing works — out-of-the-money options cost less.

**Option C — Creator-defined tiers**  
Creator manually assigns a premium rate to each strike tier. Maximum flexibility but operationally complex and prone to misconfiguration.

**Decision: Option B** — distance-based pricing is fair to both hedgers and LPs, requires no manual configuration, and sets BlockFinaX up as a credible risk pricing platform.

### 3d. Settlement Logic Change

**Current:**
```
if (settlementRate crosses event.strike) → all positions pay out
```

**New:**
```
for each position in event:
    if (settlementRate crosses position.chosenStrike) → that position pays out
    else → that position receives nothing
```

This means in one event, hedgers with tight strikes may win while hedgers with wide strikes lose — realistic and accurate to how protection should work.

### 3e. Scenario

**Event: USD/NGN, current rate 1,580**

Creator sets: strikeMin = 1,628 (+3%), strikeMax = 1,896 (+20%), strikeStep = 16 (1%)

| Hedger | Chosen Strike | Notional | Premium Paid |
|--------|-------------|---------|-------------|
| Hedger A | 1,628 (+3%) | 50,000 | 1,500 USDC (expensive, tight) |
| Hedger B | 1,738 (+10%) | 100,000 | 1,200 USDC (moderate) |
| Hedger C | 1,896 (+20%) | 200,000 | 800 USDC (cheap, wide) |

Oracle settles at 1,710 (+8%):
- Hedger A wins — 1,710 crossed their 1,628 strike ✓
- Hedger B wins — 1,710 crossed their 1,738 strike? No — 1,710 < 1,738 ✗
- Hedger C loses — 1,710 did not reach 1,896 ✗

Only Hedger A receives a payout. The pool retains the premiums from B and C.

---

## 4. LP Share Token Model — Design

### 4a. How It Works

When an LP deposits USDC, the contract calculates how many **pool shares** to issue based on the current pool value at the moment of deposit:

```
shares_issued = deposit × totalShares / poolValue
```

If the pool is empty (first LP), shares issued equal the deposit amount 1:1.

As premiums accumulate, pool value grows but total shares stay the same. Each share is worth more USDC. A late LP deposits at this higher pool value, receives fewer shares, and therefore owns a smaller percentage of the pool — accurately reflecting that they did not earn the earlier premiums.

### 4b. Why This Is Fair

**Scenario:**

- LP A deposits 10,000 USDC → pool = 10,000, totalShares = 10,000, LP A holds 10,000 shares
- 5 hedgers buy protection, 2,000 USDC premiums collected → pool = 12,000, totalShares = 10,000
- LP B deposits 10,000 USDC → shares issued = 10,000 × 10,000 / 12,000 = **8,333 shares**
- totalShares = 18,333, pool = 22,000

At withdrawal (no payouts, pool = 22,000):
- LP A: 10,000 / 18,333 × 22,000 = **12,000 USDC** (capital + full 2,000 premium)
- LP B: 8,333 / 18,333 × 22,000 = **10,000 USDC** (capital only — did not earn past premiums)

LP A is correctly rewarded for the risk they carried alone. LP B breaks even. This is mathematically precise with no special logic required — it emerges naturally from the share model.

### 4c. Data Model Changes

**HedgeEvent storage additions:**

```
totalShares   (uint256) — running total of all shares issued
poolValue     (uint256) — current USDC in pool (capital + premiums − payouts)
```

**LP Deposit record changes:**

```
Remove:   amount (raw USDC deposited)
Add:      shares (pool shares held)
          depositValue (USDC at time of deposit, for UI reference only)
```

### 4d. Premium Claim Eliminated

In the current system, LPs must call `claimPremiums()` separately from `withdrawCapital()`. This creates two transactions and requires LPs to actively manage their position.

With the share model, premiums are embedded in the share value. They accumulate automatically as hedgers buy protection. When an LP withdraws, they receive their proportional pool value in a single transaction — capital and premiums combined.

This is a significant UX improvement. LPs set it and forget it.

**Transaction flow comparison:**

| Current | Share Token Model |
|---------|-----------------|
| `deposit()` | `deposit()` |
| `claimPremiums()` (optional, anytime) | — eliminated — |
| `withdrawCapital()` | `withdrawCapital()` |
| 2–3 transactions | 1 transaction |

### 4e. Early Withdrawal

Because LP capital backs existing open positions, early withdrawal requires careful handling. Two options:

**Option 1 — No early withdrawal**  
LP capital is locked until the event settles or expires. The event expiry is set by the creator upfront, so LPs enter knowing their lock period. Simplest and safest.

**Option 2 — Partial withdrawal**  
LP can withdraw only the portion of their share value that exceeds the outstanding payout exposure. Complex to calculate safely on-chain.

**Decision: Option 1 for v8** — locked until settlement. This aligns with how parametric insurance pools work. Liquidity commitment is the price of earning yield. If demand arises for early exits, a secondary share transfer mechanism can be added in a future upgrade.

### 4f. What Happens When Payouts Go Out

When the oracle settles an event and positions pay out, the contract deducts the payout total from the pool value. All LP shares are now worth less — the loss is socialised proportionally across all LP shareholders.

**Scenario (payout event):**

Pool = 22,000 USDC, totalShares = 18,333  
Payout to winning hedger = 8,000 USDC  
Pool after payout = 14,000 USDC

- LP A withdraws: 10,000 / 18,333 × 14,000 = **7,636 USDC** (loss of 2,364)
- LP B withdraws: 8,333 / 18,333 × 14,000 = **6,364 USDC** (loss of 3,636)

Both LPs share the loss proportionally to their pool ownership. LP B bears a larger absolute loss because they owned a larger share of the pool at the time of the payout.

---

## 5. Why Deploy Both Together

Range strike and the LP token model are independent features but they compound each other's problems if implemented separately.

Without share tokens, range strike creates even worse premium misallocation because different strike tiers collect different premium amounts at different times. A late LP joining after high-premium tight-strike positions have already been sold is taking on the most payout risk while inheriting premiums they never earned — worse than the current single-strike problem.

Deploying both together means the LP model is correct from day one of range strike. There is no interim period of compounding unfairness.

---

## 6. Deployment Strategy

### Phase 1 — Run in parallel, not replacing current system

The current fixed-strike events remain live and unchanged. Range strike events are a new event type — creators opt in when creating. This means:

- No existing LP positions are disturbed
- The new model can be validated with real activity before it becomes the default
- If a bug is found, it only affects new-type events

### Phase 2 — HedgeFacet v8 upgrade

New facet deployed to all three chains (Lisk, Base, BSC) via the existing Diamond upgrade path:
1. Deploy HedgeFacet v8 contract
2. Submit `diamondCut` via Safe (2-of-3 multisig)
3. 48-hour Timelock
4. Execute via `executeCut`

No redeployment of the Diamond, Safe, or any other infrastructure.

### Phase 3 — Migration (optional, future)

Once range strike is stable, offer existing event types a migration path to the share model. This would be a voluntary creator action, not forced.

---

## 7. Summary of Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Strike model | Range with step increments | Serves multiple risk tolerances in one event |
| Premium pricing | Distance-based | Fair to hedgers, self-calibrating, no manual config |
| LP accounting | Share token model | Eliminates late-LP fairness problem at scale |
| Early withdrawal | Locked until settlement | Simple, safe, aligns with parametric insurance norms |
| Premium claim | Eliminated (embedded in shares) | Reduces LP transactions, simpler UX |
| Deployment | Parallel new event type | Zero disruption to existing live events |
| Infrastructure | Existing Diamond upgrade path | No redeployment, same Safe multisig |

---

## 8. Open Questions for Implementation

1. What is the minimum strike step — fixed bps or creator-configurable?
2. Should the distance-based premium formula be upgradeable independently of the rest of HedgeFacet?
3. Maximum number of positions per event — unbounded settlement loops are a gas risk
4. Should range strike support both directions (above AND below) in one event, or keep single direction per event?
5. How does `recoverExpiredPayouts` behave with per-position strikes — does it sweep all unclaimed positions?
