# ADR-002: Separate the user, the wallet and the chain

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related | [Wallet v2.0](../architecture/v2/wallet-v2.0.md) |

## Context

In v1.0 a Base user (Rift smart account) and a Stellar user (passkey account) were two people with two logins. Screens chose wallets by chain.

## Decision

1. A BlockFinaX user owns many chain accounts (`chain_wallet_accounts`).
2. Signing goes through one `WalletProvider` interface; Rift and Stellar passkey are two providers.
3. `WalletSession` holds all the user's accounts; switching network does not sign the user out.
4. Users choose a network only to fund or withdraw. BlockFinaX picks the execution network.

## Reason

The user cares about protection, not chains. One login and one balance view remove the biggest source of confusion, and new chains need a provider, not a new product.

## Alternatives considered

1. One wallet per chain with separate logins. Rejected: the v1.0 problem.
2. One universal key across chains. Rejected: chains use different curves (secp256k1, ed25519) and account models.

## Consequences

1. Signup provisions accounts on `provisionAtSignup` chains; others are created on first use.
2. Partners can bypass providers and sign prepared transactions themselves.
3. Account linking must refuse addresses owned by another user.
