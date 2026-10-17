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

Set on the `blockfinax-testnet` service in Railway: `APP_ENV=testnet`, `NETWORK_MODE=testnet`, `VITE_NETWORK_MODE=testnet`, `BLOCKFINAX_ENV=testnet`, `DATABASE_URL`, `ADMIN_PASSWORD`, `PUBLIC_APP_URL`, `STELLAR_FEE_PAYER_SECRET`, `POOL_PRICING_SECRET`, `WALLET_PROVIDER=passkey`, `VITE_WALLET_PROVIDER=passkey`, `EVM_RELAYER_PRIVATE_KEY`.

Testnet uses the BlockFinaX passkey wallet instead of Rift. Users sign in with an email code (Resend, `RESEND_API_KEY`, `SMTP_FROM`) or Google (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, with `https://blockfinax-testnet-testnet.up.railway.app/api/auth/google/callback` registered as a redirect URI), then create a passkey that controls a Stellar smart account and a Base Sepolia smart account. The Base Sepolia relayer (`0x54733B449882558214641D7a00fbF9C546bbF60B`) pays gas for users' transactions and needs Base Sepolia ETH from a faucet.

The server refuses to start in testnet mode unless both network settings say `testnet`, so a testnet deployment can never point at mainnet. Database tables are created on each testnet deploy; production skips that step.

## Stellar testnet contracts

| Contract | Id |
| --- | --- |
| Currency pool | `CCPGYWP66LLG4VYTKHEVSPBTRLTCNWDZKA4KRM3VU7DD5BQFLKOA7SEF` |
| Pool oracle | `CCDSTO44FZQ4XKYYOFNDLK7SCYMIR643MNY6RX5GUIMIWXC6VR774IT7` |
| Test USDC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

Oracle policy: quorum 2 of 2, 1% tolerance, 900 s stale window, 300 s cooldown. Enabled pairs: USD/NGN, USD/GHS, USD/KES, USD/ZAR, USD/EGP.
