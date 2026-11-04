# ADR-005: Business accounts run on OpenZeppelin smart accounts

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 2026-11-04 |
| Owner | BlockFinaX |
| Related | [Wallet v2.0](../architecture/v2/wallet-v2.0.md), [Stellar organisation accounts](../architecture/stellar-organisation-accounts.md), [Business account use cases](../architecture/b2b-use-cases.md), [ADR-002](ADR-002-wallet-chain-separation.md) |

## Context

A personal BlockFinaX wallet on Stellar is a Passkey Kit smart account with one passkey signer, so whoever holds the phone controls the money. A business is several people. It needs shared access with different powers, the ability to remove someone who leaves, and a guarantee that day-to-day staff cannot send money out.

Stellar classic (G) accounts have native multisig, but signers are ed25519 keys (seed phrases) and thresholds apply per operation category, so "may buy cover but may not withdraw" cannot be expressed: every contract call is the same category. Contract (C) accounts can express it, but someone has to write the account contract.

Stellar's smart wallet guide presents Passkey Kit and Smart Account Kit (which drives OpenZeppelin's smart account, stellar-accounts) as siblings, neither recommended over the other: "pick the model that fits your app". In October 2026 Stellar's Guestbook tutorial moved from Passkey Kit to Smart Account Kit, and Launchtube was retired in favour of OpenZeppelin Relayer. OpenZeppelin's account contract has a published audit; Passkey Kit's README states its wallet contract has not had an independent third-party audit.

## Decision

1. A business ("organisation") is its own Stellar C account, separate from any member's personal wallet, running OpenZeppelin stellar-accounts 0.8.0 (`c514d35e...`).
2. Members are people with their own sign-in and their own passkey. A member's role decides which of the account's context rules their passkey is a signer on:
   - admin: the Default rule, with a threshold policy (1 at launch);
   - operator: rules scoped to the currency pool, the rate pool, and USDC; the USDC rule carries a BlockFinaX transfer allow-list policy so USDC can only be paid into a pool;
   - viewer: no signer.
3. Spend limits and two-admin approval exist as OpenZeppelin policies (spending limit, threshold) that can be switched on per business by an admin transaction. They are off at launch. Turning them on never needs a new contract.
4. Personal wallets stay on Passkey Kit for now. Moving them to OpenZeppelin accounts is a separate decision, to be taken before Stellar mainnet.
5. Gas sponsorship is unchanged: OpenZeppelin Relayer Channels first, the BlockFinaX fee payer as fallback. The fee payer deploys organisation accounts.

## Reason

1. OpenZeppelin's model (context rules, signers, policies) maps one to one onto the roles the product needs, so BlockFinaX writes one small policy instead of an account contract.
2. It is the audited option of the two Stellar documents, it is what Stellar's own example app now uses, and the account and policy contracts are maintained by OpenZeppelin (see Consequences for the version caveat).
3. Organisation accounts are new accounts, so adopting a different account contract for them needs no migration of existing wallets, balances or hedges.

## Alternatives considered

1. Passkey Kit signer limits plus a custom policy. Rejected: needs a custom policy for every rule (roles, thresholds, limits), and Passkey Kit has no built-in m-of-n.
2. Stellar classic multisig. Rejected: no passkeys, and no way to separate buying cover from withdrawing.
3. MPC custody platforms. Rejected: custodial, and a cost base wrong for small importers.
4. Moving every wallet to OpenZeppelin now. Deferred: worth doing before mainnet, but it touches every existing user, so it is its own piece of work.

## Consequences

1. One new contract: `blockfinax-transfer-allowlist-policy` (contracts repo). Built, tested and deployed to testnet on 2026-11-04 (`CA5BPWHN...4WKQ`); it has no admin and cannot be upgraded. It must be audited before mainnet.
2. The audited OpenZeppelin release is 0.7.0 (release candidate). The deployed 0.8.0 account and policies, and Smart Account Kit itself, are newer than that audit. Before mainnet: confirm audit coverage for the exact versions pinned, or commission it.
3. Two wallet systems run side by side (Passkey Kit for people, OpenZeppelin for businesses) until personal wallets move.
4. Business accounts are Stellar only. Funding from other networks (CCTP routing), Request a quote, and cross-network withdrawals refuse when acting for a business, rather than acting on a personal account.
5. Removing a member ends their app access when removal starts; the on-chain removal follows.
