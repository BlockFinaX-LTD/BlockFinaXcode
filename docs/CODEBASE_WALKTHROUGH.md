# BlockFinaX — Codebase Walkthrough

A practical map of the repository for new contributors. Read this top-to-bottom and you should be able to navigate any file in the project.

---

## 1. What BlockFinaX Does

BlockFinaX is a **multi-chain, parametric FX-protection marketplace**. Users create or buy *hedge events* tied to currency pairs (typically emerging-market FX such as USD/GHS or USD/NGN), liquidity providers (LPs) deposit USDC into a pool, and hedgers buy protection that pays out if the FX rate touches a strike at expiry.

Three roles, one product:

| Role | Pays | Earns |
|------|------|-------|
| **Creator** | Initial liquidity + creation fee | Loyalty share of platform fees |
| **LP** | USDC deposit | Pro-rata premiums (MasterChef-style accumulator) |
| **Hedger** | Premium + platform fee | Payout if strike is touched at settlement |

Settlement uses either a single oracle admin (legacy) or an N-of-M oracle consensus quorum (`OracleFacet`).

---

## 2. Repository Layout

```
BlockFinaxcode-merge/
├── contracts/        Solidity sources, deployment artifacts, Hardhat scripts
├── server/           Express + TypeScript backend (auth, pricing, protocol, admin)
├── client/           Vite + React 18 + Tailwind frontend
├── shared/           Drizzle schema + types shared by server & client
├── docs/             Architecture notes, pricing model, upgrade logs
├── scripts/          Repo-wide tooling
├── main.py           Python helper (see pyproject.toml / uv.lock)
├── drizzle.config.ts
├── vite.config.ts
└── package.json
```

The whole stack speaks **TypeScript** end-to-end except the Solidity contracts (and a small Python helper for ad-hoc analysis).

---

## 3. Smart Contracts — `contracts/`

### 3.1 Architecture: EIP-2535 Diamond

A single proxy (`Diamond.sol`) routes every external call to a registered *facet* via `delegatecall`. State lives in named storage libraries — never in the facets — so facets can be swapped without losing data.

```
Diamond (proxy)
├── BlockFinaXHedgeFacet            ← core domain logic (~1,800 LoC)
├── BlockFinaXOracleFacet           ← multi-signer settlement consensus
├── BlockFinaXDiamondCutFacet       ← standard EIP-2535 upgrade
├── BlockFinaXTimelockCutFacet      ← 48h-timelocked upgrade (production)
└── BlockFinaXOwnershipFacet        ← two-step ownership transfer
```

Storage is partitioned across three libraries:

- [`LibAppStorage`](../contracts/src/libraries/LibAppStorage.sol) — hedge events, positions, LP deposits, fees, pause flag, pricing-engine signer (v8).
- [`LibOracleStorage`](../contracts/src/libraries/LibOracleStorage.sol) — oracle registry, quorum config, per-event price submissions.
- [`LibDiamond`](../contracts/src/libraries/LibDiamond.sol) — selector→facet routing, ERC-165 flags, owner / pendingOwner.

### 3.2 HedgeFacet — Core Lifecycle

[`contracts/src/facets/BlockFinaXHedgeFacet.sol`](../contracts/src/facets/BlockFinaXHedgeFacet.sol)

| Function | Line | Purpose |
|---|---|---|
| `createEvent` | 808 | Creator opens an event; v8 verifies an ECDSA-signed pricing quote |
| `deposit` | 1186 | LP funds the pool, receives shares |
| `buyProtection` | 1290 | Hedger pays premium + fee, gets `positionId` |
| `settleEvent` | 1412 | Single-key oracle admin posts settlement price |
| `claimPayout` | 1546 | Winning hedger withdraws (minus payout fee) |
| `claimPremiums` | 1631 | LP claims accrued premiums (lazy MasterChef accumulator) |
| `withdrawCapital` | 1707 | LP withdraws principal post-settlement (uses snapshot) |

Notable invariants:

- **Reentrancy lock** — single boolean in `AppStorage`, shared across facets.
- **Pause** — emergency switch blocks user actions but not settlement.
- **`activateOracleV2()`** — *one-way* flag; once set, `settleEvent` is permanently disabled in favor of the OracleFacet quorum.
- **Range payouts (v7)** — `payoutCap` enables call/put-spread geometry, not just digital all-or-nothing.
- **Pricing attestation (v8)** — `pricingEngineSigner` + `usedQuoteNonces` block premium manipulation.

### 3.3 OracleFacet — Decentralized Settlement

[`contracts/src/facets/BlockFinaXOracleFacet.sol`](../contracts/src/facets/BlockFinaXOracleFacet.sol)

Up to 10 oracles register via `addOracle()`. Each calls `submitRate(eventId, price)`. On every submission, `_checkConsensus()`:

1. Drops stale submissions (>15 min old).
2. If we have ≥ `requiredSigners` fresh submissions and `(max−min)/min ≤ toleranceBps`, averages the prices and settles.
3. If the spread is too wide, clears submissions; oracles must resubmit.

A 5-minute per-oracle resubmit cooldown and `clearStaleSubmissions()` admin escape hatch round it out.

### 3.4 Deployments

JSON address books live in [`contracts/deployments/`](../contracts/deployments/) — one per chain (Lisk, Lisk Sepolia, Base, BSC, plus `_archive/`). Each file lists the diamond address, every facet address, and the configured fee schedule.

Production diamond addresses (for quick reference):

| Chain | Diamond |
|-------|---------|
| Base Mainnet | `0xbCC51E62C4948FD35ab505bd71804C849601e4Ef` |
| BSC Mainnet  | `0xaC939C0897981Abc0711ec4e37527F13106180fc` |
| Lisk Mainnet | `0x69cB5BA093e44B345B617f72a148Ee43c4a18465` |

Hardhat scripts under [`contracts/scripts/`](../contracts/scripts/) cover fresh deploys, facet upgrades, oracle registration, signer rotation, and Safe (multi-sig) integration. Outstanding ops work — pending ownership accepts, oracle-V2 activations, audit deploys — is tracked in [`TODO.md`](../TODO.md).

---

## 4. Backend — `server/`

### 4.1 Entry Point

[`server/index.ts`](../server/index.ts) wires up Express:

1. **Helmet + CSP** with allowlists for Lisk, Base, BSC RPCs (lines 30–75).
2. **JSON parser** capped at 1 MB.
3. **Request logger** that captures status + duration on `/api/*`.
4. **Rate limiters** (in-memory token bucket).
5. **Startup tasks**: DB init → on-chain oracle node registration → multi-oracle daemon → chain-sync → daily pricing refresh → hourly hedge-expiry sweep.
6. **`registerRoutes(app)`** — all REST routes mounted from [`server/routes.ts`](../server/routes.ts).
7. Vite dev middleware in development; static dist in production.

A **WebSocket server** at `/ws` provides wallet-scoped pub/sub. Clients send `{type:"authenticate", walletAddress}`, the server stores the mapping in `connectedClients`, and pushes hedge/event updates as they occur.

### 4.2 Route Map

| Mount | Module | Notes |
|---|---|---|
| `/api/auth/*` | [`auth-routes.ts`](../server/auth-routes.ts) | Magic links (Resend), Google OAuth, WebAuthn |
| `/api/wallets/*` | [`routes/wallet.ts`](../server/routes/wallet.ts) | Wallet CRUD, session attach |
| `/api/pricing/*` | [`routes/pricing.ts`](../server/routes/pricing.ts) | Quote endpoint + health |
| `/api/protocol/*` | [`routes/protocol.ts`](../server/routes/protocol.ts) | Gas/fees, prices, FX, hedge lifecycle |
| `/api/kyc/*` | [`routes/kyc.ts`](../server/routes/kyc.ts) | Provider session, redirect URL |
| `/api/admin/*` | [`routes/admin.ts`](../server/routes/admin.ts) | Token-gated dashboard, KYC review |
| `/api/investor/*` | [`routes/investor.ts`](../server/routes/investor.ts) | Data room, file uploads (multer) |
| `/api/community/*` | [`routes/community.ts`](../server/routes/community.ts) | Tasks, leaderboard, referrals |

Write operations against `/api/hedge/*` go through [`middleware/signature-auth.ts`](../server/middleware/signature-auth.ts) — clients sign a timestamped message with their wallet (EIP-191) and the server recovers the address with `ethers.verifyMessage()` (5-minute max age).

### 4.3 Pricing Engine — `server/pricing/`

This is the analytically sharpest part of the codebase. Premiums use **Garman–Kohlhagen** (FX option pricing) with empirical drift correction for emerging-market pairs.

**Kernel** — [`pricing/kernel.ts`](../server/pricing/kernel.ts)
- Pure math: `normalCDF`, `garmanKohlhagenCall`, `callSpreadValue`, `putSpreadValue`.
- `GKInputs`: `S` (spot), `K` (strike), `T` (years), `r` (risk-free), `q = r − μ` (cost of carry, EM correction), `sigma`.

**Data layer** — [`pricing/data/`](../server/pricing/data/)
- [`yahoo.ts`](../server/pricing/data/yahoo.ts) — 5y daily closes from `query1.finance.yahoo.com`. Default source for FX, crypto, gold, commodities (no API key, no rate limits).
- [`twelvedata.ts`](../server/pricing/data/twelvedata.ts) — optional fallback (free tier doesn't cover frontier-EM FX).
- [`drift.ts`](../server/pricing/data/drift.ts) — empirical 5y log-return drift, capped at ±50%/yr.
- [`vol.ts`](../server/pricing/data/vol.ts) — EWMA σ (λ=0.94) annualized over √252, with per-tier floors (pegged 30%, frontierEM 15%) and global clamps.
- [`classification.ts`](../server/pricing/data/classification.ts) — per-pair governance (`useEmpiricalDrift`, tier).
- [`historical.ts`](../server/pricing/data/historical.ts) — DB layer (`historical_fx_closes` table).

**Quote orchestrator** — [`pricing/quote.ts`](../server/pricing/quote.ts)
- Public route at `POST /api/pricing/quote`.
- Returns `premiumRate`, `premiumUsd`, `maxPayoutUsd`, `premiumRateFixed6` (1e6 fixed-point for on-chain), and a v8 `attestation` if `PRICING_ENGINE_PRIVATE_KEY` is set and the call includes `chainId`/`diamondAddress`/`creator`.
- Hard cap `MAX_LEVERAGE_RATIO = 100` (max payout / premium) — anything above is rejected as a model failure.

**Daily refresh** — [`pricing/dailyRefresh.ts`](../server/pricing/dailyRefresh.ts) — cron pulls yesterday's close per pair; idempotent.

**Scripts** under [`pricing/scripts/`](../server/pricing/scripts/):
- `bootstrap.ts` — seed registry + 5y backfill + smoke test.
- `apply-pricing-tables.ts` — idempotent SQL migration.
- `scan-onchain-pairs.ts` / `scan-onchain-everything.ts` — pull live pair lists from chain.

### 4.4 Database — Drizzle + Postgres

Schema is in [`shared/schema.ts`](../shared/schema.ts). Key tables:

- **Identity**: `userAccounts`, `authSessions`, `webauthnCredentials`, `userProfiles` (KYC).
- **Wallets**: `wallets`, `networks`.
- **Hedge mirror**: `hedgeEvents`, `hedgePositions`, `hedgeLpDeposits` (off-chain mirror of on-chain state, populated by [`chain-sync.ts`](../server/chain-sync.ts)).
- **Pricing**: `historicalFxCloses`, `pairClassification`.
- **Gamification**: `userPoints`, `pointTransactions`, `referralCodes`, `referrals`.

[`server/db.ts`](../server/db.ts) auto-selects the driver: `@neondatabase/serverless` for Neon hosts, plain `pg` for everything else (Railway, RDS, local).

### 4.5 Auth

Four flows in [`server/auth-routes.ts`](../server/auth-routes.ts):

1. **Magic link** — 32-byte token, SHA-256 hashed at rest, 30-min expiry, 3-per-15-min rate limit, delivered via Resend.
2. **Google OAuth** — ID-token verification through `google-auth-library`.
3. **WebAuthn / passkeys** — `@simplewebauthn/server`; counter checks for cloned authenticators.
4. **Session/wallet bind** — links a wallet address to an existing session token.

Sessions arrive via `Authorization: Bearer …` or `X-Session-Token`.

### 4.6 Notable Services

- **On-chain readers** — [`chain-sync.ts`](../server/chain-sync.ts), [`fx-oracle.ts`](../server/fx-oracle.ts), [`hedge-reader.ts`](../server/hedge-reader.ts) using ethers v6 with multi-RPC fallback.
- **KYC** — [`kyc-provider.ts`](../server/kyc-provider.ts) provider abstraction.
- **Uploads** — multer disk storage at `server/uploads/compliance` (20 MB limit, document MIME types only).
- **Price aggregator** — [`routes/protocol.ts`](../server/routes/protocol.ts) lines 42–80 fall through OKX → MEXC → CryptoCompare → Kraken → CoinGecko with a 5-minute cache.

---

## 5. Frontend — `client/`

### 5.1 Stack

- **React 18** + **Vite 5** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** on Radix primitives
- **wouter** for routing
- **TanStack Query 5** for server state
- **react-hook-form** + **zod** for forms
- **viem 2** + **ethers 6** for chain calls
- **@rift-finance/wallet** for wallet auth + gasless tx
- **@simplewebauthn/browser** for passkeys
- **framer-motion**, **recharts**, **lucide-react**, **date-fns**, **decimal.js**

There is no Redux/Zustand store — global state lives in TanStack Query caches plus a small `wallet-context.tsx` provider.

### 5.2 Routing

[`client/src/App.tsx`](../client/src/App.tsx) defines routes via wouter `<Switch>`. An `AuthGuard` component (lines 54–62) redirects unauthenticated users on protected routes to `/auth`.

| Path | Notes |
|------|-------|
| `/` | Marketing site |
| `/pitch`, `/whitepaper`, `/data-room`, `/terms`, `/privacy` | Public collateral |
| `/auth` | Rift signup/login (email+OTP, phone+OTP, username+password) |
| `/home` | Dashboard *(protected)* |
| `/hedge` | Main hedging UI *(protected)* |
| `/wallet` | Deposit/send/history *(protected)* |
| `/profile` | KYC form *(protected)* |
| `/tasks`, `/rewards` | Gamification *(protected)* |
| `/admin` | Token-gated admin dashboard |
| `/financial-model` | Spreadsheet builder |
| `/video` | Internal scenes |

### 5.3 Component Layout

```
client/src/
├── App.tsx, main.tsx, index.css
├── components/
│   ├── ui/                shadcn primitives (40+ files)
│   ├── wallet/            tx-auth-dialog, rift-send-modal, send-modal, history-card …
│   ├── profile/           profile-settings.tsx
│   ├── video/             scene components (framer-motion)
│   ├── app-header.tsx     desktop nav
│   ├── bottom-nav.tsx     mobile nav
│   └── terms-gate.tsx     terms acceptance
├── pages/                 one file per route (hedge.tsx is ~2.5k LoC)
├── hooks/                 use-wallet, use-rift-balances, use-transactions, use-auth …
├── contexts/              wallet-context.tsx
├── lib/
│   ├── api-client.ts      TanStack Query setup + apiRequest()
│   ├── hedge-contract.ts  Diamond ABIs, addresses, write helpers
│   ├── rift-client.ts     Rift SDK singleton + signup/login/getMe
│   ├── wallet.ts          read-only WalletManager shim
│   ├── tx-auth.ts         5-min OTP/password cache for repeated tx signing
│   ├── networks.ts, tokens.ts
└── assets/
```

### 5.4 Web3 Flow

1. **Auth** — Rift Finance SDK login → bearer token in `localStorage`.
2. **Wallet state** — `use-wallet.ts` calls `rift.getMe()` for address + balances.
3. **Reads** — TanStack Query hits the backend mirror (`/api/protocol/*`).
4. **Writes** — two paths:
   - **Gasless via Rift** — `rift.signer.sendTransaction()` (Rift relays + sponsors gas).
   - **Direct via ethers** — used by `send-modal.tsx` when the user wants raw on-chain calls; requires USDC approve + signature.
5. **Tx auth** — `requestTxAuth()` opens a dialog, prompts for OTP/password, caches the result for 5 minutes so users aren't re-prompted on every contract call.

The single most important file is [`client/src/lib/hedge-contract.ts`](../client/src/lib/hedge-contract.ts) — it pins the per-chain Diamond addresses, exports the ABIs, and wraps every write the frontend issues (`createHedgeEvent`, `buyProtection`, `depositLiquidity`, `claimPayout`, `withdrawLiquidity`, `settleEvent`, …).

### 5.5 Backend Talk

[`api-client.ts`](../client/src/lib/api-client.ts) configures TanStack Query with `staleTime: Infinity`, `refetchInterval: false`, `retry: false` and exposes:

- `apiRequest(method, url, body?)` — fetch wrapper with credentials + structured error.
- `getQueryFn({ on401: 'throw' | 'returnNull' })` — query factory.

Admin and investor routes attach an extra `x-admin-token` / `x-investor-token` header for gating.

### 5.6 Styling

- **Tailwind 3** with HSL CSS variables (primary `217 91% 60%`, navy `213 50% 20%`, success/warning/destructive).
- **Dark mode** via `next-themes` + `.dark` class.
- Custom utilities (`.wallet-gradient`, `.brand-gradient`, `.btn-primary-gradient`, `.stat-card`).
- Inter font with stylistic feature settings; tight tracking on headings.
- Animations are mostly Tailwind keyframes; framer-motion only on terms-gate and the marketing video.

---

## 6. Cross-Cutting Concerns

### 6.1 Shared Schema

[`shared/schema.ts`](../shared/schema.ts) is imported by both server and client (via `tsconfig` paths) so the two stay in lock-step on entity shapes. Drizzle-Zod auto-generates the validators consumed by react-hook-form on the frontend and by Express handlers on the backend.

### 6.2 Chain ↔ DB Sync

[`server/chain-sync.ts`](../server/chain-sync.ts) subscribes to Diamond events (`HedgeEventCreated`, `ProtectionPurchased`, `EventSettled`, `PayoutClaimed`, …) and mirrors them into Postgres. The frontend reads the mirror — never the chain directly — for list views and dashboards. Direct on-chain reads happen only when the user lands on a single hedge detail page.

### 6.3 Pricing-Engine Attestation (v8)

End-to-end:

1. Frontend hits `/api/pricing/quote`.
2. Backend computes the premium and signs `(eventId, premiumRateFixed6, deadline, nonce, chainId, diamondAddress, creator)` with `PRICING_ENGINE_PRIVATE_KEY`.
3. Frontend calls `createEvent(...)` with the attestation.
4. HedgeFacet recovers the signer, checks it matches `pricingEngineSigner`, and rejects reused nonces.

This closes the loop on premium manipulation: the on-chain contract trusts only quotes signed by the off-chain pricing service.

### 6.4 Multi-Chain Awareness

Every layer is chain-aware:

- **Contracts** — independent diamond per chain, deployed identically.
- **Backend** — `LISK_RPC_URL`, `BASE_RPC_URL`, `BSC_RPC_URL` envs; multi-RPC fallback in `chain-sync.ts`.
- **Frontend** — `CHAIN_DIAMOND_MAP` in `hedge-contract.ts` selects the right diamond per `chainId`.

---

## 7. Running It Locally

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# fill in DATABASE_URL, PRICING_ENGINE_PRIVATE_KEY, RPC URLs, etc.

# 3. Migrations + pricing data
npm run db:push
npm run pricing:bootstrap

# 4. Dev server (Vite + Express on the same port)
npm run dev

# 5. Tests
npm run pricing:test
npm run check          # tsc
```

Build for production:

```bash
npm run build && npm start
```

Deployment manifest: [`railway.json`](../railway.json) and [`nixpacks.toml`](../nixpacks.toml).

---

## 8. Where to Look First

| If you want to… | Open |
|---|---|
| Understand the on-chain product | [`contracts/src/facets/BlockFinaXHedgeFacet.sol`](../contracts/src/facets/BlockFinaXHedgeFacet.sol) |
| Trace a quote end-to-end | [`server/pricing/quote.ts`](../server/pricing/quote.ts) → [`server/pricing/kernel.ts`](../server/pricing/kernel.ts) |
| Add a hedge UI feature | [`client/src/pages/hedge.tsx`](../client/src/pages/hedge.tsx) |
| Wire a new contract call | [`client/src/lib/hedge-contract.ts`](../client/src/lib/hedge-contract.ts) |
| Add an API route | [`server/routes.ts`](../server/routes.ts) + a module under `server/routes/` |
| Touch the DB schema | [`shared/schema.ts`](../shared/schema.ts) → `npm run db:push` |
| See pending production work | [`TODO.md`](../TODO.md) |
| Read deeper docs | [`docs/architecture/`](architecture/), [`docs/pricing/`](pricing/), [`docs/upgrades/`](upgrades/) |

---

*Walkthrough generated 2026-05-08. Verify on-chain state and deployment JSONs before acting on anything in §3.4.*
