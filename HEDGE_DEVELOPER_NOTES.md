# P2P Trade Hedge — Developer Notes

> **What is this?** A peer-to-peer FX protection marketplace where African importers/exporters can insure themselves against currency drops. Think of it like buying insurance: you pay a small premium now, and if your currency loses value, you get paid.

---

## Quick Glossary

| Term | Plain English |
|------|-------------|
| **Hedge Event** | A one-touch "insurance contract" that anyone can create for a specific currency pair (e.g. USD/GHS). It has a strike price (the trigger point) and a max duration. Settles automatically when the FX rate touches the strike — no need to wait for expiry. |
| **Hedger** | The buyer — a business that pays a premium to be protected if a currency drops. |
| **LP (Liquidity Provider)** | The seller — someone who puts money into the pool to back the insurance. They earn premiums as income. |
| **Creator** | The person who created the event. They earn 5% of all platform fees from that event. |
| **Strike Price** | The exchange rate that triggers a payout. Example: if strike = 16.0 for USD/GHS and the rate hits 17.0, hedgers get paid. |
| **Premium** | The cost of protection. Set as a % of the coverage amount (e.g. 2.5% of $1,000 = $25). |
| **Notional** | The dollar amount the hedger wants to protect (e.g. $1,000). |
| **Pool** | The total USDC deposited by all LPs for a specific event. This is what backs the insurance payouts. |
| **Settlement** | One-touch: the FX oracle continuously monitors rates and settles the event the moment the rate touches the strike. If the rate never touches the strike before the max duration, the event expires and LPs keep everything. |
| **Treasury Wallet** | The platform's on-chain wallet that holds all USDC. All fees and payouts flow through this. |

---

## Source Files

| File | What It Does |
|------|-------------|
| `shared/schema.ts` | Database tables — defines what data we store |
| `server/routes.ts` | API endpoints — all the backend logic (lines ~6215–6881) |
| `server/fx-oracle.ts` | FX rate fetching, caching, and automatic settlement |
| `client/src/pages/hedge.tsx` | Frontend UI — all 4 tabs (Buy Protection, Provide Liquidity, My Events, My Hedges) |
| `client/src/lib/hedge-contract.ts` | On-chain interactions — reads events/positions/deposits from the Diamond contract |

---

## The Complete Lifecycle (Step by Step)

```
1. CREATOR creates an event
   → Picks currency pair, strike, premium rate, expiry
   → Pays $25 creation fee
   → Deposits initial liquidity (min $10)
   → Pool starts CLOSED (hedgers can't buy yet)

2. CREATOR opens the pool
   → Toggles "Pool Open" switch
   → Now hedgers can buy protection

3. LP deposits liquidity (optional)
   → Anyone can add USDC to the pool (if external LP is allowed)
   → Gets "shares" proportional to their deposit
   → More liquidity = more hedgers can buy protection

4. HEDGER buys protection
   → Picks how much coverage they want (notional)
   → Pays premium (e.g. 2.5%) + platform fee (0.5%)
   → Payout is PREDETERMINED at purchase: Notional × (Strike - InitialRate) / InitialRate
   → 100% of premium goes to LPs immediately
   → Protection is now "active" — hedger knows exact payout upfront

5. TIME PASSES... FX rates move

6. ORACLE MONITORS → checks FX rate every 5 minutes
   → If rate >= strike: ONE-TOUCH TRIGGERED — hedgers get their predetermined payout!
   → If rate never touches strike before expiry: event expires, LPs keep everything

7. HEDGER claims payout (if triggered)
   → Gets their predetermined payout (calculated at purchase time)
   → Minus 1% platform fee
   → USDC sent from Diamond contract to their wallet

8. LP withdraws capital + claims premiums
   → Can only withdraw capital AFTER event settles
   → Can claim premiums anytime
   → 1% fee on premium claims
```

---

## 1. Database Schema

> **Where:** `shared/schema.ts`
> **What:** Three tables store everything about hedge events, hedger positions, and LP deposits.

### Hedge Events — The "insurance contract"

```typescript
export const hedgeEvents = pgTable("hedge_events", {
  // === Identity ===
  id: serial("id").primaryKey(),                    // Auto-incrementing ID
  name: text("name").notNull(),                     // Human-readable name, e.g. "GHS Protection Q1"
  description: text("description"),                 // Optional details about the event

  // === Core Parameters (set at creation, never change) ===
  underlying: text("underlying").notNull(),         // Currency pair, e.g. "USD/GHS"
  strike: decimal("strike", { precision: 18, scale: 6 }).notNull(),
                                                    // Trigger price — if FX rate goes above this, hedgers win
                                                    // Example: 16.5 means "pay out if USD/GHS exceeds 16.5"
  premiumRate: decimal("premium_rate", { precision: 10, scale: 6 }).notNull(),
                                                    // Cost of protection as a decimal
                                                    // Example: 0.025 means hedger pays 2.5% of their notional
  expiryDate: timestamp("expiry_date").notNull(),   // When the contract expires and gets settled

  // === Legacy Fields (exist in DB but NOT used in calculations) ===
  payoutRate: decimal("payout_rate", { precision: 10, scale: 6 }).notNull(),
                                                    // Was meant to cap payouts, but we use uncapped formula now
  safetyFactor: decimal("safety_factor", { precision: 5, scale: 2 }).notNull().default("0.80"),
                                                    // Was meant to reserve some pool capacity, always set to 1 now

  // === Settlement (filled in when event expires) ===
  status: text("status").notNull().default("open"), // "open" → active, "settled" → done, "expired" → no positions
  settlementPrice: decimal("settlement_price", { precision: 18, scale: 6 }),
                                                    // The actual FX rate at expiry (set by oracle)
  triggered: boolean("triggered").default(false),   // Did the rate hit the strike? true = hedgers win
  settledAt: timestamp("settled_at"),               // When settlement happened

  // === Pool Controls (creator can toggle these) ===
  poolOpen: boolean("pool_open").notNull().default(false),
                                                    // false = hedgers CANNOT buy yet (default)
                                                    // true = hedgers CAN buy protection
  allowExternalLp: boolean("allow_external_lp").notNull().default(true),
                                                    // true = anyone can deposit liquidity (default)
                                                    // false = only the creator can deposit

  // === Ownership & Earnings ===
  createdBy: text("created_by").notNull(),          // Wallet address of whoever created this event
  creatorEarnings: decimal("creator_earnings", { precision: 18, scale: 6 }).default("0"),
                                                    // Running total: 5% of all platform fees from this event
                                                    // This value ONLY shows to the creator (privacy rule)

  createdAt: timestamp("created_at").defaultNow(),
});
```

### Hedge Positions — Each hedger's "insurance policy"

```typescript
export const hedgePositions = pgTable("hedge_positions", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => hedgeEvents.id).notNull(),
                                                    // Which event this position belongs to

  hedgerWallet: text("hedger_wallet").notNull(),    // Wallet address of the hedger

  // === Money ===
  notional: decimal("notional", { precision: 18, scale: 2 }).notNull(),
                                                    // How much USD the hedger is protecting
                                                    // Example: $1,000 means "insure me for $1,000 worth of FX risk"
  premiumPaid: decimal("premium_paid", { precision: 18, scale: 2 }).notNull(),
                                                    // How much premium they paid (goes 100% to LPs)
                                                    // Example: $1,000 × 2.5% = $25
  maxPayout: decimal("max_payout", { precision: 18, scale: 2 }).notNull(),
                                                    // Estimated max payout = notional × payoutRate
                                                    // Used for pool capacity check (liquidity must cover this)
                                                    // NOT a payout ceiling (actual payout is uncapped)
  payoutAmount: decimal("payout_amount", { precision: 18, scale: 2 }),
                                                    // Filled in at settlement. The actual payout amount.
                                                    // Formula: Notional × (SettlementRate - Strike) / Strike

  // === Status ===
  claimed: boolean("claimed").default(false),       // Has the hedger collected their payout?
  status: text("status").notNull().default("active"),
                                                    // "active"       → waiting for settlement
                                                    // "settled_win"  → rate hit strike, payout available
                                                    // "settled_loss" → rate didn't hit strike, no payout
                                                    // "claimed"      → hedger collected their winnings
                                                    // "claimable"    → (auto-settlement) ready to claim
                                                    // "expired"      → (auto-settlement) no payout

  createdAt: timestamp("created_at").defaultNow(),
});
```

### LP Deposits — Each liquidity provider's contribution

```typescript
export const hedgeLpDeposits = pgTable("hedge_lp_deposits", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => hedgeEvents.id).notNull(),

  lpWallet: text("lp_wallet").notNull(),            // Wallet address of the LP

  // === Capital ===
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
                                                    // How much USDC they deposited
  shares: decimal("shares", { precision: 18, scale: 6 }).notNull(),
                                                    // Their "ownership slice" of the pool
                                                    // First LP: shares = amount (1:1)
                                                    // Later LPs: shares = (amount / totalPool) × totalShares
                                                    // This ensures fair premium distribution

  // === Earnings ===
  premiumsEarned: decimal("premiums_earned", { precision: 18, scale: 2 }).default("0"),
                                                    // Running total of premiums earned from hedgers buying
                                                    // Updated IMMEDIATELY when a hedger buys protection
  premiumsWithdrawn: decimal("premiums_withdrawn", { precision: 18, scale: 2 }).default("0"),
                                                    // How much they've already claimed
                                                    // Claimable = premiumsEarned - premiumsWithdrawn

  // === Withdrawal ===
  withdrawn: boolean("withdrawn").default(false),   // Has the LP taken their capital back?
  withdrawnAt: timestamp("withdrawn_at"),           // When they withdrew
                                                    // RULE: Cannot withdraw while event is "open"
                                                    //        Must wait until "settled" or "expired"

  createdAt: timestamp("created_at").defaultNow(),
});
```

---

## 2. Fee Structure

> **Where:** Top of hedge routes in `server/routes.ts`
> **Why:** These 5 constants control ALL platform revenue from the hedge system.

```typescript
// ┌─────────────────────────────────────────────────────────────────┐
// │                    PLATFORM FEE CONSTANTS                       │
// ├─────────────────────────────────────────────────────────────────┤
// │                                                                 │
// │  EVENT_CREATION_FEE = 25                                        │
// │  → $25 flat fee when someone creates a new hedge event          │
// │  → Charged once, paid by the creator                            │
// │                                                                 │
// │  HEDGER_FEE_RATE = 0.005 (0.5%)                                 │
// │  → Charged to hedger ON TOP of their premium                    │
// │  → Based on notional (coverage amount)                          │
// │  → Example: $1,000 notional × 0.5% = $5 platform fee           │
// │                                                                 │
// │  HEDGER_PAYOUT_FEE_RATE = 0.01 (1%)                             │
// │  → Deducted from hedger's payout when they claim winnings       │
// │  → Example: $200 payout × 1% = $2 fee, hedger gets $198        │
// │                                                                 │
// │  LP_PROFIT_FEE_RATE = 0.01 (1%)                                 │
// │  → Deducted when LP claims their earned premiums                │
// │  → Example: $50 premiums × 1% = $0.50 fee, LP gets $49.50      │
// │                                                                 │
// │  CREATOR_LOYALTY_RATE = 0.05 (5%)                               │
// │  → 5% of EVERY platform fee above goes to the event creator     │
// │  → This rewards people who create popular events                │
// │  → Example: $5 hedger fee × 5% = $0.25 to creator              │
// │                                                                 │
// └─────────────────────────────────────────────────────────────────┘

const EVENT_CREATION_FEE = 25;
const HEDGER_FEE_RATE = 0.005;
const HEDGER_PAYOUT_FEE_RATE = 0.01;
const LP_PROFIT_FEE_RATE = 0.01;
const CREATOR_LOYALTY_RATE = 0.05;
```

### Fee Flow Diagram (Worked Example)

```
HEDGER BUYS $1,000 PROTECTION (2.5% premium rate):

  Hedger pays:
  ├── Premium: $25.00 ────────────→ Split among all LPs based on their share of the pool
  ├── Platform fee: $5.00 ────────→ Stays in treasury (platform revenue)
  │   └── Creator reward: $0.25 ──→ 5% of $5.00 → added to event.creatorEarnings
  └── TOTAL cost to hedger: $30.00


LP CLAIMS $50.00 IN EARNED PREMIUMS:

  LP receives:
  ├── Gross premiums: $50.00
  ├── Platform fee: -$0.50 ───────→ Stays in treasury (platform revenue)
  │   └── Creator reward: $0.025 ─→ 5% of $0.50 → added to event.creatorEarnings
  └── NET to LP wallet: $49.50 ───→ Sent as USDC on-chain from treasury


HEDGER CLAIMS $200.00 PAYOUT (after winning settlement):

  Hedger receives:
  ├── Gross payout: $200.00
  ├── Platform fee: -$2.00 ───────→ Stays in treasury (platform revenue)
  │   └── Creator reward: $0.10 ──→ 5% of $2.00 → added to event.creatorEarnings
  └── NET to hedger: $198.00 ─────→ Sent as USDC on-chain from treasury
```

---

## 3. Payout Formula

> **The big question:** How much does a hedger get paid if the currency drops?

```
Payout = Notional × (SettlementRate − Strike) / Strike
```

**This is UNCAPPED** — there is no maximum. The worse the currency devaluation, the bigger the payout.

### Example 1: Small move
```
Notional:        $1,000
Strike:          16.0  (USD/GHS)
Settlement Rate: 16.8  (USD/GHS)

Payout = $1,000 × (16.8 - 16.0) / 16.0
       = $1,000 × 0.8 / 16.0
       = $1,000 × 0.05
       = $50.00

After 1% fee:    $49.50 net to hedger
```

### Example 2: Large move
```
Notional:        $1,000
Strike:          16.0  (USD/GHS)
Settlement Rate: 20.0  (USD/GHS)

Payout = $1,000 × (20.0 - 16.0) / 16.0
       = $1,000 × 4.0 / 16.0
       = $1,000 × 0.25
       = $250.00

After 1% fee:    $247.50 net to hedger
```

### Example 3: No trigger (hedger loses)
```
Notional:        $1,000
Strike:          16.0
Settlement Rate: 15.5  (rate stayed BELOW strike)

Result: $0 payout. Hedger loses their premium. LPs keep everything.
```

---

## 4. API Endpoints — Full Code with Comments

### 4.1 Create Event (`POST /api/hedge/events`)

> **What happens:** Someone creates a new hedge event (insurance contract).
> They pay a $25 fee and must deposit at least $10 as initial liquidity.

```typescript
app.post("/api/hedge/events", async (req, res) => {
  // Step 1: Extract all the event parameters from the request
  const { name, description, underlying, strike, premiumRate, payoutRate,
          safetyFactor, expiryDate, createdBy, poolOpen, allowExternalLp,
          initialLiquidity } = req.body;

  // Step 2: Validate required fields
  if (!name || !underlying || !strike || !premiumRate || !expiryDate || !createdBy)
    return res.status(400).json({ message: "Missing required fields" });

  // Step 3: Require initial liquidity (at least $10)
  //         This ensures every event starts with some backing
  if (!initialLiquidity || parseFloat(initialLiquidity) < 10)
    return res.status(400).json({ message: "Initial liquidity is required (minimum $10)" });

  // Step 4: Log the creation fee (charged to the creator's wallet)
  const EVENT_CREATION_FEE = 25;
  console.log(`[Event Creation Fee] $${EVENT_CREATION_FEE} charged to ${createdBy}`);

  // Step 5: Save the event to the database
  //         NOTE: poolOpen defaults to FALSE — creator must manually open it
  //         NOTE: safetyFactor is always "1" (legacy field, no longer used)
  const event = await storage.createHedgeEvent({
    name,
    description: description || null,
    underlying,                                // e.g. "USD/GHS"
    strike: strike.toString(),                 // e.g. "16.5"
    premiumRate: premiumRate.toString(),        // e.g. "0.025" (2.5%)
    payoutRate: (payoutRate || 0.30).toString(),// Legacy — not used in calc
    safetyFactor: "1",                         // Legacy — always 1
    expiryDate: new Date(expiryDate),
    status: "open",
    poolOpen: poolOpen === true ? true : false, // Default: CLOSED
    allowExternalLp: allowExternalLp !== false,  // Default: OPEN to others
    createdBy                                    // Creator's wallet address
  });

  // Step 6: Auto-deposit the creator's initial liquidity
  //         First deposit always gets 1:1 shares (e.g. $100 = 100 shares)
  if (initialLiquidity && parseFloat(initialLiquidity) >= 10) {
    const amountNum = parseFloat(initialLiquidity);
    await storage.createHedgeLpDeposit({
      eventId: event.id,
      lpWallet: createdBy,
      amount: amountNum.toString(),
      shares: amountNum.toString()  // 1:1 because it's the first deposit
    });
  }

  res.status(201).json(event);
});
```

### 4.2 Buy Protection (`POST /api/hedge/positions`)

> **What happens:** A hedger pays a premium to get FX protection.
> Their premium is IMMEDIATELY split among all LPs proportionally.

```typescript
app.post("/api/hedge/positions", async (req, res) => {
  const { eventId, hedgerWallet, notional } = req.body;

  // Step 1: Find the event and validate
  const event = await storage.getHedgeEvent(parseInt(eventId));
  if (!event) return res.status(404).json({ message: "Event not found" });
  if (event.status !== "open") return res.status(400).json({ message: "Event is not open" });
  if (!event.poolOpen) return res.status(400).json({ message: "Pool is not open for buying" });

  // Step 2: Check the event hasn't expired
  if (new Date(event.expiryDate) <= new Date())
    return res.status(400).json({ message: "Event has expired" });

  // Step 3: Calculate costs
  const notionalNum = parseFloat(notional);
  if (notionalNum < 10) return res.status(400).json({ message: "Minimum notional is $10" });

  const premiumPaid = notionalNum * parseFloat(event.premiumRate);
  //    Example: $1,000 × 0.025 = $25 premium (goes to LPs)

  const payoutRate = parseFloat(event.payoutRate) || 0.30;
  const maxPayout = notionalNum * payoutRate;
  //    maxPayout = notional × payoutRate (default 30%)
  //    Used ONLY for pool capacity checks — estimates the likely max payout
  //    NOT a payout ceiling (actual payout is calculated by formula at settlement)
  //    This lets pools support ~3x more hedgers than reserving full notional

  const hedgerPlatformFee = notionalNum * HEDGER_FEE_RATE;
  //    Example: $1,000 × 0.005 = $5 platform fee (stays in treasury)

  const totalCost = premiumPaid + hedgerPlatformFee;
  //    Example: $25 + $5 = $30 total the hedger pays

  // Step 4: CHECK POOL CAPACITY
  //         Pool must have enough USDC to cover potential payouts
  //         Available = totalLiquidity - currentExposure
  const positions = await storage.getHedgePositionsByEvent(event.id);
  const deposits = await storage.getHedgeLpDepositsByEvent(event.id);

  const totalLiquidity = deposits
    .filter(d => !d.withdrawn)                    // Only count active deposits
    .reduce((sum, d) => sum + parseFloat(d.amount), 0);

  const currentExposure = positions
    .filter(p => p.status === "active")           // Only count active hedges
    .reduce((sum, p) => sum + parseFloat(p.maxPayout), 0);

  if (currentExposure + maxPayout > totalLiquidity) {
    // Not enough money in the pool to back this hedge
    // Note: exposure is based on estimated maxPayout (notional × payoutRate),
    // not the full notional, so pools can support more positions
    return res.status(400).json({
      message: "Insufficient pool liquidity",
      availableCapacity: Math.max(0, totalLiquidity - currentExposure),
      maxNotionalAllowed: totalLiquidity > currentExposure
        ? Math.floor((totalLiquidity - currentExposure) / payoutRate) : 0
    });
  }

  // Step 5: Create the hedger's position
  const position = await storage.createHedgePosition({
    eventId: event.id,
    hedgerWallet,
    notional: notionalNum.toString(),
    premiumPaid: premiumPaid.toString(),
    maxPayout: maxPayout.toString(),
    status: "active"
  });

  // Step 6: DISTRIBUTE PREMIUM TO LPs
  //         100% of the premium goes to LPs, split by their deposit proportion
  //         Example: LP-A deposited $800 of $1000 pool → gets 80% of premium
  const activeDeposits = deposits.filter(d => !d.withdrawn);
  for (const dep of activeDeposits) {
    const share = parseFloat(dep.amount) / totalLiquidity;  // Their % of the pool
    const earned = premiumPaid * share;                     // Their cut of the premium
    await storage.updateHedgeLpDeposit(dep.id, {
      premiumsEarned: (parseFloat(dep.premiumsEarned || "0") + earned).toString()
    });
  }

  // Step 7: CREATOR'S EARNINGS
  //         The event creator gets 5% of the platform fee as a reward
  const creatorReward = hedgerPlatformFee * CREATOR_LOYALTY_RATE;
  //    Example: $5 platform fee × 5% = $0.25 to creator
  const currentCreatorEarnings = parseFloat(event.creatorEarnings || "0");
  await storage.updateHedgeEvent(event.id, {
    creatorEarnings: (currentCreatorEarnings + creatorReward).toString()
  });

  console.log(`[Hedge Fee] Notional: $${notionalNum} | Premium: $${premiumPaid.toFixed(4)} (→ LPs) | Platform fee: $${hedgerPlatformFee.toFixed(4)} | Creator reward: $${creatorReward.toFixed(4)}`);

  res.status(201).json({
    ...position,
    premiumPaid, hedgerPlatformFee, creatorReward, totalCost, maxPayout,
    message: `Protection purchased. Total: $${totalCost.toFixed(2)} (Premium: $${premiumPaid.toFixed(2)} + Fee: $${hedgerPlatformFee.toFixed(4)})`
  });
});
```

### 4.3 LP Deposit (`POST /api/hedge/deposits`)

> **What happens:** An LP adds USDC to a pool. They receive "shares" representing their ownership slice.

```typescript
app.post("/api/hedge/deposits", async (req, res) => {
  const { eventId, lpWallet, amount } = req.body;

  const event = await storage.getHedgeEvent(parseInt(eventId));
  if (!event) return res.status(404).json({ message: "Event not found" });
  if (event.status !== "open") return res.status(400).json({ message: "Event is not open" });

  // Privacy check: if the creator set "private pool", only they can deposit
  const isCreator = lpWallet.toLowerCase() === event.createdBy.toLowerCase();
  if (!isCreator && !event.allowExternalLp) {
    return res.status(403).json({ message: "This pool is private — only the creator can provide liquidity" });
  }

  const amountNum = parseFloat(amount);
  if (amountNum < 10) return res.status(400).json({ message: "Minimum deposit is $10" });

  // === SHARE CALCULATION ===
  // Shares represent your "slice" of the pool.
  //
  // WHY SHARES MATTER:
  // When a hedger pays $25 premium, it gets split among LPs by shares.
  // If you have 50% of the shares, you get 50% of the premium.
  //
  // HOW SHARES ARE CALCULATED:
  // - First LP ever:  shares = amount  (1:1, e.g. deposit $100 → 100 shares)
  // - Later LPs:      shares = (yourDeposit / currentPoolSize) × existingShares
  //
  // EXAMPLE:
  // Pool has $1,000 with 1,000 shares. You deposit $500.
  // Your shares = ($500 / $1,000) × 1,000 = 500 shares
  // You now own 500/1500 = 33.3% of the pool

  const existingDeposits = await storage.getHedgeLpDepositsByEvent(event.id);
  const totalLiquidity = existingDeposits
    .filter(d => !d.withdrawn)
    .reduce((sum, d) => sum + parseFloat(d.amount), 0);
  const totalShares = existingDeposits
    .filter(d => !d.withdrawn)
    .reduce((sum, d) => sum + parseFloat(d.shares), 0);

  const shares = totalLiquidity === 0
    ? amountNum                                    // First deposit: 1:1
    : (amountNum / totalLiquidity) * totalShares;  // Proportional

  const deposit = await storage.createHedgeLpDeposit({
    eventId: event.id,
    lpWallet,
    amount: amountNum.toString(),
    shares: shares.toString()
  });

  res.status(201).json({
    ...deposit,
    message: `Deposited $${amountNum.toFixed(2)} into pool. Received ${shares.toFixed(4)} LP shares.`
  });
});
```

### 4.4 LP Claim Premiums (`POST /api/hedge/deposits/:id/claim-premiums`)

> **What happens:** LP collects their earned premiums. 1% fee deducted. Actual USDC is sent on-chain from the treasury wallet.

```typescript
app.post("/api/hedge/deposits/:id/claim-premiums", async (req, res) => {
  const { callerAddress } = req.body;

  // Step 1: Find the deposit and verify ownership
  const deposit = await storage.getHedgeLpDeposit(parseInt(req.params.id));
  if (!deposit) return res.status(404).json({ message: "Deposit not found" });
  if (deposit.lpWallet.toLowerCase() !== callerAddress.toLowerCase())
    return res.status(403).json({ message: "Unauthorized — not your deposit" });

  // Step 2: Calculate how much they can claim
  //         claimable = total earned - already withdrawn
  const earned = parseFloat(deposit.premiumsEarned || "0");
  const alreadyWithdrawn = parseFloat(deposit.premiumsWithdrawn || "0");
  const claimable = earned - alreadyWithdrawn;
  if (claimable <= 0) return res.status(400).json({ message: "No premiums to claim" });

  // Step 3: Deduct 1% platform fee
  const lpProfitFee = claimable * LP_PROFIT_FEE_RATE;  // e.g. $50 × 1% = $0.50
  const netPayout = claimable - lpProfitFee;            // e.g. $50 - $0.50 = $49.50

  // Step 4: Give creator their 5% cut of the fee
  const creatorReward = lpProfitFee * CREATOR_LOYALTY_RATE;
  const event = await storage.getHedgeEvent(deposit.eventId);
  if (event) {
    const currentCreatorEarnings = parseFloat(event.creatorEarnings || "0");
    await storage.updateHedgeEvent(event.id, {
      creatorEarnings: (currentCreatorEarnings + creatorReward).toString()
    });
  }

  // Step 5: SEND USDC ON-CHAIN
  //         This is a real blockchain transaction from the treasury wallet
  const treasuryPrivateKey = process.env.TREASURY_POOL_PRIVATE_KEY;
  const ethers = await import("ethers");
  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
  const treasuryWallet = new ethers.Wallet(treasuryPrivateKey, provider);

  // Connect to USDC contract on Base Sepolia testnet
  const usdcAddress = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const usdcContract = new ethers.Contract(usdcAddress, [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function transfer(address to, uint256 amount) returns (bool)"
  ], treasuryWallet);

  // Step 6: Check treasury has enough USDC
  const decimals = await usdcContract.decimals();
  const treasuryBalance = await usdcContract.balanceOf(treasuryWallet.address);
  const treasuryBalanceFormatted = parseFloat(ethers.formatUnits(treasuryBalance, decimals));
  if (netPayout > treasuryBalanceFormatted)
    return res.status(400).json({ message: `Insufficient treasury balance` });

  // Step 7: Execute the transfer
  const transferAmount = ethers.parseUnits(netPayout.toFixed(6), decimals);
  const tx = await usdcContract.transfer(deposit.lpWallet, transferAmount);
  const receipt = await tx.wait();  // Wait for blockchain confirmation

  // Step 8: Update the database to track what's been withdrawn
  await storage.updateHedgeLpDeposit(deposit.id, {
    premiumsWithdrawn: (alreadyWithdrawn + claimable).toString()
  });

  console.log(`[LP Fee] Claimed: $${claimable.toFixed(4)} | Fee (1%): $${lpProfitFee.toFixed(4)} | Net: $${netPayout.toFixed(4)}`);

  res.json({
    success: true,
    txHash: receipt.hash,          // Blockchain transaction hash (proof of payment)
    grossAmount: claimable.toFixed(2),
    platformFee: lpProfitFee.toFixed(4),
    netAmount: netPayout.toFixed(2)
  });
});
```

### 4.5 Settlement (`POST /api/hedge/events/:id/settle`)

> **What happens:** When an event expires, the FX oracle posts the settlement price.
> All active positions are resolved — winners get payouts, losers get nothing.

```typescript
app.post("/api/hedge/events/:id/settle", async (req, res) => {
  const { settlementPrice, settlerAddress } = req.body;
  const event = await storage.getHedgeEvent(parseInt(req.params.id));

  // Step 1: Compare settlement rate to strike
  const price = parseFloat(settlementPrice);  // The actual FX rate at expiry
  const strike = parseFloat(event.strike);    // The trigger price
  const triggered = price >= strike;          // Did the rate hit the trigger?
  //    Example: Strike = 16.0, Rate = 17.0 → triggered = TRUE (hedgers win!)
  //    Example: Strike = 16.0, Rate = 15.5 → triggered = FALSE (LPs keep everything)

  // Step 2: Mark the event as settled
  await storage.updateHedgeEvent(event.id, {
    status: "settled",
    settlementPrice: price.toString(),
    triggered,
    settledAt: new Date()
  });

  // Step 3: Resolve every active position
  const positions = await storage.getHedgePositionsByEvent(event.id);
  for (const pos of positions) {
    if (pos.status !== "active") continue;  // Skip already-settled positions

    if (triggered && strike > 0) {
      // === HEDGER WINS ===
      // Payout = Notional × (SettlementRate − Strike) / Strike
      //
      // WHAT THIS MEANS:
      // The payout is proportional to HOW MUCH the rate moved past the strike.
      // If the rate moved 5% past strike, hedger gets 5% of their notional.
      // If the rate moved 25% past strike, hedger gets 25% of their notional.
      // There is NO CAP — extreme moves give extreme payouts.

      const rateGap = (price - strike) / strike;
      const notionalVal = parseFloat(pos.notional);
      const payout = notionalVal * rateGap;

      await storage.updateHedgePosition(pos.id, {
        status: "settled_win",
        payoutAmount: Math.max(0, payout).toFixed(2)
      });
    } else {
      // === HEDGER LOSES ===
      // Rate stayed below strike — the currency didn't devalue enough.
      // Hedger gets $0 back. LPs keep all the premiums.
      await storage.updateHedgePosition(pos.id, {
        status: "settled_loss",
        payoutAmount: "0"
      });
    }
  }

  res.json({
    message: triggered
      ? `FX rate ${price} >= strike ${strike}. Hedgers can claim payouts.`
      : `FX rate ${price} < strike ${strike}. Positions expire worthless.`,
    triggered, settlementPrice: price, strike
  });
});
```

### 4.6 Claim Payout (`POST /api/hedge/positions/:id/claim`)

> **What happens:** A hedger whose position won collects their payout. 1% fee deducted.

```typescript
app.post("/api/hedge/positions/:id/claim", async (req, res) => {
  const position = await storage.getHedgePosition(parseInt(req.params.id));
  if (position.claimed) return res.status(400).json({ message: "Already claimed" });
  if (position.status !== "settled_win")
    return res.status(400).json({ message: "Not eligible — position didn't win" });

  const grossPayout = parseFloat(position.payoutAmount || "0");

  // Deduct 1% platform fee from the payout
  const payoutFee = grossPayout * HEDGER_PAYOUT_FEE_RATE;  // e.g. $200 × 1% = $2
  const netPayout = grossPayout - payoutFee;                // e.g. $200 - $2 = $198

  // Give creator their 5% cut of the fee
  const creatorReward = payoutFee * CREATOR_LOYALTY_RATE;   // e.g. $2 × 5% = $0.10
  const event = await storage.getHedgeEvent(position.eventId);
  if (event) {
    const currentCreatorEarnings = parseFloat(event.creatorEarnings || "0");
    await storage.updateHedgeEvent(event.id, {
      creatorEarnings: (currentCreatorEarnings + creatorReward).toString()
    });
  }

  // Mark as claimed so they can't double-claim
  await storage.updateHedgePosition(position.id, {
    claimed: true,
    status: "claimed"
  });

  res.json({
    message: `Payout claimed! Gross: $${grossPayout.toFixed(2)} — Fee: $${payoutFee.toFixed(4)} — You receive: $${netPayout.toFixed(2)}`,
    grossPayout: grossPayout.toFixed(2),
    platformFee: payoutFee.toFixed(4),
    netPayout: netPayout.toFixed(2)
  });
});
```

### 4.7 LP Withdraw Capital (`POST /api/hedge/deposits/:id/withdraw`)

> **What happens:** LP takes their deposited USDC back. Only allowed after the event is done.

```typescript
app.post("/api/hedge/deposits/:id/withdraw", async (req, res) => {
  const deposit = await storage.getHedgeLpDeposit(parseInt(req.params.id));
  if (deposit.withdrawn) return res.status(400).json({ message: "Already withdrawn" });

  const event = await storage.getHedgeEvent(deposit.eventId);

  // IMPORTANT: Cannot withdraw while the event is still active
  // Why? Because the LP's capital is backing active hedges.
  // If they withdrew, there wouldn't be enough money to pay hedgers.
  if (event.status === "open") {
    return res.status(400).json({
      message: "Cannot withdraw while event is active. Wait for settlement/expiry."
    });
  }

  await storage.updateHedgeLpDeposit(deposit.id, {
    withdrawn: true,
    withdrawnAt: new Date()
  });

  res.json({ message: "Liquidity withdrawn successfully" });
});
```

### 4.8 Pool Controls (`PATCH /api/hedge/events/:id/pool`)

> **What happens:** The event creator toggles pool settings (open/close buying, allow/block external LPs).

```typescript
app.patch("/api/hedge/events/:id/pool", async (req, res) => {
  const { poolOpen, allowExternalLp, callerAddress } = req.body;
  const event = await storage.getHedgeEvent(parseInt(req.params.id));

  // Only the creator can change pool settings
  if (callerAddress.toLowerCase() !== event.createdBy.toLowerCase())
    return res.status(403).json({ message: "Only the event creator can modify pool settings" });

  // Toggle whichever field was provided
  const updates: any = {};
  if (typeof poolOpen === "boolean") updates.poolOpen = poolOpen;
  if (typeof allowExternalLp === "boolean") updates.allowExternalLp = allowExternalLp;
  await storage.updateHedgeEvent(event.id, updates);

  res.json({ message: "Pool settings updated" });
});
```

### 4.9 Pool Stats (`GET /api/hedge/events`)

> **What happens:** Every event is returned with live pool statistics — how much liquidity, how much is reserved, etc.

```typescript
app.get("/api/hedge/events", async (_req, res) => {
  const events = await storage.getAllHedgeEvents();

  const eventsWithStats = await Promise.all(events.map(async (event) => {
    const positions = await storage.getHedgePositionsByEvent(event.id);
    const deposits = await storage.getHedgeLpDepositsByEvent(event.id);

    // Total USDC in the pool (only count deposits that haven't been withdrawn)
    const totalLiquidity = deposits
      .filter(d => !d.withdrawn)
      .reduce((sum, d) => sum + parseFloat(d.amount), 0);

    // How much of the pool is "reserved" for active hedges
    const totalExposure = positions
      .filter(p => p.status === "active")
      .reduce((sum, p) => sum + parseFloat(p.maxPayout), 0);

    // All premiums ever collected from hedgers
    const totalPremiums = positions
      .reduce((sum, p) => sum + parseFloat(p.premiumPaid), 0);

    // What % of the pool is being used
    const utilization = totalLiquidity > 0 ? (totalExposure / totalLiquidity) * 100 : 0;

    return {
      ...event,
      poolStats: {
        totalLiquidity,                                          // e.g. $10,000
        totalExposure,                                           // e.g. $7,000
        totalPremiums,                                           // e.g. $175
        utilization: Math.min(utilization, 100),                 // e.g. 70%
        availableCapacity: Math.max(0, totalLiquidity - totalExposure), // e.g. $3,000
        lpCount: deposits.filter(d => !d.withdrawn).length,      // e.g. 5
        hedgerCount: positions.filter(p => p.status === "active").length // e.g. 12
      }
    };
  }));

  res.json(eventsWithStats);
});
```

---

## 5. FX Oracle (`server/fx-oracle.ts`)

> **What it does:** Fetches live exchange rates, caches them, and automatically settles expired events.

### How Rate Fetching Works

```typescript
// ┌──────────────────────────────────────────────────────────────┐
// │                    FX ORACLE FLOW                            │
// │                                                              │
// │  1. Frontend or poller calls fetchAllRates()                 │
// │  2. If cache is less than 5 minutes old → return cache       │
// │  3. Otherwise, fetch fresh rates from exchangerate-api.com   │
// │     - Fetches USD, EUR, GBP base rates in parallel           │
// │  4. Build rate objects for all 51 supported pairs            │
// │  5. Cache the results for next 5 minutes                    │
// │  6. Return rates as { "USD/GHS": { rate: 16.5, ... }, ... } │
// └──────────────────────────────────────────────────────────────┘

const CACHE_TTL = 5 * 60 * 1000;  // Cache for 5 minutes
const API_URL = "https://open.er-api.com/v6/latest";

// Fetch rates for one base currency (USD, EUR, or GBP)
async function fetchRatesForBase(base: string): Promise<Record<string, number>> {
  const response = await fetch(`${API_URL}/${base}`);
  const data = await response.json();
  return data.rates;  // { "GHS": 16.5, "NGN": 1600, ... }
}

// Fetch ALL supported pairs (called by frontend and poller)
export async function fetchAllRates(): Promise<Record<string, FXRate>> {
  const now = Date.now();

  // Return cached rates if they're still fresh
  if (now - cache.lastFetch < CACHE_TTL && Object.keys(cache.rates).length > 0) {
    return cache.rates;
  }

  // Fetch USD, EUR, GBP rates in parallel (3 API calls)
  const bases = [...new Set(Object.values(SUPPORTED_PAIRS).map(p => p.base))];
  const allRates: Record<string, Record<string, number>> = {};
  await Promise.all(bases.map(async (base) => {
    allRates[base] = await fetchRatesForBase(base);
  }));

  // Build rate objects for each of our 51 supported pairs
  const result: Record<string, FXRate> = {};
  for (const [pair, { base, quote }] of Object.entries(SUPPORTED_PAIRS)) {
    const rate = allRates[base]?.[quote];
    if (rate) {
      result[pair] = {
        pair,                                    // e.g. "USD/GHS"
        rate,                                    // e.g. 16.5
        source: "exchangerate-api.com",
        timestamp: now,
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  // Save to cache
  cache.rates = result;
  cache.lastFetch = now;
  return result;
}
```

### One-Touch Settlement (polls every 5 minutes)

```typescript
// ┌──────────────────────────────────────────────────────────────┐
// │              ONE-TOUCH SETTLEMENT FLOW                       │
// │                                                              │
// │  1. Oracle poller runs every 5 minutes (300s)                │
// │  2. Checks ALL events with status "open"                     │
// │  3. For each open event:                                     │
// │     a. Fetch live FX rate for the event's currency pair      │
// │     b. If rate >= strike → ONE-TOUCH TRIGGERED!              │
// │        - Settle immediately (don't wait for expiry)          │
// │        - Mark positions as "claimable"                       │
// │        - Mark event as "settled", triggered = true           │
// │     c. If rate < strike AND event has expired:               │
// │        - Mark positions as "expired"                         │
// │        - Mark event as "settled", triggered = false          │
// │        - LPs keep everything                                 │
// │     d. If rate < strike AND NOT expired: do nothing (wait)   │
// │  4. Log one-touch vs expiry settlement counts                │
// └──────────────────────────────────────────────────────────────┘

export async function checkExpiredEvents(storage: any) {
  const events = await storage.getAllHedgeEvents();
  const now = new Date();
  let settled = 0;

  for (const event of events) {
    // Skip events that aren't open or haven't expired yet
    if (event.status !== "open") continue;
    if (new Date(event.expiryDate) > now) continue;

    // Get the live FX rate
    const rate = await getRate(event.underlying);
    if (!rate) continue;  // Skip if we can't get a rate

    const positions = await storage.getHedgePositionsByEvent(event.id);
    const deposits = await storage.getHedgeLpDepositsByEvent(event.id);
    const triggered = rate.rate >= parseFloat(event.strike);
    const strikePrice = parseFloat(event.strike);

    if (triggered && strikePrice > 0) {
      // HEDGERS WIN — calculate payouts using the formula
      const rateGap = (rate.rate - strikePrice) / strikePrice;
      for (const pos of positions.filter((p: any) => p.status === "active")) {
        const payout = parseFloat(pos.notional) * rateGap;
        await storage.updateHedgePosition(pos.id, {
          status: "claimable",                      // Ready for hedger to claim
          payoutAmount: Math.max(0, payout).toFixed(2),
        });
      }
    } else {
      // HEDGERS LOSE — no payout
      for (const pos of positions.filter((p: any) => p.status === "active")) {
        await storage.updateHedgePosition(pos.id, {
          status: "expired",
          payoutAmount: "0",
        });
      }
    }

    // Distribute premiums to LPs (proportional to shares)
    const totalPremiums = positions.reduce((sum: number, p: any) =>
      sum + parseFloat(p.premiumPaid), 0);
    const totalShares = deposits.filter((d: any) => !d.withdrawn)
      .reduce((sum: number, d: any) => sum + parseFloat(d.shares), 0);

    if (totalShares > 0) {
      for (const dep of deposits.filter((d: any) => !d.withdrawn)) {
        const share = parseFloat(dep.shares) / totalShares;
        const earned = parseFloat(dep.premiumsEarned || "0") + (totalPremiums * share);
        await storage.updateHedgeLpDeposit(dep.id, {
          premiumsEarned: earned.toString()
        });
      }
    }

    // Mark event as settled
    await storage.updateHedgeEvent(event.id, {
      status: "settled",
      settlementPrice: rate.rate.toString(),
      triggered,
      settledAt: new Date(),
    });
    settled++;
  }

  return { settled };
}

// Start the poller (called once when server boots up)
// Polls every 5 minutes (300,000ms) for one-touch settlement
export function startOraclePoller(storage: any, intervalMs: number = 5 * 60 * 1000) {
  fetchAllRates();  // Fetch rates immediately on startup
  setInterval(async () => {
    await fetchAllRates();           // Refresh rate cache
    await checkExpiredEvents(storage); // Settle any expired events
  }, intervalMs);  // Default: every 60 minutes
}
```

### Supported Currency Pairs (51 total)

```
USD pairs (34): GHS, NGN, KES, ZAR, XOF, XAF, TZS, UGX, RWF, ETB,
                EGP, MAD, TND, MZN, ZMW, MWK, AOA, CDF, SDG, GMD,
                SLL, LRD, BWP, NAD, SZL, LSL, SCR, MUR, DJF, ERN,
                SOS, BIF, CVE, KMF, MGA, STN

EUR pairs (9):  GHS, NGN, KES, ZAR, XOF, XAF, EGP, MAD, TND

GBP pairs (5):  GHS, NGN, KES, ZAR, EGP
```

---

## 6. Frontend: "My Hedges" Tab

> **Where:** `client/src/pages/hedge.tsx`, inside the "My Hedges" tab
> **What:** Shows BOTH LP deposits and hedger positions in one unified view

### Layout

The "My Hedges" tab shows two sections:

1. **My LP Deposits** (collapsible, shown at top if user has deposits)
   - Shows active deposit count and total deposited amount
   - Each deposit card shows: event name, currency pair, amount, shares, premiums earned/claimable
   - Locked badge while event is open; Withdraw button after settlement
   - Claim premiums button with fee breakdown

2. **My Protection Positions** (shown below LP deposits)
   - Each position card shows: event name, notional, premium paid, status
   - Live estimated payout using current FX rate (updates in real-time)
   - Claim button for winning positions after settlement

### Real-Time Estimated Payout

```typescript
// For each active hedge position in "My Hedges":
const notionalNum = parseFloat(pos.notional);
const strikeNum = event ? parseFloat(event.strike) : 0;
const currentRate = event && fxData?.rates?.[event.underlying]?.rate || 0;

// Apply the same payout formula using the CURRENT rate (not settlement rate)
// This gives a live estimate that updates as FX rates change
const estGrossPayout = (pos.status === "active" && currentRate > strikeNum && strikeNum > 0)
  ? notionalNum * (currentRate - strikeNum) / strikeNum
  : 0;

// Deduct the 1% fee to show what they'd actually receive
const estNetPayout = estGrossPayout > 0 ? estGrossPayout * 0.99 : 0;

// UI shows:
// "Expected Payout: $X.XX" (green, if rate > strike)
// "Expected Payout: $0.00" (gray, if rate <= strike)
```

---

## 7. Frontend: Shareable Event Links

> **Where:** `client/src/pages/hedge.tsx`
> **What:** Anyone can share a direct link to buy protection or provide liquidity for a specific event.

```typescript
// === GENERATING A SHARE LINK ===
// Creates a URL like: https://blockfinax.com/hedge?event=42&action=buy
const copyShareLink = (eventId: number, action: "buy" | "lp") => {
  const url = `${window.location.origin}/hedge?event=${eventId}&action=${action}`;
  navigator.clipboard.writeText(url);
  // Show toast: "Link copied!"
};

// === OPENING A SHARED LINK ===
// When someone visits the link, auto-open the right dialog
useEffect(() => {
  if (eventsLoading || events.length === 0) return;
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get("event");
  const action = params.get("action");
  if (!eventId) return;

  // Find the event and open the right dialog
  const event = events.find(e => e.id === parseInt(eventId));
  if (!event) return;

  setSelectedEvent(event);
  if (action === "buy") {
    setActiveTab("hedger");        // Switch to "Buy Protection" tab
    setBuyDialogOpen(true);        // Open the buy dialog
  } else if (action === "lp") {
    setActiveTab("lp");            // Switch to "Provide Liquidity" tab
    setDepositDialogOpen(true);    // Open the deposit dialog
  }

  // Clean the URL so it doesn't re-trigger on refresh
  window.history.replaceState({}, "", window.location.pathname);
}, [eventsLoading, events]);
```

---

## 8. Frontend: Creator Profile & Privacy

> **Where:** `client/src/pages/hedge.tsx`
> **Rule:** Creator's earnings are PRIVATE. Public visitors only see total liquidity.

```typescript
// Check if the viewer is the creator
const isOwnProfile = wallet?.address?.toLowerCase() === viewingCreator.toLowerCase();

// === WHAT THE CREATOR SEES (their own profile) ===
// Three columns:
// 1. Pool Premiums Earned: $X.XX (total premiums from all their events)
// 2. Creator's Earnings: $X.XX (their 5% loyalty cut)
// 3. Total Liquidity: $X.XX (total USDC in their pools)

// === WHAT EVERYONE ELSE SEES (public profile) ===
// One column only:
// 1. Total Liquidity Provided: $X.XX
// (No premiums or creator earnings — those are private)

// === MY EVENTS TAB (creator only) ===
// Shows an earnings summary at the top:
const myEvents = events.filter(e => e.createdBy === wallet?.address);
const totalPremiums = myEvents.reduce((sum, e) =>
  sum + (e.poolStats?.totalPremiums || 0), 0);
const totalLoyalty = myEvents.reduce((sum, e) =>
  sum + parseFloat((e as any).creatorEarnings || "0"), 0);

// Displays two cards:
// "Pool Premiums Earned: $X.XX"    ← Total premiums collected across all their events
// "Creator's Earnings: $X.XX"       ← Their 5% loyalty reward across all events
```

---

## 9. Blockchain Details (Database-Driven Backend)

| Property | Value |
|----------|-------|
| **Network** | Base Sepolia (testnet) |
| **RPC URL** | `https://sepolia.base.org` |
| **USDC Contract** | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| **Treasury Wallet** | Derived from `TREASURY_POOL_PRIVATE_KEY` env secret |
| **Library** | ethers.js v6 |

In the database-driven backend, on-chain transfers happen in two places:
1. **LP claims premiums** → Treasury sends USDC to LP's wallet
2. **Hedger claims payout** → Treasury sends USDC to hedger's wallet

---

## 10. Smart Contract: HedgeFacet (On-Chain)

> **Status:** Compiled and ready for deployment on Base Sepolia
> **Architecture:** EIP-2535 Diamond Standard — added as a new facet to the existing BlockFinaX Diamond

### What Moved On-Chain

The `HedgeFacet.sol` smart contract replicates ALL the hedge logic that was previously in the database/backend:

| Feature | Database Version | Smart Contract Version |
|---------|-----------------|----------------------|
| Event creation | `POST /api/hedge/events` | `createEvent()` |
| LP deposit | `POST /api/hedge/deposits` | `deposit()` |
| Buy protection | `POST /api/hedge/positions` | `buyProtection()` |
| Settlement | `POST /api/hedge/events/:id/settle` | `settleEvent()` |
| Hedger claim | `POST /api/hedge/positions/:id/claim` | `claimPayout()` |
| LP claim premiums | `POST /api/hedge/deposits/:id/claim-premiums` | `claimPremiums()` |
| LP withdraw capital | `POST /api/hedge/deposits/:id/withdraw` | `withdrawCapital()` |
| Pool controls | `PATCH /api/hedge/events/:id/pool` | `setPoolSettings()` |
| Creator earnings | Tracked in DB, claimed via treasury | `withdrawCreatorEarnings()` |

### Key Difference: Trustless

In the database version, users trust the server to:
- Hold their USDC in the treasury wallet
- Calculate payouts correctly
- Distribute premiums fairly

In the smart contract version:
- **The Diamond contract holds all USDC** — no external treasury wallet
- **All calculations happen on-chain** — payout formula, fee deduction, premium distribution
- **Users interact directly with the blockchain** — no server middleman for money flows

### Source Files

```
contracts/
├── src/
│   ├── libraries/
│   │   └── LibAppStorage.sol     ← Hedge storage structs added here
│   └── facets/
│       └── HedgeFacet.sol        ← All hedge logic (580+ lines)
├── scripts/
│   └── deploy-diamond.js         ← Updated to deploy HedgeFacet
└── hardhat.config.js             ← Base Sepolia network config
```

### Storage Structs (`LibAppStorage.sol`)

```solidity
// All amounts use 6 decimals (USDC standard)
// Shares use 18 decimals for precision

struct HedgeEvent {
    uint256 id;
    address creator;
    string name;
    string underlying;       // e.g. "USD/GHS"
    uint256 strike;          // 6 decimals (16500000 = 16.5)
    uint256 premiumRate;     // 6 decimals (25000 = 2.5%)
    uint256 expiryDate;      // Unix timestamp
    HedgeEventStatus status; // Open, Settled, Expired
    uint256 settlementPrice;
    bool triggered;
    bool poolOpen;           // Creator toggle
    bool allowExternalLp;    // Creator toggle
    uint256 creatorEarnings; // 5% of platform fees
    uint256 totalLiquidity;  // USDC in pool
    uint256 totalExposure;   // Capacity reserved
    uint256 totalPremiums;   // All premiums collected
    uint256 lpCount;
    uint256 hedgerCount;
}

struct HedgePosition {
    uint256 id;
    uint256 eventId;
    address hedger;
    uint256 notional;        // Coverage amount
    uint256 premiumPaid;     // Goes 100% to LPs
    uint256 platformFeePaid; // 0.5% of notional
    uint256 payoutAmount;    // Calculated at settlement
    HedgePositionStatus status;
    bool claimed;
}

struct HedgeLpDeposit {
    uint256 id;
    uint256 eventId;
    address lp;
    uint256 amount;          // USDC deposited
    uint256 shares;          // Pool share (18 decimals)
    uint256 premiumsEarned;
    uint256 premiumsClaimed;
    bool withdrawn;
}

struct HedgeFeeConfig {
    uint256 eventCreationFee;    // 25 USDC (25e6)
    uint256 hedgerFeeRate;       // 0.5% (5000)
    uint256 hedgerPayoutFeeRate; // 1% (10000)
    uint256 lpProfitFeeRate;     // 1% (10000)
    uint256 creatorLoyaltyRate;  // 5% (50000)
}
```

### Contract Functions

#### Admin (owner only)
```solidity
initializeHedgeFees(eventCreationFee, hedgerFeeRate, hedgerPayoutFeeRate, lpProfitFeeRate, creatorLoyaltyRate)
setOracleAdmin(address)
withdrawPlatformFees(amount)
```

#### Creator
```solidity
createEvent(CreateEventParams)  // Pays creation fee + initial liquidity
setPoolSettings(eventId, poolOpen, allowExternalLp)
withdrawCreatorEarnings(eventId)
```

#### Liquidity Provider
```solidity
deposit(eventId, amount)        // Min 10 USDC, gets proportional shares
claimPremiums(depositId)        // Claim earned premiums (1% fee deducted)
withdrawCapital(depositId)      // Only after event settles
```

#### Hedger
```solidity
buyProtection(eventId, notional) // Pays premium + 0.5% fee
claimPayout(positionId)          // After winning settlement (1% fee deducted)
```

#### Oracle Admin
```solidity
settleEvent(eventId, settlementPrice)  // Posts FX rate, resolves all positions
```

#### View Functions
```solidity
getHedgeEventCore(eventId)      // Name, underlying, strike, premiumRate, etc.
getHedgeEventStats(eventId)     // Liquidity, exposure, premiums, settlement info
getHedgePosition(positionId)    // Position details
getHedgeLpDeposit(depositId)    // LP deposit details
getEventPositionIds(eventId)    // All position IDs for an event
getEventDepositIds(eventId)     // All deposit IDs for an event
getCreatorEventIds(creator)     // All events by a creator
getHedgerPositionIds(hedger)    // All positions by a hedger
getLpDepositIds(lp)             // All deposits by an LP
getHedgeFeeConfig()             // Current fee rates
getHedgePlatformFees()          // Total fees collected
getTotalHedgeEvents()           // Total events created
getPoolUtilization(eventId)     // Liquidity, exposure, available capacity, %
```

### On-Chain Fee Flow

```
HEDGER BUYS $1,000 PROTECTION (2.5% premium):

  USDC transferred from hedger to Diamond contract:
  ├── Premium: $25.00 ───────→ Distributed to LP deposits (proportional to shares)
  ├── Platform fee: $5.00 ──→ Stays in Diamond contract
  │   └── Creator: $0.25 ──→ 5% of fee → evt.creatorEarnings (claimable)
  └── Total: $30.00

  On-chain events emitted:
  └── ProtectionPurchased(eventId, positionId, hedger, notional, premium, fee, total)


LP CLAIMS $50 PREMIUMS:

  Diamond contract transfers to LP wallet:
  ├── Gross: $50.00
  ├── Platform fee: -$0.50 → Stays in Diamond
  │   └── Creator: $0.025 → evt.creatorEarnings
  └── Net sent: $49.50

  On-chain events emitted:
  └── PremiumsClaimed(depositId, lp, grossAmount, fee, netAmount)


HEDGER CLAIMS $200 PAYOUT:

  Diamond contract transfers to hedger wallet:
  ├── Gross: $200.00
  ├── Platform fee: -$2.00 → Stays in Diamond
  │   └── Creator: $0.10 → evt.creatorEarnings
  └── Net sent: $198.00

  On-chain events emitted:
  └── PayoutClaimed(positionId, hedger, grossPayout, fee, netPayout)
```

### Oracle Strategy

**Phase 1 (Current):** Admin-posted settlement price
- The deployer or designated oracle admin calls `settleEvent(eventId, price)`
- The server's FX oracle fetcher (`server/fx-oracle.ts`) feeds rates to the admin
- Admin is the bridge between off-chain FX data and on-chain settlement

**Phase 2 (Future):** Chainlink or decentralized oracle
- Replace admin-posted prices with Chainlink price feeds
- Settlement becomes fully automated and trustless
- Anyone can trigger settlement once expiry is reached

### Deployment Commands

```bash
cd contracts

# Compile
npx hardhat compile

# Deploy to Base Sepolia (testnet)
npx hardhat run scripts/deploy-diamond.js --network baseSepolia

# After deployment, initialize fees:
# Call initializeHedgeFees(25000000, 5000, 10000, 10000, 50000)
# Call setOracleAdmin(oracleAddress)
```

### Contract Events (for indexing)

```solidity
HedgeEventCreated(eventId, creator, underlying, strike, premiumRate, expiryDate, initialLiquidity)
PoolSettingsUpdated(eventId, poolOpen, allowExternalLp)
LiquidityDeposited(eventId, depositId, lp, amount, shares)
ProtectionPurchased(eventId, positionId, hedger, notional, premiumPaid, platformFee, totalCost)
EventSettled(eventId, settlementPrice, triggered)
PayoutClaimed(positionId, hedger, grossPayout, fee, netPayout)
PremiumsClaimed(depositId, lp, grossAmount, fee, netAmount)
CapitalWithdrawn(depositId, lp, amount)
CreatorEarningsWithdrawn(eventId, creator, amount)
PlatformFeesWithdrawn(admin, amount)
```

These events can be indexed by a backend listener to keep the database in sync for fast UI queries.

---

## 11. Important Rules & Gotchas

| Rule | Details |
|------|---------|
| **Pool starts closed** | `poolOpen` defaults to `false`. Creator must toggle it open before hedgers can buy. |
| **Minimum deposit is $10** | Both initial liquidity and LP deposits require at least $10 (10e6 in USDC decimals). |
| **Minimum notional is $10** | Hedgers must protect at least $10. |
| **LP capital is locked** | LPs cannot withdraw while the event is `Open`. Must wait for `Settled` or `Expired`. |
| **Premiums can be claimed anytime** | LP premium claims are independent of event status. |
| **Payout is uncapped** | Formula: `Notional × (Rate - Strike) / Strike`. No maximum. |
| **Pool capacity uses payoutRate** | Liquidity check: `maxPayout = notional × payoutRate` (default 30%), NOT the full notional. This lets pools support ~3x more hedgers. Actual payout at settlement can exceed this estimate. |
| **One-touch settlement** | Oracle polls every 5 minutes. If rate touches strike at ANY time (not just at expiry), the event settles immediately. |
| **Creator earnings are private** | Only visible to the creator on My Events tab and their own profile. |
| **Oracle is admin-posted** | Phase 1 uses a trusted admin to post settlement prices. |
| **All USDC held by Diamond** | The smart contract itself holds all liquidity, premiums, and fees. |
| **Events emitted for indexing** | All state changes emit Solidity events for off-chain tracking. |
| **USDC uses 6 decimals** | All amounts in the contract use 6 decimal places (1 USDC = 1e6). |
| **Shares use 18 decimals** | LP shares use 18 decimal places for precision in premium distribution. |
