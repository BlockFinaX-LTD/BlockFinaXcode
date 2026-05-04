# BlockFinaX Explained Simply

Forget contracts and Solidity for a second. This doc is just **the math**, with the "why" behind every step. We'll use real numbers all the way through.

---

## 0. Two Annoying Things About Computers (read this first)

Before any of the math makes sense, you need to know two rules the contract has to live by.

### Rule 1: Computers can't store decimals

You can't write `0.025` in this contract. So how do we say "2.5%"?

We pick a big number to mean "100%" — in this contract that number is `1,000,000` (called `PRECISION`). Then every percentage becomes "how many out of a million."

| What we mean | What we write |
|---|---|
| 100% | 1,000,000 |
| 50% | 500,000 |
| 2.5% | 25,000 |
| 0.5% | 5,000 |

It's the exact same trick you use when you say "75 out of 100" instead of "0.75". We just picked 1,000,000 instead of 100 because we want more decimal places of accuracy.

So when you see this in the code:

```
fee = amount * feeRate / 1,000,000
```

Translate it as: "fee equals amount times the percentage." If `feeRate = 25,000` (2.5%) and `amount = 1000`, then `fee = 1000 * 25000 / 1000000 = 25`. ✓

### Rule 2: USDC has 6 decimals

$1 in USDC is stored as the number `1,000,000` inside the contract. $10 = `10,000,000`. $100 = `100,000,000`.

Same reason — no decimals allowed, so we shift everything up by 6 zeros.

So when you see `10 * PRECISION` in the code, that's just **$10**. Don't be scared.

**From here on I'll write dollar amounts in plain dollars, but remember the contract is multiplying by 1,000,000 under the hood.**

---

## 1. The Story First (no math yet)

A baker in Ghana sells bread. She earns Ghanaian Cedis (GHS). She also buys flour from America priced in dollars (USD). If the USD/GHS rate goes UP, her flour gets more expensive and she loses money.

She wants insurance. So she goes to BlockFinaX and says:

> "If USD/GHS goes from today's rate (10 GHS per dollar) up to 12 GHS per dollar, please pay me. I'll buy $1,000 worth of protection."

On the other side, **liquidity providers (LPs)** are people willing to **bet the rate WON'T go up that much**. They put money in a pool. If the rate stays low, they keep the baker's premium as profit. If the rate jumps, they pay her out of the pool.

That's the whole product. Now let's do the math.

---

## 2. The Predetermined Payout — Just a Percentage

The baker bought $1,000 of protection. The current rate is 10. The trigger ("strike") is 12. **How much should she get if the rate hits 12?**

### Step 1: How big is the move?

```
move = 12 - 10 = 2
```

The rate moved by 2.

### Step 2: How big is that move as a percentage of where we started?

```
percentage move = 2 / 10 = 0.20 = 20%
```

The rate went up 20%.

### Step 3: Apply that percentage to her notional

```
payout = $1,000 × 20% = $200
```

She gets $200.

### Why this formula? The intuition.

If you had $1,000 of dollar-denominated debt and the dollar got 20% more expensive, your debt also got 20% more expensive in your home currency. So 20% of your notional is exactly what you lost. The hedge pays back what you lost. That's the whole point.

### The formula in the code

```
payout = notional × (strike − initialRate) / initialRate
       = 1000 × (12 − 10) / 10
       = 1000 × 2 / 10
       = 200
```

This sits at [BlockFinaXHedgeFacet.sol:1115](../contracts/src/facets/BlockFinaXHedgeFacet.sol#L1115).

### Important: she knows this BEFORE she pays

The contract calculates the $200 the moment she buys, **not later**. She knows exactly what she gets. There's no claims-adjuster, no fight, no surprise. If the rate hits 12, she gets $200. If it doesn't, she gets nothing. That's why it's called **parametric** insurance — one parameter (the rate) decides everything.

### Why we cap the move at 10× the starting rate

What if a creator made an event with strike = 1000 and initial rate = 10? The move would be 990, which is **99× the starting rate**. The payout per dollar of notional would be **99×**. One $100 buyer would drain $9,900 from the pool. Easy way to break the system.

So the contract refuses any event where `move > 10 × initialRate`. Real currencies never move 10× anyway — this just blocks malicious or sloppy events.

---

## 3. The Premium — What the Hedger Pays

The baker has to pay for her insurance, just like with regular insurance. The fee is a tiny percentage of her notional.

If the **premium rate** is 2.5%:

```
premium = $1,000 × 2.5% = $25
```

She pays $25 up front. Even if the rate doesn't move and she gets no payout, the LPs keep her $25. That's their profit.

In the code:

```
premium = notional × premiumRate / 1,000,000
       = 1000 × 25,000 / 1,000,000
       = 25
```

(Remember — `25,000` is how we write 2.5% when 100% is 1,000,000.)

### Plus a separate platform fee

There's also a **platform fee**, also a percentage of notional, charged on top:

```
platformFee = notional × hedgerFeeRate / 1,000,000
```

If the platform fee rate is 0.5% (`5,000` out of `1,000,000`):

```
platformFee = 1000 × 0.5% = $5
```

So the baker actually pays:

```
totalCost = premium + platformFee = 25 + 5 = $30
```

Of that, $25 goes to LPs and $5 goes to the platform (a slice of which is shared back with the event creator as a "loyalty" bonus).

---

## 4. Shares — How LPs Split the Pizza

Now switch hats. You're an LP. You want to put $100 into a pool that already has $1,000 in it. **How big a slice should you own?**

### Pizza intuition

Imagine the pool is a pizza. The first person who showed up paid $1,000 and the chef cut it into 1,000 slices. They own all 1,000 slices.

Now you walk in with $100. You don't get 100 slices — that wouldn't be fair. You should own a fraction of the pie equal to the fraction of money you contributed:

```
your fraction = 100 / (1000 + 100) = 100 / 1100 ≈ 9.09%
```

So in a 1,000-slice pie, you should get about 90.9 slices. Then the new pie has 1,090.9 slices, and your 90.9 / 1,090.9 = 9.09%. ✓

### The formula

```
yourShares = depositAmount × existingShares / existingPool
           = 100 × 1000 / 1000
           = 100
```

Wait, that's 100 shares, but I just said 90.9? Let me redo with the same denominator.

The trick: divide BEFORE adding your money, not after.

```
yourShares = 100 × 1000 / 1000 = 100 new slices
new total slices = 1000 + 100 = 1100
your fraction = 100 / 1100 = 9.09% ✓
```

The math works out because you're using the **old pool's price-per-share** to figure out how many shares your money buys.

In the code ([deposit](../contracts/src/facets/BlockFinaXHedgeFacet.sol#L1018)):

```
shares = amount × totalActiveShares / totalLiquidity
```

This is the same formula Uniswap and Balancer use. It's the simplest "fair" answer: **each dollar buys you the same fraction of the pool, no matter when you arrived.**

### What about the very first deposit?

There's no existing pool to base the price on. So we just pick a starting unit:

```
shares = amount × 1,000,000,000,000   (1e12)
```

If you deposit $1, you get a trillion shares. Why so many? So that later, when someone else deposits a tiny amount, the math doesn't round down to zero shares. It's just headroom for precision.

### Why we refuse a zero-share deposit

If the pool is huge and you add a tiny amount, integer division might round your shares down to zero. You'd add money but own nothing — basically a free gift to the existing LPs. The contract spots this and reverts:

```
require(shares > 0, "Deposit too small relative to pool size")
```

---

## 5. The MasterChef Trick — Paying LPs Premiums Without Looping

This is the cleverest piece of math in the whole contract. Pay attention.

### The naive approach (what NOT to do)

Every time a hedger pays a $25 premium, you'd think:

> "Loop over every LP, give each one their share of the $25."

If there are 200 LPs, that's 200 storage writes per hedger purchase. That's expensive on Ethereum. If there were 10,000 LPs, it'd be impossible.

### The trick: a running total per share

Picture a single big counter on the wall called `accPremiumPerShare`. It tracks:

> "If you'd owned exactly **one share** since the very beginning, how much money would you have earned in total?"

Every time a $25 premium comes in, we add to this counter:

```
counter += $25 / total_shares_in_existence
```

That's it. **One number gets updated. No matter how many LPs there are.**

### How does an LP later figure out what they earned?

When you deposit, you write down the **current value of the counter** as your "starting line" (called `rewardDebt`):

```
yourStartingLine = yourShares × counter   (at the time you joined)
```

Later, when you want to claim:

```
totalEarnedIfYouOwnedFromStart = yourShares × counter   (right now)
yourActualEarnings = totalEarnedIfYouOwnedFromStart − yourStartingLine
```

The subtraction makes sure you only get premiums that arrived **after** you joined.

### A concrete example

Pool starts at $1000 with one LP (Alice) owning 1000 shares. The counter starts at 0.

**Hedger 1 pays $25 premium.** Counter ticks up:
```
counter += 25 / 1000 = 0.025
```
Counter now = 0.025.

**Bob joins** with $500, gets 500 shares. He records his starting line:
```
bob_starting_line = 500 × 0.025 = 12.5
```
That 12.5 is "what Bob would have earned if he'd been here from the start." We pretend he earned it so he can't claim it. Now there are 1500 total shares.

**Hedger 2 pays $30 premium.** Counter ticks up:
```
counter += 30 / 1500 = 0.020
```
Counter now = 0.045.

**Alice claims.** Her starting line was 0 (she joined first). Earnings:
```
1000 × 0.045 − 0 = $45
```
She gets $45. ($25 from hedger 1 + $20 from hedger 2's premium split between her two-thirds and Bob's one-third = $25 + $20 = $45. ✓)

**Bob claims.** His starting line was 12.5. Earnings:
```
500 × 0.045 − 12.5 = 22.5 − 12.5 = $10
```
He gets $10. (His one-third of the $30 premium = $10. He gets nothing from premium 1 because he wasn't here. ✓)

### Why the multiplier (1e18)

Computers can't store `0.025` (Rule 1 again). So instead of storing the counter as a tiny decimal, we multiply everything by a HUGE number — `1,000,000,000,000,000,000` (1e18). The counter only stores whole numbers, but they represent very fine-grained fractions when divided back out.

### The dust fix

Sometimes the division leaves a leftover. If the premium is $25 and there are 1500 shares:

```
25 × 1e18 = 25,000,000,000,000,000,000
divided by 1500 = 16,666,666,666,666,666 with remainder of 1000
```

That remainder of 1000 (in giant-multiplier units) would be **lost forever**. Over thousands of premium payments, that lost dust adds up.

So the contract keeps a tiny dust jar. Each leftover gets added to the jar. When the jar fills up enough to give every share at least one extra unit, it gets distributed:

```
dust_jar += remainder
if dust_jar >= total_shares:
    bonus = dust_jar / total_shares
    counter += bonus
    dust_jar = dust_jar % total_shares
```

Now zero money is lost over the long run.

---

## 6. Settlement — Did the Strike Get Hit?

After expiry (or as soon as the price touches the strike), the oracle posts the final price. The contract just checks one thing:

```
For "upward hedge" (strikeAbove = true):
    triggered = (settlementPrice >= strike)

For "downward hedge" (strikeAbove = false):
    triggered = (settlementPrice <= strike)
```

If `triggered` is true, every hedger who bought protection on this event becomes eligible to claim their predetermined payout. If false, every hedger gets nothing — the LPs keep all the premiums and capital.

### Sanity guard on the price

What if the oracle has a bug and posts the price as `1,000,000,000` instead of `10`? That'd ruin everything. So the contract requires:

```
initialRate / 100 ≤ settlementPrice ≤ initialRate × 100
```

Real FX rates don't move 100× ever. Any value outside that range is almost certainly a typo or a bug.

---

## 7. Hedger Claims — Take Off the Platform Fee

The baker won. Her predetermined payout was $200. Now she calls `claimPayout()`. The math:

```
gross   = $200
fee     = gross × payoutFeeRate / 1,000,000   (say 1% = $2)
net     = gross − fee = $198
```

She gets $198. The $2 fee gets split between the platform and the event creator (loyalty share, again as a percentage):

```
creatorReward = fee × creatorLoyaltyRate / 1,000,000   (say 5% of the $2 = $0.10)
platformKeeps = fee − creatorReward = $1.90
```

Tiny amounts here, but it adds up over thousands of hedgers.

---

## 8. LP Withdraws Capital — Splitting the Loss Fairly

The hedgers won. The pool owes a total of $200 in payouts (`totalMaxPayout`). The pool had $1000 (`totalLiquidity`). You're an LP who put in $100. **How much do you get back?**

### Pizza intuition again

You put in $100 out of $1000 — that's 10% of the pool. So you should pay 10% of the loss:

```
yourLossShare = $200 × 10% = $20
yourRefund    = $100 − $20 = $80
```

You get $80.

### The formula

```
lpPayoutShare = totalMaxPayout × yourDeposit / poolSize
              = 200 × 100 / 1000
              = 20

withdrawAmount = yourDeposit − lpPayoutShare
               = 100 − 20
               = 80
```

Same answer. ✓

### The "snapshot" trick

A tricky bug appears if we're not careful. Say there are two LPs:

- Alice put in $500 (50%)
- Bob put in $500 (50%)
- Pool owes $200

Alice withdraws first:
```
Alice's loss = 200 × 500 / 1000 = $100
Alice gets   = $400
```

Now the pool's `totalLiquidity` would change to $500 (Bob's only). If we used the **live** value when Bob withdraws:

```
Bob's loss = 200 × 500 / 500 = $200    ← WRONG, he's paying 100% of it!
Bob gets   = $300
```

That's not fair. The fix is to **snapshot** the pool size at settlement time and use that snapshot for everyone:

```
Bob's loss = 200 × 500 / 1000 = $100   ← correct
Bob gets   = $400
```

The variable storing the snapshot is `liquidityAtSettlement`. Everyone gets the same denominator no matter what order they withdraw.

### What if the loss exceeds your deposit?

It can't, mathematically — your loss share is `totalMaxPayout × yourFraction`, and `totalMaxPayout` is always ≤ `totalLiquidity`. But the code defensively floors at 0 anyway:

```
if (lpPayoutShare > yourDeposit):
    withdrawAmount = 0
```

---

## 9. The Oracle — How Multiple Sources Agree

Instead of trusting one oracle (one person could lie or get hacked), the contract waits for several oracles to agree.

### The setup

- Up to 10 oracles can be registered.
- A `requiredSigners` setting (e.g. 2) says how many must agree.
- A `toleranceBps` setting (e.g. 100) says how close their answers must be.

### What's a basis point (bps)?

```
1 bps = 0.01%
100 bps = 1%
10,000 bps = 100%
```

Multiplying percentages by 10,000 gives bps. Same trick as PRECISION, just with a different scaling.

### Are the oracles close enough?

3 oracles submit prices: 10.00, 10.05, 10.10. The math:

```
spread (in bps) = (max − min) × 10,000 / min
                = (10.10 − 10.00) × 10,000 / 10.00
                = 0.10 × 10,000 / 10.00
                = 100 bps
                = 1%
```

If `toleranceBps = 100`, this just barely passes. If oracles disagreed more (say one said 10.00 and another said 10.30), the spread would be 300 bps and the contract would throw out all submissions and tell them to try again.

### What price do we settle on?

Just the **average**:

```
agreedPrice = (10.00 + 10.05 + 10.10) / 3 = 10.05
```

Boring math, but it works. The "stale" filter throws out submissions older than 15 minutes first, so old data can't sway the average.

### Cooldown — why 5 minutes between submissions?

Without it, a malicious oracle could keep submitting wildly different prices to perpetually break consensus and DoS the system. The 5-minute cooldown means each oracle can only mess with consensus once every 5 minutes — way too slow to be useful as an attack.

---

## 10. The Solvency Check — The Most Important Rule

Before any hedger is allowed to buy, the contract checks:

```
availableLiquidity = totalLiquidity − totalMaxPayout
require(newPredeterminedPayout <= availableLiquidity)
```

In English: **"Can the pool actually pay this person if they win?"** If not, the purchase is refused.

This is the single most important invariant in the whole protocol. As long as this check passes for every buyer, the pool is **always able to pay every winner**. No bank run, no insolvency, no "we can't afford to honor your claim."

### Pool utilization — how full is the pool?

```
utilization = totalMaxPayout / totalLiquidity
```

If the pool has $1000 and $200 is reserved for hedgers, utilization is 20%. The remaining $800 is free space for new hedgers. As more hedgers buy, the pool fills up, and once `availableLiquidity` drops to zero, no more buys are accepted.

---

## 11. The Cheat Sheet (the only page you really need)

| In English | In Math | What it tells you |
|---|---|---|
| Move from today's rate to the strike | `move = strike − initialRate` | How big a price change triggers payout |
| Payout if hedger wins | `notional × move / initialRate` | Like saying "20% of $1000 = $200" |
| Premium the hedger pays | `notional × premiumRate / 1,000,000` | A percentage of what's being protected |
| Platform fee | `notional × hedgerFeeRate / 1,000,000` | Same idea, just a different rate |
| Total cost to hedger | `premium + platformFee` | What leaves their wallet |
| Pool can pay everyone | `totalMaxPayout ≤ totalLiquidity` | The solvency invariant |
| LP shares (first depositor) | `amount × 1e12` | Just bootstrap the share supply |
| LP shares (anyone else) | `amount × oldShares / oldPool` | Same fraction in = same fraction out |
| Premium counter ticks up | `counter += premium × 1e18 / totalShares` | One write, no loops |
| LP claimable premiums | `shares × counter / 1e18 − rewardDebt` | "Now − starting line" |
| LP loss at withdraw | `totalMaxPayout × deposit / poolSnapshot` | Pay your fair share of the loss |
| LP gets back | `deposit − lpLoss` | Whatever's left of your money |
| Did the strike hit? | `strikeAbove ? price ≥ strike : price ≤ strike` | Yes or no, no in-between |
| Oracle spread | `(max − min) × 10000 / min` | "Are the oracles close enough?" |
| Oracle agreed price | `sum / count` | Just the average |

---

## 12. The Philosophy

If you only remember three things:

1. **Use big integers as fake decimals.** 2.5% is `25,000` because we agreed `1,000,000` means 100%.
2. **Shares are slices of a pizza.** New money buys slices at the current price-per-slice. Everyone gets the same dollar-per-share treatment regardless of when they joined.
3. **The MasterChef trick replaces loops with one running total.** Any time you see "this happens to every user", ask: can I do it with one global counter and a per-user "starting line" instead?

That's the entire protocol. Everything else is plumbing.
