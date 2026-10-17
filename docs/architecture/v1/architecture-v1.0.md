# BlockFinaX Architecture v1.0

| Field | Value |
| --- | --- |
| Title | BlockFinaX Architecture v1.0 (Base first, Stellar separate) |
| Version | 1.0 |
| Status | Superseded |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Supersedes | None |
| Superseded by | [Architecture v2.0](../v2/architecture-v2.0.md) |
| Related documents | [System map](../system-map.md), [Multichain backend](../multichain-backend.md), [Currency pools](../currency-pools.md), [Wallet infrastructure design](../wallet-infrastructure-design.md), [Oracle strategy](../oracle-strategy.md) |

This document records the architecture as it stood before v2.0, so the change is traceable. The documents linked above stay as they are. They describe v1.0 in more detail and are not rewritten.

## Summary

BlockFinaX v1.0 was built as a Base product with Stellar added beside it.

1. **Base (and BSC)** ran from this repository: the main web app, the main Express backend, the Rift smart-account wallet, and the EIP-2535 Diamond with the currency-pool facets.
2. **Stellar** ran as a second product: its own wallet web app and wallet server (`blockfinax-stellar-wallet`, later `blockfinax-stellar/apps/wallet`), its own passkey accounts, its own copy of the pool maths, its own oracle worker, and the Soroban `currency-pool` and `oracle-consensus` contracts.

## How the two halves were joined

| Concern | Base | Stellar |
| --- | --- | --- |
| Frontend | `client/` | Stellar wallet web app |
| Backend | `server/` | Stellar wallet server |
| User account | Session user with a Rift smart account | Passkey smart account, separate login |
| Pricing | `server/pricing/pool-quote.ts` | `currency-pool-math.ts` (a port) |
| Quote signing | ECDSA, `BLOCKFINAX_POOL_BUY_V1` | ed25519, `BFX_STELLAR_POOL_BUY_V1` |
| Oracle | `server/multi-oracle/oracle-node.ts` | `oracle-worker.ts` |
| Errors | Revert strings | `Error(Contract, #N)` |
| Events | Solidity logs | Soroban events |

Parity was kept by shared test vectors (`parity/vectors/currency-pool.v1.json`). Both chains produced the same economic results, but the product logic was written twice.

## Problems that led to v2.0

1. A user needed two logins to use both chains.
2. Every product change had to be made twice, once per chain.
3. Screens called contracts directly and handled chain units and chain errors.
4. There was no single place that said which chain takes new hedges.
5. Moving liquidity from one chain to another had no defined process.
6. Funding from a chain other than the one holding the pools was not possible.

The architecture review dated 2026-10-17 concluded: "Base and Stellar are still too separate." Architecture v2.0 is the response.
