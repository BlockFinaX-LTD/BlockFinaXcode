# BlockFinaX Smart Contract Function Reference

**Diamond Address:** `0x3582D8f5f88ef557ce10Af26834FAC8B8e1445bf` (Lisk Sepolia)
**Standard:** EIP-2535 Diamond — all functions are called on the Diamond proxy address.
**Tokens:** USDC `0xf52Ad63619Bf9cFeF510341ac6b4038554399562` · USDT `0x05D032ac25d322df992303dCa074EE7392C117b9`

---

## Table of Contents

1. [User Functions](#1-user-functions)
2. [Owner-Only Functions](#2-owner-only-functions)
3. [Oracle Functions](#3-oracle-functions)
4. [Read-Only Functions](#4-read-only-functions)
5. [Fee Flow Summary](#5-fee-flow-summary)
6. [Safety Mechanisms](#6-safety-mechanisms)

---

## 1. User Functions

These functions are open to any wallet. They are the core product interactions.

---

### `createEvent(params)`

**Who calls it:** Event creators (traders, analysts, institutions)

**What it does:** Creates a new FX protection event on the marketplace. The creator defines the currency pair, strike rate, direction (above/below), expiry date, and premium rate. They also provide the initial liquidity that seeds the protection pool.

**Cost:** $25 flat creation fee + initial liquidity amount, paid in the chosen token (USDC or USDT) at the time of calling.

**Parameters:**
| Field | Description |
|---|---|
| `name` | Human-readable label (e.g. "NGN/USD Q2 2025") |
| `underlying` | The asset pair being tracked (e.g. "NGN/USD") |
| `strike` | The rate that triggers the event (6 decimals) |
| `premiumRate` | Fraction of notional charged to hedgers (e.g. 5000 = 0.5%) |
| `expiryDate` | Unix timestamp when the event closes |
| `allowExternalLp` | Whether external wallets can deposit liquidity |
| `initialLiquidity` | Creator's seed capital deposited into the pool |
| `initialRate` | Current market rate at creation (for reference) |
| `strikeAbove` | True = event triggers if price goes above strike; False = below |
| `paymentToken` | USDC or USDT address |

**Why it exists:** Allows market participants to structure protection products around real FX events, without needing a bank or broker. The $25 creation fee filters out spam events and contributes to platform revenue.

---

### `deposit(eventId, amount)`

**Who calls it:** Liquidity Providers (LPs)

**What it does:** Deposits capital into an event's protection pool. The LP's funds back the potential payouts for hedgers. In return, the LP earns a share of every premium paid by hedgers, proportional to their share of total pool liquidity.

**Requirement:** The event must be open and accepting external LPs (if `allowExternalLp` is true).

**Why it exists:** LPs are the counterparty to hedgers. Without LP capital, there is nothing to pay out. LPs take on the risk of the event triggering in exchange for premium income.

---

### `buyProtection(eventId, notional)`

**Who calls it:** Hedgers (businesses, traders protecting against FX moves)

**What it does:** Purchases FX protection on an open event. The hedger pays:
- A **premium** (based on `premiumRate × notional`) — goes to LPs
- A **0.5% platform fee** on notional — split between platform and creator

If the event triggers (strike is touched before expiry), the hedger's `notional` amount becomes their payout.

**Why it exists:** This is the core product — affordable, trustless FX protection. The hedger pays a known upfront cost and receives a fixed payout if the market moves against them.

---

### `claimPayout(positionId)`

**Who calls it:** Hedger (winner)

**What it does:** Collects the hedger's payout after an event has settled in their favour. A 1% payout fee is deducted at this point, split between the platform and the event creator. The net amount is transferred to the hedger's wallet.

**Requirement:** The event must be settled and triggered. The position must be unclaimed.

**Grace period:** Hedgers have **90 days** from settlement to claim. After that, the unclaimed amount can be recovered by the owner via `recoverExpiredPayouts()`.

**Why it exists:** Settlement marks who won — this function is how winners collect their funds. Keeping it as a separate step (rather than auto-sending) is safer and prevents re-entrancy issues.

---

### `claimPremiums(depositId)`

**Who calls it:** LP

**What it does:** Withdraws the LP's accumulated share of premiums earned from hedger entry fees. A 1% LP profit fee is deducted, split between the platform and the event creator.

**Why it exists:** This is how LPs collect their yield. Premiums accumulate on each `buyProtection()` call and are claimable at any time after an event closes.

---

### `withdrawCapital(depositId)`

**Who calls it:** LP

**What it does:** Returns the LP's original deposit after an event closes. If the event triggered, the LP's share of the max payout is deducted proportionally from their withdrawal amount.

**Formula:**
```
LP payout liability = (totalMaxPayout × LP deposit) ÷ totalLiquidity
LP receives back    = LP deposit − LP payout liability
```

**Requirement:** The event must no longer be open (settled or expired).

**Why it exists:** LPs need a way to exit their position and recover capital. The proportional deduction ensures no LP bears more than their fair share of winning hedger payouts.

---

### `withdrawCreatorEarnings(eventId)`

**Who calls it:** Event creator

**What it does:** Collects the creator's loyalty earnings accumulated across their event. The creator earns 5% of every platform fee generated by their event — on entry fees, payout fees, and LP claim fees.

**Why it exists:** Incentivises experienced traders and analysts to create high-quality events. The loyalty mechanic is passive — it accumulates automatically as activity happens on their event.

---

## 2. Owner-Only Functions

These functions can only be called by the Diamond contract owner. After the Gnosis Safe accepts ownership, they require 2-of-3 Safe signatures.

---

### `initializeHedgeFees(creationFee, hedgerFeeRate, payoutFeeRate, lpFeeRate, loyaltyRate)`

**What it does:** Sets or updates all platform fee rates. Must be called once after deployment before any event can be created. Can be updated later — changes apply only to new events and new purchases, never retroactively.

**Rate caps (enforced on-chain):**
| Parameter | Cap |
|---|---|
| Creation fee | $1,000 maximum |
| Hedger fee rate | 10% maximum |
| Payout fee rate | 10% maximum |
| LP profit fee rate | 10% maximum |
| Creator loyalty rate | 50% of platform fees maximum |

**Current live values:**
- Creation fee: $25
- Hedger fee: 0.5%
- Payout fee: 1%
- LP profit fee: 1%
- Creator loyalty: 5%

**Why it exists:** Allows the platform to adjust economics without redeploying contracts. All rates are bounded to prevent misconfiguration that could harm users.

---

### `setOracleAdmin(address)`

**What it does:** Sets the address of the single-key oracle admin — a wallet that can call `settleEvent()` directly. Setting this to `address(0)` disables the single-key path entirely, forcing all settlement through the multi-oracle OracleFacet consensus.

**Why it exists:** Provides a simple, direct settlement path for early-stage operations. In production, this should be set to `address(0)` once the multi-oracle system is fully operational.

---

### `transferOwnership(newOwner)`

**What it does:** Initiates a two-step ownership transfer. The proposed new owner must separately call `acceptOwnership()` to confirm. The current owner retains all rights until the transfer is accepted.

**Why two steps:** Prevents permanent lockout from a typo or wrong address. If the wrong address is proposed, the current owner can just propose a new address before anyone accepts.

---

### `acceptOwnership()`

**What it does:** Completes a pending ownership transfer. Must be called by the proposed new owner. When the Gnosis Safe is the proposed owner, this requires a 2-of-3 multisig transaction from Safe signers.

---

### `pause()`

**What it does:** Activates the circuit breaker. Blocks:
- `createEvent()`
- `deposit()`
- `buyProtection()`
- `setPoolSettings()`

Does **not** block:
- `claimPayout()`, `claimPremiums()`, `withdrawCapital()`, `withdrawCreatorEarnings()` — users can always retrieve their funds
- `settleEvent()` and oracle operations — in-flight events continue to resolve

**Why it exists:** Emergency response to a discovered vulnerability or exploit attempt. Blocking new activity while allowing existing users to exit protects funds without locking anyone in.

---

### `unpause()`

**What it does:** Restores normal protocol operations after a pause.

---

### `withdrawPlatformFeesByToken(token, amount)`

**What it does:** Transfers accumulated platform fees in a specified token (USDC or USDT) from the Diamond contract to the owner's wallet. This is the primary fee withdrawal function.

**Safety:** Uses CEI pattern — the internal balance counter is decremented before the token transfer. Protected by `nonReentrant`.

**Why it exists:** Platform fees accumulate inside the contract with every user action. This function is the only way for the platform to collect its revenue. Nothing moves automatically — the owner must call this manually.

---

### `withdrawPlatformFees(amount)`

**What it does:** Legacy USDC-only fee withdrawal. Reads from the `hedgePlatformFeesCollected` counter (which pre-dates the multi-token v3 upgrade). Still functional but `withdrawPlatformFeesByToken` is preferred for new usage.

**Why it still exists:** Backward compatibility — some pre-v3 events credited only this counter, not the per-token mapping. Both counters are kept in sync during withdrawal.

---

### `recoverExpiredPayouts(eventId)`

**What it does:** Sweeps unclaimed hedger payouts from a settled event into platform fees, making them withdrawable by the owner.

**Requirements (all must be true):**
- Event must be settled and triggered
- 90 days must have passed since settlement
- Reserved payouts must exceed claimed payouts

**Formula:**
```
Recoverable = totalMaxPayout − totalPayoutClaimed
```

After recovery, `totalMaxPayout` is set to `totalPayoutClaimed` — making a second call a no-op.

**Why it exists:** Prevents funds from being permanently locked in the contract when winning hedgers abandon their positions. The 90-day grace period ensures winners have ample time to claim before recovery is possible.

---

### `setPoolSettings(eventId, poolOpen, allowExternalLp)`

**What it does:** Opens or closes a pool to new deposits, and toggles whether external LPs (not the creator) can deposit. Blocked when the protocol is paused.

**Why it exists:** Gives the owner the ability to manage pool access — for example, closing a pool to new deposits if it is already sufficiently capitalised.

---

### `setAllowedPaymentToken(token, allowed)`

**What it does:** Adds or removes a stablecoin from the whitelist of accepted payment tokens. Only whitelisted tokens can be used when creating a new event. De-listing a token has no effect on events already created with it.

**Why it exists:** Controls which stablecoins the platform accepts. Currently USDC and USDT are whitelisted. New tokens (e.g. USDE, PYUSD) can be added in future without a contract upgrade.

---

### `rescueETH(recipient)`

**What it does:** Sends any ETH held by the Diamond contract to a specified address. The Diamond is a stablecoin-only platform — ETH has no legitimate purpose here. This function recovers ETH that may have been sent by mistake before the `receive()` function was hardened to revert.

**Reverts if:** The contract holds no ETH, or `recipient` is `address(0)`.

---

## 3. Oracle Functions

These functions are restricted to registered oracle wallets or the owner.

---

### `submitRate(eventId, price)` — OracleFacet

**Who calls it:** Registered oracle nodes (automated, running on the server)

**What it does:** Submits a price reading for a specific event. After each submission, the contract automatically checks for consensus:

1. Collects all submissions not older than 15 minutes
2. If fewer than `requiredSigners` valid submissions exist — exits silently, waits for more
3. Calculates spread between highest and lowest submitted price
4. If spread exceeds `toleranceBps` (default 1%) — clears all submissions, oracles must resubmit
5. If spread is within tolerance — takes the average price and settles the event automatically

**Anti-DoS protection:** Each oracle must wait 5 minutes (`RESUBMIT_COOLDOWN`) before overwriting its own submission for the same event.

**Why it exists:** Decentralises settlement. No single oracle can manipulate the result — at least 2 of 3 must agree within a 1% price band before settlement occurs.

---

### `settleEvent(eventId, price)` — HedgeFacet

**Who calls it:** Oracle admin wallet or contract owner (single-key path)

**What it does:** Directly settles an event at the given price. Checks whether the price has crossed the strike. If triggered, calculates each hedger's payout and records totals. If not triggered, closes the event with no payouts.

**Why it exists:** Provides a direct settlement path for early-stage operations and as a fallback if the multi-oracle system encounters issues.

---

### `addOracle(address)` — OracleFacet

**Who calls it:** Owner

**What it does:** Registers a new oracle wallet. Maximum 10 oracles (`MAX_ORACLES`). Registered oracles can call `submitRate()`.

---

### `removeOracle(address)` — OracleFacet

**Who calls it:** Owner

**What it does:** Deregisters an oracle wallet. Any pending submissions from that wallet are invalidated on the next consensus check.

---

### `setOracleConfig(requiredSigners, toleranceBps)` — OracleFacet

**Who calls it:** Owner

**What it does:** Updates the consensus parameters. `requiredSigners` sets how many oracles must agree. `toleranceBps` sets the maximum allowed spread between their price submissions (100 = 1%).

---

### `clearStaleSubmissions(eventId)` — OracleFacet

**Who calls it:** Owner

**What it does:** Manually clears all pending price submissions for a specific event. Used if oracles are stuck in persistent disagreement or one goes offline and the consensus state needs to be reset.

---

## 4. Read-Only Functions

Free to call — no gas required. No wallet connection needed on Blockscout.

| Function | Returns |
|---|---|
| `getHedgeEventCore(eventId)` | Event name, underlying pair, strike, expiry, status, pool open flag, strike direction |
| `getHedgeEventStats(eventId)` | Settlement price, trigger status, settlement time, creator earnings, total liquidity, exposure, premiums, hedger count, LP count, max payout |
| `getHedgePosition(positionId)` | Hedger address, notional, premium paid, platform fee paid, payout amount, claimed status |
| `getHedgeLpDeposit(depositId)` | LP address, deposit amount, shares, premiums earned, premiums claimed, withdrawal status |
| `getEventPositionIds(eventId)` | All position IDs linked to an event |
| `getEventDepositIds(eventId)` | All LP deposit IDs linked to an event |
| `getCreatorEventIds(address)` | All event IDs created by an address |
| `getHedgerPositionIds(address)` | All position IDs held by an address |
| `getLpDepositIds(address)` | All deposit IDs held by an address |
| `getHedgeFeeConfig()` | Current fee rates (creation fee, hedger fee, payout fee, LP fee, loyalty rate) |
| `getHedgePlatformFees()` | Legacy USDC fee counter |
| `getPlatformFeesByToken(token)` | Accumulated fees for a specific token address |
| `getTotalHedgeEvents()` | Total number of events ever created |
| `getPoolUtilization(eventId)` | Total liquidity, total exposure, available capacity, utilisation % |
| `getEventPaymentToken(eventId)` | USDC or USDT address for a given event |
| `isAllowedPaymentToken(token)` | Whether a token is whitelisted for event creation |
| `pendingOwner()` | Address awaiting ownership confirmation (if any) |

---

## 5. Fee Flow Summary

Every fee-generating action splits revenue between the platform and the event creator:

```
User action → Platform fee calculated
                    ↓
        ┌──────────────────────┐
        │  Creator loyalty     │  5% of platform fee → evt.creatorEarnings
        │  Platform share      │  95% of platform fee → platformFeesByToken[token]
        └──────────────────────┘
                    ↓
        All funds sit inside the Diamond contract
                    ↓
        Owner manually calls withdrawPlatformFeesByToken()
        Creator manually calls withdrawCreatorEarnings()
```

**Fee schedule:**

| Action | Who pays | Amount | Goes to |
|---|---|---|---|
| `createEvent()` | Creator | $25 flat | Platform only (no loyalty split) |
| `buyProtection()` | Hedger | 0.5% of notional | 95% platform · 5% creator |
| `claimPayout()` | Hedger | 1% of gross payout | 95% platform · 5% creator |
| `claimPremiums()` | LP | 1% of profit | 95% platform · 5% creator |

---

## 6. Safety Mechanisms

| Mechanism | How it works |
|---|---|
| **Re-entrancy guard** | Diamond-compatible boolean flag in AppStorage — not a contract-level variable, required for `delegatecall` compatibility |
| **CEI pattern** | All functions update state before transferring tokens — state changes first, then transfer |
| **Pause circuit breaker** | Owner can freeze new activity without locking existing user funds |
| **Two-step ownership** | Ownership transfer requires confirmation from the new owner — prevents lockout from typos |
| **Fee rate caps** | All rates are bounded on-chain — cannot be misconfigured above safe limits |
| **Oracle consensus** | Minimum 2 of 3 oracles must agree within 1% before settlement triggers |
| **Oracle cooldown** | Each oracle must wait 5 minutes before resubmitting for the same event |
| **Stale threshold** | Submissions older than 15 minutes are excluded from consensus |
| **90-day payout grace** | Expired payouts cannot be recovered for 90 days — protects winning hedgers |
| **Idempotent recovery** | `recoverExpiredPayouts()` is a no-op if called twice on the same event |
| **ETH rejection** | `receive()` reverts direct ETH sends — contract is stablecoin only |
| **Oracle count cap** | Maximum 10 oracle wallets — bounds all loop gas costs |

---

*Last updated: March 2026 — HedgeFacet v4, OracleFacet v2*
