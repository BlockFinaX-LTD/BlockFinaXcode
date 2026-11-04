# Business wallet design

| Field | Value |
| --- | --- |
| Status | Phase 1 built on testnet (2026-11-04), including operators and the transfer allow-list policy. |
| Decision | [ADR-005](../adr/ADR-005-organisation-accounts-on-openzeppelin.md) |
| Implementation | [Stellar organisation accounts](stellar-organisation-accounts.md) |
| Use cases | [Business account use cases](b2b-use-cases.md) |

This document keeps the reasoning behind business accounts. How they are built is in the implementation document; what each person does is in the use cases.

---

## 1. The problem

A personal BlockFinaX wallet is one person's account: one passkey signer, so whoever holds the phone controls the money. A business is several people. It needs:

1. shared access with different powers;
2. a way to stop day-to-day staff sending money out;
3. a way to remove someone who leaves, at once;
4. recovery when one person's phone is lost.

## 2. The model

A business is its own Stellar account, separate from any member's personal wallet. Members are people with their own sign-in and passkey. Their role decides what their passkey can approve:

| Role | Can | Cannot |
| --- | --- | --- |
| Admin | Everything: buy cover, liquidity, withdraw to any address, manage members, settings | Upgrade the account through the app |
| Operator | Buy cover, add and manage liquidity | Send money out, approve allowances, change the account |
| Viewer | See balances, cover and statements | Approve anything |

The account is OpenZeppelin's smart account. Each role is a set of context rules: admins sit on the Default rule; operators sit on rules scoped to the pools and to USDC, where a BlockFinaX policy only lets USDC go into a pool. The chain enforces the roles; the app and the relay enforce them again so a refused request fails before anyone pays for it.

## 3. Decisions taken, and why

**Only admins withdraw; operators act alone.** Money leaving the business is the risky action, so it is admin only. Buying cover and liquidity keep money inside the protocol (every pool payout returns to the business account), so an operator acts alone, quickly.

**No human approval in front of buying cover.** A cover purchase carries a quote that expires in 120 seconds, too short for a second person on another phone. Control there comes from the operator's scope and, when wanted, a spend limit, both checked instantly on chain. Liquidity, pool settings and withdrawals carry no quote, so a second approval fits there without any clock.

**No spend limits at launch, but the capability is on chain.** OpenZeppelin's spending-limit and threshold policies are deployed contracts. Turning a limit or two-admin approval on for a business is an admin transaction, never a new contract or a new audit. The screens come when a customer asks.

**Members are added from the Account page, like backup passkeys.** Invite by email, the person accepts and makes their own passkey, then an admin approves putting that passkey on the account. A viewer needs nothing on chain.

**Removal is immediate in the app.** The member loses access when removal starts; the chain follows a step or two later.

**Never one admin by choice.** The last admin cannot be removed or demoted, and the app asks for a second admin, because with one admin a lost phone locks the business.

**OpenZeppelin, not our own account code.** The earlier draft of this document built on Passkey Kit's signer limits, which would have meant writing policies for roles, thresholds and limits ourselves, with no built-in m-of-n. OpenZeppelin's account has them, it is the audited option of the two Stellar documents as siblings, and business accounts are new accounts, so adopting it needs no migration. One BlockFinaX policy remains: the transfer allow-list.

## 4. What changed on chain and in the wallet kit

| Layer | Change |
| --- | --- |
| Personal wallets | None. They stay on Passkey Kit. |
| Pool contracts | None. They do not know whether a buyer is a person or a business. |
| Business accounts | New: OpenZeppelin account (deployed per business by the fee payer), OpenZeppelin verifier and policies (already deployed by OpenZeppelin) |
| BlockFinaX contracts | New: the transfer allow-list policy |
| Wallet kit | Smart Account Kit added for business accounts. The Stellar SDK moved to 16.4.1 and Passkey Kit now shares it. |
| Gas | Unchanged: OpenZeppelin Relayer Channels first, the BlockFinaX fee payer as fallback |

## 5. Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Business accounts, admins and viewers, invitations, add and remove members, role changes, acting for a business, chain checks in the browser, history | Built on testnet |
| 1b | Operators: deploy the transfer allow-list policy, then add operators | Built on testnet; an operator buying from the real pool is still to be tested in the app |
| 2 | Screens for spend limits and two-admin approval (with a co-signing queue), statements as CSV, replacing a member's passkey | Planned |
| 3 | Session keys for automation (auto-claim, roll at expiry), guardian recovery for single-admin businesses | Planned |

## 6. Open questions

1. Business verification (KYB): today the acting member's own verification applies to business activity.
2. A per-business gas budget and abuse limits (today's limits are per user).
3. Whether personal wallets also move to OpenZeppelin accounts before mainnet, so the app runs one wallet system.
4. Underwriting businesses: confirm with the first one that the operator scope (pool calls, deposits into pools) fits how they work.
