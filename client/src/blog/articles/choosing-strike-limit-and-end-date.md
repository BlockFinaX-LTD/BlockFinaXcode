---
title: "Choosing a strike, a limit and an end date: how much currency protection is enough"
subtitle: Protection that covers every possible move is expensive, and protection that covers too little does not help when it matters. Three decisions set where the balance falls.
date: 2026-10-26
author: BlockFinaX Team
category: Hedging
readTime: 7 min read
slug: choosing-strike-limit-and-end-date
---

A business that decides to protect a foreign-currency payment still has to decide how much protection to buy. Three choices do most of the work: where the protection starts, how far it reaches and when it ends. Each one moves the price, and each one changes which outcomes are covered. The aim is not the most protection, which costs the most, but the protection that matches what the business can and cannot absorb.

This article works through those choices for one payment. The structure is the one BlockFinaX uses: a premium paid once, a strike where the payout starts, and either a limit chosen by the buyer or a maximum payout set by the underwriters' pool. The same reasoning applies to options bought from a bank.

## The example

On 23 October 2026 the Bank of Ghana's published mid rate was 11.65 cedis per US dollar [1]. A cedi rate quoted this way rises when the dollar becomes more expensive, so an importer is hurt by a rise. Take a distributor with a $200,000 supplier payment due in two months. At 11.65 the payment costs 2,330,000 cedis. If the rate is 12.80 when it pays, the cost is 2,560,000 cedis, an extra 230,000. At 13.60 the extra is 390,000.

The premiums below are assumptions made for this illustration, not quotes. Real prices depend on the currency's volatility, the time to the end date and the terms chosen, and they change daily.

## Where protection starts

The strike is the rate at which the payout begins. Every move from today's rate up to the strike stays with the business, much like an insurance excess, and in exchange the premium is lower.

Compare two strikes on the $200,000 payment, both with a limit at 13.07:

| | Strike 11.88 (about 2% above today) | Strike 12.23 (about 5% above today) |
|---|---|---|
| Assumed premium | $2,400 | $1,300 |
| Total with 5% platform fee | $2,520 | $1,365 |
| Most the contract can pay | $20,429.18 | $14,420.60 |

The payout on contracts of this kind is the amount protected, multiplied by the move from the strike to the settlement rate (up to the limit), divided by the rate when the protection was bought. At 12.80 the first contract pays 200,000 × (12.80 − 11.88) ÷ 11.65 = $15,793.99, and the second pays 200,000 × (12.80 − 12.23) ÷ 11.65 = $9,785.41. After a 2% fee on the payout, the business receives $15,478.11 or $9,589.70.

The right strike depends on the business rather than the currency. A distributor working on a 15% gross margin can absorb a small move but not a large one; a 5% strike lets it carry the first part cheaply and protect what would actually hurt. A business that has already agreed fixed prices with its customers, and has no room at all, may need the closer strike despite the cost.

## How far it reaches

The limit sets where the payout stops growing. A narrow range between strike and limit is cheaper because underwriters set aside less capital, but it leaves the largest moves uncovered. In the example, a rate of 13.60 pays the same as 13.07 on both contracts above, because the limit has been reached.

Open cover takes a different approach. Instead of a limit chosen by the buyer, the underwriters' pool sets a maximum payout as a percentage of the amount, for example 30%. With a strike of 11.88, that places the effective limit at 11.88 + (11.65 × 30%) = 15.375 and the maximum payout at $60,000. Assume a premium of $3,400, or $3,570 with the fee.

| Rate when the payment falls due | Limited, strike 11.88 | Limited, strike 12.23 | Open, strike 11.88 |
|---|---|---|---|
| 11.70: cedi slightly weaker | No payout; cost $2,520 | No payout; cost $1,365 | No payout; cost $3,570 |
| 12.80: dollar up about 10% | Receives $15,478.11 | Receives $9,589.70 | Receives $15,478.11 |
| 13.60: dollar up about 17% | Receives $20,020.60 | Receives $14,132.19 | Receives $28,937.34 |

At 12.80 the extra cost of the payment is 230,000 cedis, about $17,969 at that rate. At 13.60 it is 390,000 cedis, about $28,676. The open structure keeps pace with the larger move; the limited ones stop growing. In the first row, all three expire with no payout and the premium is the whole cost. Over a run of quiet months, that is the most common outcome, and it is the reason protection is cheaper than the losses it covers.

Choosing between them comes down to which risk is unacceptable. A business that worries most about a moderate move can buy a limited contract and keep the premium low. One that cannot survive a large devaluation, in a currency with a history of sharp steps, has more reason to pay for the wider range.

## When it ends

Protection pays on the reference rate on its end date. If the end date falls a week before the supplier is paid, a move in the final week is uncovered. If it falls after, the business may have to buy dollars before the payout is known. Matching the end date to the payment date is the simplest way to keep the protection aligned with the exposure. BlockFinaX pools generally allow any end date up to 90 days ahead, so the date can be chosen to match an invoice rather than rounded to a standard tenor.

Two smaller timing points matter as well. The reference rate is a published benchmark, such as the Bank of Ghana's daily weighted median of bank-reported transactions [1], and the rate a business actually pays at its bank can differ from it. And longer protection costs more, because there is more time for the rate to move, so stretching the end date for comfort has a price.

## How much of the amount

The final choice is the amount itself. Protecting the full invoice gives the closest match to the exposure. Some firms protect only part, typically where they expect to offset some of the move by adjusting prices, or where part of the payment can be met from dollar income. Protecting more than the actual exposure turns protection into a position on the currency, which is a different activity with different risks.

## Making the choice before it matters

The pattern across these decisions is consistent: each extra degree of protection costs more, and the business has to decide which outcomes it needs to survive rather than which outcomes it would like to avoid. The Climate Policy Initiative describes the core trade-off in currency hedging as the choice between locking in a rate and capping the downside while keeping the upside [2]. Protection with a strike and a limit belongs to the second family. It does not fix the cost of the payment. It sets a worst case the business has chosen, for a price it knows in advance.

That choice is easier to make when the currency is calm. Premiums rise with volatility, and protection bought after a move has started covers less for more. The time to set the strike, the reach and the end date is when the payment is first committed, not when the rate is already moving.

## References

1. Bank of Ghana, "Daily Interbank FX Rates" (published mid rate 11.6500 for 23 October 2026, and weighted median methodology note). https://www.bog.gov.gh/treasury-and-the-markets/daily-interbank-fx-rates/
2. Climate Policy Initiative, "FX Hedging Instruments", January 2026. https://www.climatepolicyinitiative.org/wp-content/uploads/2026/01/FX-Instruments.pdf
