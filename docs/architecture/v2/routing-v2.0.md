# Routing Architecture v2.0

| Field | Value |
| --- | --- |
| Title | Routing Architecture v2.0: multi-chain funding and withdrawal |
| Version | 2.0 |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Supersedes | None (new in v2.0) |
| Related documents | [Architecture v2.0](architecture-v2.0.md), [Liquidity hub v2.0](liquidity-hub-v2.0.md), [ADR-003](../../adr/ADR-003-routing-provider-abstraction.md) |

## 1. Purpose

A user funds from any Funding Network and withdraws to any Withdrawal Network. The Routing Layer moves the value to or from the Liquidity Hub and, when asked, completes an action at the destination (credit a balance, deposit to a pool, buy a hedge).

## 2. Providers

Every provider implements `RoutingProvider` (`server/routing/types.ts`):

| Method | Purpose |
| --- | --- |
| `supports(request)` | Can it move this asset between these chains |
| `getQuote(request)` | A `RoutingQuote`, or null if it cannot serve the amount |
| `execute(route)` | Start the route and return the source transactions to sign |
| `getStatus(route)` | pending, source_confirmed, destination_confirmed or failed |
| `recover(route)` | refunded, retrying or manual |

| Provider | State | Notes |
| --- | --- | --- |
| Direct | Implemented | Same chain; no bridge |
| BlockFinaX prefunded | Implemented, ports not wired | Treasury float on the hub pays out at once; the source deposit refills a float on the source chain, recorded as a rebalance owed |
| Circle CCTP | Implemented, port not wired | Burn on source, attest, mint on destination |
| LI.FI, aggregators, solvers | Not implemented | Same interface |

## 3. Best execution

`RoutingEngine.quote` drops expired quotes and quotes above the risk limit, then ranks by:

`score = amountOut / amountIn - time penalty - risk penalty`

so a slightly cheaper route that takes an hour, or carries more counterparty risk, can lose to a faster, safer one. The policy is in `DEFAULT_POLICY` and is configurable.

Direct execution on a non-hub chain is allowed only if that chain has `allowSecondaryExecution` in the registry. Otherwise funds are routed to the hub first.

## 4. States

```
REQUESTED -> SOURCE_CONFIRMED -> ROUTING -> DESTINATION_CONFIRMED -> ACTION_PENDING -> ACTION_COMPLETED
                   |                |                                      |
                   +---- FAILED ----+                                      +--> RECOVERY_REQUIRED (funds on hub, retry)
                           |
                    RECOVERY_REQUIRED -> REFUNDED, or back to ROUTING
```

`HEDGE_PENDING` and `HEDGE_CREATED` in the original request are the `ACTION_PENDING` and `ACTION_COMPLETED` states when the action is a hedge.

## 5. Funds are never unaccounted for

Every state change writes to the `BalanceLedger` (`server/domain/ledger.ts`):

| Moment | Ledger entry |
| --- | --- |
| Source confirmed | Credit `user / transit:<route> / pending_routing` |
| Destination confirmed | Move to `user / <hub> / available`; the fee leaves as a debit |
| Action completed | Move to `user / <hub> / reserved` (LP deposit or hedge) |
| Action failed | Nothing moves: the funds stay `available` to the user on the hub |
| Delivery failed after the source confirmed | Funds stay in `transit` until recovery |
| Refunded | Transit balance leaves the ledger back to the sender |

`conservationCheck` proves that credits minus debits equals the sum of all balances. Tests cover funding, withdrawal, failure with refund, and action failure with retry.

## 6. Why execution is gated

`POST /api/v2/routing/execute` returns an error unless `ROUTING_ENABLED` is set, and even then until a persistent route store and ledger tables exist. An in-memory store would lose a route on restart, and that is the one thing this layer must never do. Quotes are live.

## 7. Before enabling execution

1. Add database tables for routes, route history and ledger entries, and implement `RouteStore` on them.
2. Wire the treasury port (hub float, source float, payout and refund signing) and the CCTP port.
3. Run a background job that calls `advance` on every open route and alerts on `RECOVERY_REQUIRED`.
4. Reconcile the ledger against on-chain balances daily.
