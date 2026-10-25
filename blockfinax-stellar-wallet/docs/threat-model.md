# Testnet threat model

| Threat                           | Implemented control                                                                   | Remaining work                                               |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Email-code theft/replay          | HMAC storage, five-minute expiry, single use, five guesses, 60-second resend cooldown | Email delivery security, identity abuse detection            |
| OAuth account substitution       | State cookie plus expiring single-use server challenge, provider ID-token/audience validation, verified email                   | Operator Google configuration and live-provider test         |
| CSRF                             | Exact configured origin check on mutations, SameSite/HttpOnly cookies                 | Validate ingress proxy configuration                         |
| False passkey registration       | Server challenge, expected origin/RP, P-256, required user verification               | Independent review                                           |
| Unauthorized payment             | Session-bound sender, approved token/function, on-chain passkey signature             | Institutional approval policies                              |
| Sponsor drain                    | Authenticated routes, per-IP limits, payment/fee caps, daily faucet limit             | Sybil-resistant onboarding, global daily sponsorship budgets |
| Contract address front-running   | Private deployment source; checked signer and pinned WASM at connection               | Durable ownership checks for partner APIs                    |
| Lost passkey                     | No email-based signing override                                                       | Add recovery/additional signers before customer-fund release |
| Fee-source sequence collisions   | Single-process serialized submission                                                  | Durable multi-worker queue/reconciliation                    |
| Expired/evicted contract storage | RPC errors visible to user                                                            | Automated TTL renewal and restoration                        |
| Process/storage failure          | Persistent-volume instructions, confirmed activity records                            | Backups, reconciliation, disaster recovery                   |

## Monitoring needed for hosted pilots

Monitor fee-payer balance, confirmed/failed transactions, simulation failures, RPC availability, storage TTL, faucet/sponsor volume, login abuse, unexpected wallet WASM and passkey failures. Alert on a sponsor balance below 500 test XLM, more than five failed submissions in ten minutes or three consecutive RPC health failures. Record transaction hashes without raw assertions, OAuth tokens, email codes or private keys. Add automated alerts and transaction reconciliation before expanding beyond the local testnet pilot.

The current release records confirmed transactions and exposes process health. It does not claim that an external monitoring service, security audit or regulator approval has been completed.
