# Infrastructure Roadmap

A comprehensive doc on what we need to build, fix, and add to turn the current protocol into infrastructure that platforms can actually integrate and use to sell trade finance products to their customers.

This is not a feature wishlist. It's the full set of work — engineering, data, operations, business — needed to make the protocol function as platform-grade infrastructure. Read it end-to-end before deciding sequencing.

---

## 0. Where We Are vs Where We Need To Be

**Where we are:** A parametric insurance protocol with solid contract architecture (pool accounting, MasterChef rewards, oracle settlement, share math) but missing the layers that make it actually viable as a product:

- No pricing engine — premiums are creator-set, not computed
- No volatility infrastructure — the key input for any pricing engine doesn't exist
- Single-strike binary triggers — gamma cliffs make LP exposure violent
- No platform-facing surface — no API, SDK, or integration patterns for partners
- No underwriter management — capital is anonymous LP deposits, not risk-managed institutional capital
- No compliance scaffolding — no KYC/KYB, no SOC 2, no auditability for platform partners
- No clear go-to-market — we're a protocol looking for users instead of infrastructure for platforms

**Where we need to be:** A platform-facing infrastructure layer that fintech and B2B payment platforms can integrate in 2-3 weeks to offer FX hedging and trade finance products to their customers, with proper pricing, bounded risk for all sides, and institutional-grade compliance.

This doc lays out the work to get there.

---

## 1. The Product Layer: Range-Based Payouts

### What changes

Replace single-strike digital options with range-based call spreads as the default product structure.

**Current product:** "Pay out fixed amount X if rate hits strike Y."
- Cliff at the strike (13.99 vs 14.01 dramatic difference)
- Unbounded gamma near strike
- Underwriter exposure scales with how far past strike rate moves

**New product:** "Pay out proportionally for the move within range [K_lower, K_upper], bounded at top of range."
- No cliffs — payout is continuous in the range
- Gamma split across two strikes, smoother total exposure
- Underwriter loss capped at `(K_upper - K_lower) / K_entry × notional`

### Payout function

```
effective_rate = min(settlement_rate, K_upper)
payout = notional × max(0, effective_rate − K_lower) / K_entry  for upward hedges

For downward hedges:
effective_rate = max(settlement_rate, K_lower)
payout = notional × max(0, K_upper − effective_rate) / K_entry
```

### Contract changes required

- Event creation accepts `(K_lower, K_upper)` tuple instead of single `strike`
- Settlement logic computes proportional payout instead of binary
- Solvency invariant computes max payout from `K_upper` (the cap)
- All existing pool accounting (MasterChef, share math, withdraw splits) ports over unchanged
- Backward compatibility: existing single-strike events can be expressed as ranges with `K_lower = K_upper`, but we should sunset that pattern

### Engineering effort

Roughly 3-4 weeks of contract work plus testing. Existing test suite needs updating. Audit re-run required (~$30-50K).

### Why this matters first

This is upstream of everything else. The pricing engine prices ranges, not points. The risk monitoring is for range exposure. The platform integration exposes range-based products. Get the product structure right before building the surrounding layers.

---

## 2. The Pricing Engine

### Goal

Replace "creator picks a number" with "protocol computes premium from observable market inputs." Creators specify event parameters (range, expiry, notional); protocol computes the premium.

### Inputs needed (the five universals)

1. **Spot rate (S)** — current exchange rate
2. **Strike range (K_lower, K_upper)** — event parameter
3. **Time to expiry (T)** — event parameter, in years
4. **Risk-free rates (r, q)** — for both currencies in the pair
5. **Volatility (σ)** — annualized standard deviation of returns

### Pricing formula

For a range payout structured as a call spread, fair premium is the difference between two vanilla call values:

```
fair_premium = vanilla_call(S, K_lower, T, r, q, σ) - vanilla_call(S, K_upper, T, r, q, σ)
```

Vanilla call value via Black-Scholes:
```
C = S × e^(-q·T) × N(d1) - K × e^(-r·T) × N(d2)

where:
d1 = [ln(S/K) + (r - q + σ²/2)·T] / (σ·√T)
d2 = d1 - σ·√T
N() = standard normal CDF
```

For downward hedges (puts), the same logic applies with put-call parity. Implementation is well-known and not the hard part.

### On-chain implementation considerations

Black-Scholes requires logarithms, exponentials, and normal CDF computation — all expensive in Solidity. Approaches:

- **Pre-computed lookup tables** for N(d1), N(d2) at discrete intervals, with linear interpolation
- **Fixed-point math libraries** (PRBMath, ABDKMath64x64) for log/exp operations
- **Off-chain computation with on-chain verification** — pricing computed off-chain by an oracle service, validated against bounds on-chain

The third option is most practical. The pricing engine runs as a service, publishes a computed premium with the inputs that produced it, and the contract validates that the published premium is consistent with the published inputs (via cheaper sanity checks: monotonicity in strike, time decay properties, etc.).

### Engineering effort

- Pricing service: 6-8 weeks (1-2 engineers)
- On-chain validation contracts: 2-3 weeks
- Integration with event creation flow: 2 weeks
- Testing and edge case handling: 4 weeks

Total: roughly 3-4 months for a working pricing engine, assuming inputs are available.

### Why "assuming inputs are available" is the catch

The math is well-known. The inputs are the hard part — particularly volatility and EM rate curves. Sections 3 and 4 are where the real work concentrates.

---

## 3. The Volatility Infrastructure

This is the single largest piece of work in the entire roadmap. Half the engineering and operational effort goes here. Get it wrong and the pricing engine is worthless.

### Three sources of volatility

**Source 1: Implied vol from existing options markets**

For G10 currency pairs (EUR/USD, USD/JPY, GBP/USD, USD/CHF, AUD/USD, NZD/USD, USD/CAD) and major crosses, traded options markets exist on Deribit, CME, EUREX. Implied vol surfaces are published by data vendors.

For some EM pairs (USD/INR, USD/BRL, USD/MXN, USD/ZAR), offshore options markets exist with published implied vols.

For exotic EM pairs (USD/GHS, USD/VND, USD/NGN, USD/KES) — **implied vols don't exist**. Must use Source 2 or 3.

**Source 2: Realized vol from historical price data**

Compute σ from observed daily returns:

```
returns = [ln(S_t / S_{t-1}) for each day t]
realized_vol = std_dev(returns) × √252
```

Variants:
- Simple historical (last 30/60/90 days, equal weighted)
- EWMA (exponentially weighted, recent observations matter more)
- GARCH (captures vol clustering)

For protocol use, EWMA with a 30-60 day window is the right default. Adapts faster than simple historical, less complex than GARCH.

**Critical:** Realized vol systematically underestimates future vol. Must add a risk premium markup before using as pricing input.

**Source 3: Expert-set vol with governance**

For brand-new pairs, pairs with thin price history, or pairs experiencing regime breaks (currency crises, capital control changes), neither implied nor realized vol is reliable. The vol surface is set by a governance process (the protocol team or DAO) with conservative defaults until enough data accumulates.

### The hybrid vol oracle architecture

Build a vol oracle service that:

1. For each tracked pair, classifies the pair's vol source (implied / realized / governed)
2. For implied: integrates with data vendors (Deribit API, CME data feeds, Refinitiv, Bloomberg)
3. For realized: ingests daily spot prices, maintains rolling computation of EWMA vol, applies risk premium markup based on pair classification
4. For governed: stores the most recent governance-set value
5. Publishes updated vol values on-chain at appropriate frequency (daily for most pairs, more frequently for high-volume pairs)

### Risk premium markup methodology

For realized-vol-based pairs, the markup added to compensate for vol risk premium and tail risk:

| Pair classification | Realized vol markup |
|---|---|
| G10 majors | +10-15% |
| Major EM (BRL, MXN, ZAR, INR) | +20-30% |
| Frontier EM (VND, GHS, NGN, KES) | +50-100% |
| Pegged or managed currencies | +100-200% (because devaluation tail risk) |
| Crisis/capital control countries | Governance-only, no formula |

These markups should be governance-adjustable parameters, with changes requiring multisig approval.

### Data sources and costs

**Spot rate data:**
- Existing oracle infrastructure works for major pairs
- Need to extend to exotic EM pairs (Reuters, Bloomberg FX feeds, regional FX aggregators)
- Cost: $10-30K/year for premium feeds

**Implied vol data:**
- Deribit API (crypto) — free
- CME data (FX options) — $5-15K/year
- Refinitiv Eikon — $20-30K/user/year
- Bloomberg terminal — $30K/user/year
- Specialized EM data providers (CMI, EM Capital) — $20-50K/year for specific coverage

**Historical price data for realized vol:**
- Most major sources cover this
- For exotic pairs, may need regional providers
- Cost: bundled with spot rate data typically

**Total vol infrastructure data costs:** $50-150K/year depending on coverage breadth.

### Engineering effort

- Vol oracle service: 3-4 months (1-2 engineers)
- Data vendor integrations: 1-2 months per major source
- On-chain publication contracts: 3-4 weeks
- Governance interfaces and tooling: 1 month
- Monitoring and alerting: 1 month

Total: 6-9 months of focused work for a production-grade vol oracle.

### What we ship in phases

**Phase 1 (MVP, 3 months):** Realized vol only, manual review for pair listings, governance-set risk premiums per pair tier. Covers any pair with reasonable price history.

**Phase 2 (4-6 months):** Add implied vol integration for G10 majors and major EM. Hybrid logic to use implied where available, realized + markup elsewhere.

**Phase 3 (6-12 months):** Term structure (different vols for different expiries), vol smile (different vols for different strikes), backtesting framework, automated regime detection.

Phase 1 is sufficient to launch with platform partners. Phases 2-3 are quality improvements.

---

## 4. Rate Curves (the Other Pricing Input)

Less attention than vol but still real work. The forward rate is driven by the rate differential between currencies, and getting this wrong systematically biases all pricing.

### What we need

For each tracked pair, we need r and q:
- r = quote currency rate (usually USD, easy)
- q = base currency rate (varies by pair, often hard for EM)

### Sources

**USD rate (r):**
- SOFR for short-term
- Treasury curve for longer tenors
- Available from Pyth, Chainlink, RedStone, plus standard data vendors
- Cost: minimal

**Major currency rates (EUR, JPY, GBP, etc.):**
- ECB, BoJ, BoE published rates
- Standard interest rate curves from data vendors
- Cost: bundled with FX data

**EM currency rates (q for VND, GHS, NGN, etc.):**
- Central bank policy rates exist but don't reflect tradeable rates
- True tradeable rate is implied by the NDF (non-deliverable forward) market
- Compute as: `q = r - ln(forward_NDF / spot) / T`
- NDF curves available from major data vendors

**For pairs without NDF markets:** Use central bank policy rate plus a spread for inaccessible rates. This is an approximation and another reason to add markup to pricing.

### Engineering effort

- Rate oracle service: 6-8 weeks
- NDF data integration: 4-6 weeks
- On-chain publication: 2 weeks

Total: roughly 3 months of work, can run in parallel with vol oracle.

### Cost

NDF data is the expensive piece — $30-80K/year for institutional-grade EM coverage. Worth it.

---

## 5. Risk and Solvency Infrastructure

The current solvency invariant (`totalMaxPayout ≤ totalLiquidity`) is necessary but not sufficient. Real risk infrastructure needs to do more.

### Live risk monitoring

For each event and each pool, continuously compute:

- **Current mark-to-market value** of all open positions (using current spot, time, vol)
- **Aggregate delta exposure** across the pool (sum of position deltas weighted by notional)
- **Aggregate gamma exposure** across the pool
- **Stress test scenarios** (what happens if spot moves +10%, +20%, +50%; what happens if vol spikes 50%)
- **Concentration metrics** (% of pool exposed to any single pair, expiry bucket, strike range)

### Concentration limits

Hard limits enforced by contracts:

- Maximum % of pool capital exposed to any single pair (suggested: 30%)
- Maximum % exposed to any single expiry bucket (suggested: 50%)
- Maximum % exposed to any single platform/event creator (suggested: 40%)
- Maximum total open exposure as % of pool (suggested: 70%, leaving 30% buffer for adverse moves)

### Margin and collateral mechanics

If platforms or underwriters bear risk on events they create, they post collateral that locks proportionally to event exposure. Collateral can be:

- Stablecoins (USDC primary, USDT secondary)
- Yield-bearing stables (sUSDe, sDAI, etc.) — earns yield while locked
- Tokenized treasury products (BUIDL, Ondo USDY, etc.) — earns risk-free rate

Margin call mechanics: if locked collateral becomes insufficient to cover updated max payout (e.g., new events created or vol moves widening exposure estimates), underwriter must top up or be liquidated.

### Liquidation logic

If an underwriter fails margin call:

- Their existing event obligations remain in place (cannot abandon hedgers)
- Their unutilized collateral is locked from withdrawal
- Other underwriters in the pool can absorb the orphaned positions at a small discount
- If no absorption, the protocol's backstop fund covers shortfall

### Backstop fund

A reserve held by the protocol from accumulated fees, used to absorb tail risk events that exceed underwriter collateral. Sized as a % of total exposure (suggested: 5-10%).

### Engineering effort

- Risk monitoring service: 2-3 months
- Concentration limit contracts: 4-6 weeks
- Margin/collateral mechanics: 6-8 weeks
- Liquidation contracts: 4-6 weeks
- Backstop fund mechanics: 2-3 weeks

Total: 4-5 months of focused risk engineering work.

---

## 6. Platform-Facing API and SDK

This is the surface that platform partners (Tazapay, BVNK, Aleta Planet, etc.) integrate against. Quality here directly determines partnership conversion rates.

### API requirements

**Core endpoints:**
- `POST /events/quote` — get a price quote for given parameters
- `POST /events/create` — create an event with the platform as creator
- `POST /events/{id}/buy` — hedger purchases protection on an event
- `GET /events/{id}` — current state of an event
- `GET /events/{id}/payout` — computed payout based on current settlement
- `POST /events/{id}/settle` — trigger settlement post-expiry
- `GET /pools/{id}/exposure` — risk metrics for a pool
- `POST /collateral/deposit` — underwriter deposits backing capital
- `POST /collateral/withdraw` — underwriter withdraws unlocked collateral

**Webhook events:**
- `event.created`
- `event.purchased`
- `event.priceUpdated`
- `event.settled`
- `event.payoutClaimed`
- `collateral.marginCall`
- `pool.exposureWarning`

**Standards:**
- RESTful with consistent JSON schemas
- OAuth2 for authentication
- OpenAPI spec for documentation
- Rate limits and SLAs published
- Sandbox environment with test data
- Versioning strategy (URL-versioned: /v1/, /v2/)

### SDK requirements

Language coverage in priority order:
1. TypeScript/JavaScript (most fintechs)
2. Python (data science, backend)
3. Go (high-performance backends)
4. Java (enterprise integrations)

Each SDK should provide:
- Typed client for all endpoints
- Webhook signature verification helpers
- React components for embedded UI ("Buy Protection" button, quote display, status tracker)
- Example integration code for common flows
- Comprehensive error handling

### Documentation requirements

- API reference (auto-generated from OpenAPI)
- Integration guide ("Integrate in 14 days")
- Common patterns (FX hedge on invoice, payment guarantee, etc.)
- Troubleshooting guide
- Security best practices
- Migration guides between versions

### Engineering effort

- Core API: 3-4 months
- SDK in TypeScript: 6-8 weeks
- SDK in Python: 4-6 weeks
- React components: 4-6 weeks
- Documentation: ongoing, ~1 person continuously

Total: 4-6 months for production-grade platform-facing surface.

---

## 7. Permissioning and Multi-Party Roles

The protocol needs clear role separation that the contracts enforce:

### Roles

**Platform (event creator):**
- Registered and KYBed entity
- Can create events for their customers
- Specifies capital backing source (self, underwriter, hybrid)
- Receives distribution share of premiums
- Bears reputational risk if customers have bad experiences

**Underwriter (capital provider):**
- Registered institutional entity
- Provides backing collateral for events
- Earns underwriting share of premiums
- Subject to margin and concentration limits
- Can be platform-tied (one underwriter backs one platform's events) or pool-shared (underwriters back many platforms' events through a shared pool)

**Hedger (end customer):**
- Comes through a platform
- KYC handled by platform, attested to protocol
- Buys protection on platform-created events
- Pays premium, receives payout if triggered

**Oracle operator:**
- Existing role from current contracts
- Submits price feeds for settlement
- Subject to existing tolerance and signature requirements

**Governance:**
- Sets protocol parameters (fees, limits, supported pairs)
- Approves new platforms and underwriters
- Manages backstop fund
- Adjusts pricing methodology parameters (vol markups, etc.)

### Permissioning contracts

- Platform registry with KYB attestation
- Underwriter registry with capital and limits
- Role-based access control on event creation
- Hedger eligibility checks (platform-attested KYC, geographic restrictions if applicable)

### Engineering effort

Roughly 6-8 weeks of contract and supporting infrastructure work.

---

## 8. Compliance Infrastructure

Platform partners' compliance teams will reject integrations that don't meet baseline standards. This is non-negotiable for serious BD.

### KYC/KYB

- Integration with Sumsub, Onfido, or ComplyAdvantage for identity verification
- Tiered verification levels (light for small hedgers, full for underwriters and platforms)
- Sanctions screening (OFAC, EU, UN lists)
- PEP (politically exposed person) screening
- Ongoing monitoring for status changes

### AML/transaction monitoring

- Chainalysis or Elliptic integration for crypto transaction analysis
- Risk scoring per address and per transaction
- Suspicious activity flagging and reporting workflow
- Travel rule compliance for cross-border transfers above thresholds

### Audit trail

- Immutable record of all events, transactions, settlements
- Standardized export formats for regulator requests
- Time-stamped versioning of all parameter changes
- Full reconstructibility of historical state

### Certifications

- SOC 2 Type II (12-18 month process, ~$50-150K)
- ISO 27001 (parallel track, ~$30-80K)
- Smart contract audits from recognized firms (Trail of Bits, OpenZeppelin, ConsenSys Diligence) — $50-100K per major audit
- Penetration testing — $20-40K annually

### Legal documentation

- Terms of service for platforms
- Terms of service for underwriters
- Standard hedger agreement (white-labeled by platforms)
- Privacy policy compliant with GDPR, applicable EM jurisdictions
- Disclaimer and risk disclosure language reviewed by counsel

### Engineering and operational effort

- KYC/AML integration: 2-3 months
- Audit trail infrastructure: 1-2 months
- SOC 2 prep and audit: 12-18 months parallel work
- Legal documentation: 1-2 months with counsel

Total compliance buildout: 6-12 months of work, ongoing maintenance thereafter.

### Cost

- Compliance vendor stack: $100-200K/year
- Audits and certifications: $200-400K initially, $100-150K/year ongoing
- Legal counsel: $100-200K initial, $50-100K/year ongoing

---

## 9. Pricing Display and Fairness Layer

Even with a working pricing engine, the UX has to make pricing feel fair to all parties. This is the layer that gives platforms confidence to sell the product to their customers.

### What's displayed to platform-facing users (their customers)

When a hedger buys through a platform's UI:

```
Quote details:
  Protection: USD/VND 24,500 - 25,500 range
  Notional: $50,000
  Expiry: 60 days from now
  
Premium breakdown:
  Estimated fair value: $42  [from our pricing engine]
  Platform margin: $18  [platform sets this]
  Protocol fee: $5
  Total premium: $65  [what customer pays]
  
Maximum payout if triggered: $2,041
```

### What's displayed to platforms (creators)

```
Event configuration:
  Pair: USD/VND
  Range: 24,500 - 25,500
  Notional: $50,000
  Expiry: 60 days
  
Pricing inputs (current values):
  Spot: 24,150
  USD rate: 4.5%
  VND rate: 8.2% (from NDF)
  Volatility: 12% (realized + 30% markup)
  
Computed fair value: $42
Your suggested premium: ___ [you set this]
Your margin: $0 default, $X if you set premium higher
Protocol fee: $5
Customer's total: $42 + your_margin + $5
```

### What's displayed to underwriters

```
Pool exposure summary:
  Total locked collateral: $5.2M
  Total max payout exposure: $4.1M
  Utilization: 79%
  
By pair:
  USD/VND: $1.8M exposure, $400 expected loss this month
  USD/PHP: $1.2M exposure, $250 expected loss this month
  USD/IDR: $1.1M exposure, $180 expected loss this month
  
Average premium captured: 1.8%
Realized loss ratio (12 months): 0.6%
Annualized return on locked capital: 14.2%
```

### Engineering effort

- Pricing display API (deriving and exposing fair value): 2-4 weeks
- Platform UI components: 4-6 weeks
- Underwriter dashboard: 6-8 weeks

Total: 3-4 months for the full fairness display layer.

---

## 10. Settlement Reliability and Oracle Hardening

Settlement is the moment of truth. If oracle data is wrong or settlement fails, the entire protocol's credibility evaporates. This needs much more attention than current state.

### Multiple oracle redundancy

Current system has multiple oracles with tolerance — extend to:

- Minimum 3 oracles per pair (5 for major pairs)
- Diverse data sources (different vendors, not just same data resold)
- Geographic distribution where relevant
- Cooldown and tolerance parameters per pair (more volatile pairs need wider tolerance)

### Disputed settlement mechanics

If oracles disagree beyond tolerance:

- Settlement paused, not failed
- Governance (or UMA-style optimistic dispute mechanism) resolves
- Time-bounded dispute window (24-48 hours)
- Resolution either: median of submitted prices, manual governance set, or fallback to alternate oracle set

### Stale data protection

- Maximum age of price data (15 minutes for active settlement)
- Heartbeat monitoring for oracle liveness
- Automatic alerts to operations team for stale feeds
- Circuit breaker that pauses new event creation if oracle infrastructure degrades

### Settlement automation

- Trigger settlement automatically at expiry (no manual step required)
- Batch settle multiple events in single transaction for gas efficiency
- Webhook notifications to platforms when their events settle

### Engineering effort

- Oracle improvements: 2-3 months
- Dispute mechanics: 1-2 months
- Automation infrastructure: 1 month

Total: 3-4 months of focused settlement reliability work.

---

## 11. Operations and Support Infrastructure

A protocol used by platforms needs operational maturity. This is unglamorous but essential.

### Monitoring and alerting

- 24/7 system health monitoring
- On-call rotation for operations team
- Alerting for: oracle failures, settlement issues, margin call events, anomalous pool activity, smart contract errors
- Status page for platform partners

### Incident response

- Documented incident response procedures
- Communication templates for partner notifications
- Post-mortem process for major incidents
- SLA commitments to platform partners (e.g., 99.5% uptime, 1-hour response on critical issues)

### Customer support

- For platforms: dedicated technical contacts, Slack/Telegram channels for urgent issues, monthly business reviews
- For underwriters: risk dashboards, monthly performance reports, quarterly book reviews
- End-customer support is platforms' responsibility (they own customer relationship)

### Legal and dispute resolution

- Standard procedures for handling oracle disputes
- Procedures for addressing platform-customer disputes
- Procedures for addressing underwriter capital issues
- Coordination with legal counsel for novel situations

### Operational effort

- Operations engineer: 1 person dedicated, 2 over time
- Partner success manager: 1 person, 2-3 as partner count grows
- Legal/compliance ops: 1 person initially

---

## 12. Regulatory Strategy

Probably the biggest non-engineering question. Get this wrong and the rest doesn't matter.

### Core question

What are we, regulatorily?

Possibilities:
- A software protocol with no regulated activity (most aggressive interpretation)
- A licensed insurance provider
- A licensed derivatives platform
- A licensed payment institution
- An infrastructure-only provider, with platforms holding regulated activity

The right answer depends on jurisdiction and specific structure. Almost certainly need a real regulatory law firm to scope this properly.

### Likely approach

For a platform-distributed model where platforms hold the customer relationship:

1. Protocol is positioned as **infrastructure provider** — software and clearing/settlement layer
2. Platforms hold customer-facing licensing in their own jurisdictions
3. Underwriters hold any required licensing for risk-bearing activity
4. Protocol entity is incorporated in a sensible jurisdiction (likely Singapore for fintech, BVI for the contract layer)

### Specific work

- Engagement with regulatory law firm: $50-150K initial scoping
- Possible MAS Capital Markets Services license application (Singapore): $100-300K, 12-18 months
- Possible alternatives: VARA (Dubai), MFSA (Malta), specific country trade finance frameworks
- Legal opinions for each jurisdiction where platforms operate: $20-50K each

### Timeline

- Months 1-3: Regulatory scoping and decision
- Months 3-9: License application or structuring (if needed)
- Months 6-18: Ongoing regulatory engagement as we add jurisdictions

This is sequential to a lot of other work — platforms won't integrate until regulatory question has clear answer.

---

## 13. Token and Economic Model

If there's a protocol token, what does it do? If there isn't, how do underwriters and platforms get aligned?

### Without a token

- Platforms earn revenue share from premiums on events they create
- Underwriters earn premium income directly proportional to capital deployed and risk taken
- Protocol earns fee on each transaction
- All parties paid in stablecoins
- Simple and clean; no token-related regulatory issues

### With a token

- Could be governance only (limited utility, regulatory simpler)
- Could include staking for underwriter participation (boosts capital efficiency)
- Could include fee discounts or boosts for platforms holding token
- Could be backstop fund mechanism (token holders backstop tail risk in exchange for fee share)

**Recommendation:** Launch without a token. Build real revenue and traction first. Add token only if there's a specific function it serves (most likely: backstop fund mechanism). Premature tokens create regulatory drag and distract from product.

---

## 14. Competitive Differentiation Maintenance

Once we ship, the moats:

1. **Range-based product structure** is genuinely better than single-strike — copyable but takes time
2. **Vol oracle for EM pairs** is hard infrastructure — once built, others have to rebuild it
3. **Platform integrations** are sticky — fintechs don't want to migrate once integrated
4. **Trade finance integration** with stablecoin settlement is unique to crypto-native infrastructure
5. **Network effects** — more platforms = more flow = better pricing = more underwriters = more platforms

Maintenance work:
- Continuous improvement of pricing accuracy (better data, better models)
- Adding new pair coverage
- Adding new product types (FX hedges → invoice guarantees → shipping cover → factoring)
- Deeper platform integrations over time
- Building out the underwriter network

---

## 15. Phasing and Sequencing

Everything above takes 18-24 months minimum to build properly. Here's a realistic sequence.

### Phase 0 (Months 1-3): Strategic Decisions

- Commit to range-based product as default
- Commit to platform-distribution model
- Get regulatory scoping started
- Identify 5-10 target platform partners
- Secure or commit to 1 anchor underwriter relationship

No infrastructure work happens before these decisions.

### Phase 1 (Months 3-9): MVP Infrastructure

- Range-based product contracts (replace single-strike digitals)
- Realized-vol-only pricing engine (Phase 1 of vol oracle)
- Basic platform API (core endpoints, TypeScript SDK)
- Permissioning and multi-party roles
- Basic risk monitoring
- KYC/KYB integration with one provider
- First smart contract audit

Goal: ship something the first platform partner can integrate.

### Phase 2 (Months 9-15): First Production Deployments

- 1-2 platform integrations live with real volume
- Implied vol added for major pairs (Phase 2 of vol oracle)
- Underwriter dashboard and risk tools
- Settlement automation and oracle hardening
- SOC 2 audit preparation
- Compliance buildout
- Second smart contract audit

Goal: prove the model with real flow and one or two reference platforms.

### Phase 3 (Months 15-24): Scale and Expand

- Additional product types (invoice guarantees, shipping cover)
- Additional platform integrations (target 5-10 partners)
- Additional pair coverage (10+ pairs, Phase 3 of vol oracle)
- Backstop fund mechanism
- SOC 2 Type II completed
- Multiple underwriters per pair (real competitive pricing)
- Term structure and vol smile in pricing

Goal: be the obvious infrastructure choice for any B2B payment platform that wants to add hedging.

---

## 16. Critical Path and Dependencies

What blocks what:

- **Range product** blocks pricing engine (we're pricing the wrong thing without it)
- **Pricing engine** blocks platform API (platforms need to show real prices)
- **Vol oracle** blocks pricing engine (no inputs = no pricing)
- **Permissioning** blocks platform integrations (platforms can't be event creators without role infrastructure)
- **Compliance** blocks serious platform partnerships (their compliance teams won't approve without it)
- **Audits** block underwriter capital (institutions won't deposit without audit reports)
- **Regulatory clarity** blocks most production deployment (platforms won't risk integration without it)

The critical path is roughly: regulatory scoping → range product → pricing engine + vol oracle → platform API + permissioning → compliance + audits → first platform integration.

Anything outside this path can be parallelized or deferred.

---

## 17. Resource Requirements

To execute this roadmap in 18-24 months, the team needs roughly:

**Engineering:**
- 2-3 contract engineers (Solidity, security-focused)
- 2-3 backend engineers (pricing engine, API, services)
- 1-2 data engineers (vol oracle, rate oracle)
- 1 DevOps engineer
- 1 frontend engineer (dashboards, components)

**Operations:**
- 1 head of operations
- 1-2 partner success managers (later)
- 1 compliance officer

**Business:**
- 1 head of business development (platform partnerships)
- 1-2 BD/sales (later)

**Leadership:**
- CEO/founder
- CTO/technical lead

**External:**
- Regulatory counsel (retainer)
- Audit firms (engagement basis)
- Compliance vendors (subscription)

**Total team: ~12-15 people peak.**

**Annual operating cost at peak: ~$3-5M including data, vendors, audits, legal.**

---

## 18. Risk and Failure Modes

Worth being honest about what could kill this.

**Pricing engine doesn't get accurate enough.** EM vol is hard. If our prices are systematically wrong, underwriters lose money or hedgers overpay. Both kill volume.

**Platforms don't integrate.** BD doesn't land. Sales cycles drag. We build infrastructure no one uses.

**Underwriters don't show up.** Without backing capital, platforms can't offer the product even if integrated. We end up self-funding the pool, which doesn't scale.

**Regulatory determination is unfavorable.** A jurisdiction we care about classifies the protocol in a way that creates licensing requirements we can't meet. We lose access to that market.

**Operational incident damages credibility.** Oracle failure, settlement bug, hack — any of these in early days could end partnerships immediately.

**Competition from established players.** Wise Business, Airwallex, or a bank-backed fintech ships a similar product with their own customer base and we're outcompeted on distribution.

Mitigations are roughly:
- Conservative pricing (overcharge slightly to cushion vol uncertainty)
- Anchor partnerships before broad outreach (one good launch is worth twenty pitches)
- Self-fund a small backing pool to bridge underwriter cold start
- Multi-jurisdictional strategy (if Singapore says no, BVI/Cayman/somewhere else still works)
- Heavy investment in audit and operational excellence
- Deep platform partnerships create switching costs that resist competition

---

## 19. Summary

The infrastructure work to turn the current protocol into platform-grade infrastructure is substantial but tractable. The headline pieces:

1. **Move to range-based products** (3-4 weeks of contract work, eliminates gamma cliffs)
2. **Build a pricing engine** (3-4 months, depends on inputs being available)
3. **Build the vol oracle** (6-9 months, the largest single piece of work)
4. **Build rate curves infrastructure** (3 months, parallel to vol)
5. **Build risk and solvency infrastructure** (4-5 months)
6. **Build the platform API and SDK** (4-6 months)
7. **Build permissioning and multi-party roles** (6-8 weeks)
8. **Build compliance infrastructure** (6-12 months parallel work)
9. **Build pricing display and fairness layer** (3-4 months)
10. **Harden settlement and oracle reliability** (3-4 months)
11. **Build operations infrastructure** (continuous)
12. **Resolve regulatory positioning** (3-9 months, blocking most other work)

Total realistic timeline: **18-24 months from commitment to production-ready platform-grade infrastructure with first 2-3 platforms integrated and real volume flowing.**

Total realistic cost: **$5-10M including team, vendors, audits, legal, and operations during the build period.**

The good news: every piece of this work is well-understood. None of it requires research breakthroughs. It's all execution. The question is whether we commit to the platform-distribution model and execute it well, or stay general and build something less focused.

The recommendation is to commit. The model is right; the work is real but doable; the market opportunity justifies the investment. What's needed now is decision and sequencing, not more analysis.
