# Liquidity Hub v2.0

| Field | Value |
| --- | --- |
| Title | Liquidity Hub v2.0: one active hub and controlled migration |
| Version | 2.0 |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Supersedes | None (new in v2.0) |
| Related documents | [Architecture v2.0](architecture-v2.0.md), [Routing v2.0](routing-v2.0.md), [ADR-001](../../adr/ADR-001-single-liquidity-hub.md) |

## 1. Why one hub

Liquidity split across chains is thinner on each chain. With one hub, every LP dollar backs every hedge, prices are the same for everyone, and capacity is one number.

## 2. Chain states

| Capability | ACTIVE | DRAINING | ACCESS_ONLY | DISABLED |
| --- | --- | --- | --- | --- |
| New pools | yes | no | no | no |
| New hedges | yes | no | no | no |
| LP deposits | yes | no | no | no |
| Settlement | yes | yes | no | no |
| Claims | yes | yes | no | no |
| LP withdrawals | yes | yes | no | no |
| Funding (route in) | yes | yes | yes | no |
| Withdrawals (route out) | yes | yes | yes | no |

The table is `CAPABILITIES` in `shared/chains/registry.ts`. The registry refuses a config where the hub is not ACTIVE, where a second chain is ACTIVE without `allowSecondaryExecution`, or where an ACTIVE or DRAINING chain has no pool contract.

## 3. Configuration

`config/chains/mainnet.json` and `config/chains/testnet.json` hold the chains. Environment variables override per deployment:

| Variable | Effect |
| --- | --- |
| `BLOCKFINAX_ENV` | `mainnet` or `testnet` file |
| `BLOCKFINAX_CHAIN_CONFIG` | Path to another config file |
| `BLOCKFINAX_LIQUIDITY_HUB` | Which chain is the hub |
| `<KEY>_STATE` | Chain state, for example `STELLAR_STATE=ACCESS_ONLY` |
| `<KEY>_RPC_URL`, `<KEY>_CURRENCY_POOL`, `<KEY>_POOL_ORACLE` | Endpoints and contracts |

Current settings: mainnet hub Base (ACTIVE), BSC ACCESS_ONLY, Stellar DISABLED. Testnet hub Stellar testnet (ACTIVE), Base Sepolia ACCESS_ONLY.

## 4. Migration, for example from Base to Stellar

Starting point: Base ACTIVE, Stellar ACCESS_ONLY.

Step 1. Deploy and test the Stellar pool and oracle contracts. Pass the parity vectors.

Step 2. Seed Stellar with pools and liquidity while it is still ACCESS_ONLY (admin action).

Step 3. Begin the migration: `beginHubMigration(config, "stellar")`. Stellar becomes ACTIVE and the hub. Base becomes DRAINING.

Step 4. While draining:
1. New quotes, hedges, pools and LP deposits go to Stellar only. A Base request returns `CHAIN_DRAINING`.
2. Existing Base hedges settle and pay out as normal. The oracle engine keeps serving every settling chain.
3. Base LPs can withdraw. Routing can move their USDC to Stellar if they choose.

Step 5. When Base has no active hedges and no liquidity left, `completeDrain(config, "base", ...)` moves it to ACCESS_ONLY. It refuses while hedges remain.

Step 6. Base remains a Funding and Withdrawal Network.

The tests in `server/architecture/__tests__/v2.test.ts` cover these steps.

## 5. Risks

1. LPs may not move: Base liquidity shrinks before Stellar liquidity grows. Seed Stellar first (Step 2).
2. A config change is the switch. Change it only by a reviewed deployment, never by hand on a live server.
3. Contracts on the draining chain must stay unpaused until the drain completes, or hedges cannot settle.
