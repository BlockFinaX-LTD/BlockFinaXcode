# Wallet architecture

## Account creation

The email-code or Google callback creates a BlockFinaX application session. The server generates a WebAuthn challenge tied to that user. After verifying the browser's registration response against the expected challenge, origin, relying party and user-verification requirement, it extracts the P-256 public key and deploys a Passkey Kit smart account with that key as its signer.

Deployment uses the server's private fee-payer account as its source and hashes the credential ID into the contract salt. We deliberately do not use the public canonical deployer seed for deployment. The backend stores the resulting wallet address with the verified credential. The browser supplies this authenticated registry lookup to Passkey Kit and checks both the stored signer and the pinned executable hash. The fee payer is not installed as a wallet signer.

## Payment

The browser builds a SEP-41 token transfer, simulates it and requests the user's WebAuthn assertion through Passkey Kit. The signing challenge commits to the Soroban authorization payload. The browser sends the signed XDR to the API. The API checks that it represents one transfer from that user's registered wallet, using the approved token and amount limit. It rebuilds the outer transaction with its own source account, retains the signed contract authorization, simulates fees and submits. The smart account verifies the passkey signature on chain. The API reports success only after confirmed inclusion.

## Storage and network

SQLite holds application identities, HMAC-protected email codes, verified credential public keys/counters, wallet addresses and confirmed activity. Session cookies contain signed, expiring identities. Registration and unlock challenges are short-lived in-memory values; restarting the server cancels pending ceremonies. A single-process queue serializes sponsorship transactions. This release must run as one API process with persistent storage.

The approved testnet payment assets are Stellar native XLM and Circle's canonical testnet USDC Stellar Asset Contract (`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`). Both use seven decimal places. The application faucet moves 100 test XLM to the user's contract account; it does not mint or distribute USDC. Friendbot funds only the sponsor's classic account. A faucet call is not proof that the user can sign: the payment integration test provides that evidence.

## Contract provenance

Client: `passkey-kit@0.14.0`, generated wallet binding `passkey-kit-sdk@0.8.0`; dependencies locked in package-lock.json. Network passphrase: `Test SDF Network ; September 2015`.

Wallet WASM: `fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0`. Source and build manifest: https://github.com/stellar/passkey-kit/blob/main/docs/deployments-testnet-2026-07-11.md . Upstream records this as the July 13, 2026 hardened testnet build. The application enforces the hash during browser connection; upgrading requires an explicit version migration.
