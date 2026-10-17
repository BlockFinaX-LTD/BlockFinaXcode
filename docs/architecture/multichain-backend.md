# Multi-chain backend architecture

## Goal

Use one BlockFinaX API and PostgreSQL database for platform identity and shared
business records, while keeping chain-specific wallet, transaction, and oracle
logic behind explicit chain boundaries. A user's platform identity is separate
from each wallet address they control.

The server stores wallet and transaction metadata only. It must not store
private keys, seed phrases, signing shares, passkey secrets, or wallet-provider
access tokens. Wallet connection and transaction signing happen in a client
wallet provider.

## Implemented foundation

- `shared/auth-core-schema.ts` owns the stable `user_accounts` identity table.
- `shared/chain-wallet-schema.ts` defines linked external identities,
  chain/network wallet accounts, and idempotent chain transaction records.
- `server/chain-wallet-store.ts` provides conflict-safe wallet linking and
  transaction creation. It checks chain/network ownership and prevents a
  wallet address or idempotency key from being silently reused by another user
  or transaction.
- `client/src/lib/wallet-provider.ts` defines the client-side provider
  contract for EVM and Soroban accounts and transactions.
- `migrations/2026-10-14-multichain-wallet-records.sql` is additive. It does not
  migrate, delete, or rewrite existing Rift wallet records or Stellar SQLite
  data.

These are foundations, not a production cutover. Existing routes and product
features still use legacy auth and wallet integrations. The migration has not
been run against any database.

## Data boundaries

```text
Platform user (user_accounts)
  ├── auth identity links (Rift today; other auth providers later)
  ├── EVM wallet account (network-specific)
  ├── Stellar wallet account (network-specific)
  └── chain transactions (idempotency key + chain/network + status)
```

An account is unique by chain namespace, network key, and canonical address.
Examples of network keys are `eip155:8453`, `eip155:56`,
`stellar:testnet`, and `stellar:pubnet`. A transaction hash is only unique
within a chain and network. Application-level idempotency keys are also scoped
to chain and network.

## Wallet ownership proof

An authenticated session does not prove control of every address a user
submits. Before exposing a wallet-link API, implement a short-lived,
single-use challenge bound to the authenticated platform user, chain, network,
and exact address. Verify the signature using chain-appropriate rules, consume
the challenge atomically, and only then call `linkChainWallet`. Do not trust an
address supplied in a request body or infer that a Rift EVM address proves
control of a Stellar account.

## Transaction lifecycle

1. The client selects a wallet provider and chain/network.
2. The server validates authorization, business rules, and request idempotency.
3. The client wallet provider signs/submits the chain-specific transaction.
4. The API records the returned transaction identifier with the same
   idempotency key.
5. A chain-specific observer confirms the transaction and advances its status.
6. Business settlement runs once, guarded by database uniqueness and
   transaction boundaries.

Do not mark a financial operation complete from a wallet submission response.
Only a verified chain receipt / finalized Stellar transaction can move it to a
settled state. The generic metadata table is not a ledger; business settlement
must also use the platform's authoritative accounting records.

## Migration sequence

1. Review the additive SQL against the target PostgreSQL schema and take a
   verified backup.
2. Apply it to a non-production database and verify table/index ownership.
3. Implement challenge creation and chain-specific signature verification.
4. Add authenticated API routes using the platform's stable user ID, not a
   wallet address as the user key.
5. Build a Rift adapter for the provider contract and connect a non-custodial
   Stellar provider adapter. Keep existing UI paths until both are verified.
6. Move read-only Stellar account and transaction data from the separate
   SQLite service into PostgreSQL using an idempotent, auditable importer.
   Reconcile counts and balances before any cutover.
7. Add chain-specific observers, retry/dead-letter handling, metrics, and
   settlement reconciliation.
8. Migrate product routes and users incrementally. Keep rollback paths and
   retain historical records; do not delete legacy tables during the cutover.
9. Only after production evidence supports it, retire Rift-specific flows and
   deploy the BlockFinaX wallet provider. The backend never receives signing
   keys during this transition.

## Required configuration before chain integration

Keep network and token identifiers in validated server configuration. Do not
put RPC credentials, database URLs, or signing secrets in `VITE_` variables.
Configure the Stellar Horizon/Soroban RPC endpoints and the exact USDC issuer
and asset identifier for each Stellar network from authoritative deployment
records. Testnet and pubnet configurations must be separate and impossible to
select accidentally in production.

No RPC URL or token contract should be inferred from a display label. At
startup, validate required configuration and fail closed when a requested
chain/network is not configured.

## Operational safeguards

- Run schema migration through a reviewed, versioned deployment step; do not
  run `drizzle-kit push` against production as part of application startup.
- Make external submission and confirmation handlers idempotent.
- Use bounded retries with timeouts and a dead-letter/manual-reconciliation
  path; never turn an RPC outage into a zero balance or successful settlement.
- Keep an append-only financial audit record that includes actor, operation,
  chain/network, transaction hash, request idempotency key, and state changes.
- Alert on stuck, replaced, reverted, and duplicate transactions.
- Back up PostgreSQL and rehearse restoration before migration or cutover.
