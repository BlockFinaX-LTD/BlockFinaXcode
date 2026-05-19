---
title: Stop Losing Money When the Currency Moves
subtitle: If you do business across borders, you've felt this pain. Here's how to stop bleeding cash to FX swings — without locking up half your working capital.
date: 2026-05-19
author: BlockFinaX Team
category: Hedging
readTime: 5 min read
slug: stop-losing-money-to-fx
---

You sign a deal. Three months later, when it's time to pay, the currency has moved 10% against you. The deal you thought was profitable is now break-even. The deal you thought was tight is now a loss.

If you're running a business that buys, sells, or pays in a different currency than the one you bank in, this has happened to you. Probably more than once. This post is about how to stop it.

## A real example

Let's say you import goods from China. You agreed a price with your supplier:

- **Invoice:** $50,000 USD, due in 60 days
- **Today's rate:** 1 USD = 14.50 Ghana cedis (so the invoice costs you ₵725,000)
- **Your margin on the goods:** 18%

You close the deal in your books at ₵725,000. You expect to make 18%. Then two months pass, the cedi weakens, and this is what shows up on your books:

```scene
type: fx-loss
invoice: 50000
fromCurrency: USD
toCurrency: GHS
fromSymbol: $
toSymbol: ₵
startRate: 14.50
endRate: 15.80
days: 60
marginStart: 18
marginEnd: 9
```

Half your profit gone, on a deal you already won. This isn't a hypothetical — it's a normal month in any emerging-market currency.

## Why most businesses don't fix this

There's a tool for this — it's been around for 50 years. It's called a **forward contract**. You walk into your bank and say: *"Lock the rate at 14.50 for me, even though I don't pay until 60 days from now."* Done. No surprise. No bleeding cash to the currency move.

So why doesn't every business do this? Three reasons:

```scene
type: bank-wall
barriers:
  - Minimum deal: $100,000+
    You're too small. The bank won't even take the trade.
  - Wire us $20,000 collateral
    Locked up for the whole 60 days, earning nothing. That's working capital you needed for inventory.
  - Two weeks of paperwork
    New banking relationship, credit review, legal docs. You needed the rate locked yesterday.
```

The result: most businesses don't hedge. They just absorb the losses. Quietly. Month after month. Year after year.

## The simpler way

Think about how car insurance works:

- You pay a small fee every year.
- If something bad happens, the insurance company pays you out.
- If nothing bad happens, you don't get the money back — and that's fine, because you didn't crash.
- You don't put down $20,000 in collateral. You don't fill out 40 pages of paperwork. You sign up and you're covered.

That's the model. Pay a small premium. If the currency moves against you past a certain line, you get paid out automatically.

```scene
type: insurance-flow
premium: 750
protected: 50000
days: 60
payout: 6500
currencySymbol: $
```

Back to the importer: a $750 premium protects $50,000 of exposure for 60 days. If the cedi drops, the contract pays you out the difference. If it stays flat, the $750 is just a small cost of doing business — same as a year of car insurance with no claims.

A small, known fee instead of an unknown, large loss. That's the trade.

## Who this is for

You should be looking at this if:

- You buy or sell in a currency that's not the one you bank in.
- Your deals are typically $1,000 to $500,000 — too small for traditional bank forwards to bother with.
- You can't (or don't want to) freeze a big chunk of working capital as collateral.
- You need protection *now*, not after two weeks of paperwork.
- You've watched the currency move 10–30% in a year and quietly absorbed the hit.

If any of that sounds like you, [start here](/hedge). It takes minutes, not weeks. There's no minimum. There's no collateral.

You don't have to keep eating these losses.
