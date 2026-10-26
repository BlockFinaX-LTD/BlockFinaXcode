---
title: Your bank's rate, the official rate and the rate a hedge settles on
subtitle: A currency hedge pays on a published reference rate. The rate a business actually gets can be several percent away from it, and in some years much further. Understanding the gap is part of deciding how much protection is worth.
date: 2026-10-26
author: BlockFinaX Team
category: Markets
readTime: 6 min read
slug: bank-rate-official-rate-and-hedge-rate
---

A treasurer in Lagos checks the official naira rate in the morning, then calls her bank to buy dollars for a supplier payment. The rate she is offered is worse than the one she read, and if she cannot get enough dollars through the bank, the rate available elsewhere may be worse again. All three are real prices for the same currency on the same day. Which one matters depends on what she is trying to do, and for anyone using a hedge, the difference between them is a risk in its own right.

## What the official rates measure

Ghana and Nigeria both publish a daily reference rate, and both are built from actual transactions rather than set by decree.

The Bank of Ghana asks banks to report their spot dollar-cedi transactions completed before 3:30 pm each working day, and publishes the weighted median of those trades as the day's closing rate [1]. On 23 October 2026 the published mid rate was 11.65 cedis per dollar [1]. The Central Bank of Nigeria publishes the Nigerian Foreign Exchange Market (NFEM) rate, derived as a volume-weighted average of the day's trades, and describes it as the official exchange rate for the day [2].

These rates summarise transactions reported by banks, not the prices quoted to individual customers. They are the natural reference for contracts, accounts and hedges because they are published, reproducible and hard for any single party to move. They are not the rate a small business is quoted at a branch.

## Why the rate you pay differs

Three gaps separate a business's rate from the official one.

The first is the bank's margin. A bank buying dollars in the interbank market and selling them to a client adds a spread for its costs, its risk and its profit. For a large corporate the spread may be small; for a smaller client buying a modest amount, it is usually wider.

The second is timing. The official rate summarises trades up to a cut-off on one day. A business that buys dollars the next morning, or late in the afternoon after news has moved the market, trades at a different price.

The third, and potentially the largest, is access. When a central bank holds its official rate below the level at which dollars actually change hands, demand that cannot be met at the official rate moves to a parallel market at a higher price. The World Bank, comparing official and parallel rates across developing economies, recorded Nigeria's official rate at 461 naira per dollar and its parallel rate at 745 on 31 March 2023, a parallel premium of about 61.7% [3]. In its analysis, such gaps benefit those with access to foreign exchange at the official rate while the cost is paid for by everyone else [3].

## When the official rate catches up

Wide gaps tend to close abruptly. In June 2023 Nigeria unified its official exchange-rate windows, letting the official rate move towards the price at which dollars were actually trading. The IMF later noted that the naira depreciated sharply after the unification [4].

For businesses, a move of this kind has an awkward property. A firm that had been buying dollars in the parallel market would have seen a much smaller change in its own cost on the day of unification than the move in the official rate. A firm that had obtained dollars at the official rate, or that had contracts priced on it, faced the full step. The same event was a small change for one business and a large shock for another, depending on which rate it had actually been using.

## What this means for a hedge

A hedge does not settle on the rate a business pays. It settles on a reference rate named in the contract, because both sides need a number neither of them controls. That creates basis risk: the chance that the hedge and the exposure move by different amounts.

Consider an illustration with hypothetical numbers. A business protects a $100,000 payment against a rise in the official rate from 1,350 to a strike of 1,377 naira per dollar, with a limit at 1,515. On the payment date the official rate is 1,450. Contracts of this shape pay the amount protected multiplied by the move from strike to settlement rate, divided by the rate when bought: 100,000 × (1,450 − 1,377) ÷ 1,350 = $5,407.41. If the business buys its dollars at 1,450 plus a 1% bank margin, it pays about 1,464.50, so part of its extra cost falls outside the hedge. If it buys in a parallel market at a premium of 5%, roughly 1,522.50, the gap is larger again, and the hedge, which knows nothing about the parallel rate, will not close it.

The basis can also work in the business's favour. If the official rate jumps on a unification while the business has already been paying the parallel price, a hedge on the official rate pays out even though the business's own cost barely moved.

## Managing the gap

Basis risk cannot be removed by any hedge that settles on a published benchmark, but it can be sized and planned for. Three practical steps help.

The first is to know which rate the business really uses. A firm that reliably obtains dollars from its bank at a small margin over the official rate has a small, stable basis. A firm that relies on informal channels has a basis that can swing by tens of percent, and a hedge on the official rate will be a loose fit.

The second is to treat the margin as a known cost. If the bank's spread is usually about 1%, the business can budget for it separately, or set its strike slightly lower so that protection starts where the combined cost becomes painful.

The third is to read the market structure. Where official and parallel rates are close, an official-rate hedge tracks the business's own cost closely. Where they are far apart, the official rate may be more likely to jump, and the hedge then protects against that step rather than against the rate the business pays day to day.

None of this argues against hedging. It argues for knowing what a hedge measures. A contract that pays on the official rate protects a business from movements in that rate, at a price set in advance. The difference between that rate and the one at the bank counter is a separate, smaller risk that the business still owns, and the better it understands that gap, the better it can decide how much protection is worth buying.

## References

1. Bank of Ghana, "Daily Interbank FX Rates" (weighted median methodology note; mid rate 11.6500 for 23 October 2026). https://www.bog.gov.gh/treasury-and-the-markets/daily-interbank-fx-rates/
2. Central Bank of Nigeria, "Exchange Rates" (NFEM rate methodology note). https://www.cbn.gov.ng/rates/ExchRateByCurrency.html
3. David Malpass, World Bank, "The Parallel Exchange Rate Problem: The World Bank's Approach to Helping People in Developing Countries", World Bank Voices, 31 May 2023. https://blogs.worldbank.org/en/voices/parallel-exchange-rate-problem-world-banks-approach-helping-people-developing-countries
4. International Monetary Fund, "Nigeria: IMF Executive Board Concludes 2024 Article IV Consultation", Press Release No. 24/144, 8 May 2024. https://www.imf.org/en/news/articles/2024/05/08/pr-24144-nigeria-executive-board-concludes-2024-art-iv-consultation
