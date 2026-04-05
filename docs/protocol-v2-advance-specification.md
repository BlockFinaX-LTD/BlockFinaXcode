# BlockFinaX Advance — v2 Protocol Specification

> **Advance** is the second generation of the BlockFinaX hedge protocol. It upgrades the fixed-strike, creator-priced model of v1 into a dynamic, formula-priced system where event creators define a strike range and hedgers choose their exact protection level. Premium is calculated automatically by the protocol using a touch option pricing formula derived from financial mathematics.

---

## 1. Overview

### Why Advance Exists

In v1, event creators set a single fixed strike price and a manually chosen premium rate. Hedgers take it or leave it — they have no ability to customise their protection level. This works for simple use cases but diverges significantly from how professional FX derivatives markets operate, where the client (hedger) specifies the strike they want and receives a price for it.

**Advance closes that gap.**

The creator defines a range of acceptable strikes (e.g. GHS/USD between 15.00 and 16.50). Any hedger can then pick any strike within that range. The protocol automatically calculates the fair premium for their chosen strike using a touch option pricing formula. No guesswork. No manual pricing. The math does the work.

### What Changes for Each Party

| Party | v1 Classic | Advance |
|---|---|---|
| **Event Creator** | Sets one fixed strike + one manual premium rate | Sets a strike range + expiry + premium multiplier |
| **Hedger** | Takes the available strike or finds another event | Picks any strike within the range; gets a dynamically priced premium |
| **LP** | Backs one fixed payout scenario | Backs a pool covering multiple hedger positions at different strikes |
| **Protocol** | Passes creator's premium to chain unchanged | Calculates and enforces fair premium on-chain using the pricing formula |
| **Oracle** | Settles when spot touches one event-level strike | Settles each position individually when spot touches that hedger's chosen strike |

---

## 2. Key Differences: v1 vs Advance

| Feature | v1 Classic | v2 Advance |
|---|---|---|
| Strike | Single fixed value set by creator | Range (min, max) set by creator |
| Premium | Manual % set by creator | Formula-derived, calculated per hedger at entry |
| Who prices risk | Event creator | The protocol (on-chain formula) |
| Hedger choice | Accept or reject the event | Choose any strike within range; see premium update live |
| LP pool risk | Single known payout scenario | Multiple positions with different strikes and payouts |
| Settlement | One trigger level for all hedgers | Per-hedger trigger — each position settles independently |
| Contract fields | `strike`, `premiumRate` on event | `strikeMin`, `strikeMax`, `premiumMultiplier` on event; `chosenStrike` on position |
| Backwards compatible | — | Yes — v1 Classic events continue to function unchanged |

---

## 3. The Pricing Engine

### 3.1 Formula Derivation

A one-touch option pays out if the underlying price touches a barrier level at any point before expiry. The probability of this occurring depends on three things: how far the barrier is from the current price, how volatile the asset is, and how much time remains.

The closed-form approximation for touch probability under a geometric Brownian motion assumption is:

```
Touch Probability = exp( −2 × d² / (σ² × T) )
```

Where:

| Variable | Meaning | Units |
|---|---|---|
| `d` | Distance to strike as a fraction of current rate: `|strike − currentRate| / currentRate` | Decimal (e.g. 0.05 = 5%) |
| `σ` | Daily volatility of the underlying asset | Decimal per day (e.g. 0.009 = 0.9%/day) |
| `T` | Days to expiry | Days (e.g. 7.0) |

The fair premium rate (as a percentage of notional) is:

```
Fair Premium Rate = Touch Probability × d
```

**Why multiply by `d`?**
If the event triggers, the payout is approximately `d` — the percentage move from the initial rate to the chosen strike. A fair price for protection equals the probability of the event occurring multiplied by the payout if it does. This mirrors expected-value pricing used in actuarial science and derivatives markets.

### 3.2 Worked Examples

#### Example A — Tight Strike (USD/GHS, 14-day expiry)

- Current rate: 15.00
- Hedger chooses strike: 15.15 (1% above)
- Daily volatility σ = 0.009
- Days to expiry T = 14

```
d = |15.15 − 15.00| / 15.00 = 0.01

Touch Probability = exp( −2 × 0.01² / (0.009² × 14) )
                 = exp( −2 × 0.0001 / 0.001134 )
                 = exp( −0.176 )
                 = 0.839   →   ~84% chance of being touched

Fair Premium Rate = 0.839 × 0.01 = 0.84%
```

**Interpretation:** Near-certain to trigger. Hedger pays 0.84% of notional for very reliable protection.

#### Example B — Mid-Range Strike (USD/GHS, 14-day expiry)

- Strike: 15.45 (3% above current)

```
d = 0.03

Touch Probability = exp( −2 × 0.03² / (0.009² × 14) )
                 = exp( −2 × 0.0009 / 0.001134 )
                 = exp( −1.587 )
                 = 0.205   →   ~21% chance

Fair Premium Rate = 0.205 × 0.03 = 0.61%
```

#### Example C — Distant Strike (USD/GHS, 14-day expiry)

- Strike: 15.75 (5% above current)

```
d = 0.05

Touch Probability = exp( −2 × 0.05² / (0.009² × 14) )
                 = exp( −2 × 0.0025 / 0.001134 )
                 = exp( −4.41 )
                 = 0.012   →   ~1.2% chance

Fair Premium Rate = 0.012 × 0.05 = 0.06%
```

**Interpretation:** Unlikely to trigger. Very cheap premium but offers a large payout if the rate does reach 15.75.

#### Key Observation

The formula self-balances. Closer strikes are more likely to trigger but also have smaller payouts (`d` is small). Distant strikes are unlikely to trigger but offer proportionally larger payouts. This prevents any single strike from being obviously mispriced — it is not possible to get both a low premium and a high touch probability at the same strike.

### 3.3 Effect of Time

Longer expiry = more time for the market to wander = higher touch probability = higher premium:

| Expiry | Touch Probability (d=3%, σ=0.009) | Fair Premium Rate |
|---|---|---|
| 3 days | 5.3% | 0.16% |
| 7 days | 12.7% | 0.38% |
| 14 days | 20.5% | 0.61% |
| 30 days | 32.8% | 0.98% |

### 3.4 Effect of Volatility

Higher volatility = price moves more each day = higher chance of touching any given strike:

| Volatility σ | Touch Probability (d=3%, T=14) | Fair Premium Rate |
|---|---|---|
| 0.005 (stable FX) | 3.3% | 0.10% |
| 0.009 (African FX avg) | 20.5% | 0.61% |
| 0.020 (crude oil) | 72.8% | 2.18% |
| 0.040 (Ethereum) | 97.4% | 2.92% |

---

## 4. Volatility (σ) — Source and Calculation

### 4.1 What Daily Volatility Means

Daily volatility is the standard deviation of day-over-day log returns. It captures how much the price typically moves each day as a percentage.

```
Step 1: Collect closing prices for the last 30 days
Step 2: Calculate daily log returns: r_t = ln(Price_t / Price_{t−1})
Step 3: σ = standard deviation of (r_1, r_2, ... r_30)
```

A σ of 0.009 means the price moves roughly ±0.9% on a typical day (one standard deviation). Moves of ±1.8% occur roughly 5% of the time.

### 4.2 Reference Volatility Table (v2 Static Lookup)

All values represent estimated daily σ based on historical analysis of each asset class. Used directly in the on-chain pricing formula and displayed transparently to users.

#### African FX Pairs

| Pair | σ/day | Regime |
|---|---|---|
| USD/GHS | 0.009 | BOG managed float |
| USD/NGN | 0.014 | Post-unification — elevated vol |
| USD/KES | 0.007 | Relatively stable |
| USD/ZAR | 0.010 | Liquid, moderate vol |
| USD/EGP | 0.012 | Devaluation risk |
| USD/UGX | 0.008 | Moderate |
| USD/TZS | 0.007 | Stable |
| USD/ETB | 0.011 | Managed — periodic resets |
| USD/MAD | 0.005 | Pegged band |
| USD/TND | 0.006 | Moderate |
| USD/XOF | 0.003 | West African CFA — soft EUR peg |
| USD/XAF | 0.003 | Central African CFA — soft EUR peg |
| EUR/GHS | 0.010 | EUR/GHS cross |
| EUR/NGN | 0.015 | High vol cross |
| EUR/KES | 0.008 | Moderate cross |
| GBP/GHS | 0.011 | GBP/GHS cross |
| GBP/NGN | 0.015 | High vol cross |
| USD/RWF | 0.006 | Rwandan Franc |
| USD/MZN | 0.009 | Mozambican Metical |
| USD/ZMW | 0.010 | Zambian Kwacha |
| USD/BWP | 0.007 | Botswana Pula |
| USD/MUR | 0.006 | Mauritian Rupee |
| USD/SCR | 0.007 | Seychellois Rupee |
| USD/GMD | 0.008 | Gambian Dalasi |
| USD/SLL | 0.010 | Sierra Leonean Leone |
| USD/GNF | 0.011 | Guinean Franc |
| USD/CDF | 0.013 | Congolese Franc |
| USD/AOA | 0.014 | Angolan Kwanza |
| USD/MWK | 0.012 | Malawian Kwacha |
| USD/LSL | 0.010 | ZAR-linked |
| USD/SZL | 0.010 | ZAR-linked |
| USD/NAD | 0.010 | ZAR-linked |
| USD/CVE | 0.004 | EUR-linked |
| USD/STN | 0.009 | São Tomé Dobra |
| USD/DJF | 0.002 | USD-pegged |
| USD/ERN | 0.002 | Controlled rate |
| USD/SDG | 0.020 | High risk |
| USD/SSP | 0.025 | Very high risk |
| USD/LYD | 0.008 | Dual rate risk |
| USD/MGA | 0.009 | Malagasy Ariary |

#### Major FX Pairs

| Pair | σ/day |
|---|---|
| EUR/USD | 0.004 |
| GBP/USD | 0.005 |
| USD/JPY | 0.004 |
| USD/CHF | 0.004 |
| USD/CAD | 0.004 |
| AUD/USD | 0.005 |

#### Metals

| Asset | σ/day | Notes |
|---|---|---|
| XAU/USD | 0.009 | Gold |
| XAG/USD | 0.014 | Silver — higher vol |
| XPT/USD | 0.012 | Platinum |
| XPD/USD | 0.016 | Palladium — highest among metals |

#### Energy & Agriculture

| Asset | σ/day |
|---|---|
| XTI/USD (WTI Crude) | 0.020 |
| XBR/USD (Brent) | 0.019 |
| XNG/USD (Natural Gas) | 0.025 |
| XCO/USD (Copper) | 0.018 |
| XCF/USD (Coffee) | 0.015 |
| XWH/USD (Wheat) | 0.016 |
| XSG/USD (Sugar) | 0.012 |

#### Crypto

| Asset | σ/day |
|---|---|
| BTC/USD | 0.035 |
| ETH/USD | 0.040 |
| BNB/USD | 0.042 |
| SOL/USD | 0.050 |
| XRP/USD | 0.045 |
| ADA/USD | 0.044 |

**Default fallback:** σ = 0.010 for any unlisted pair.

### 4.3 v2.1 Enhancement — Dynamic σ from Oracle History

In v2, σ values are static (lookup table). In v2.1, the oracle writes price observations into `AppStorage` as a rolling 30-day buffer per underlying. The pricing formula reads this live data, computing σ dynamically so the formula always reflects current market conditions rather than historical averages. This is especially important for African FX pairs during episodes of acute stress (e.g. currency crises, central bank interventions).

---

## 5. Creator Flow — Advance Events

### 5.1 Event Creation Parameters

| Field | Type | Description |
|---|---|---|
| `name` | string | Display name for the event |
| `underlying` | string | Asset pair (e.g. USD/GHS) |
| `direction` | bool | `up` — strike above current rate; `down` — strike below |
| `strikeMin` | uint256 | Minimum strike hedgers can select (6 decimal USDC precision) |
| `strikeMax` | uint256 | Maximum strike hedgers can select |
| `expiryHours` | uint256 | Duration until settlement eligibility |
| `premiumMultiplier` | uint256 | Scaled by 1e6 — e.g. 1200000 = 1.20× fair value |
| `initialLiquidity` | uint256 | Creator's USDC deposit to seed the pool |
| `allowExternalLp` | bool | Whether third-party LPs can add to the pool |

### 5.2 The Premium Multiplier

Rather than setting a manual premium rate, the creator sets a multiplier applied on top of the formula's fair value at any chosen strike:

```
Actual Premium Rate = Fair Premium Rate × premiumMultiplier

Examples:
  multiplier = 1.00 → exactly fair value — LP earns formula-priced premium, no creator margin
  multiplier = 1.20 → 20% above fair value — LP-friendly buffer; recommended default
  multiplier = 1.50 → 50% above fair value — conservative pool; lower hedger demand expected
  multiplier = 0.90 → 10% below fair value — subsidises hedgers; used to attract volume
```

The multiplier applies uniformly across the entire strike range. A creator cannot set different multipliers for different parts of the range — that complexity is deferred to v3.

### 5.3 Live Premium Curve

The creation UI renders a premium curve — a chart showing the actual premium rate at every point in the defined strike range. The creator sees immediately what hedgers will pay for tight vs distant strikes before publishing. This helps the creator validate that the range and multiplier produce sensible economics.

---

## 6. Hedger Flow — Advance Events

### 6.1 Entering a Position

1. Hedger browses the marketplace and identifies an Advance event (badged "Advance")
2. A strike selector — slider and direct input — is shown, bounded by `strikeMin` and `strikeMax`
3. As the hedger adjusts the strike, the UI updates in real time:

| Display | Description |
|---|---|
| Touch Probability | % chance the market reaches this strike before expiry |
| Fair Premium | Formula output before the creator's multiplier |
| Your Premium | What the hedger actually pays (fair × multiplier) |
| Expected Payout | Notional × d — fixed at entry, paid if strike is touched |

4. Hedger enters their USDC notional and submits the transaction
5. The smart contract validates the chosen strike is within range, calculates premium on-chain, checks pool capacity, and records the position

### 6.2 Certainty at Entry

All outcomes are predetermined at purchase — identical to v1 in this respect:

| Item | Fixed at purchase |
|---|---|
| Chosen strike | Yes |
| Premium paid | Yes |
| Payout if triggered | Yes — Notional × d |
| Expiry | Yes (shared with all event participants) |

There are no mark-to-market adjustments, margin calls, or variable payouts. The hedger knows their maximum loss (premium paid) and maximum gain (payout amount) at the moment they enter.

---

## 7. LP Pool Mechanics — Advance Events

### 7.1 Why Per-Hedger Tracking Is Required

In v1, all hedgers enter at the same strike with the same payout percentage. Maximum pool liability is simple: `sum(notional) × payoutPercent`.

In Advance, each hedger has a different chosen strike and therefore a different payout percentage `d`. The pool must track each position's maximum liability individually:

```
Position A: $10,000 notional, d = 1.0% → max payout = $100
Position B:  $5,000 notional, d = 4.0% → max payout = $200
Position C: $20,000 notional, d = 7.0% → max payout = $1,400

Total pool liability = $1,700
Pool must hold ≥ $1,700 in USDC to accept all three positions
```

### 7.2 Capacity Check

Before accepting any new hedger position, the contract verifies:

```
currentTotalMaxPayout + newPositionMaxPayout ≤ totalPoolLiquidity
```

If insufficient capacity exists, the transaction reverts with a clear error. The UI performs this check before the transaction is signed, preventing wasted gas.

### 7.3 LP Returns

LPs earn all premium paid by every hedger who enters the pool, regardless of their chosen strike. Premiums are distributed proportionally to LP shares at the time of premium collection. Events with wide, attractive ranges and a fair multiplier tend to attract more hedger participation, generating more premium income for LPs.

### 7.4 LP Risk Profile

LPs in an Advance event face a more complex risk profile than in v1:
- Multiple positions may trigger at different times (positions near current rate trigger first)
- Total payout obligation depends on which positions trigger — not all necessarily do
- If only some positions trigger, remaining pool liquidity stays intact for non-triggered LPs

LPs should assess the full strike range and total maximum payout obligation before depositing, not just the headline pool size.

---

## 8. Smart Contract Changes — HedgeFacet v2

### 8.1 AppStorage — Append Only

**Critical rule enforced by the Diamond Standard:** Fields are only ever appended to structs. They are never removed or reordered. This preserves the Diamond storage layout and ensures all v1 data remains valid.

#### HedgeEvent struct — new fields appended at end:

```solidity
// ── v1 fields (positions 0–N, unchanged) ──────────────────────────────────
uint256 id;
address creator;
string name;
string underlying;
uint256 strike;           // v1 fixed strike — ignored for Advance events
uint256 premiumRate;      // v1 fixed premium — ignored for Advance events
uint256 expiryDate;
HedgeEventStatus status;
bool poolOpen;
bool allowExternalLp;
uint256 initialRate;
bool strikeAbove;
// ... all other existing v1 fields

// ── v2 Advance fields (appended after all v1 fields) ──────────────────────
bool isAdvanceEvent;       // true = Advance range event; false = v1 Classic
uint256 strikeMin;         // minimum strike hedgers may select
uint256 strikeMax;         // maximum strike hedgers may select
uint256 premiumMultiplier; // scaled 1e6 — e.g. 1_200_000 = 1.20×
```

#### HedgePosition struct — new fields appended at end:

```solidity
// ── v1 fields (unchanged) ─────────────────────────────────────────────────
uint256 id;
uint256 eventId;
address hedger;
uint256 notional;
uint256 premiumPaid;
uint256 platformFeePaid;
uint256 payoutAmount;
HedgePositionStatus status;
bool claimed;

// ── v2 Advance fields (appended after all v1 fields) ──────────────────────
uint256 chosenStrike;      // hedger's specific strike (0 for v1 Classic positions)
uint256 premiumRatePaid;   // actual rate applied at entry — stored for audit/transparency
```

### 8.2 New Functions

#### `getHedgeQuote(uint256 eventId, uint256 notional, uint256 chosenStrike)`
```
view returns (uint256 premium, uint256 payoutAmount, uint256 touchProbabilityPct)
```
A read-only view function. Returns the premium cost, expected payout, and touch probability for a given strike and notional on a specific Advance event. Called by the frontend continuously as the hedger moves the strike slider. Zero gas cost.

#### `createAdvanceEvent(AdvanceEventParams calldata params) returns (uint256 eventId)`

Creates a new Advance range event. Accepts `strikeMin`, `strikeMax`, and `premiumMultiplier` in place of v1's fixed `strike` and `premiumRate`. All other parameters (name, underlying, expiry, liquidity, allowExternalLp) are unchanged.

### 8.3 Modified Functions

#### `buyProtection(uint256 eventId, uint256 notional, uint256 chosenStrike)`

For **Advance events**, `chosenStrike` is a required parameter. The contract executes:

1. Validates `strikeMin ≤ chosenStrike ≤ strikeMax`
2. Fetches `initialRate` and `dailyVol` for the underlying
3. Computes `fairPremiumRate` on-chain using the touch option formula
4. Applies `premiumMultiplier`: `actualRate = fairPremiumRate × multiplier / 1e6`
5. Checks pool capacity: `totalMaxPayout + (notional × d) ≤ poolLiquidity`
6. Deducts premium + platform fee from hedger's wallet
7. Records `chosenStrike` and `premiumRatePaid` on the HedgePosition struct

For **v1 Classic events**, `chosenStrike` is ignored (pass 0) and existing behaviour is completely unchanged.

### 8.4 Settlement Changes

#### `settleEvent()` — oracle-called

For **Advance events**, settlement is per-position rather than per-event:

```
currentRate ← oracle.getRate(event.underlying)

for each open position in event:
  if event.strikeAbove:
    triggered = currentRate >= position.chosenStrike
  else:
    triggered = currentRate <= position.chosenStrike

  if triggered:
    markPositionTriggered(position.id)
    reservePayout(position.payoutAmount)

if allPositionsResolved OR block.timestamp >= event.expiryDate:
  event.status = SETTLED
```

**Event-level status** transitions to SETTLED only when all positions are either triggered and paid or expired. This means a single Advance event may process settlement incrementally over time as positions trigger at their individual levels.

---

## 9. Oracle Changes

### 9.1 Per-Position Monitoring

The v1 oracle checks one strike per event. In Advance it checks each open position's `chosenStrike` individually on every polling cycle:

```
for each active Advance event:
  rate ← fetchCurrentRate(event.underlying)
  for each open position in event:
    if shouldTrigger(rate, position.chosenStrike, event.strikeAbove):
      callSettlePosition(position.id, rate)
```

**Gas optimisation:** all positions within the same event share one rate fetch. The oracle batches settlement calls for positions that trigger in the same cycle.

### 9.2 Polling Frequency

Oracle continues to poll every 5 minutes — unchanged from v1. Given that one-touch options are path-dependent, more frequent polling increases settlement accuracy. A future upgrade to event-driven settlement (Chainlink Automation or push oracles) would eliminate the 5-minute lag entirely.

### 9.3 v2.1 — On-Chain Price History for Dynamic σ

The oracle writes each price observation to `AppStorage` as a rolling buffer (30 observations × 63 pairs). The pricing formula reads this buffer to compute σ dynamically rather than using the static lookup table. This v2.1 enhancement significantly improves pricing accuracy during periods of elevated or suppressed volatility.

---

## 10. Migration from v1 to Advance

### 10.1 No Breaking Changes

All v1 Classic events remain fully functional. The Diamond upgrade adds new functions and appends new struct fields — it does not modify any existing function signatures or storage positions.

### 10.2 Upgrade Process

```
Step 1: Deploy new HedgeFacet v2 implementation contract to Lisk
Step 2: Execute diamondCut() to replace HedgeFacet selector mappings
Step 3: New struct fields default to zero for all existing v1 events — safe
Step 4: Existing v1 positions are untouched; oracle continues monitoring them
```

### 10.3 Coexistence

Classic and Advance events appear side by side in the same marketplace. The UI distinguishes them with an "Advance" badge. Hedgers, LPs, and the oracle handle both types simultaneously. No user action is required to migrate — they simply encounter both event types in the marketplace.

---

## 11. Regulatory Considerations

### 11.1 Protocol as Pricing Agent

In Advance, the protocol calculates the premium — not the creator. The platform is now acting as the pricing agent, not just a neutral venue. This is a material distinction from a regulatory classification standpoint and must be reflected in the Bank of Ghana sandbox application and any future licensing submissions.

**Position:** The protocol is an automated, rule-based pricing engine. All inputs are publicly observable and deterministic. This is meaningfully different from a discretionary market maker and supports a **parametric** rather than **speculative derivative** classification.

### 11.2 Formula Transparency

All inputs to the pricing formula are publicly verifiable:

| Input | Source | How to Verify |
|---|---|---|
| `currentRate` | ExchangeRate-API / CoinGecko / Yahoo Finance via oracle | Public API data |
| `T` (days to expiry) | `expiryDate` minus `block.timestamp` — on-chain | Block explorer |
| `σ` (daily volatility) | Static lookup table (v2) / on-chain buffer (v2.1) | Contract ABI / stored data |
| `premiumMultiplier` | Stored on HedgeEvent — set by creator at creation | Contract read |

Any regulator, auditor, or counterparty can independently verify every premium calculation given these four inputs.

### 11.3 Parametric Classification

The Advance protocol remains parametric:
- Payouts are rule-based and determined entirely at entry
- No discretion is exercised at settlement — the oracle reads a public rate and compares it mechanically to the stored strike
- The dynamic pricing engine makes the product a more accurate representation of fair value, which **strengthens** the compliance case, not weakens it

### 11.4 AML / KYC Implications

Advance events are larger and more sophisticated than typical v1 events. Corporate hedgers (the primary target of Advance) will likely require enhanced KYC. The $1.50/wallet KYC cost assumption in the financial model may need to be revised upward for Advance-class users ($5–$15/user for enhanced due diligence). This should be reflected in a future financial model update.

---

## 12. Glossary — Advance-Specific Terms

| Term | Definition |
|---|---|
| **Strike Range** | The [min, max] band defined by the event creator within which hedgers select their specific strike |
| **Chosen Strike** | The specific price level a hedger selects at entry — stored on their HedgePosition |
| **Touch Probability** | The formula's estimate of the likelihood that spot reaches the chosen strike before expiry |
| **Distance (d)** | `|chosenStrike − initialRate| / initialRate` — the percentage move required to trigger the position |
| **Daily Volatility (σ)** | Standard deviation of daily log returns for the underlying asset |
| **Fair Premium Rate** | `touchProbability × d` — the formula's output before the premium multiplier |
| **Premium Multiplier** | A scale factor set by the creator applied to the fair premium (e.g. 1.20 = 20% above fair value) |
| **Actual Premium Rate** | `fairPremiumRate × premiumMultiplier` — what the hedger actually pays |
| **Pool Liability** | The sum of maximum payout obligations across all active positions in the event's LP pool |
| **Advance Event** | An event using the v2 range-based, formula-priced model (`isAdvanceEvent = true`) |
| **Classic Event** | A v1 fixed-strike, creator-priced event — continues to function unchanged in v2 |

---

## 13. Summary — What Advance Delivers

| Capability | v1 Classic | v2 Advance |
|---|---|---|
| Fixed strike | ✓ | ✓ (via Classic events) |
| Hedger-chosen strike from a range | ✗ | ✓ |
| Formula-priced premium on-chain | ✗ | ✓ |
| Touch probability shown to hedger | ✗ | ✓ |
| Multiple strikes in one LP pool | ✗ | ✓ |
| Live premium calculator in UI | ✗ | ✓ |
| Creator premium multiplier | ✗ | ✓ |
| Per-position oracle settlement | ✗ | ✓ |
| Backwards compatible with v1 | — | ✓ |
| On-chain pricing audit trail | ✗ | ✓ |

Advance transforms BlockFinaX from a fixed-product marketplace into a fully parametric pricing engine — the closest decentralised equivalent to how an institutional FX options desk prices and structures one-touch products for corporate clients. It preserves everything that works in v1 while opening the platform to sophisticated hedgers who require customised strike selection and transparent, verifiable pricing.

---

*Document version: Advance v2.0*
*Date: March 2026*
*Protocol: BlockFinaX Diamond (EIP-2535) on Lisk Sepolia → Lisk Mainnet (July 7, 2026)*
*Next version: v2.1 — Dynamic σ from on-chain oracle price history*
