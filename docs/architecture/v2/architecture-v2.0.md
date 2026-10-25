# BlockFinaX Architecture v2.0

| Field | Value |
| --- | --- |
| Title | BlockFinaX Architecture v2.0: one chain-agnostic product |
| Version | 2.0 |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Supersedes | [Architecture v1.0](../v1/architecture-v1.0.md) |
| Related documents | [Wallet v2.0](wallet-v2.0.md), [Routing v2.0](routing-v2.0.md), [Liquidity hub v2.0](liquidity-hub-v2.0.md), [Chain adapters v2.0](chain-adapters-v2.0.md), [ADR-001](../../adr/ADR-001-single-liquidity-hub.md), [ADR-002](../../adr/ADR-002-wallet-chain-separation.md), [ADR-003](../../adr/ADR-003-routing-provider-abstraction.md), [ADR-004](../../adr/ADR-004-one-frontend-one-backend.md) |

## 1. The idea in one paragraph

BlockFinaX is one product. A user has one BlockFinaX account, which owns one or more chain accounts. The product (pools, quotes, hedges, settlement, balances) is described in BlockFinaX terms only. Chains sit below a single interface, the **Chain Adapter**. One chain at a time is the **Liquidity Hub**, where new pools and new hedges live. Users may fund from, and withdraw to, any enabled network. The **Routing Layer** moves money between the network the user chose and the hub.

## 2. Terminology

| Term | Meaning |
| --- | --- |
| Liquidity Hub | The one chain that takes new pools, new LP deposits and new hedges. Set by `activeLiquidityHub`. |
| Execution Network | The chain a hedge is actually written on. Normally the hub. |
| Funding Network | A chain a user may deposit from. |
| Withdrawal Network | A chain a user may withdraw to. |
| Routing Layer | Moves value between a funding or withdrawal network and the hub, with tracked states. |
| Chain Adapter | The only code that knows a chain's encoding, signatures, errors and events. |
| Wallet Provider | The only client code that knows how a user signs on a chain. |

## 3. Layers

```
  Screens (client/src)            speak BlockFinaX only
        |  blockfinaxApi + WalletSession
  /api/v2 (server/routes/v2.ts)   chain is a field in the data
        |
  Domain services                 QuoteService, AccountService, oracle engine,
  (server/domain, accounts)       settlement, BalanceLedger
        |                         shared maths: shared/domain/pool-economics.ts
  Routing Layer (server/routing)  RoutingEngine + RoutingProviders
        |
  Chain registry                  config/chains/*.json, shared/chains/registry.ts
        |
  Chain Adapters (server/chain)   EvmAdapter (Base, BSC, future EVM), StellarAdapter
        |
  Contracts                       Diamond pool facets, Soroban currency-pool
```

Rule: nothing above the Chain Adapter line uses ABI, XDR, ECDSA, ed25519, `msg.sender` or `require_auth`. The client side follows the same rule above the Wallet Provider line.

## 4. Shared components

| Component | File | What it owns |
| --- | --- | --- |
| Domain types | `shared/domain/types.ts` | CurrencyPool, ProtectionQuote, ProtectionPosition, RoutingQuote, SettlementResult, Asset, TransactionState, ApplicationError, BusinessEvent, ResourceId |
| Pool maths | `shared/domain/pool-economics.ts` | Offer rate, cost, max payout, Open cap, settlement payout, term checks, exact unit conversion |
| Chain registry | `shared/chains/registry.ts`, `config/chains/*.json` | Chains, states, capabilities, hub, assets, contract addresses |
| Quote service | `server/domain/quote-service.ts` | Economic quote first, then the hub adapter signs it |
| Oracle engine | `server/domain/oracle-engine.ts` | One market-data and policy engine for every settling chain |
| Settlement view | `server/domain/settlement.ts` | One SettlementResult for every chain |
| Balance ledger | `server/domain/ledger.ts` | Where every unit is: chain, transit, bucket |
| Account service | `server/accounts/service.ts` | One user, many chain accounts |
| Routing | `server/routing/*` | Funding and withdrawal across networks |
| API | `server/routes/v2.ts` | `/api/v2/*` |
| Client API | `client/src/lib/blockfinax-api.ts` | Typed calls to `/api/v2` |
| Wallet session | `client/src/lib/wallet-session.ts` | Accounts, network switching, transaction lifecycle |

## 5. Identity of things

Every pool, hedge and withdrawal has one id format: `chain:contract:id`, for example `base:0xbCC5...:position/3` or `stellar:CCIO...:pool/1`. Events from every chain are normalized into `BusinessEvent` with this id as `subject`, so indexing and history do not care where the event came from.

## 6. Transaction lifecycle

Every write follows the same states on every chain:

`PREPARED -> AWAITING_SIGNATURE -> SUBMITTED -> CONFIRMED` or `FAILED`.

The server prepares (`PreparedTransaction`), the client's Wallet Provider signs and sends, and the server reports status through `GET /api/v2/transactions/:chain/:hash`.

## 7. Errors

Contracts fail in their own way. Adapters translate each failure into one code from `APPLICATION_ERROR_CODES` (for example `INSUFFICIENT_LIQUIDITY`, `QUOTE_EXPIRED`, `CHAIN_DRAINING`). The API returns `{ "error": { "code", "message" } }`. Screens only see these codes.

## 8. API

| Method and path | Purpose |
| --- | --- |
| GET /api/v2/chains | Registry view: hub, states, capabilities, assets |
| GET /api/v2/pools, /pools/:ref | Pools on every enabled chain |
| GET /api/v2/options?pair= | Tenors and structures available now |
| POST /api/v2/quotes | Protection quote on the execution network |
| POST /api/v2/hedges/prepare | Transactions that buy the quoted hedge |
| GET /api/v2/hedges, /hedges/:ref | Positions with SettlementResult |
| POST /api/v2/hedges/:ref/claim/prepare | Claim transactions |
| POST /api/v2/pools/prepare, /pools/:ref/tenors/prepare, /pools/:ref/deposits/prepare | Underwriter actions (hub only) |
| GET, POST /api/v2/accounts | Chain accounts of the signed-in user |
| GET /api/v2/balances | Balances across chains |
| POST /api/v2/routing/quote | Ranked routes for funding or withdrawal |
| POST /api/v2/routing/execute | Start a route (gated, see Routing v2.0) |
| POST /api/v2/transactions/relay | Sponsored submission for Stellar passkey accounts |
| GET /api/v2/transactions/:chain/:hash | Transaction state |

Partners can use the API without the BlockFinaX wallet: they read pools, request quotes and receive prepared transactions, then sign with their own keys or custody.

## 9. Security boundaries

| Enforced by the contract (cannot be bypassed) | Enforced by the backend (policy and convenience) |
| --- | --- |
| Quote signature, nonce, expiry, max cost | Choice of execution network and pool |
| Pool capacity, reserved funds, cap bounds, tenor | Routing provider ranking |
| Oracle quorum, staleness, cooldown, tolerance | Deviation guard before submitting |
| Payout, fees, claims, LP withdrawal notice | Ledger and route tracking |
| Pausing and admin roles | Chain state gates (DRAINING refuses new hedges) |

The backend can refuse to help, but it cannot make a contract do something the contract forbids. A backend failure stops new activity; it never moves user funds on its own.

## 10. Migration stages

| Stage | Content | State on 2026-10-17 |
| --- | --- | --- |
| 1 | Chain registry and config | Done |
| 2 | Domain types, errors, transaction states, shared maths | Done |
| 3 | Wallet Provider interface, Rift and Stellar passkey providers, WalletSession | Done (Rift send path moved; screens still use it through hedge-contract.ts) |
| 4 | Chain Adapters for EVM and Stellar | Done |
| 5 | `/api/v2` on the main backend | Done |
| 6 | Shared screens on `/api/v2` | Not started (client API ready) |
| 7 | Routing engine, providers, ledger | Engine done; execution gated until persistent storage exists |
| 8 | Retire the separate Stellar wallet server | Not started (relay and adapter now live in the main backend) |

## 11. Adding a chain

1. Add it to `config/chains/<env>.json` as `DISABLED`, with its assets and decimals.
2. If it is EVM, deploy the Diamond pool facets; the existing `EvmAdapter` serves it. Otherwise write a new adapter that implements `ChainAdapter`.
3. Pass the parity vectors (`parity/vectors/currency-pool.v1.json`) and the adapter parity tests (`server/architecture/__tests__`).
4. Map every contract error to an application code and every event to a `BusinessEvent`.
5. Add a Wallet Provider if users sign differently on it.
6. Set it to `ACCESS_ONLY` to allow funding and withdrawal. Make it the hub only by the migration in [Liquidity hub v2.0](liquidity-hub-v2.0.md).
