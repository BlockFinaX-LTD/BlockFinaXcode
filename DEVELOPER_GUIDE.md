# BlockFinaX Developer Guide

A complete guide for setting up, understanding, and contributing to the BlockFinaX platform. This document covers the full stack: frontend, backend, smart contracts, and deployment.

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Architecture](#2-architecture)
3. [Project Structure](#3-project-structure)
4. [Environment Setup](#4-environment-setup)
5. [Database](#5-database)
6. [Backend (Express Server)](#6-backend-express-server)
7. [Frontend (React)](#7-frontend-react)
8. [Smart Contracts (Solidity)](#8-smart-contracts-solidity)
9. [FX Oracle](#9-fx-oracle)
10. [Wallet System](#10-wallet-system)
11. [Hedge System (P2P One-Touch Options)](#11-hedge-system-p2p-one-touch-options)
12. [Tasks & Rewards System](#12-tasks--rewards-system)
13. [Admin Dashboard](#13-admin-dashboard)
14. [Security](#14-security)
15. [Deployment](#15-deployment)
16. [Common Tasks for New Developers](#16-common-tasks-for-new-developers)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. Platform Overview

BlockFinaX is a blockchain-based platform with two core products:

- **Wallet** — Cross-border stablecoin (USDC) payments on Lisk Sepolia
- **Hedge** — P2P one-touch FX protection marketplace (on-chain via smart contracts)

Supporting features include a daily tasks/rewards system, admin dashboard, FX oracle, and educational content (pitch deck, whitepaper, insights).

### Business Model
- 0.3% transaction fee (min $0.50) on all wallet USDC transfers
- Hedge fees: $25 event creation, 0.5% hedger fee, 1% payout fee, 1% LP fee, 5% creator loyalty

### Blockchain
- **Network**: Lisk Sepolia (chainId 4202) — the ONLY supported network
- **USDC Contract**: `0xf52Ad63619Bf9cFeF510341ac6b4038554399562`
- **Diamond Contract**: `0x7e2322f7cE4C80fE9a030444de8037Cc3f984F9C`
- **Block Explorer**: https://sepolia-blockscout.lisk.com

---

## 2. Architecture

```
                     +----------------+
                     |   Landing Page |
                     |   (website.tsx)|
                     +-------+--------+
                             |
              +--------------+--------------+
              |                             |
    +---------v----------+       +----------v---------+
    |   Wallet (USDC)    |       |   Hedge (On-Chain)  |
    |  Backend API calls |       | Direct contract calls|
    +----+----------+----+       +----+----------+-----+
         |          |                 |          |
    +----v----+ +---v-----+    +-----v----+ +---v-----------+
    | Express | |PostgreSQL|    | Lisk     | | Diamond       |
    | Server  | |  (Neon)  |    | Sepolia  | | Smart Contract|
    +---------+ +----------+    | RPC      | | (EIP-2535)    |
                                +----------+ +---------------+
```

**Key architectural decisions:**
- Wallet operations go through the backend (Express API) for transaction recording and fee management
- Hedge operations go directly from the frontend to the smart contract on-chain (bypassing the backend)
- The FX oracle runs on the backend, polling exchange rates every 5 minutes and auto-settling hedge events
- The backend only provides FX rates (`/api/fx/rates`) to the hedge UI — all other hedge logic is on-chain

---

## 3. Project Structure

```
blockfinax/
├── client/                          # Frontend (React + Vite)
│   └── src/
│       ├── pages/                   # Route pages
│       │   ├── website.tsx          # Landing page
│       │   ├── home.tsx             # Dashboard after login
│       │   ├── wallet.tsx           # Wallet management
│       │   ├── hedge.tsx            # Hedge marketplace (main product)
│       │   ├── create-wallet.tsx    # New wallet creation
│       │   ├── import-wallet.tsx    # Import existing wallet
│       │   ├── unlock-wallet.tsx    # Unlock encrypted wallet
│       │   ├── tasks.tsx            # Daily tasks for points
│       │   ├── profile.tsx          # User profile
│       │   ├── faucet.tsx           # Test USDC faucet
│       │   ├── admin-dashboard.tsx  # Admin panel
│       │   ├── pitch-deck.tsx       # Investor pitch deck
│       │   ├── whitepaper.tsx       # Technical whitepaper
│       │   ├── insights.tsx         # Educational articles
│       │   ├── waitlist.tsx         # Early adopter signup
│       │   └── rewards-referrals.tsx # Referral program
│       ├── components/
│       │   ├── ui/                  # shadcn/ui primitives
│       │   ├── hedge/               # Hedge-specific components
│       │   ├── wallet/              # Wallet-specific components
│       │   ├── admin/               # Admin components
│       │   ├── profile/             # Profile components
│       │   ├── app-header.tsx       # Top navigation bar
│       │   └── bottom-nav.tsx       # Mobile bottom navigation
│       ├── lib/
│       │   ├── hedge-contract.ts    # Smart contract interaction (ethers.js)
│       │   ├── api-client.ts        # Backend API client (TanStack Query)
│       │   ├── wallet.ts            # Wallet encryption/decryption
│       │   └── price-service.ts     # Price feed utilities
│       ├── hooks/
│       │   └── use-wallet.ts        # Wallet state management hook
│       ├── contexts/
│       │   └── wallet-context.tsx   # Wallet React context
│       └── App.tsx                  # Router and app entry point
│
├── server/                          # Backend (Express.js)
│   ├── index.ts                     # Server entry point
│   ├── routes.ts                    # All API route handlers
│   ├── storage.ts                   # Data access layer (IStorage interface)
│   ├── db.ts                        # Database connection (Drizzle + Neon)
│   ├── init-db.ts                   # Database seeding
│   ├── fx-oracle.ts                 # FX rate polling + auto-settlement
│   ├── treasury-wallet.ts          # Treasury wallet management
│   ├── payment-verifier.ts          # On-chain payment verification
│   └── middleware/
│       ├── signature-auth.ts        # EIP-191 signature verification
│       └── rate-limiter.ts          # Tiered API rate limiting
│
├── shared/                          # Shared between frontend + backend
│   ├── schema.ts                    # Database table definitions (Drizzle ORM)
│   ├── profile-schema.ts           # User profile tables
│   ├── referral-schema.ts          # Referral + points tables
│   └── whitepaper-content.ts       # Static whitepaper content
│
├── contracts/                       # Smart contracts (Hardhat + Solidity)
│   ├── src/
│   │   ├── Diamond.sol              # Main Diamond proxy contract
│   │   ├── facets/
│   │   │   ├── BlockFinaXDiamondCutFacet.sol   # Upgrade mechanism
│   │   │   ├── BlockFinaXDiamondLoupeFacet.sol  # Contract inspection
│   │   │   └── BlockFinaXHedgeFacet.sol         # Hedge marketplace logic
│   │   ├── interfaces/
│   │   │   ├── IDiamondCut.sol
│   │   │   └── IDiamondLoupe.sol
│   │   └── libraries/
│   │       ├── LibAppStorage.sol    # Shared storage layout
│   │       └── LibDiamond.sol       # Diamond standard helpers
│   ├── scripts/
│   │   ├── deploy-diamond.js        # Full deployment script
│   │   └── upgrade-hedge-facet.js   # Facet upgrade script
│   ├── hardhat.config.js            # Hardhat configuration
│   └── deployments-diamond-liskSepolia.json  # Deployment addresses
│
├── scripts/                         # Utility scripts
│   ├── setup-hedge-contract.ts      # Initialize hedge fees on-chain
│   ├── seed-articles.ts             # Seed database with articles
│   ├── deploy-test-usdc.mjs         # Deploy test USDC token
│   └── update-usdc-token.mjs        # Update USDC address in contracts
│
├── HEDGE_DEVELOPER_NOTES.md         # Detailed hedge system documentation
├── DEVELOPER_GUIDE.md               # This file
├── replit.md                        # Project config and context
├── drizzle.config.ts                # Drizzle ORM migration config
├── package.json                     # Root dependencies
├── tailwind.config.ts               # Tailwind CSS config
├── vite.config.ts                   # Vite build config
└── tsconfig.json                    # TypeScript config
```

---

## 4. Environment Setup

### Prerequisites
- Node.js 20+
- PostgreSQL database (Neon recommended)
- A funded Lisk Sepolia wallet (for deploying contracts and gas sponsoring)

### Environment Variables

Create a `.env` file in the root directory:

```env
# Database (required)
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Blockchain (required)
DEPLOYER_PRIVATE_KEY=0x...        # Wallet private key for contract deployment and oracle
TREASURY_POOL_PRIVATE_KEY=0x...   # Treasury wallet for fee collection and gas sponsoring

# Admin (required)
ADMIN_PASSWORD=your_admin_password

# Network (optional, defaults to testnet)
NETWORK_MODE=testnet              # testnet or mainnet

# Block explorer API (optional, for contract verification)
BASESCAN_API_KEY=your_api_key
```

### Install and Run

```bash
# Install root dependencies
npm install

# Install contract dependencies
cd contracts && npm install && cd ..

# Push database schema
npm run db:push

# Start development server (frontend + backend on port 5000)
npm run dev
```

### Available Scripts

**Root (`package.json`):**
| Script | Command | What It Does |
|--------|---------|-------------|
| `npm run dev` | `NODE_ENV=development tsx server/index.ts` | Start dev server (Express + Vite) on port 5000 |
| `npm run build` | `vite build && esbuild ...` | Build for production |
| `npm start` | `NODE_ENV=production node dist/index.js` | Run production build |
| `npm run check` | `tsc` | TypeScript type checking |
| `npm run db:push` | `drizzle-kit push` | Push schema changes to database |

**Contracts (`contracts/package.json`):**
| Script | Command | What It Does |
|--------|---------|-------------|
| `npm run compile` | `hardhat compile` | Compile Solidity contracts |
| `npm run test` | `hardhat test` | Run contract tests |
| `npm run deploy:testnet` | `hardhat run scripts/deploy-diamond.js --network liskSepolia` | Deploy to Lisk Sepolia |
| `npm run deploy:mainnet` | `hardhat run scripts/deploy-diamond.js --network lisk` | Deploy to Lisk mainnet |
| `npm run upgrade:hedge` | `hardhat run scripts/upgrade-hedge-facet.js --network liskSepolia` | Upgrade HedgeFacet |
| `npm run verify` | `hardhat verify` | Verify contracts on block explorer |

---

## 5. Database

### Tech Stack
- **PostgreSQL** hosted on Neon (serverless)
- **Drizzle ORM** for type-safe queries
- Schema defined in `shared/schema.ts`, `shared/profile-schema.ts`, `shared/referral-schema.ts`

### Core Tables

| Table | Purpose |
|-------|---------|
| `wallets` | Encrypted wallet storage (address, private key, mnemonic) |
| `networks` | Supported blockchain networks |
| `transactions` | Transaction history |
| `balances` | Wallet balance snapshots |
| `messages` | Wallet-to-wallet messaging |
| `contacts` | Address book |
| `user_roles` | User role assignments |
| `user_profiles` | Individual/business profile data |
| `referral_codes` | Referral code tracking |
| `user_points` | Points balances |
| `point_transactions` | Points history |
| `hedge_events` | Hedge event records (mirrors on-chain data) |
| `hedge_positions` | Hedger position records |
| `hedge_lp_deposits` | LP deposit records |
| `daily_tasks` | Task definitions |
| `user_task_completions` | Task completion tracking |
| `platform_fees` | Fee collection records |
| `articles` | Educational content/blog posts |
| `waitlist` | Early adopter signups |
| `subscribers` | Email subscribers |

### Schema Changes

1. Edit table definitions in `shared/schema.ts`
2. Run `npm run db:push` to sync changes to the database
3. If there's a data-loss warning, use `npm run db:push --force`
4. Never write manual SQL migrations

### Data Access Pattern

All database operations go through the `IStorage` interface in `server/storage.ts`:

```typescript
// Interface defines all operations
export interface IStorage {
  getWallet(id: number): Promise<Wallet | undefined>;
  createWallet(wallet: InsertWallet): Promise<Wallet>;
  // ... etc
}

// DatabaseStorage implements with Drizzle queries
export class DatabaseStorage implements IStorage {
  async getWallet(id: number) {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.id, id));
    return wallet;
  }
}
```

API routes in `server/routes.ts` use `storage` (the singleton instance) for all CRUD operations.

---

## 6. Backend (Express Server)

### Entry Point
`server/index.ts` — starts Express, initializes the database, starts the FX oracle, registers routes.

### Route Structure (`server/routes.ts`)

Routes are organized into sections:

| Section | Prefix | Purpose |
|---------|--------|---------|
| HEALTH | `/api/health` | Health check endpoint |
| USER | `/api/user/role` | User role management |
| ADMIN | `/api/admin/*` | Admin dashboard data and management |
| ADMIN ARTICLES | `/api/admin/articles` | Content management (CRUD) |
| PUBLIC ARTICLES | `/api/articles` | Published articles (read-only) |
| WALLET | `/api/wallets/*` | Wallet creation, balance, transactions |
| STATS | `/api/stats/*` | Platform and portfolio statistics |
| WAITLIST | `/api/waitlist` | Waitlist signups |
| SUBSCRIBERS | `/api/subscribers` | Email subscriber management |
| FX-ORACLE | `/api/fx/*` | FX rate data from the oracle |
| HEDGE | `/api/hedge/*` | Hedge event data (read-only, data mirrors on-chain state) |
| TASKS | `/api/tasks/*` | Daily tasks, progress, completion, leaderboard |
| FEES | `/api/fees/*` | Fee calculation and recording |
| GAS | `/api/gas/*` | Gas sponsoring for users |
| REFERRALS | `/api/referrals/*` | Referral codes and tracking |
| POINTS | `/api/points/*` | Points system |
| PROFILES | `/api/profiles/*` | User profiles |

### Middleware

**Rate Limiting** (`server/middleware/rate-limiter.ts`):
- General API: 100 requests/minute
- Financial mutations (hedge, wallet): 20 requests/minute
- Wallet operations: 30 requests/minute
- Keys by wallet address (header `X-Wallet-Address`) or IP

**Signature Auth** (`server/middleware/signature-auth.ts`):
- EIP-191 signature verification for sensitive operations
- Only enforced on mainnet — passes through on testnet
- Headers required: `X-Wallet-Address`, `X-Signature`, `X-Timestamp`
- Signed message format: `${method}:${path}:${timestamp}:${bodyHash}`

### Key Backend Services

**Treasury Wallet** (`server/treasury-wallet.ts`):
- Manages the platform's USDC treasury
- Handles gas sponsoring (auto-sends 0.005 ETH when user has <0.001 ETH)
- 60-second cooldown per wallet for gas sponsoring

**Payment Verifier** (`server/payment-verifier.ts`):
- Monitors on-chain USDC transfers
- Verifies payment completion for platform operations

---

## 7. Frontend (React)

### Tech Stack
- React 18 with TypeScript
- Vite for build tooling
- Tailwind CSS + shadcn/ui (Radix UI based) for styling
- TanStack Query (v5) for server state management
- Wouter for routing
- Framer Motion for animations
- ethers.js for blockchain interaction

### Routing (`App.tsx`)

| Path | Page | Purpose |
|------|------|---------|
| `/` | Website | Landing page with FX ticker |
| `/pitch` | PitchDeck | Investor presentation |
| `/whitepaper` | Whitepaper | Technical documentation |
| `/insights` | Insights | Educational articles |
| `/waitlist` | Waitlist | Early adopter signup form |
| `/wallet` | Wallet | Wallet management dashboard |
| `/create-wallet` | CreateWallet | New wallet creation flow |
| `/import-wallet` | ImportWallet | Import existing wallet |
| `/unlock-wallet` | UnlockWallet | Decrypt and unlock wallet |
| `/home` | HomePage | Authenticated user dashboard |
| `/hedge` | Hedge | P2P hedge marketplace |
| `/tasks` | Tasks | Daily tasks and points |
| `/profile` | Profile | User profile management |
| `/faucet` | Faucet | Test token faucet |
| `/rewards` | Tasks | Rewards redirect |
| `/admin` | AdminDashboard | Admin panel |

### Data Fetching Pattern

All API calls use TanStack Query with a default fetcher:

```typescript
// Queries (GET requests) — just provide the key
const { data, isLoading } = useQuery({
  queryKey: ['/api/wallets'],
});

// Mutations (POST/PATCH/DELETE)
const mutation = useMutation({
  mutationFn: async (data) => {
    const res = await apiRequest('POST', '/api/wallets', data);
    return res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['/api/wallets'] });
  },
});
```

### Wallet Management (`client/src/hooks/use-wallet.ts`)

The wallet hook manages:
- Wallet creation (generates keypair, encrypts private key with AES-256)
- Wallet import (from private key or mnemonic)
- Session-based unlock (password decrypts private key for the session)
- Auto-lock on inactivity
- Balance tracking via on-chain RPC calls

### Hedge Contract Interaction (`client/src/lib/hedge-contract.ts`)

This is the bridge between the React frontend and the on-chain Diamond contract:

```typescript
// Key exports
export const DIAMOND_ADDRESS = '0x7e2322f7cE4C80fE9a030444de8037Cc3f984F9C';
export const USDC_ADDRESS = '0xf52Ad63619Bf9cFeF510341ac6b4038554399562';

// HedgeContractService class provides methods for:
// - createEvent()     → Create a new hedge event
// - deposit()         → LP deposits USDC into event pool
// - buyProtection()   → Hedger buys FX protection
// - claimPayout()     → Hedger claims payout after settlement
// - claimPremiums()   → LP claims earned premiums
// - withdrawCapital() → LP withdraws deposited USDC
// - getHedgeEventCore() / getHedgeEventStats() → Read event data
// - approveUSDC()     → Approve USDC spending for the Diamond
```

All hedge operations require the user's wallet to be unlocked (decrypted private key in session).

### Styling Conventions
- Use shadcn/ui components from `@/components/ui/`
- Use Tailwind CSS utility classes
- Dark theme with CSS variables defined in `client/src/index.css`
- Icons from `lucide-react`
- Import paths use `@/` alias (maps to `client/src/`)
- Import paths use `@shared/` alias (maps to `shared/`)
- Import paths use `@assets/` alias (maps to `attached_assets/`)

---

## 8. Smart Contracts (Solidity)

### Diamond Standard (EIP-2535)

The platform uses the Diamond proxy pattern for upgradeable contracts. One proxy contract (`Diamond.sol`) delegates all calls to facet contracts based on function selectors.

**Why Diamond Standard?**
- Add new features without redeploying
- Upgrade logic without changing the contract address
- Users' funds and data stay in the same contract
- No storage migration needed

### Deployed Facets

| Facet | Address | Purpose |
|-------|---------|---------|
| DiamondCutFacet | `0xC18bD2aB565dB76424D447016BEC25db181F217d` | Add/replace/remove facets |
| DiamondLoupeFacet | `0xC691ba840f5D6d9A6726B88eB5446ca1CFF6C19f` | Inspect which facets are installed |
| HedgeFacet | `0xBeb29Cec00a5288dcbcBF2020dB23103D7750F62` | Full hedge marketplace logic |

### Storage Layout (`LibAppStorage.sol`)

All facets share the same storage via `AppStorage` struct:

```solidity
struct AppStorage {
    address usdcToken;           // USDC contract address
    address oracleAdmin;         // Oracle address for settlements
    
    // Hedge system
    uint256 totalHedgeEvents;
    mapping(uint256 => HedgeEvent) hedgeEvents;
    mapping(uint256 => HedgePosition) hedgePositions;
    mapping(uint256 => HedgeLpDeposit) hedgeLpDeposits;
    // ... counters, fee config, mappings
}
```

### HedgeFacet Functions

**Admin:**
- `initializeHedgeFees(creationFee, hedgerRate, payoutRate, lpRate, creatorRate)` — Set fee schedule
- `setOracleAdmin(address)` — Set who can settle events
- `withdrawPlatformFees(amount)` — Withdraw collected fees

**Event Lifecycle:**
- `createEvent(name, pair, strikePrice, premiumRate, initialRate, expiryDate, depositAmount)` — Create event + initial deposit
- `setPoolSettings(eventId, poolOpen, allowExternalLp)` — Toggle pool settings
- `deposit(eventId, amount)` — LP adds liquidity
- `buyProtection(eventId, notionalAmount)` — Hedger buys coverage
- `settleEvent(eventId, settlementPrice)` — Oracle settles (one-touch or at expiry)
- `claimPayout(positionId)` — Hedger collects payout
- `claimPremiums(depositId)` — LP collects premiums
- `withdrawCapital(depositId)` — LP withdraws USDC after settlement
- `withdrawCreatorEarnings(eventId)` — Creator collects loyalty rewards

**Read-Only:**
- `getHedgeEventCore(eventId)` — Event details
- `getHedgeEventStats(eventId)` — Pool stats
- `getHedgePosition(positionId)` — Position details
- `getHedgeLpDeposit(depositId)` — LP deposit details
- `getPoolUtilization(eventId)` — Pool capacity info
- Various ID listing functions

### Payout Model (Predetermined)

Payouts are calculated and locked at the moment a hedger buys protection:

```
payout = notionalAmount × (strikePrice - initialRate) / initialRate
```

Example: Rate = 10, Strike = 12, Notional = $10,000
- Payout = $10,000 × (12 - 10) / 10 = $2,000

This amount is fixed regardless of how far the rate moves past the strike.

### Deploying Contracts

```bash
cd contracts

# Full fresh deployment (new Diamond + all facets)
npm run deploy:testnet

# Upgrade only the HedgeFacet (keeps same Diamond address)
npm run upgrade:hedge

# Verify on Blockscout
npx hardhat verify --network liskSepolia <contract_address>
```

After deploying, update the Diamond address in:
- `client/src/lib/hedge-contract.ts` (DIAMOND_ADDRESS)
- `server/fx-oracle.ts` (DIAMOND_ADDRESS)
- `scripts/setup-hedge-contract.ts` (DIAMOND_ADDRESS)
- `contracts/deployments-diamond-liskSepolia.json` (auto-updated by deploy script)

### Upgrading a Facet

When you modify `BlockFinaXHedgeFacet.sol`:

1. Make your changes to the Solidity code
2. Run `npm run compile` to verify it compiles
3. Run `npm run upgrade:hedge` to deploy the new facet and swap it in the Diamond
4. The Diamond address stays the same — no frontend changes needed
5. All existing data (events, positions, deposits) is preserved

**Important**: If you add new functions, add their selectors to the upgrade script. If you change function signatures, the old selectors must be removed and new ones added.

---

## 9. FX Oracle

**File**: `server/fx-oracle.ts`

The oracle is responsible for:
1. Fetching live FX rates every 5 minutes from `open.er-api.com`
2. Caching rates for the frontend (`/api/fx/rates`)
3. Automatically settling hedge events when the rate touches the strike (one-touch)

### How Settlement Works

```
Oracle polls every 5 minutes
  → Fetches USD/GHS, USD/NGN, USD/KES, etc.
  → For each open hedge event:
      → Get the event's currency pair and strike price
      → If current rate >= strike price → settle (triggered)
      → If past expiry date → settle (expired, no payout)
  → Settlement calls settleEvent() on the Diamond contract
  → Uses DEPLOYER_PRIVATE_KEY as the oracle admin signer
```

### Supported Pairs
46 African FX pairs including: USD/GHS, USD/NGN, USD/KES, USD/ZAR, USD/XOF, EUR/GHS, GBP/NGN, and many more.

---

## 10. Wallet System

### Flow
1. User creates wallet → keypair generated client-side → private key encrypted with AES-256 using user's password → stored in PostgreSQL
2. User unlocks wallet → password decrypts private key → held in React state (session) → auto-locks on tab close
3. User sends USDC → private key signs transaction → sent via Lisk Sepolia RPC → 0.3% fee deducted → recorded in database

### Gas Sponsoring
When a user's wallet has less than 0.001 ETH (not enough for gas), the backend automatically sends 0.005 ETH from the treasury wallet. This happens before every send operation and hedge contract interaction.

### Key Files
- `client/src/hooks/use-wallet.ts` — Wallet hook (create, import, unlock, lock)
- `client/src/lib/wallet.ts` — Encryption/decryption utilities
- `server/routes.ts` — Wallet API endpoints
- `server/treasury-wallet.ts` — Gas sponsoring logic

---

## 11. Hedge System (P2P One-Touch Options)

This is the core product. Read `HEDGE_DEVELOPER_NOTES.md` for the complete deep dive.

### Quick Summary

1. **Creator** creates a hedge event for a currency pair (e.g., USD/GHS) with a strike price, premium rate, and expiry. They deposit initial USDC as the first LP.

2. **LPs** deposit USDC into the event pool. Their capital backs hedger payouts. They earn premiums as income.

3. **Hedgers** buy protection by paying a premium. Their predetermined payout is calculated at purchase: `notional × (strike - initialRate) / initialRate`. The pool reserves this amount.

4. **Oracle** monitors the FX rate. If the rate touches the strike → event is settled, hedgers can claim payouts. If it never touches the strike before expiry → event expires, LPs keep everything.

5. After settlement, hedgers claim payouts, LPs claim premiums and withdraw capital. Fees are collected at each step.

### Data Flow
- **On-chain**: All financial operations (deposit, buy, settle, claim, withdraw) happen via the Diamond contract
- **Off-chain**: The database stores copies of events/positions for quick API access (admin dashboard, analytics). The oracle reads on-chain state to know which events to check.
- **Frontend**: `hedge.tsx` reads data from both the contract (via ethers.js) and the backend API

---

## 12. Tasks & Rewards System

### How It Works
- Admin creates tasks via `/api/admin/tasks` (or seeds them in the database)
- Tasks can be daily (resetable) or one-time
- Categories: Social (follow Twitter, join Telegram), On-Chain (buy protection, provide liquidity), Community (invite friends)
- Completing a task awards points
- Points are tracked in `user_points` table, shared with the referral system
- Leaderboard shows top 20 users by total points

### Key Endpoints
- `GET /api/tasks` — List active tasks
- `GET /api/tasks/progress/:walletAddress` — User's completion status
- `POST /api/tasks/complete` — Mark a task as done
- `GET /api/tasks/leaderboard` — Points leaderboard

---

## 13. Admin Dashboard

Access at `/admin` with the `ADMIN_PASSWORD` environment variable.

### Sections
- **Overview** — Total wallets, transactions, hedge events, active users
- **Users** — Wallet list, roles, activity
- **Transactions** — Transaction history and filtering
- **Hedge** — Open hedge events, positions, LP deposits
- **Revenue** — Platform fee collection, treasury stats
- **Tasks** — Create/edit/delete daily tasks
- **Content** — Manage articles/insights (CRUD)
- **Analytics** — Platform growth metrics
- **Health** — System status monitoring

---

## 14. Security

### Wallet Security
- Private keys encrypted with AES-256 using user's password
- Keys never leave the client unencrypted
- Session-based access — keys cleared on tab close
- No server-side access to unencrypted private keys

### API Security
- EIP-191 signature verification on mainnet for sensitive routes
- Tiered rate limiting (100/min general, 20/min financial, 30/min wallet)
- Input validation via Zod schemas
- SQL injection prevention via Drizzle ORM parameterized queries

### Smart Contract Security
- Owner-only access control on admin functions (initializeFees, setOracle, withdrawFees)
- Owner-only access on `diamondCut` (prevents unauthorized upgrades)
- USDC approval pattern (users must approve the Diamond to spend their USDC)
- Predetermined payouts prevent oracle manipulation attacks
- Pool capacity checks prevent over-commitment

### Known Limitations (Testnet)
- Signature verification is bypassed on testnet
- No reentrancy guards on HedgeFacet (add before mainnet)
- No payout caps per position (predetermined model mitigates this)

---

## 15. Deployment

### Production Build

```bash
# Build frontend and bundle backend
npm run build

# Start production server
npm start
```

The production build:
- Vite compiles React to `dist/public/`
- esbuild bundles the server to `dist/index.js`
- Express serves static files from `dist/public/`
- Server runs on port 5000

### Deploying to Other Platforms

The codebase is fully portable (no vendor lock-in):

**Railway/Render (easiest)**:
1. Push to GitHub
2. Connect to Railway/Render
3. Set environment variables
4. Build command: `npm run build`
5. Start command: `npm start`
6. Add PostgreSQL addon (or keep using Neon)

**Vercel + Railway (split)**:
- Frontend on Vercel (Vite build)
- Backend on Railway (Express)
- Requires API URL configuration changes

### Contract Deployment Checklist (Mainnet)

Before deploying to mainnet:
- [ ] Add reentrancy guards to HedgeFacet
- [ ] Audit all access control
- [ ] Set correct USDC mainnet address
- [ ] Test full flow on testnet
- [ ] Deploy with `npm run deploy:mainnet`
- [ ] Verify all contracts on block explorer
- [ ] Update DIAMOND_ADDRESS in all files
- [ ] Set NETWORK_MODE=mainnet
- [ ] Configure signature auth for real enforcement

---

## 16. Common Tasks for New Developers

### Task 1: Run the Project Locally

```bash
git clone <repo>
cd blockfinax
npm install
cd contracts && npm install && cd ..
# Set up .env with DATABASE_URL, DEPLOYER_PRIVATE_KEY, TREASURY_POOL_PRIVATE_KEY, ADMIN_PASSWORD
npm run db:push
npm run dev
# Open http://localhost:5000
```

### Task 2: Add a New API Endpoint

1. If new data is needed, add a table to `shared/schema.ts`
2. Add CRUD methods to `IStorage` interface and `DatabaseStorage` class in `server/storage.ts`
3. Add route handler in `server/routes.ts` inside the appropriate section
4. Run `npm run db:push` to sync the schema
5. Frontend: use `useQuery` or `useMutation` from TanStack Query to consume the endpoint

### Task 3: Add a New Frontend Page

1. Create the page in `client/src/pages/my-page.tsx`
2. Register the route in `client/src/App.tsx`
3. Add navigation link in `app-header.tsx` or `bottom-nav.tsx`
4. Use shadcn/ui components for consistent styling

### Task 4: Modify the Hedge Smart Contract

1. Edit `contracts/src/facets/BlockFinaXHedgeFacet.sol`
2. If adding new storage, update `contracts/src/libraries/LibAppStorage.sol` (only append to structs, never reorder)
3. Run `cd contracts && npm run compile`
4. If adding new functions, add selectors to `contracts/scripts/upgrade-hedge-facet.js`
5. Deploy: `npm run upgrade:hedge`
6. If function signatures changed, update the ABI in `client/src/lib/hedge-contract.ts`

### Task 5: Add a New FX Currency Pair

1. The oracle auto-fetches all available pairs from the exchange rate API
2. To add a new pair to the hedge UI, edit the pair selection dropdown in `client/src/pages/hedge.tsx`
3. Add the pair to the `FX_PAIRS` constant in the hedge page
4. The contract accepts any pair string — no on-chain changes needed

### Task 6: Create a New Admin Feature

1. Add the data endpoint in `server/routes.ts` under the ADMIN section
2. Add the UI tab/section in `client/src/pages/admin-dashboard.tsx`
3. Admin routes are protected by password check (POST `/api/admin/login`)

### Task 7: Deploy a Fresh Instance

1. Set up a PostgreSQL database
2. Set environment variables
3. Run `npm run db:push` to create all tables
4. `cd contracts && npm run deploy:testnet` to deploy fresh contracts
5. Update DIAMOND_ADDRESS in all files (see Section 8)
6. Run `npm run dev` or `npm run build && npm start`

### Task 8: Add Contract Tests

1. Create test files in `contracts/test/`
2. Use Hardhat's testing framework (Mocha + Chai + ethers.js)
3. Run with `cd contracts && npm test`
4. Test the full lifecycle: create event → deposit → buy protection → settle → claim

---

## 17. Troubleshooting

### "Function does not exist" when calling contract
The function selector isn't registered in the Diamond. Check `contracts/scripts/deploy-diamond.js` or `upgrade-hedge-facet.js` to ensure the selector is included.

### Database schema out of sync
Run `npm run db:push --force` to force-sync the schema. This may cause data loss on conflicting columns.

### Oracle not settling events
Check that `DEPLOYER_PRIVATE_KEY` is set and the deployer wallet has ETH for gas. Check server logs for oracle errors.

### Transaction failing with "insufficient funds"
The user needs USDC for the transaction and ETH for gas. The gas sponsoring should auto-send ETH, but check the 60-second cooldown.

### "USDC allowance too low"
The user needs to approve the Diamond contract to spend their USDC. The frontend calls `approveUSDC()` automatically before operations.

### Contract compilation errors after storage changes
Never reorder or remove fields in `AppStorage` struct — only append new fields at the end. Changing the storage layout breaks all existing data.

### Frontend not loading after code changes
The Vite dev server hot-reloads automatically. If it's stuck, restart the development server.

### Admin login not working
Check that `ADMIN_PASSWORD` environment variable is set. The password is compared directly (not hashed) in the admin login route.
