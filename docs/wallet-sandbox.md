# BlockFinaX wallet sandbox

This is the existing React wallet UI, built with `VITE_NETWORK_MODE=testnet` and
served by `server/sandbox/wallet.ts`. It uses Home, Cover, Earn, Profile and
Settings directly; there is no separate partner portal design.

Run `npm run build:wallet-sandbox`, then start with
`APP_ENV=sandbox VITE_NETWORK_MODE=testnet node dist/wallet-sandbox.js`.
The server verifies its RPC is Base Sepolia (84532) at startup.
Use `railway.wallet-sandbox.json` as the sandbox deployment configuration.
The isolated `sandbox/wallet` Git branch uses this as `railway.json`.

Frontend settings are listed in `config/sandbox-wallet.env.example`.
Place local Vite settings in `client/.env.testnet.local`, which is ignored.
The current Rift sign-in project may be reused through its publishable key and
widget URL. Sandbox-specific values take precedence when supplied. Add the wallet
sandbox origin to Rift's project allowlist before testing actual sign-in.
Secret `sk_` keys are rejected in the sandbox frontend. Changing Vite variables
requires a rebuild because they are compiled into the browser bundle.

## Current integration limits

This deployment is a UI and read-only testnet foundation, not a completed
end-to-end transaction environment. Rift's development environment points to its
production API in the installed SDK. Its chain types do not include Base Sepolia.
Transfers, contract writes, OTP transaction authorization and v3 signing calls
are therefore blocked until the provider's testnet signing integration is
confirmed and implemented. Setting a signing URL alone does not enable writes.

Test token balances are read from Base Sepolia through a read-only RPC endpoint.
Until a test token is deployed and configured, the wallet has no configured test
assets. Market prices are deterministic synthetic fixtures, labelled in the app.
No reward campaigns, referral codes or activity have been configured. Profile
updates, compliance, cash-out, AI chat and other unsupported APIs return 503.
No production database, email services or oracle workers are mounted.

Test contracts and a faucet still require Base Sepolia deployment funding and
contract/version alignment with the current wallet ABI. The earlier partner API
sandbox uses the published fixed-v8 contracts; the wallet also supports dynamic
pricing, so those contracts must not be presented as fully compatible without
further integration work.
