# API

All routes are under `/api`. Mutating requests require `Origin` equal to `APP_ORIGIN`; authenticated routes require the HttpOnly `bfx_session` cookie. JSON errors are `{ "error": "message" }`. Sign-in failures return 401, validation failures 400, origin failures 403 and request limits 429.

| Method | Route                          | Purpose                                                                      |
| ------ | ------------------------------ | ---------------------------------------------------------------------------- |
| GET    | `/config`                      | Public testnet/RPC/WASM/token settings and provider availability; no secrets |
| GET    | `/health`                      | Process health                                                               |
| GET    | `/me`                          | Signed-in email, registered contract/credential and confirmed activity       |
| POST   | `/auth/email`                  | `{email}`; deliver six-digit Resend code; return `{requestId, message}`      |
| POST   | `/auth/email/verify`           | `{email, requestId, code}`; consume code and set session cookie              |
| GET    | `/auth/google`                 | Start Google authorization-code flow                                         |
| GET    | `/auth/google/callback`        | Validate state and verified Google identity; set session                     |
| POST   | `/auth/logout`                 | Clear session cookie                                                         |
| POST   | `/wallet/registration/options` | Generate user-bound WebAuthn registration challenge                          |
| POST   | `/wallet/registration/verify`  | WebAuthn registration JSON; verify and deploy wallet                         |
| POST   | `/wallet/unlock/options`       | Generate challenge for the registered credential                             |
| POST   | `/wallet/unlock/verify`        | WebAuthn authentication JSON; verify ownership and update counter            |
| GET    | `/wallet/balance`              | `{stroops}` as decimal integer string                                        |
| POST   | `/wallet/faucet`               | Send 100 test XLM; once per user per 24 hours                                |
| POST   | `/wallet/payments`             | `{xdr}` signed Soroban token transfer; return confirmed `{hash}`             |

The application does not accept arbitrary RPC URLs, token contracts, contract deployments or relay operations from a caller. The `/payments` policy permits only native test XLM from the session's registered wallet. The outer XDR signatures are not trusted for user authority; signed Soroban authorization is verified by Stellar.

Amounts are integers at seven-decimal XLM precision. Example: 5 XLM = `50000000` stroops. Read-only contract balances are queried through simulation. There is no mainnet endpoint or API-key partner authentication in this release.

Email codes expire after five minutes and allow five guesses. A resend is available after 60 seconds and invalidates the earlier code. Delivery failures return an error and cancel the pending code.
