# ADR-001: One active liquidity hub

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related | [Liquidity hub v2.0](../architecture/v2/liquidity-hub-v2.0.md) |

## Context

BlockFinaX runs currency pools on Base and on Stellar. Running both as live markets splits LP capital, gives two prices for the same hedge, and doubles operations.

## Decision

Exactly one chain is the Liquidity Hub at a time (`activeLiquidityHub`). Only the hub takes new pools, LP deposits and hedges. Other chains are ACCESS_ONLY (funding and withdrawal), DRAINING (settling old hedges after a migration) or DISABLED. A second ACTIVE chain is allowed only with an explicit `allowSecondaryExecution` flag.

## Reason

Deep liquidity in one place gives more capacity per dollar, one price, one oracle focus and simpler risk. Routing lets users reach the hub from any chain, so a single hub does not limit who can use BlockFinaX.

## Alternatives considered

1. Separate markets on every chain. Rejected: thin liquidity and price divergence.
2. Cross-chain shared accounting with one pool spread over chains. Rejected: needs cross-chain messaging for every hedge, with bridge risk inside every trade.

## Consequences

1. Hub changes follow the controlled migration (ACTIVE, DRAINING, ACCESS_ONLY).
2. Users on non-hub chains pay a routing cost and wait for routing.
3. The hub's chain risk is concentrated; the migration path is the mitigation.
