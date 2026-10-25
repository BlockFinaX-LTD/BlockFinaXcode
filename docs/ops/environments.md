# Environments: testnet and production

| | Testnet | Production |
| --- | --- | --- |
| Git branch | `testnet` | `main` |
| Railway environment | `testnet` (service `blockfinax-testnet`) | `production` (service `BlockFinaXcode`) |
| Address | https://blockfinax-testnet-testnet.up.railway.app | https://blockfinax.com |
| Money | Test tokens only | Real funds |
| Liquidity hub | Stellar testnet | Base |
| Database | Its own testnet Postgres | Production Postgres |
| Keys | Testnet-only keys, never shared with production | Production keys |
| Wallet | BlockFinaX passkey wallet (Stellar and Base Sepolia) | Rift |

## How a change reaches production

Step 1. Commit the change to the `testnet` branch and push. GitHub runs the CI check (tests and build), and Railway deploys it to testnet.

Step 2. Try it on the testnet address.

Step 3. Open a pull request from `testnet` into `main` on GitHub.

Step 4. When the checks are green, merge it. Railway deploys `main` to production.

`main` is protected: direct pushes are refused, a pull request must come from `testnet`, and the `verify` check must pass.

## Testnet settings

Set on the `blockfinax-testnet` service in Railway: `APP_ENV=testnet`, `NETWORK_MODE=testnet`, `VITE_NETWORK_MODE=testnet`, `BLOCKFINAX_ENV=testnet`, `DATABASE_URL`, `ADMIN_PASSWORD`, `PUBLIC_APP_URL`, `STELLAR_FEE_PAYER_SECRET`, `POOL_PRICING_SECRET`, `WALLET_PROVIDER=passkey`, `VITE_WALLET_PROVIDER=passkey`, `EVM_PAYMASTER_URL`, `STELLAR_RELAYER_URL`, `STELLAR_RELAYER_API_KEY`, `EVM_RELAYER_PRIVATE_KEY` (fallback).

Testnet uses the BlockFinaX passkey wallet instead of Rift. Users sign in with an email code (Resend, `RESEND_API_KEY`, `SMTP_FROM`) or Google (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, with `https://blockfinax-testnet-testnet.up.railway.app/api/auth/google/callback` registered as a redirect URI), then create a passkey that controls a Stellar smart account and a Base Sepolia smart account. Fees are paid by third-party sponsors, so users never hold gas tokens:

| Chain | Sponsor | Settings |
| --- | --- | --- |
| Base Sepolia | Coinbase Developer Platform paymaster and bundler (ERC-4337 v0.6, ERC-7677) | `EVM_PAYMASTER_URL` (the `base-sepolia` endpoint) |
| Stellar testnet | OpenZeppelin Relayer Channels | `STELLAR_RELAYER_URL`, `STELLAR_RELAYER_API_KEY` |

BlockFinaX's allowlist still runs before anything is sent to a sponsor. If a sponsor setting is missing, the server falls back to its own relayer: `EVM_RELAYER_PRIVATE_KEY` (`0x54733B449882558214641D7a00fbF9C546bbF60B`, needs Base Sepolia ETH) and `STELLAR_FEE_PAYER_SECRET`. Stellar wallet deployment always uses the fee payer.

Test USDC on Stellar: Circle's faucet cannot pay passkey (C) wallets, so testers use **Get 10 test USDC** in Receive. It pays from the BlockFinaX faucet account `GDDHDXGNMHSRPGP2GF6NJYGNZ22XYOR2PMWGF4TKZVFX6SHWQUUUEKI7` (`TESTNET_USDC_FAUCET_SECRET`), once per user per day. Refill it by sending Circle testnet USDC to that G address at https://faucet.circle.com, or, when Circle's daily limit is reached, by swapping the account's free test XLM for USDC on the Stellar testnet exchange (a path payment from XLM to `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`; 500 XLM bought about 443 USDC on 2026-10-17).

The server refuses to start in testnet mode unless both network settings say `testnet`, so a testnet deployment can never point at mainnet. Database tables are created on each testnet deploy; production skips that step.

## Stellar testnet contracts

| Contract | Id |
| --- | --- |
| Currency pool | `CC56AAARBPSBMOWEUFZGXR56HS5J5HBJMJRX6RZGG4NCJN3D2ID3MRZO` (one direction per pool, underwriter-set closest strike) |
| Pool oracle | `CBQ2J5YKMVN6DLUMHNT5LYRT5NKDDFRPYLMVYT3OTQ2YMMTYIFMVZ3OW` |
| Test USDC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

Oracle policy: quorum 2 of 2, 1% tolerance, 900 s stale window, 300 s cooldown. Enabled pairs: USD/NGN, USD/GHS, USD/KES, USD/ZAR, USD/EGP.
