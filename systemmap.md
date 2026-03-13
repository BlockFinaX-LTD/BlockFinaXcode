# Overview

BlockFinaX is a blockchain-based P2P parametric protection platform offering downside protection, stop-loss rebates, and volatility buffers across FX (40+ African pairs), commodities (metals, energy, agri), and crypto, totaling 63 pairs. Built on the EIP-2535 Diamond Standard on Lisk Sepolia, its core product is "Hedge" (P2P one-touch parametric contracts), complemented by a "Wallet" for cross-border USDC transfers. The business model relies on hedge pool fees (0.5% hedger + 1% payout/LP + 5% creator loyalty) and a 0.3% wallet transfer fee (min $0.50). The project aims to secure $12.5M in funding across Pre-Seed, Series A, and Series B rounds, with Mainnet launch targeted for July 7, 2026, and regulatory sandbox approval from the Bank of Ghana. The codebase focuses solely on Wallet and Hedge functionalities, having removed all legacy features.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Core Design
BlockFinaX operates on a single-network architecture: Lisk Sepolia (chainId 4202). The frontend is built with React 18, TypeScript, and Vite. The backend utilizes Express.js, with PostgreSQL managed by Drizzle ORM on Neon for database operations. All blockchain interactions are handled via ethers.js. Smart contracts adhere to the EIP-2535 Diamond Standard, featuring three core facets: DiamondCutFacet (for upgrades), DiamondLoupeFacet (for inspection), and HedgeFacet (containing all P2P hedge logic). The USDC contract is located at `0xf52Ad63619Bf9cFeF510341ac6b4038554399562`, and the Diamond contract at `0x3582D8f5f88ef557ce10Af26834FAC8B8e1445bf`.

## UI/UX
The user interface is designed with shadcn/ui (based on Radix UI) and styled using Tailwind CSS. TanStack Query manages server state, Wouter handles routing, and Framer Motion provides animations. The landing page features a Dark Web3 theme, while the in-app experience uses a clean light theme.

## Technical Implementations
- **Wallet Management**: Features AES-256 encrypted private key storage, session-based access, and real-time balance tracking. A 0.3% transfer fee (min $0.50) applies. The system includes a gasless transaction mechanism where the backend sponsors 0.005 ETH for wallets with less than 0.001 ETH, with a 60-second cooldown.
- **Smart Contract Platform**: Utilizes the EIP-2535 Diamond Standard. The HedgeFacet encapsulates all P2P hedge logic, including event creation, liquidity provision, hedger position management, settlement, payouts, premium distribution, and fee collection.
- **Hedge Frontend-to-Contract Integration**: The hedge marketplace UI (`client/src/pages/hedge.tsx`) directly interacts with the HedgeFacet via `client/src/lib/hedge-contract.ts` for all on-chain operations, bypassing the backend except for FX rates.
- **FX Oracle**: The `server/fx-oracle.ts` module polls FX rates every 5 minutes and automatically settles hedge events (one-touch settlement) by calling `settleEvent()` on the Diamond contract using an admin key.
- **P2P Hedge (One-Touch Option)**: Hedgers pay premiums for protection, and LPs provide liquidity to earn premiums. Hedges can be "upward" (price rises to strike) or "downward" (price falls to strike), with payouts determined at purchase. Settlement occurs automatically when the price touches the strike or at expiry. Supported asset classes include FX (40+ African pairs), Commodities (Metals, Energy, Agri), and Crypto (BTC, ETH, BNB, SOL, XRP, ADA).
- **Security**: Features encrypted key storage, session-based authentication, automatic wallet locking, EIP-191 signature verification for mainnet API routes, tiered API rate limiting, mainnet transaction safety guards with daily limits, and SQL injection prevention.
- **Daily Tasks System**: Engages users with tasks for social follows, on-chain actions, and referrals, offering points and a leaderboard.
- **Transaction Fee System**: A 0.3% platform fee (min $0.50) is applied to wallet USDC transfers, tracked in the `platform_fees` table and visible in the admin dashboard.

# External Dependencies

## Blockchain Infrastructure
- **Ethers.js**: For all blockchain interactions.
- **Lisk Sepolia**: The exclusive blockchain network (chainId 4202).
- **USDC**: Token contract `0xf52Ad63619Bf9cFeF510341ac6b4038554399562`.

## Database
- **Neon Database**: Provides serverless PostgreSQL.
- **Drizzle ORM**: For type-safe database operations.

## Frontend Libraries
- **Radix UI / shadcn**: UI components library.
- **TanStack Query**: Manages server state and data fetching.
- **Wouter**: Client-side routing.
- **Framer Motion**: For animations.

## Development Tools
- **Vite**: Frontend build tool.
- **TypeScript**: Ensures type safety across the codebase.
- **Tailwind CSS**: Utility-first CSS framework for styling.

## Cryptography
- **crypto-js**: Used for client-side AES-256 encryption.

## Third-party Services
- **ExchangeRate-API**: Provides FX rates (dual-source: open.er-api.com + api.exchangerate-api.com, averaged).
- **Yahoo Finance**: Sourced for commodity prices.
- **CoinGecko**: Used for fetching cryptocurrency prices (free tier).

## Database Tables (Active)
Nine tables in production:
- `wallets`, `networks` — core infrastructure
- `hedge_events`, `hedge_positions`, `hedge_lp_deposits` — on-chain hedge tracking
- `daily_tasks`, `user_task_completions` — engagement system
- `platform_fees` — fee revenue tracking
- `rate_snapshots` — FX oracle history
Plus profile/referral tables from separate schema files.
