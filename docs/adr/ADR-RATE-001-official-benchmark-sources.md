# ADR-RATE-001: Official benchmark sources only

| Field | Value |
| --- | --- |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related | [Oracle architecture](../rates/v1/oracle-architecture-v1.0.md), [Benchmark research](../rates/v1/benchmark-research-v1.0.md) |

**Context.** Interest-rate protection settles real money on a published number. Finance websites republish rates late, rounded or wrong.

**Decision.** The oracle value always comes from the benchmark administrator or official market operator: NY Fed, Bank of England, CBK, CBN, SARB, Bank of Ghana or GAB. Third-party sources are used only to flag anomalies, never as the value and never averaged into it.

**Reason.** Settlement must match what the borrower's loan uses, and must survive a dispute.

**Alternatives.** Aggregators (rejected: not authoritative). Averaging several sites (rejected: averaging is not consensus).

**Consequences.** Benchmarks with no official machine-readable source need an official-page adapter, and may stay disabled until the administrator confirms a feed.
