# BlockFinaX Oracle Strategy
## Price Feed Infrastructure, Current Challenges & Decentralization Roadmap

---

## 1. Overview

BlockFinaX operates as a P2P parametric protection platform covering 63 asset pairs across African FX, commodities, and crypto. At the core of every hedge settlement is a price oracle — the mechanism that determines whether a strike price has been touched and triggers payouts.

This document outlines how the current oracle works, its known limitations, and the phased roadmap toward a more decentralized and trustless price feed infrastructure.

---

## 2. Current Implementation

### How It Works

BlockFinaX uses a **custodial push oracle** model. The platform backend fetches prices from multiple external APIs on a 5-minute polling cycle and submits settlement prices directly to the Diamond smart contract when a strike condition is met.

**Data Sources (Current):**
- FX Rates: ExchangeRate-API (two endpoints, equal-weight averaged)
- Commodities: Yahoo Finance (metals, energy, agriculture)
- Crypto: CoinGecko (BTC, ETH, BNB, SOL, XRP, ADA)

**Settlement Flow:**
1. Backend polls rates every 5 minutes
2. Each fetched rate is stored in the `rate_snapshots` database table
3. The system compares current rates against all active hedge event strike prices
4. When a strike is touched, the oracle admin wallet calls `settleEvent()` on the Diamond contract
5. The contract records the settlement price permanently on-chain
6. Hedgers and LPs can then claim payouts

**Oracle Admin Wallet:** `0xef5Bed7c221c85A2c88e3c0223ee45482d6F037d`

---

## 3. Current Challenges

### 3.1 Centralization Risk
The oracle is controlled by a single private key. If this key is compromised, an attacker can submit fraudulent settlement prices and drain liquidity pools. Users must fully trust the platform operator to report accurate prices.

### 3.2 Single Point of Failure
If the application server goes offline, no events are settled. Hedgers may be left in limbo with active positions that cannot resolve until the server is restored.

### 3.3 No On-Chain Price Provenance
The smart contract records the settlement price but not its source. There is no on-chain proof that the submitted price came from a legitimate data provider rather than an arbitrary value.

### 3.4 API Dependency Risk
If ExchangeRate-API or Yahoo Finance returns erroneous data or experiences an outage, the oracle may submit incorrect prices. There is currently no automated circuit breaker to detect and reject anomalous rates.

### 3.5 5-Minute Settlement Latency
The oracle polls every 5 minutes. In highly volatile conditions, a price could touch the strike and recover before the oracle detects it — or a sharp move could be processed with a delay, creating ambiguity for users.

### 3.6 Regulatory Classification Risk
A fully centralized oracle may lead regulators, including the Bank of Ghana, to classify BlockFinaX as a centrally controlled financial product rather than a decentralized protocol. This has significant implications for licensing and sandbox approval.

### 3.7 No Existing Decentralized Alternative
Chainlink, Pyth, and API3 do not currently support 40+ African FX pairs such as GHS/USD, KES/USD, or NGN/USD. This means there is no plug-in decentralized oracle solution available for the asset classes BlockFinaX covers.

---

## 4. Why This Is an Industry-Wide Problem

The Oracle Problem is one of the most studied challenges in blockchain. Blockchains are deterministic closed systems — smart contracts cannot make outbound HTTP requests because every node in the network would need to independently verify the same external data simultaneously, which is technically impossible across a globally distributed network.

All major DeFi protocols — including Compound, Aave, Uniswap, and MakerDAO — launched with centralized or semi-centralized oracles and progressively decentralized over time. BlockFinaX is following the same pragmatic path.

---

## 5. Decentralization Roadmap

### Phase 1 — Hardened Custodial Oracle (Pre-Mainnet, Q2 2026)
**Goal:** Reduce risk of the existing centralized model without changing architecture.

- Add price deviation protection: reject any submitted price that deviates more than 3% from the previous rate
- Add a redundant data source (Open Exchange Rates or Fixer.io) for cross-validation before submission
- Implement automated circuit breaker: suspend settlement if two sources disagree by more than 2%
- Move oracle admin key to a Hardware Security Module (HSM) or secure key vault
- Emit detailed on-chain events including the data source identifier for every submission

**Status:** In progress

---

### Phase 2 — Multi-Signer Oracle (Q3 2026, Post-Mainnet)
**Goal:** Eliminate single point of failure by requiring agreement from multiple independent signers.

- Deploy a new `OracleFacet` to the Diamond contract
- Three independent oracle wallets, each operated by a separate server or entity
- Require 2-of-3 submissions within an agreed price band before a rate is accepted
- Any single outlier submission is automatically rejected
- Compromise of one key cannot affect settlement outcomes

**Architecture:**
- Oracle A: BlockFinaX primary server (ExchangeRate-API)
- Oracle B: BlockFinaX secondary server (Fixer.io / Open Exchange Rates)
- Oracle C: Trusted institutional or community partner

---

### Phase 3 — Decentralized African FX Oracle Network (2027)
**Goal:** Build and publish the first open decentralized oracle network for African FX pairs.

- Partner with African banks, fintechs, and currency exchanges to operate independent oracle nodes
- Nodes submit prices on-chain, median is taken across all submissions
- Open to third-party integration — any protocol on Lisk or EVM-compatible chains can consume the feed
- Commercial model: node operators earn a share of oracle subscription fees paid by consuming protocols
- Position BlockFinaX as the infrastructure layer for African asset pricing on-chain

This phase transforms BlockFinaX from a consumer of oracle data into a **provider** — creating a new revenue stream and a defensible infrastructure moat.

---

### Phase 4 — Decentralized Oracle Partnership (2027+)
**Goal:** Integrate with established oracle networks as African pair coverage expands.

- Engage Pyth Network and API3 to onboard African FX data providers
- Transition to hybrid model: established pairs use decentralized feeds, new pairs use BlockFinaX's own oracle until coverage is established
- Contribute African FX price data to open oracle standards

---

## 6. Risk Mitigation Summary

| Risk | Current Mitigation | Future Mitigation |
|---|---|---|
| Key compromise | Secure environment variable storage | HSM + multi-signer (Phase 2) |
| Bad data from API | Dual-source averaging | Circuit breaker + 3-source validation |
| Server downtime | Manual restart procedure | Redundant servers (Phase 2) |
| Regulatory classification | Transparent documentation | Multi-signer decentralization (Phase 2) |
| No decentralized alternative | Custom oracle with roadmap | BlockFinaX Oracle Network (Phase 3) |

---

## 7. Conclusion

BlockFinaX's current oracle is a pragmatic solution to a genuine infrastructure gap — no decentralized oracle covers 40+ African FX pairs, and building one is a non-trivial undertaking. The platform acknowledges this centralization, treats it as a known and managed risk, and has a credible roadmap to progressively decentralize.

The long-term vision — a permissionless, open African FX oracle network — is not just a compliance checkbox. It is a strategic asset that could underpin pricing infrastructure for the entire African DeFi ecosystem.

---

*Document Version: 1.0*
*Date: March 2026*
*Author: BlockFinaX Protocol Team*
