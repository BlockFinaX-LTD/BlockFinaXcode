# BlockFinaX

A market for hedging foreign exchange risk in emerging markets. Underwriters set strike and expiry. Hedgers shop across the surface. Settlement is collateral backed and oracle paid.

This repo holds the application stack: the marketing site, the gated app, the API, the pricing engine, and the multi oracle workers. The smart contracts live in their own repo: [BlockFinaX-LTD/v1protocol](https://github.com/BlockFinaX-LTD/v1protocol).

## Layout

```
client/        React app (Vite), gated by Rift auth + private beta access gate
server/        Express backend, pricing engine, multi oracle workers, chain sync
shared/        Drizzle schema + types shared between client and server
scripts/       one off ops scripts, screenshots, e2e Playwright tests
docs/          internal docs (explainers, runbooks)
```

The contracts the server reads from are at https://github.com/BlockFinaX-LTD/v1protocol.

## Local development

```bash
# install
npm install

# configure
cp .env.example .env
# fill in DATABASE_URL, RESEND_API_KEY, GOOGLE_CLIENT_ID/SECRET, the Rift
# keys, the deployer + treasury private keys for the on-chain workers, etc.

# run (dev server with Vite middleware on http://localhost:5000)
npm run dev
```

`npm run dev` boots the Express server in development mode with the Vite middleware mounted. Database is on the `DATABASE_URL` you set in `.env`. The on chain workers (oracle nodes, chain sync) will start in the background and log to stdout.

## Build and start

```bash
npm run build   # vite build (client) + esbuild server/index.ts
npm start       # node dist/index.js
```

## Deployment

This repo auto deploys to Railway. The build runs `npm run build` plus an extra esbuild step that bundles the three oracle worker entries, then starts `node dist/index.js`. See `railway.json` and `nixpacks.toml` for the exact config.

Environment variables required in production:

- `DATABASE_URL` (Postgres on Railway)
- `ADMIN_PASSWORD`, `ADMIN_EMAILS`, `ADMIN_WALLET_ADDRESSES`
- `DEPLOYER_PRIVATE_KEY`, `TREASURY_POOL_PRIVATE_KEY`
- `RESEND_API_KEY`, `SMTP_FROM`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `VITE_RIFT_PUBLIC_KEY` (publishable browser key, `pk_…`; never place a secret key in a `VITE_` variable)
- `RIFT_SECRET_KEY` (server-only Rift key)
- `PUBLIC_APP_URL` (canonical HTTPS origin used for authentication links and WebAuthn)
- `DOCS_BYPASS_KEY` for the docs gate shared key
- `NETWORK_MODE=mainnet` for prod

Startup fails fast if any required production env var is missing.

## Useful scripts

```bash
npm run check                # tsc
npm run db:push              # drizzle push
npm run pricing:test         # pricing engine unit tests
npm run pricing:bootstrap    # backfill the historical_fx_closes table
```

The Playwright e2e suites in `scripts/` cover the gating flows (`test-docs-bypass.py`, `test-invited-user.py`) and the landing CTAs (`test-landing-ctas.py`).

## Where the contracts live

See [BlockFinaX-LTD/v1protocol](https://github.com/BlockFinaX-LTD/v1protocol) for the on chain code. The server reads the Diamond via hand maintained ABI fragments in `server/`, so if you change a facet's external interface, the matching ABI fragment here needs to update.

## Stellar wallet

The Stellar testnet wallet is in [blockfinax-stellar-wallet/](blockfinax-stellar-wallet/README.md). It includes Google/email-code sign-in, passkey smart accounts, test funding and payments.

Use Node 22.18 or newer:

```sh
cd blockfinax-stellar-wallet
npm ci
npm run setup:testnet
# Configure Resend and Google in this folder’s ignored .env.
npm run dev
```

Open http://localhost:5173. The wallet API runs on port 4100 with its own environment and local database. Its tests and build run in a separate GitHub workflow.
