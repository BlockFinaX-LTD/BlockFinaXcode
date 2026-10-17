# Chain Adapters v2.0

| Field | Value |
| --- | --- |
| Title | Chain Adapters v2.0 |
| Version | 2.0 |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Supersedes | [Multichain backend](../multichain-backend.md) (v1.0, kept unchanged) |
| Related documents | [Architecture v2.0](architecture-v2.0.md), [Parity map](../../../../blockfinax-stellar/docs/parity-map.md), [Currency pools](../currency-pools.md) |

## 1. The interface

`server/chain/adapter.ts` defines `ChainAdapter`. Every method takes and returns BlockFinaX types.

| Group | Methods |
| --- | --- |
| Read | `listPools`, `getPool`, `getPosition`, `listPositions`, `listActivePositions`, `getBalance`, `getOracleState` |
| Quote | `signQuote(economic, buyer, poolId)` |
| Prepare (user signs) | `prepareCreatePool`, `prepareSetTenor`, `prepareDeposit`, `prepareHedge`, `prepareWithdrawalRequest`, `prepareWithdrawalExecute`, `prepareClaim` |
| Platform (BlockFinaX signs) | `submitOraclePrice`, `settle` |
| Translate | `decodeEvents`, `mapError`, `getTransactionStatus` |

`AdapterRegistry` (`server/chain/index.ts`) returns the adapter for a chain by its family and refuses DISABLED chains.

## 2. What stays inside each adapter

| Concern | EVM adapter (`evm-adapter.ts`) | Stellar adapter (`stellar-adapter.ts`) |
| --- | --- | --- |
| Encoding | ABI via ethers | Contract spec via `contract.Client`, XDR |
| Prepared payload | `{ kind: "evm", chainId, to, data, value }` | `{ kind: "stellar", networkPassphrase, xdr }` |
| Quote signature | ECDSA over `BLOCKFINAX_POOL_BUY_V1` | ed25519 over `BFX_STELLAR_POOL_BUY_V1` (`stellar-quote.ts`) |
| Who is the caller | `msg.sender` | `require_auth` on the wallet argument |
| Token approval | ERC20 `approve` added when needed | Authorization in the same call |
| Settlement | Inside the oracle submission (`settle` is a no-op) | Separate `settle_position` call |
| Fees | User pays gas | Fee payer sponsors via the relay |
| Errors | Revert strings (`errors.ts`, `mapEvmError`) | `Error(Contract, #N)` (`mapStellarError`) |
| Decimals | USDC 6 (18 on BSC) | USDC 7 |

## 3. Parity

Adapters must agree on the economics. Three checks enforce it:

1. **Shared vectors.** `parity/vectors/currency-pool.v1.json` runs on both contracts (11 scenarios, tolerance 0.00001 USDC).
2. **Error parity.** The same failure maps to the same code on both chains (for example "Insufficient pool capacity" and `#17` both become `INSUFFICIENT_LIQUIDITY`).
3. **Event parity.** An EVM log and a Soroban event for the same purchase decode to the same `BusinessEvent` fields, differing only in the subject's chain and contract.

The tests are in `server/architecture/__tests__/v2.test.ts`.

## 4. Base and BSC

Base, BSC and any future EVM chain use the one `EvmAdapter`, configured by the registry (chain id, Diamond address, USDC address and decimals). No code changes per EVM chain.

## 5. Writing a new adapter

1. Implement every method of `ChainAdapter`.
2. Return amounts as exact decimal strings in USDC, not chain units.
3. Use `chain:contract:pool/N` and `chain:contract:position/N` ids.
4. Map every contract error number or string to an `APPLICATION_ERROR_CODES` entry. Unknown errors become `UNKNOWN` with the original detail.
5. Pass the three parity checks above.
