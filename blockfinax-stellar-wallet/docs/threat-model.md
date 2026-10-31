# Testnet threat model

| Threat | Control in this version |
| --- | --- |
| Email-code theft/replay | HMAC storage, five-minute expiry, single use, five guesses, 60-second resend cooldown |
| OAuth account substitution | State cookie plus expiring single-use server challenge, provider ID-token/audience validation, verified email |
| CSRF | Exact configured origin check on mutations, SameSite/HttpOnly cookies |
| False passkey registration | Server challenge, expected origin/RP, P-256, required user verification |
| Unauthorized payment | Session-bound sender, approved token/function, on-chain passkey signature |
| Sponsor drain | Authenticated routes, per-IP limits, payment/fee caps, daily faucet limit |
| Contract address front-running | Private deployment source; checked signer and pinned WASM at connection |
| Lost passkey | No email-based signing override |
| Fee-source sequence collisions | Single-process serialized submission |
| Expired/evicted contract storage | RPC errors visible to user |
| Process/storage failure | Persistent-volume instructions, confirmed activity records |

The current release records confirmed transactions and exposes process health. It does not claim that an external monitoring service, security audit or regulator approval has been completed.
