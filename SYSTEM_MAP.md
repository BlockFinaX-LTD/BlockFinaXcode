# System Map

```
BLOCKFINAX — FOLDER & FILE MAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 client/          ← FRONTEND (what the user sees in the browser)
│
├── 📁 src/pages/           ← One file per page/screen
│   ├── website.tsx             Landing page (/)
│   ├── hedge.tsx               Hedge marketplace (/hedge)
│   ├── wallet.tsx              Wallet dashboard (/wallet)
│   ├── home.tsx                App home after login (/home)
│   ├── tasks.tsx               Daily tasks & points (/tasks)
│   ├── profile.tsx             User profile (/profile)
│   ├── faucet.tsx              Test USDC faucet (/faucet)
│   ├── admin-dashboard.tsx     Admin panel (/admin)
│   ├── pitch-deck.tsx          Investor pitch (/pitch)
│   ├── whitepaper.tsx          Technical whitepaper (/whitepaper)
│   ├── insights.tsx            Articles & education (/insights)
│   ├── financial-model.tsx     Financial projections (/financial-model)
│   ├── create-wallet.tsx       New wallet setup (/create-wallet)
│   ├── import-wallet.tsx       Import existing wallet (/import-wallet)
│   └── unlock-wallet.tsx       Unlock screen (/unlock-wallet)
│
├── 📁 src/components/      ← Reusable UI building blocks
│   ├── app-header.tsx          Top navigation bar
│   ├── bottom-nav.tsx          Mobile bottom navigation
│   ├── crypto-icons.tsx        Cryptocurrency logo icons
│   ├── 📁 wallet/              Wallet-specific components (modals, QR, history)
│   ├── 📁 profile/             Profile settings panel
│   ├── 📁 video/               Animated video scenes
│   └── 📁 ui/                  Base UI library (buttons, inputs, cards, etc.)
│
├── 📁 src/lib/             ← Core logic & utilities
│   ├── hedge-contract.ts       ALL blockchain calls to the smart contract
│   ├── wallet.ts               Wallet create/import/unlock/sign operations
│   ├── encrypted-storage.ts    AES-256 encrypted local storage for wallet keys
│   ├── networks.ts             Blockchain network configs (Lisk Sepolia)
│   ├── rpc-provider.ts         Connects to blockchain with auto-failover
│   ├── balance-manager.ts      Real-time ETH + USDC balance tracking
│   ├── usdc-manager.ts         USDC balance queries and transfers
│   ├── usdc-payment.ts         On-chain USDC payment sending
│   ├── price-service.ts        Crypto price fetching (CoinGecko)
│   ├── tokens.ts               Token registry (USDC config per network)
│   ├── mainnet-guard.ts        Safety checks before mainnet transactions
│   ├── api-signer.ts           Signs API requests with wallet key (mainnet auth)
│   ├── api-client.ts           HTTP fetch helpers + TanStack Query config
│   └── utils.ts                General utility functions (classnames, formatting)
│
├── 📁 src/hooks/           ← React data hooks (fetch & manage state)
│   ├── use-wallet.ts           Is wallet unlocked? What is the address?
│   ├── use-wallet-balances.ts  Live token balance updates
│   ├── use-transactions.ts     Transaction history + send USDC
│   ├── use-toast.ts            In-app notification toasts
│   └── use-mobile.tsx          Is the screen mobile size?
│
├── 📁 src/contexts/        ← Global React state shared across pages
│   └── wallet-context.tsx      Wallet connection state (address, connected?)
│
└── App.tsx                 ← App root: routing, page layout, wallet auth flow

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 server/          ← BACKEND (runs on the server, invisible to users)
│
├── index.ts                Server entry point — starts Express, loads routes
├── routes.ts               ALL API endpoints (/api/...)
├── storage.ts              Database read/write functions (all DB access goes here)
├── db.ts                   Database connection setup (Neon PostgreSQL)
├── init-db.ts              Seeds default data on first startup
├── fx-oracle.ts            FX rate poller — auto-settles hedge events on-chain
├── hedge-reader.ts         Reads live hedge events directly from blockchain
├── treasury-wallet.ts      Treasury wallet for USDC pool operations
├── unstake-manager.ts      Sends USDC from treasury back to user wallets
├── payment-verifier.ts     Verifies on-chain USDC transactions
└── 📁 middleware/
    ├── rate-limiter.ts         Prevents API abuse (too many requests)
    └── signature-auth.ts       Verifies wallet signatures on mainnet routes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 shared/          ← SHARED CODE (used by both frontend and backend)
├── schema.ts               Main database table definitions (wallets, tasks, fees...)
├── profile-schema.ts       User profile table definition
└── referral-schema.ts      Referral codes and rewards table definitions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 contracts/       ← SMART CONTRACTS (blockchain code, deployed on Lisk Sepolia)
└── src/facets/
    ├── BlockFinaXHedgeFacet.sol    Core hedge logic (events, premiums, payouts)
    ├── DiamondCutFacet.sol         Upgrade mechanism for the Diamond contract
    └── DiamondLoupeFacet.sol       Contract inspection (lists active facets)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📄 ROOT FILES
├── SYSTEM_MAP.md               This file — full folder and file map
├── replit.md                   Project overview and architecture notes
├── HEDGE_DEVELOPER_NOTES.md    Technical docs for the smart contract
├── CONTENT.md                  12 video scripts for YouTube/social
├── ADVANCE_V2.md               v2 protocol spec (deferred to Q2 2027)
└── package.json                Project dependencies and run commands
```
