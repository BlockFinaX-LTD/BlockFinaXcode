# ADR-004: One frontend and one backend

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related | [Architecture v2.0](../architecture/v2/architecture-v2.0.md), [Chain adapters v2.0](../architecture/v2/chain-adapters-v2.0.md) |

## Context

v1.0 had a main app and backend for Base and a separate wallet app and server for Stellar, with the pool maths, quote logic and oracle written twice.

## Decision

1. One backend: the main server exposes `/api/v2`, where chain is a field in the data. Chain-specific code lives only in Chain Adapters.
2. One frontend: screens use `blockfinaxApi` and `WalletSession` and never call contracts.
3. One copy of the maths (`shared/domain/pool-economics.ts`), one quote service, one oracle engine.
4. The Stellar wallet server is retired in stages once its screens and relay have moved.

## Reason

Every feature built twice costs twice and drifts. A single product layer above adapters keeps the chains in step by construction rather than by review.

## Alternatives considered

1. Keep two stacks and test parity. Rejected: parity tests catch drift but do not stop the double work.
2. Big-bang rewrite. Rejected: too risky for a live mainnet product. Staged migration instead.

## Consequences

1. `/api/v1` style routes and the Stellar server keep running until their users move.
2. Contracts stay separate per chain; they are the enforcement point and are not merged.
3. A new chain needs an adapter and, if it signs differently, a wallet provider. Nothing else.
