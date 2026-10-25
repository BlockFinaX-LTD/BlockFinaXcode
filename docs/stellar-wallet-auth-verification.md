# Stellar wallet authentication verification — 17 October 2026

Current application source: /Users/anthony/MYWORK/blockfinax-stellar/apps/wallet
Legacy copy also updated: /Users/anthony/MYWORK/BlockFinaXcode/blockfinax-stellar-wallet

Implemented changes:
- Google authorization uses a five-minute, server-side, single-use state challenge plus matching HttpOnly cookie.
- Google ID token verification requires the configured audience and a verified email; failed/cancelled sign-in returns a retry message without exposing provider responses.
- Existing Google sign-in button remains conditional on configured server credentials.
- Separate bounded testnet sponsorship caps: wallet deployment 30 test XLM; payments remain 10 test XLM.
- Recovery guidance explicitly distinguishes restoring the existing passkey from replacing a permanently lost key.

Verification:
- Current wallet: 17 unit/integration tests pass; TypeScript and Vite production build pass.
- Legacy wallet browser integration: passed real Stellar testnet wallet deployment, funding, confirmed 5 XLM payment, unlock, same-wallet sign-out/sign-in, missing-passkey rejection and restoration of the original virtual credential.
- Current wallet browser integration: passed the same full testnet flow with the documented protocol/oracle contracts configured (1.2 minutes).
- Physical-device biometrics, provider passkey sync and recovery using a new key were not verified. New-key recovery is not implemented.

Live Google sign-in:
- Public configuration reports googleEnabled=true.
- Authorization redirect reaches Google and sends the correct Railway callback URL.
- After the operator saved the authorized redirect URI, the live flow reaches Google’s account sign-in page (HTTP 200, `/v3/signin/identifier`) with no OAuth error. The configured callback is:
  https://stellar-wallet-test-stellar-test.up.railway.app/api/auth/google/callback
- A real Google account has not completed the provider exchange.

Deployment:
- No deployment has been performed in this task.
- The Railway service metadata currently reports no mounted volume. Its SQLite account/wallet registry must be preserved before a redeployment that replaces ephemeral storage.
