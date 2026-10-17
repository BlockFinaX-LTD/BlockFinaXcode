# ADR-RATE-002: Settle by observation date, never "latest value"

| Field | Value |
| --- | --- |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related | [Settlement rules](../rates/v1/settlement-rules-v1.0.md), [Oracle architecture](../rates/v1/oracle-architecture-v1.0.md) |

**Context.** Most benchmarks publish today the rate for the previous business day. "Latest fetched" can belong to the wrong period.

**Decision.** Every product names its settlement observation (a fixing date, a compounding window, an auction, or "in force on date"). Every stored and on-chain value carries its observation date. Oracle consensus identity is `(benchmarkId, observationDate)` plus the value.

**Reason.** Two correct numbers for different days must never be confused, and nodes must not agree on a number for different days.

**Alternatives.** Latest value at expiry (rejected: ambiguous, and open to timing games).

**Consequences.** The rate consensus contract keys rounds by benchmark and observation date, not by hedge event. Adapters must parse the observation date from the source.
