# Stellar organisation accounts: implementation

| Field | Value |
| --- | --- |
| Status | Phase 1 built on testnet: admins, operators and viewers. Transfer allow-list policy deployed and verified on chain (2026-11-04). |
| Date | 2026-11-04 |
| Decision | [ADR-005](../adr/ADR-005-organisation-accounts-on-openzeppelin.md) |
| Use cases | [Business account use cases](b2b-use-cases.md) |
| Design history | [Business wallet design](wallet-infrastructure-b2b-design.md) |

Audience: engineers working on wallets, the relay or the contracts. Assumes the Soroban auth model (`require_auth`, `__check_auth`, authorisation entries) and the [Wallet v2.0](v2/wallet-v2.0.md) model.

---

## 1. Shape

```text
Organisation (business_accounts row)             Stellar
  account C... ─────────────────────────────────► OpenZeppelin smart account (stellar-accounts 0.8.0)
  members (business_account_members)                 rule 0  Default         admins' passkeys   + threshold policy (1)
    admin    ── passkey ───────────────────────────►  rule n  CallContract(pool)   operators  + threshold policy (1)
    operator ── passkey ───────────────────────────►  rule n  CallContract(rates)  operators  + threshold policy (1)
    viewer   (no passkey on chain)                    rule n  CallContract(USDC)   operators  + transfer allow-list [pool, rates]
```

A member signs with the same passkey they use for their personal wallet. The organisation account never shares an address, a rule or a signature format with the personal wallet, so approvals cannot be swapped between them (section 4).

## 2. Contracts on testnet

All verified on chain on 2026-11-04 (code fingerprints match the published ones).

| Contract | Address or hash | Source |
| --- | --- | --- |
| Account code (stellar-accounts 0.8.0) | `c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1` | OpenZeppelin |
| WebAuthn verifier | `CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F` | OpenZeppelin |
| Threshold policy | `CAZ2WFUDXGX265LOEARFEOYYUL6F4BYWXZLGUAWZNJY3MRFPNLSZVS4S` | OpenZeppelin |
| Spending-limit policy | `CC3CEYQAP6NPNFIYSWL5MVZRCPJZGWX4XO7WDEJOUVGO2FZX5OONYPA5` | OpenZeppelin |
| Transfer allow-list policy | `CA5BPWHNBVIPNQ5J66UBZDSW2J4VITR7OJLU6IVHOHR6ESE2JM2H4WKQ` (code `a0dae506129f12276e0922c04b9e7b0786f173e61d2b72aa7907e3fa1f66850c`) | BlockFinaX, `blockfinax-stellar/contracts/transfer-allowlist-policy` |

They are configured in `config/chains/testnet.json` under the Stellar chain's `smartAccounts`. A chain without `smartAccounts` does not offer organisations. `transferAllowlistPolicy: null` disables operators.

The allow-list policy has no admin, no constructor and no upgrade function: once deployed, nobody (BlockFinaX included) can change its code. Its deployer key is a throwaway testnet key with no powers. A change to the policy means deploying a new contract and moving rules to it.

## 3. The transfer allow-list policy

Why it exists: buying cover calls `pool.buy_protection(hedger=org, ...)`, and the pool takes the premium with `USDC.transfer(org, pool, premium)` inside that call. The organisation account therefore authorises two contexts, the pool call and the nested USDC transfer, and an operator needs a rule for each. A rule scoped to USDC would otherwise allow `USDC.transfer(org, anyone, amount)`, a withdrawal.

What `enforce` checks: the account authorised the call; at least one of the rule's signers authenticated (a rule with policies defers its signer requirement to them); the context targets the rule's contract; the function is `transfer` (never `approve`, so an allowance cannot become a back door); the sender is the account; the recipient is a plain address on the list (a muxed recipient is refused); the amount is not negative.

Why the pool rule is safe for operators: every pool function that pays out pays the account that owns the position or deposit (`claim_payout` to `pos.hedger`, withdrawals to the LP, creator earnings to the pool creator). None takes a destination from the caller.

State is keyed by `(account, rule id)`, one deployment serves every organisation. Errors are 4100 to 4111, clear of OpenZeppelin's 3000 to 3227. Tests in `src/test.rs` cover each check plus install, change and uninstall.

## 4. Signing

Every signer on an authorisation entry signs the same 32-byte digest (`preimage-v1` for this account code):

```text
signature_payload = sha256(HashIdPreimage of the entry, its nonce and expiry)
auth_digest       = sha256(AuthDigestPreimage { account, context_rule_ids, signature_payload }.toXDR())
```

The digest binds the account and the rule ids the signer claims, so a rule cannot be swapped after signing and an approval for one account is useless on another. A passkey signs it through WebAuthn: the digest is the challenge; the browser returns authenticator data, client data and a DER signature; the app converts the signature to 64-byte `r || s` with low S and writes `{ authenticator_data, client_data, signature }` into the entry's `AuthPayload { context_rule_ids, signers }`. The signer's key data is the 65-byte public key followed by the credential id.

Code:

| What | Where |
| --- | --- |
| Digest | `computeEntryAuthDigest` from `smart-account-kit` (public API) |
| Payload encoding | `shared/vendor/oz-auth-payload.ts` (from Smart Account Kit 0.10.0, Apache 2.0; keep in step with the kit version) |
| Entry signing and guards | `signOrganisationEntry` in `shared/smart-accounts.ts` |
| Rule ids by role | `contextRuleIdsFor` in `shared/organisations.ts` |
| Browser passkey signer | `client/src/lib/organisations.ts` |

Guards in `signOrganisationEntry`: the entry must be for the organisation account; `upgrade` and `execute` are never signed in the app; an account change (add or remove a signer, rule or policy) must be the only thing the entry authorises; V1 credentials are upgraded to V2 before signing (the relay accepts only address-bound V2); a partly signed entry keeps its signatures and must keep the same expiry and rule ids. Signature expiry is the current ledger plus 60 (about five minutes), never days, so a signature never makes a sponsor pay long-term rent.

Rule ids are positional: the account checks each context of the authorisation (the call, then each nested call it authorises, depth first) against the rule id at the same position. A cover purchase by an operator claims `[pool rule, USDC rule]`; an admin claims the Default rule for every context.

## 5. Server

| File | Role |
| --- | --- |
| `shared/organisations.ts` | Roles, permissions, and the planner: which on-chain steps add, remove or change a member, in what order |
| `shared/smart-accounts.ts` | Encodings shared by browser and server: signers, policy parameters, contexts, signing |
| `server/organisations/chain.ts` | Deploy an account, prepare an account change, read rules and signers back |
| `server/organisations/gateway.ts` | Production wiring: chain config, fee payer, passkeys from `wallet_passkeys` |
| `server/organisations/service.ts` | Business rules: membership, invitations, the change workflow, confirmation |
| `server/organisations/repository.ts` | Storage (tables created on first use) |
| `server/organisations/routes.ts` | HTTP API (section 7) |

The planner's safety rules: the last admin can never be removed or demoted; adding access happens before removing it when a role changes; when an admin leaves and the approvals setting would exceed the admins left, the threshold is lowered first, in its own step (OpenZeppelin's threshold policy is not told when signers change); the first operator creates the operator rules, the last operator's removal deletes them.

The change workflow: an admin starts a change; the service plans the steps and stores them on the member row; for each step the service prepares an unsigned transaction (sponsor as source), the admin approves it with their passkey, the relay sends it, and the admin reports the hash; the service confirms from chain state, never from the hash alone (a new signer must be on the rule, a removed one gone, a new rule must exist with the expected name and signers). Only one change runs per organisation at a time. A prepared transaction expires in minutes, so `next` prepares the current step again.

Removal ends app access when it starts: the member becomes `removing`, and every organisation request requires `active`.

Deployment: the platform fee payer deploys with a salt fixed per organisation (`sha256("blockfinax-organisation:" + network + ":" + id)`), so a retried deployment lands on the same address. After deployment the gateway checks the code fingerprint and that rule 0 holds the creator's passkey.

## 6. Acting for an organisation

The browser sends `X-BFX-Organisation: <id>` on protocol requests (`/api/v2/*`) while the user has chosen to act for a business. The server resolves it in `ownerOn` and `bookFor` (`server/routes/v2.ts`) only after checking active membership; otherwise requests act for the user's own account as before.

The relay then applies the member's role (`relayUserTransaction` in `server/chain/stellar-adapter.ts`, `inspectPoolCall` in `server/chain/stellar-relay.ts`):

| Role | Relay sends |
| --- | --- |
| Personal (no header) | As before: pool calls, token transfers and approvals, CCTP burns, own backup-passkey `add_signer` |
| Admin | Pool calls, token transfers (withdrawals), CCTP burns, account changes (`add_signer`, `remove_signer`, `add_context_rule`, `remove_context_rule`, policy changes). Never `upgrade` or `execute` |
| Operator | Pool calls only. Token transfers and approvals are refused |
| Viewer | Nothing |

The chain enforces the same rules through the account's context rules; the relay is the second layer, so a refused request costs nothing.

Refused when acting for a business (they would otherwise act on a personal account): funding from other networks (`/api/v2/deposit-addresses`), cross-network routes, and Request a quote (`/api/v2/rfq*`).

## 7. API

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/organisations/config` | anyone | Whether organisations are offered, contract addresses, whether operators are available |
| `GET /api/organisations` | signed in | My organisations and my role in each |
| `POST /api/organisations` `{ name }` | signed in, with a passkey | Create one and deploy its account |
| `GET /api/organisations/:id` | active member | Members, roles, rule ids, account, my passkey identity |
| `GET /api/organisations/:id/history` | active member | Events with transaction hashes |
| `POST /api/organisations/:id/deploy` | admin | Retry a failed deployment |
| `POST /api/organisations/:id/invites` `{ email, role }` | admin | Invite; emails a one-time link, also returned |
| `POST /api/organisations/invites/accept` `{ token }` | the invited email | Accept |
| `POST /api/organisations/:id/members/:mid/revoke` | admin | Withdraw an invitation not yet on the account |
| `POST /api/organisations/:id/members/:mid/changes` `{ kind, role? }` | admin | Start activate, remove or role change; returns the first step |
| `POST /api/organisations/:id/members/:mid/next` | admin | Prepare the current step again |
| `POST /api/organisations/:id/members/:mid/confirm` `{ hash }` | admin | Confirm the current step from chain; returns the next step or the result |

Invitations: 32 random bytes, stored as a SHA-256 hash, single use, seven days, and only the invited email can accept (a forwarded link is useless).

## 8. Data

`business_accounts` (account, code fingerprint, status, approvals setting, rule ids), `business_account_members` (user, email, role, status, passkey credential id and public key, invitation hash and expiry, pending change and its remaining steps), `business_account_events` (who did what, with transaction hashes). No key material: a passkey appears only as its credential id and public key. Tables are created on first use by `PostgresOrganisationRepository`. The names differ from the onboarding module's `organisations` and `organisation_members`, which hold the business profile (legal name, registration, industry) collected at sign-up; the two are not linked yet.

## 9. Browser

| File | Role |
| --- | --- |
| `client/src/lib/acting-organisation.ts` | Which account the app acts for (a per-device convenience; the server decides) |
| `client/src/lib/organisations.ts` | API, passkey signing for the organisation, the step loop, the chain check |
| `client/src/lib/wallets/passkey-wallet.ts` | Sends the header on `/api/v2/*`; signs organisation transactions when acting for one |
| `client/src/components/v2/organisation-card.tsx` | Business accounts on the Account page; the invitation landing route `/organisations/invite` |

The browser checks each organisation from the chain, not the server: the account must run accepted account code, and the member's passkey must be on the rule their role uses. A compromised server could otherwise point a business at an account it controls.

## 10. Verifying it

| Check | Command | Covers |
| --- | --- | --- |
| Unit tests | `npm test` | Roles and planner, encodings and signing (with a software passkey), service workflow, relay by role |
| Testnet, chain level | `npm run org:check` (first script) | Deploy, admin withdrawal, add and remove an admin, a scoped operator rule, the chain refusing an operator changing the account or claiming the admins' rule, and the allow-list policy on chain: an operator pays a listed recipient, and is refused paying anyone else or approving an allowance (17 checks) |
| Testnet, service level | `npm run org:check` (second script) | The real service and gateway: create, invite, accept, activate, remove, history (9 checks) |
| Policy contract | `cargo test -p blockfinax-transfer-allowlist-policy` (contracts repo) | Every allow-list check |

The testnet checks fund a throwaway account from Friendbot and use software passkeys. They read no BlockFinaX key. Results on 2026-11-04: 17 of 17 and 9 of 9. Contract tests: 15 of 15 for the policy; the whole contracts workspace passes.

## 11. Operators: done and still open

Done (2026-11-04): Rust toolchain and `wasm32v1-none` installed; 15 policy tests pass; built with `stellar contract build`; deployed to testnet; on-chain code fingerprint matches the tested build; `transferAllowlistPolicy` set in `config/chains/testnet.json`; the chain-level check proves the policy in a real organisation account.

Still open:

1. An operator buying cover through the real currency pool end to end (needs a pricing-engine quote, so it is a manual test on the testnet app rather than part of the keyless check).
2. Include the policy in the next contract audit.

## 12. Before mainnet

1. Audit coverage for the exact OpenZeppelin versions pinned (0.8.0 account and policies) and for Smart Account Kit; the public audit covers 0.7.0 release candidate.
2. The OpenZeppelin WebAuthn verifier audit notes a key-data edge case (keys with a credential id suffix). The deployed verifier accepts the kit's format (65-byte key plus credential id), which the testnet checks prove; confirm the mainnet verifier is the same build.
3. Business verification (KYB) and a record of who may act for the company; today the acting member's own verification applies.
4. A per-organisation gas budget and abuse limits (today's limits are per user).
5. A scheduled storage keeper for organisation accounts and policies, so storage renewal never lands on a member's transaction.
6. Decide whether personal wallets move to OpenZeppelin accounts, so the app runs one wallet system.
