# Wallet Architecture v2.0

| Field | Value |
| --- | --- |
| Title | Wallet Architecture v2.0: one user, many chain accounts |
| Version | 2.0 |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Supersedes | Wallet design notes of v1.0 (internal) |
| Related documents | [Architecture v2.0](architecture-v2.0.md), [ADR-002](../../adr/ADR-002-wallet-chain-separation.md) |

## 1. Model

```
BlockFinaX user (one login)
  ├── base     0x...   provider: rift             primary
  ├── bsc      0x...   provider: rift             (lazy)
  └── stellar  C...    provider: stellar-passkey  primary
```

Chain accounts are rows in `chain_wallet_accounts`, owned by the user. `server/accounts/service.ts` manages them:

1. `provisioningPlan(user)` lists chains marked `provisionAtSignup` that the user still lacks.
2. `link(user, account)` checks the address format for the chain family, refuses an address owned by another user, and makes the first account on a chain primary.
3. Chains not marked `provisionAtSignup` are provisioned lazily, the first time the user funds or withdraws there.

## 2. Wallet Provider

`client/src/lib/wallet-provider.ts` is the one interface:

| Member | Purpose |
| --- | --- |
| `id`, `namespaces` | Which chain families the provider signs for |
| `getAccounts()` | The user's accounts this provider controls |
| `connect()`, `disconnect()` | Session control |
| `sendTransaction(request, onStep)` | Sign and send one prepared transaction |

Providers today:

| Provider | File | Chains | How it signs |
| --- | --- | --- | --- |
| Rift | `client/src/lib/wallets/rift-provider.ts` | Base, BSC, Base Sepolia | Rift smart account (v3 signer, then auth request, then signer send) |
| Stellar passkey | `client/src/lib/wallets/stellar-passkey-provider.ts` | Stellar | Passkey signs the Soroban authorization; the backend relay pays the fee |

A partner's own wallet or custody is a third kind: it skips Wallet Providers and signs the `PreparedTransaction` payloads itself.

## 3. Wallet Session

`client/src/lib/wallet-session.ts` holds the signed-in user, all their accounts across providers, and the active network.

1. `switchNetwork(chain)` changes the active account only. The user stays signed in.
2. `send(transactions, onProgress)` runs each transaction through `PREPARED`, `AWAITING_SIGNATURE`, `SUBMITTED`, then `CONFIRMED` or `FAILED`, picking the provider by the transaction's family.
3. A user rejection becomes `TRANSACTION_REJECTED`, the same code on every chain.

## 4. When the network matters

Users choose a network only when money enters or leaves BlockFinaX:

| Action | Who chooses the chain |
| --- | --- |
| Deposit or fund | The user picks a Funding Network |
| Withdraw | The user picks a Withdrawal Network |
| Quote, buy, LP deposit, claim | BlockFinaX (the Execution Network, normally the hub) |

## 5. Security

1. Keys never leave the provider. The backend sees signatures and authorizations only.
2. The Stellar relay pays fees only for one approved method on the configured pool, with the user's own address in the wallet argument and an authorization bound to that exact call (`server/chain/stellar-relay.ts`).
3. Linking checks ownership of the address string only. Proof of control is the provider's job at connection time.
