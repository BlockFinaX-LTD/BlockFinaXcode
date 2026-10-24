# ADR-003: Routing through interchangeable providers

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related | [Routing v2.0](../architecture/v2/routing-v2.0.md) |

## Context

With one hub (ADR-001), users on other chains need their money moved to the hub and back. Bridges, CCTP, aggregators, solvers and a BlockFinaX treasury float each suit different amounts and pairs, and each can fail.

## Decision

All movement goes through `RoutingProvider` (`getQuote`, `execute`, `getStatus`, `recover`). A `RoutingEngine` ranks quotes on amount received, time and risk, tracks each route through fixed states, and writes every step to a balance ledger.

## Reason

No single bridge is best for every route, and providers change. One interface lets BlockFinaX add or drop providers without touching product code. The ledger makes sure money in flight is always visible.

## Alternatives considered

1. Hard-code one bridge. Rejected: single point of failure and lock-in.
2. Let the user pick a bridge. Rejected: users should not judge bridge risk.
3. Rank on fee alone. Rejected: a cheap, slow or risky route is not the best execution.

## Consequences

1. Execution stays off until routes and ledger entries are stored in the database.
2. Every provider must implement recovery: refund, retry or manual.
3. The prefunded provider creates rebalancing debt that treasury operations must settle.
