# Partner sandbox — first release

## Infrastructure

- Railway project: `20ef0c91-264e-4bcc-b6ab-16c0823a2685`.
- Isolated environment: `sandbox` (`1aa95269-a709-479e-a795-ce4a385e2bcf`).
- Partner portal/API: `sandbox-api` (`efe441b8-589a-47f3-83a1-756f42c95925`).
- Pricing service: `sandbox-pricing` (`929c915e-6784-440a-aba5-57f66cf1245d`).
- Fresh PostgreSQL: `Postgres` (`8344b677-e058-45e5-b58b-2c65e32ce689`). No production records were copied.
- Temporary portal URL: https://sandbox-api-sandbox-955e.up.railway.app
- Intended domain: https://sandbox.blockfinax.com. Add CNAME `sandbox` → `mylb9tam.up.railway.app` at the domain's DNS provider.

The portal initially runs in **setup mode**. It advertises no usable transaction chains and returns 503 for chain actions until testnet contracts are deployed. The pricing service is provisioned but must not start before its Diamond and signer are configured.

## Testnet contracts

Base Sepolia, chain ID `84532`. Contract source and deployment scripts live in `BlockFinaX-LTD/v1protocol`, branch `sandbox/partner-testnet`.

Sandbox deployer public address: `0x4CABE327A2F48fE15be81756d8def9187E481611`. Fund this address with Base Sepolia test ETH, not mainnet funds, before deploying. Approximately 0.02 test ETH provides a starting gas budget.

The new token is **BlockFinaX Sandbox USD**, symbol `sUSD`, 6 decimals. Its `claim()` faucet gives the calling wallet 10,000 sUSD once per 24 hours. Its constructor rejects deployment outside Base Sepolia or local Hardhat. It has no monetary value.

The deployment installs the existing Diamond, hedge, oracle, loupe, and ownership code. Fee percentages match the protocol defaults and use test dollars. The deployment uses the fixed-price v8 contract published in the protocol repository, matching the current integrator API's ABI. Dynamic-price pools from newer website code are not included.

Use `hardhat.sandbox.config.js`, which reads only `.env.sandbox.local` and never reads the production deployer variable. Required settings are `SANDBOX_DEPLOYER_PRIVATE_KEY`, `SANDBOX_PRICING_SIGNER_ADDRESS`, and optionally `SANDBOX_RPC_URL`.

```sh
npx hardhat run --config hardhat.sandbox.config.js scripts/deploy-sandbox.js --network baseSepolia
```

This writes `deployments/sandbox-baseSepolia-84532.json`. It refuses to overwrite an existing completed deployment. Set that manifest's Diamond and token addresses in the sandbox API; set the Diamond in the sandbox pricing service. Set `SANDBOX_SETUP_ONLY=false` only after both are verified.

## Pricing

`server/sandbox/index.ts` is a separate server entrypoint. It does not import the production route orchestrator or start outreach, email, deposit, oracle, or research workers. `railway.sandbox.json` contains its build/start configuration.

The service reuses `server/pricing/kernel.ts` with deterministic synthetic spot/volatility inputs for USD/GHS, USD/NGN, and USD/KES. Quotes are explicitly labelled synthetic and signed by a newly generated sandbox-only key. Signatures bind to chain 84532, the deployed sandbox Diamond, and the caller's creator address. Quotes expire after 120 seconds, as on-chain verification requires. It logs quotes only in its dedicated sandbox database.

Never put production `DEPLOYER_PRIVATE_KEY`, `TREASURY_POOL_PRIVATE_KEY`, `PRICING_ENGINE_PRIVATE_KEY`, `RESEND_API_KEY`, or `RIFT_SECRET_KEY` into this service. It refuses to start if they are present. Refer to `config/sandbox.env.example` for its configuration.

## Partner experience

The API and portal use the existing integrator repository, `BlockFinaX-LTD/blockfinax-integrator-api`, branch `sandbox/partner-testnet`.

- Portal `/`: wallet connection, network switching, faucet, balances, editable API examples, signing, and transaction status.
- Swagger explorer `/v1/docs` and OpenAPI `/v1/openapi.json`.
- Existing read, approve, create, deposit, buy, payout, and governance calldata endpoints.
- Sandbox helpers at `/v1/sandbox/info`, `/v1/sandbox/faucet/build`, `/v1/sandbox/wallets/:address`, `/v1/sandbox/transactions/:hash`.
- Active sandbox rejects mainnet requests and signed transactions containing a different chain ID.

Partners use their own wallets to sign and broadcast, matching production. Public read and calldata endpoints do not require API keys. Managed partner accounts, API-key issuance, and automatic webhook delivery are future work; this release supports transaction polling and on-chain event subscriptions.

For the first flow: claim funds, approve the Diamond, create a pool, open it, buy protection, wait until expiry, request an operator test settlement, then claim the payout. Use actual event/position IDs from receipts rather than the example ID 1.

## Operator settlement

Settlement respects expiry. With the sandbox-only owner/oracle key in `.env.sandbox.local`:

```sh
SANDBOX_EVENT_ID=1 SANDBOX_SETTLEMENT_RATE=12 npx hardhat run --config hardhat.sandbox.config.js scripts/settle-sandbox.js --network baseSepolia
```

The rate is a synthetic test value, not a live market rate. Partners can choose values inside/outside their pool's payout zone to exercise triggered and untriggered outcomes.

## Validation

- Partner API build and full integration/unit suite, including sandbox and setup-mode isolation tests.
- Local blockchain faucet cooldown, full create → buy → settle → payout lifecycle.
- Pricing service attestation verified against the actual contract.
- Synthetic quote validation and signing tests in `server/sandbox/quote.test.ts`.

Keep production connected to `main`. Deploy sandbox services only from `sandbox/partner-testnet`. No production deployment is part of this setup.
