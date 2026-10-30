# Mainnet readiness

Target: limited mainnet on Stellar by 26 February 2027 (invited businesses and underwriters, low limits), then open. Real money moves only after every item marked **Blocker** is done.

Last updated: 30 October 2026.

The full security checklist (contracts, keys, oracle, wallets, server, team devices) is kept in the admin dashboard under **Security checks**, not in this public repository. Every blocker there must be closed too.

## Decisions needed first (contract freeze)

The audit can only start on frozen contract code. Decide:

| Decision | Options | Status |
|---|---|---|
| Open cover | Remove (one product: the buyer picks a limit up to the pool's maximum) or keep | Open |
| Underwriter duration ranges and pool take-over | Include in the audited contract or leave out | Built and tested, not deployed |
| Per-underwriter maximum payout and payout layers | Later version or now | Designed, not built |
| Partner fee in the contract | Needed for partner launch or later | Not built |

## Readiness

| Item | Kind | Status | Notes |
|---|---|---|---|
| Mainnet network settings | Build | **Done** | `config/chains/mainnet.json`: Stellar hub, Circle USDC `CCW67…MI75`, CCTP domain 27; Base mainnet for funding (CCTP domain 6). Trading stays off until `STELLAR_CURRENCY_POOL`, `STELLAR_POOL_ORACLE` and `STELLAR_RPC_URL` are set. |
| Verification enforced at purchase and deposit | Build | **Done** | On mainnet, buying, creating a pool and depositing check the verification tier against money moved and possible payout (policy §3.1). Testnet does not enforce; `REQUIRE_VERIFICATION=true` turns it on for testing. |
| Verification form in the app | Build | **Done** | Opens on Review protection when needed. Basic and Verified are submitted in the app; Enhanced goes to the team. Reviewed in the admin dashboard. |
| Deposits counted in money moved | Build | To do | Today the 30-day total counts protection premiums and the current deposit, not earlier deposits. |
| Wallet checks in the app | Build | **Done** | Before showing deposit addresses the app checks, from the chain and its own built-in network settings, that the Stellar wallet runs the pinned Passkey Kit code (`shared/wallet-trust.ts`), that the passkey is its signer with the key it signs with, and that the Base account and deposit addresses are the ones that key and wallet create. For mainnet, build the app with `VITE_STELLAR_RPC_URL` set (mainnet has no public RPC in `config/chains/mainnet.json`), and if the wallet code is ever changed, update `PASSKEY_WALLET_WASM_HASH` in the same release. |
| Mainnet Stellar RPC provider | Setup | To do | Choose a paid RPC provider; set `STELLAR_RPC_URL`. |
| Passkey wallet on mainnet | Setup | To do | Deploy the Passkey Kit wallet contract on mainnet, check its hash, set the relayer and fee-sponsor accounts with spending limits. |
| Contract freeze | Decision | To do | See above. |
| Independent security audit | **Blocker** | To do | Pool, oracle and deposit contracts. Unresolved critical or high findings block launch. Ask SCF Audit Bank. Allow 4 to 8 weeks with fixes. |
| New keys, never on a laptop | **Blocker** | To do | All testnet keys were exposed in September. Mainnet owner, oracle, pricing and relayer keys must be new, held in hardware or a managed key service. |
| Multisig ownership and upgrade delay | **Blocker** | To do | Several people approve contract changes; upgrades wait a public delay so users can exit first. |
| Independent rate operators | **Blocker** | To do | At least two operators that BlockFinaX does not control, with independent data sources. |
| Monitoring and runbooks | **Blocker** | To do | Alerts on reserves, claims, privileged changes, oracle freshness, settlement failures and fee-sponsor spend; tested responses. |
| Legal check per country | **Blocker** | To do | Whether selling protection in Ghana and Nigeria needs a licence or a licensed partner (see the regulatory analysis). |
| Privacy policy and terms | Review | Started | Privacy §9 now describes the passkey wallet; legal review needed. Terms to check against mainnet. |
| Launch limits | Setup | To do | Per-contract and per-user caps for the limited phase; invited users only. |
| Payout at the fixing rate | Build | To do | Agreed: the payout converts at the fixing rate (divide by R), the market standard; pricing already assumes it. Contract, server and app. |
| Official fixing sources at 12:00 UTC | Build | To do | Agreed: expiry and settlement at 12:00 UTC against the official fixing (GHS: Refinitiv WMR; NGN: FMDQ NAFEX). |
| Business-day rule | Build | To do | Agreed: use the latest official fixing on or before expiry, at most 3 business days old. |
| 14-day disruption fallback | Build | To do | Agreed: `FALLBACK_DELAY` from 7 to 14 days, matching EMTA valuation postponement. |
| Connector portal | Build | **Done** | `connector.blockfinax.com`: applications, typed-name signatures, training, prospect registration, referral links, rewards ledger, contractor engagements. Admin: Connectors section. |
| Connector and contractor agreements | **Blocker** | To do | Counsel to review CA 1.0 and ICA 1.0 (`shared/connector-programme.ts`). Then set `CONNECTOR_AGREEMENT_APPROVED=true` on mainnet; until then mainnet signing stays closed. Any text change needs a new version number. |
| Connector portal domain | Setup | To do | Add `connector.blockfinax.com` as a custom domain on the app service (DNS CNAME to Railway); set `CONNECTOR_PORTAL_URL` and add the origin to `PASSKEY_RELATED_ORIGINS`. |
| Passkey domain `blockfinax.com` | Setup | To do | Set `PASSKEY_RP_ID=blockfinax.com` so one passkey works on the app and the connector portal. Changing it later invalidates existing passkeys, so set it before launch. |

## At deployment

1. Deploy the audited contracts with the multisig as owner; record contract IDs and code hashes.
2. Set `BLOCKFINAX_ENV=mainnet`, `STELLAR_CURRENCY_POOL`, `STELLAR_POOL_ORACLE`, `STELLAR_RPC_URL` and the new key settings on the mainnet service.
3. Publish contract IDs and hashes in the docs (Networks and assets, Upgrades: Mainnet).
4. Point the app's Mainnet switch to the mainnet app (`client/src/lib/app-links.ts`) instead of the sales form.
