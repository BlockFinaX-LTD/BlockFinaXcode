# BlockFinaX Integrator API

A standalone, REST-style public API for the BlockFinaX parametric FX-protection protocol. Deploy this independently of the main BlockFinaX app — third parties (and other internal services) consume it for reads, calldata building, and protocol orchestration.

## Design model

We never custody keys or sign on your behalf. For every state-changing contract function the API exposes a `POST /v1/tx/.../build` endpoint that returns ready-to-sign calldata:

```json
{
  "data": {
    "chainId": 8453,
    "to": "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
    "data": "0x...",
    "value": "0",
    "function": "buyProtection",
    "args": { "eventId": "12", "notional": "100000000", "maxCost": "...", "deadline": "..." },
    "estimatedGas": "180432"
  }
}
```

You sign the `data` with **your own wallet** (Privy, MetaMask, Rift, a raw private key, a Safe, anything) and broadcast through **your own RPC**. If you'd rather not run an RPC, `POST /v1/tx/broadcast` will relay a signed raw transaction for you — still never signing anything on the server.

Reads are plain REST: `GET /v1/hedge/events/8453/12` returns event 12 on Base.

## Endpoint groups

```
Auth        GET /v1/me                                  (Rift Bearer)

Meta        GET /v1/chains                              chains we support
            GET /v1/hedge/fees?chainId=…                fee config

Governance  GET /v1/governance/owner?chainId=…
            GET /v1/governance/facets?chainId=…         all facets + selectors
            GET /v1/governance/facet-addresses/:chainId
            GET /v1/governance/facets/:chainId/by-address/:facetAddress
            GET /v1/governance/facet-address/:chainId/:selector
            GET /v1/governance/proposals/:chainId/:proposalId
            GET /v1/governance/cut-ids/:chainId
            GET /v1/governance/pending-cut-ids/:chainId
            GET /v1/governance/pending-cut-info/:chainId/:proposalId

Hedge       GET /v1/hedge/events/:chainId/:id           event core
            GET /v1/hedge/events/:chainId/:id/stats     pool stats
            GET /v1/hedge/events/:chainId/:id/range     range params
            GET /v1/hedge/events/:chainId/:id/utilization
            GET /v1/hedge/events/:chainId/:id/positions  position IDs
            GET /v1/hedge/events/:chainId/:id/deposits   deposit IDs
            GET /v1/hedge/events/:chainId/:id/payment-token
            GET /v1/hedge/events/:chainId/:id/quote-signer
            GET /v1/hedge/events/:chainId/total
            GET /v1/hedge/positions/:chainId/:id
            GET /v1/hedge/positions/:chainId/wallet/:addr
            GET /v1/hedge/deposits/:chainId/:id
            GET /v1/hedge/deposits/:chainId/:id/pending
            GET /v1/hedge/deposits/:chainId/wallet/:addr
            GET /v1/hedge/creators/:chainId/wallet/:addr
            GET /v1/hedge/quote-payout/:chainId/:id?hypoSettlement=…&notional=…
            GET /v1/hedge/paused/:chainId
            GET /v1/hedge/fees-initialized/:chainId
            GET /v1/hedge/platform-fees/:chainId
            GET /v1/hedge/platform-fees/:chainId/by-token/:token
            GET /v1/hedge/payment-tokens/:chainId/:token
            GET /v1/hedge/pricing-engine-signer/:chainId
            GET /v1/hedge/quote-nonce-used/:chainId/:nonce

Oracle      GET /v1/oracle/oracles/:chainId
            GET /v1/oracle/config/:chainId
            GET /v1/oracle/is-authorised/:chainId/:addr
            GET /v1/oracle/submissions/:chainId/:eventId
            GET /v1/oracle/submission/:chainId/:eventId/:oracle
            GET /v1/oracle/submitter-count/:chainId/:eventId

Pricing     POST /v1/pricing/quote                       fair premium + optional v8 signed attestation
            GET  /v1/pricing/health                      engine status (signer, USD rate, pair coverage)
            GET  /v1/pricing/signer                      just the active signer address

Tx (build)  POST /v1/tx/erc20/approve

            POST /v1/tx/hedge/create-event
            POST /v1/tx/hedge/deposit
            POST /v1/tx/hedge/buy-protection
            POST /v1/tx/hedge/claim-payout
            POST /v1/tx/hedge/claim-premiums
            POST /v1/tx/hedge/withdraw-capital
            POST /v1/tx/hedge/withdraw-creator-earnings
            POST /v1/tx/hedge/set-pool-settings

            POST /v1/tx/oracle/submit-rate

            POST /v1/tx/ownership/transfer-ownership
            POST /v1/tx/ownership/accept-ownership

  (admin)   POST /v1/tx/hedge/initialize-fees
            POST /v1/tx/hedge/settle-event
            POST /v1/tx/hedge/pause
            POST /v1/tx/hedge/unpause
            POST /v1/tx/hedge/activate-oracle-v2
            POST /v1/tx/hedge/set-oracle-admin
            POST /v1/tx/hedge/set-pricing-engine-signer
            POST /v1/tx/hedge/withdraw-platform-fees
            POST /v1/tx/hedge/withdraw-platform-fees-by-token
            POST /v1/tx/hedge/rescue-eth
            POST /v1/tx/hedge/rescue-erc20
            POST /v1/tx/hedge/set-allowed-payment-token
            POST /v1/tx/hedge/recover-expired-payouts
            POST /v1/tx/oracle/add-oracle
            POST /v1/tx/oracle/remove-oracle
            POST /v1/tx/oracle/set-required-signers
            POST /v1/tx/oracle/set-tolerance-bps
            POST /v1/tx/oracle/clear-stale-submissions
            POST /v1/tx/governance/diamond-cut          queue a Diamond upgrade
            POST /v1/tx/governance/execute-cut          apply queued upgrade
            POST /v1/tx/governance/cancel-cut           abort queued upgrade

Tx (relay)  POST /v1/tx/broadcast                       relay a signed raw tx
```

Full machine-readable spec at **`/v1/openapi.json`** and Swagger UI at **`/v1/docs`**.

## End-to-end example: buy protection

```ts
// 1. Read the event so the caller knows the parameters
const eventRes = await fetch("https://api.blockfinax.com/v1/hedge/events/8453/12").then(r => r.json());
const event = eventRes.data;

// 2. Ask the server to build an ERC-20 approve, then sign + broadcast it locally
const approveRes = await fetch("https://api.blockfinax.com/v1/tx/erc20/approve", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chainId: 8453,
    token:  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base USDC
    spender: event.diamond ?? "0xbCC51E62C4948FD35ab505bd71804C849601e4Ef",
    amount: "120000000", // 120 USDC (6 decimals) — buffer for premium + fee
    from:   wallet.address,
  }),
}).then(r => r.json());

await wallet.sendTransaction(approveRes.data); // sign + send with YOUR wallet

// 3. Build the buyProtection call
const buyRes = await fetch("https://api.blockfinax.com/v1/tx/hedge/buy-protection", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chainId: 8453, eventId: 12,
    notional: "100000000",                           // 100 USDC notional
    maxCost:  "110000000",                           // 10% slippage room
    deadline: String(Math.floor(Date.now() / 1000) + 300),
    from:     wallet.address,
  }),
}).then(r => r.json());

const tx = await wallet.sendTransaction(buyRes.data); // your wallet signs
await tx.wait();
```

That's it. The integrator never needs our private keys, our RPC, or any backend account.

## Auth

| Endpoint group | Auth |
|---|---|
| `GET /v1/me` | `Authorization: Bearer <rift-access-token>` |
| All public reads | None |
| All `POST /v1/tx/.../build` | None (we're only encoding calldata, not signing) |
| `POST /v1/tx/broadcast` | None (caller already signed) |

Admin write endpoints (initializeHedgeFees, settleEvent, pause, etc.) are unauthenticated at the API layer — anyone can build the calldata. But the on-chain function reverts unless the signer is the Diamond owner / oracle admin, so the security boundary is on-chain.

## Env

```
PORT=4000                         # API listens here

# Rift auth (for /v1/me)
RIFT_API_KEY=<your sk_… key>
RIFT_API_BASE=https://payment.riftfi.xyz

# Per-chain RPCs (defaults shown — override for higher-tier RPCs)
LISK_RPC_URL=https://rpc.api.lisk.com
BASE_RPC_URL=https://mainnet.base.org
BSC_RPC_URL=https://bsc-dataseed.binance.org

# Contract addresses — defaults match BlockFinaX mainnet deployment
LISK_DIAMOND_ADDRESS=0x69cB5BA093e44B345B617f72a148Ee43c4a18465
BASE_DIAMOND_ADDRESS=0xbCC51E62C4948FD35ab505bd71804C849601e4Ef
BSC_DIAMOND_ADDRESS=0xaC939C0897981Abc0711ec4e37527F13106180fc

# Optional CORS — leave unset to allow any origin
CORS_ORIGINS=https://yourdomain.com,https://anotherdomain.com

# Upstream pricing engine — required for /v1/pricing/* endpoints.
# The pricing engine has live data deps (Twelvedata, TreasuryDirect, Postgres)
# so it runs as the main BlockFinaX service and this API proxies through.
PRICING_ENGINE_URL=https://api.blockfinax.com
```

## Local development

```bash
cd integrator-api
npm install
PORT=4000 npm run dev
open http://localhost:4000/v1/docs
```

## Testing

```bash
npm test               # full suite (unit + integration + e2e) — ~8s
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:coverage  # v8 coverage — 100% statements / functions / lines / branches
```

223 tests across 19 files cover every endpoint with `ethers.Interface.decodeFunctionData` round-trips for calldata builders, mocked reader for view endpoints, Rift bearer auth, error envelopes, and a canonical integrator-journey E2E flow. No RPC required.

## Deployment

The package is fully self-contained. Build a Node.js image, set the env vars, expose the port. There's no DB requirement — the server reads live from chain over the configured RPCs. Optional: put it behind a rate-limiter (CloudFlare / nginx) and you have a production deployment.
