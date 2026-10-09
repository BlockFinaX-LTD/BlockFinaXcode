# BlockFinaX Stellar Wallet

A testnet wallet and API for the BlockFinaX Stellar integration. Users sign in with an email verification code or Google, create a passkey, and use that passkey to authorize payments from a Soroban smart account.

This repository is the first implementation of the wallet infrastructure on our roadmap. It runs independently of Rift. BlockFinaX runs the identity service, account registry and fee sponsor; the device holds the user's transaction signing key. The smart account implementation comes from Stellar's open-source Passkey Kit, pinned to a specific testnet WASM hash. We have not written or claimed a new cryptographic wallet contract.

![BlockFinaX Stellar testnet wallet](docs/assets/wallet-desktop.png)

## Run locally

Use Node **22.18 or newer**.

```sh
npm ci
npm run setup:testnet
npm run dev
```

Open **http://localhost:5173**. Click **Sign in**, then enter an email address. A six-digit code is delivered through Resend. Enter the code, create a passkey, and open **Receive** and click **Receive test funds**. To test payments, create another wallet in a second browser profile and send to its `C…` address. A funded Stellar `G…` account also works as a recipient.

The setup script generates a fee-payer key, funds it through Friendbot and writes an ignored `.env` with restrictive file permissions. It never prints the secret. All activity uses Stellar **testnet**; the server fixes the network passphrase to testnet.

## Implemented

- Email verification codes: HMAC storage, five-minute expiry, single use, five attempts and a 60-second resend cooldown.
- Google OAuth authorization-code sign-in: state validation and verified ID token/email. Configure credentials before enabling it.
- HttpOnly session cookies, same-origin API checks and request limits.
- Server-verified P-256 passkey registration with required user verification.
- Smart-account deployment with the user's passkey as its persistent signer.
- Passkey unlock and on-chain signer/WASM checks before connecting.
- Live test XLM balance, daily test funding, passkey-approved payments and confirmed transaction history.
- A self-hosted transaction sponsor. It accepts only the signed user's wallet transferring the approved test XLM contract, with a 1,000 XLM payment limit and a 10 XLM sponsorship fee cap. Stellar verifies the contract authorization.
- SQLite storage and serialized fee-account submission to avoid sequence collisions in this single-process service.
- The current BlockFinaX app interface: original signed-in styles, Geist fonts, logo, Home/Cover/Earn/Profile navigation, dark/light theme, balance cards and responsive payment sheets. Cover, Earn and oracle feeds show their pending Stellar state.

Email or Google sign-in does not authorize payments or recover a lost passkey. Passkeys may sync through the user's device provider; that is not a BlockFinaX recovery service. Keep your passkey available. Additional signers, recovery, institutional approval policies, custom asset issuance, hedge contracts, FX oracle integration and mainnet release remain subsequent development.

## Configuration

See [.env.example](.env.example). Never put a secret in a `VITE_` variable.

For Google, add a Web Application OAuth client with redirect URI `http://localhost:5173/api/auth/google/callback` locally, or the exact HTTPS production origin plus that path. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server. Set `RESEND_API_KEY` and a verified `EMAIL_FROM` for email delivery. No existing Rift credentials are used.

For hosted use, build with `npm run build`, set `APP_ORIGIN` to the public HTTPS origin, `RP_ID` to its hostname, `NODE_ENV=production`, Resend and server secrets, then run `npm start`. Set `HOST=0.0.0.0` behind your hosting proxy. Preserve the SQLite database on a persistent volume. Passkeys created on localhost belong to localhost and will not work on another domain.

This release is for testnet evaluation. Before use with customer funds we need independent contract/integration review, recovery and governance design, a durable multi-process submission queue, custody/compliance decisions and operational controls. The grant implementation plan covers those next stages.

## Verify

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser integration test uses a Chromium virtual authenticator and submits real Stellar testnet transactions. It requires a configured, funded fee payer and internet access. It checks deployment, funding, wallet-to-wallet payment, reconnect and faucet limits. The browser test uses explicit local console code delivery. Resend delivery was separately verified against its automated test address. Google sign-in still requires operator configuration.

## Architecture and API

Read [architecture](docs/architecture.md), [API](docs/api.md), and [threat model](docs/threat-model.md). The existing grant proposal is at https://docs.blockfinax.com/stellar/.

Upstream references: [Stellar smart wallets](https://developers.stellar.org/docs/build/guides/contract-accounts/smart-wallets), [Passkey Kit](https://github.com/stellar/passkey-kit), [Stellar JS SDK](https://github.com/stellar/js-stellar-sdk).

For offline development without Resend, set `EMAIL_DELIVERY=console`. Codes appear only in the server terminal. Production does not permit console delivery.
