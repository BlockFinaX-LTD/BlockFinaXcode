# Business account use cases

| Field | Value |
| --- | --- |
| Date | 2026-11-04 |
| Implementation | [Stellar organisation accounts](stellar-organisation-accounts.md) |
| Decision | [ADR-005](../adr/ADR-005-organisation-accounts-on-openzeppelin.md) |

Each use case below is traced from what the person does, through the app and server, to what happens on Stellar. Status: **Built** (on testnet, tested), **Planned** (designed, not built).

The running example is Acme Imports Ltd in Lagos: Ada (founder, admin), Bayo (finance, admin), Chidi (operations, operator), and Dami (external accountant, viewer).

---

## UC1. Create a business account (Built)

**Who:** Ada, signed in with her own passkey.

1. Ada opens Account, then Business accounts, then Create a business account, and types "Acme Imports Ltd".
2. Server (`OrganisationService.create`): checks Ada has a passkey, records the organisation (`deploying`) and Ada as an active admin with her passkey's credential id and public key.
3. Chain: the platform fee payer deploys an OpenZeppelin account with Ada's passkey on rule 0 (Default) and a threshold policy of 1. The salt is fixed per organisation, so a retry lands on the same address.
4. Server: checks the new account's code fingerprint and that rule 0 holds Ada's passkey, then marks the organisation `active`.
5. Browser: checks the same two facts from the chain itself and shows "Checked on the network".

**Result:** Acme has its own Stellar address, separate from Ada's personal wallet. Ada is its only admin. The app suggests adding a second admin.

**If it fails:** the organisation shows "Setup failed" and Ada can try again; the fixed salt means no second account is created.

## UC2. Invite a team member (Built)

**Who:** Ada (admin).

1. Ada enters `chidi@acme.ng`, picks Operator, and presses Invite.
2. Server (`invite`): admins only; validates the email and role; creates a member row `invited` with a hashed one-time token valid for seven days; records the event.
3. Server: emails Chidi a link to `/organisations/invite#token=...` and returns the link to Ada as well, in case email fails.

**Nothing happens on chain.** An invitation grants nothing until accepted and added.

## UC3. Accept an invitation (Built)

**Who:** Chidi.

1. Chidi opens the link. The app keeps the token for this tab and opens the app; if he is not signed in, he signs in or signs up first (creating his own passkey if new).
2. The Account page shows "You have an invitation". Chidi presses Accept.
3. Server (`accept`): the token must be unused and unexpired, and Chidi's sign-in email must be the invited one (a forwarded link is useless). His passkey's credential id and public key are recorded; one passkey cannot belong to two members.
4. A viewer is active at once. An admin or operator becomes `accepted`, waiting for an admin to add their passkey to the account.

## UC4. Add an accepted member to the account (Built)

**Who:** Ada (admin), for Bayo (admin) or Chidi (operator).

1. Ada presses Add to account next to the member.
2. Server (`start`, kind `activate`): plans the steps (`planAddMember`):
   - an admin: one step, `add_signer` on rule 0;
   - the first operator: create the operator rules (pool, rate pool, USDC with the allow-list);
   - later operators: `add_signer` on each operator rule.
3. For each step: the server prepares the transaction; Ada approves with her passkey (claiming rule 0); the relay sends it; the server confirms from chain state (the passkey is on the rule, or the new rule exists with the expected name and signers) and records any new rule id.
4. After the last step the member is `active`.

**Only one change runs at a time** per organisation. A change interrupted half way shows Continue.

## UC5. Act for the business (Built)

**Who:** any active member.

1. On the Account page, under "Act for", the member picks Acme Imports Ltd instead of My personal account.
2. The app sends `X-BFX-Organisation` on protocol requests. The server checks active membership on every request and swaps in Acme's account: balances, cover and pools now show Acme's, never the member's personal funds.
3. Switching back to the personal account is one press.

## UC6. Operator buys cover for the business (Built; real-pool purchase to be tested in the app)

**Who:** Chidi (operator), acting for Acme.

1. Chidi gets a quote for a USD/NGN Cap on a $25,000 supplier invoice due in 30 days and presses Buy.
2. Server: prepares `buy_protection` with Acme's account as the buyer and an engine-signed quote (valid for 120 seconds).
3. Browser: Chidi's passkey signs. The purchase has two contexts (the pool call and the USDC premium transfer inside it), so the app claims `[operators pool rule, operators USDC rule]`.
4. Relay: an operator may send pool calls only; this is one, so it is sponsored.
5. Chain: the pool rule's threshold policy accepts one operator; the USDC rule's allow-list accepts a transfer from Acme to the pool. Any other recipient would be refused.

**Why there is no second approval here:** the quote expires in two minutes, too short for a second person. Control comes from the operator's scope (pools only) and, when a business asks, a spend limit (UC13), both checked instantly on chain.

## UC7. Operator manages liquidity for an underwriting business (Built; to be tested in the app)

**Who:** an operator at a business that underwrites.

Deposits, withdrawal requests and claiming creator earnings are pool calls, so the operator's pool rule covers them. The deposit's USDC transfer goes to the pool, which the allow-list permits. Every amount the pool pays out goes back to the business account, never to an address the operator chooses.

## UC8. Admin withdraws (Built)

**Who:** Bayo (admin), acting for Acme.

1. Bayo sends USDC from Acme's account to Acme's exchange or off-ramp address.
2. Browser: Bayo's passkey signs, claiming rule 0. The relay allows a token transfer for admins.
3. Chain: rule 0's threshold policy (1 at launch) accepts one admin.

**Refused for operators** at the relay and, independently, on chain (their USDC rule only pays pools). Proven on testnet: a removed admin's withdrawal and an operator's attempt to use the admins' rule both fail on chain.

## UC9. Viewer checks statements (Built for access; statements Planned)

**Who:** Dami (accountant), acting for Acme.

Dami sees Acme's balances, cover and pools. Any attempt to send is refused by the app, the relay and the chain (Dami has no signer). A CSV statement export is planned.

## UC10. A member leaves (Built)

**Who:** Ada (admin), removing Chidi.

1. Ada presses Remove.
2. Server: Chidi becomes `removing` at once, so he loses access in the app before anything reaches the chain.
3. Steps (`planRemoveMember`): one of several operators, `remove_signer` on each operator rule; the last operator, the operator rules are deleted; an admin, `remove_signer` on rule 0 (and the threshold lowered first if needed).
4. Ada approves each step; the server confirms the passkey is gone; Chidi becomes `removed`.

**The last admin can never be removed** (and cannot remove themselves): the app, the server and the planner all refuse.

## UC11. Change a member's role (Built)

**Who:** Ada.

New access is added before old access is removed (`planChangeRole`), so nobody is ever left between roles with no admin. Promoting a viewer looks up their passkey at that point. Demoting the last admin is refused.

## UC12. An admin loses their phone (Built when there are two admins)

With two admins, the other admin removes the lost passkey (UC10) and the person rejoins with a new passkey. This is why the app asks for a second admin.

**Gap (Planned):** replacing a member's passkey in one step, and accepting a member's backup passkey as an additional signer. Today a member signs only with their primary passkey.

## UC13. Spend limits, when a business asks (Planned, no new contract)

An admin adds OpenZeppelin's spending-limit policy to the operators' USDC rule with a limit and a period (for example 50,000 USDC per day). It is one admin transaction against a deployed contract, so it needs a screen, not a contract change or an audit. Limits are off at launch.

## UC14. Two-admin approval, when a business asks (Planned, no new contract)

The admins' rule already carries a threshold policy set to 1. Raising it to 2 is one `set_threshold` transaction. Then every admin action needs two passkeys, which needs a co-signing queue (the first admin's signature is kept, the second admin adds theirs before the expiry). The signing code already keeps existing signatures on a partly signed entry; the queue and screens are planned.

## Not available for business accounts yet

| Feature | Why | Behaviour |
| --- | --- | --- |
| Funding from other networks (CCTP) | Deposit addresses are per personal wallet | Refused with a clear message |
| Moving money between networks | Business accounts are Stellar only | Refused with a clear message |
| Request a quote | Offers are signed against a personal account | Refused with a clear message |
| Business verification (KYB) | Not built | The acting member's own verification applies |
