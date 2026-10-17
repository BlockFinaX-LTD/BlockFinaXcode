# ADR-RATE-005: Policy-rate protection settles on the rate in force on the expiry date

| Field | Value |
| --- | --- |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related | [Settlement rules](../rates/v1/settlement-rules-v1.0.md), [Pricing integration](../rates/v1/pricing-integration-v1.0.md) |

**Context.** Central banks postpone or move policy meetings. CBN shifted meetings in 2018, deferred one in 2023, and moved one in Feb 2025 over delayed CPI data. Emergency meetings also happen. A product that settles on "the decision of meeting X" has no answer when X moves.

**Decision.** Policy-rate protection settles on the official policy rate **in force at 17:00 local time on the expiry date**, using the effective date in the central bank's statement. Postponements, early meetings and emergency decisions are then handled by the definition itself.

**Reason.** It matches the borrower's reality: their loan is repriced by the rate actually in force. It avoids discretionary decisions at settlement.

**Alternatives.**
- Settle on a named meeting (rejected: breaks on postponement).
- Cancel and refund on postponement (rejected: the buyer still bore the risk while waiting).
- Extend expiry to the new meeting date (rejected: open-ended capital lock for underwriters).

**Consequences.** The app must show scheduled decision dates and warn when a protection expires before the next decision. Pricing models decision probabilities per meeting within the protection window.

**Amendment (2026-10-17, testnet build).** The oracle now records the policy rate in force at 17:00 local time on every weekday, using each decision's effective date. Policy-rate protection on testnet settles on that daily series **compounded over the protection**, the same way as the overnight benchmarks, instead of on the single value on the expiry date. The "rate in force" definition above still decides each day's value, so postponed and emergency meetings are handled the same way. Compounding matches how a loan priced off the policy rate accrues, and it means one pool contract serves both kinds of benchmark. A single-fixing settlement mode can be added later if borrowers need it.
