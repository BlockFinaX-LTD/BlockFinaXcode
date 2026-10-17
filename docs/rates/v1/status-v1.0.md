# Rate Oracle v1 Status

| Field | Value |
| --- | --- |
| Title | Interest-rate oracle v1 build status |
| Version | 1.0 |
| Status | Testnet |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related documents | [Oracle architecture](oracle-architecture-v1.0.md), [Benchmark registry](benchmark-registry-v1.0.md), [Settlement rules](settlement-rules-v1.0.md), [Licensing](licensing-v1.0.md) |
| Supersedes | None |

## Verdict

**RATE ORACLE V1 READY FOR TESTING** on Stellar testnet, for nine benchmarks (section 6). Treasury bill rates are deliberately excluded.

It is **not ready for production**. The blockers are listed in section 4. Nothing here prices or settles an interest-rate protection yet; that is the next stage (market type and payout formula).

## 1. What was built

| Part | Where | Notes |
| --- | --- | --- |
| Benchmark registry | `shared/rates/benchmarks.ts` | All 14 researched benchmarks. Production `enabled` is false for all; only SOFR and KESONIA have `testnet: true` |
| Canonical format | same file | Integer micro-percent, exact string conversion, no floating point |
| Calendars | `server/rates/calendar.ts` | US bond market (SIFMA) for SOFR, Kenya public holidays for KESONIA, 2025 to 2027 |
| Validation and freshness | `server/rates/validate.ts` | Registry checks, expected observation date, PENDING / DELAYED, revision cutoffs |
| Source adapters | `server/rates/adapters.ts` | NY Fed Markets API (fallback: its search endpoint); CBK KESONIA table |
| Observation store | `shared/rate-oracle-schema.ts`, `server/rates/service.ts` | `rate_observations` (one value per benchmark and date, with revision history), `rate_fetches` (every fetch with raw payload and rejections) |
| API | `server/routes/rate-oracle.ts` | `GET /api/v2/benchmarks`, `/benchmarks/:id`, `/benchmarks/:id/observations`, `/benchmarks/:id/observations/:date`. SOFR responses carry the New York Fed notice |
| Scheduler | `server/rates/scheduler.ts` | Every 30 minutes on testnet; 30-day backfill at startup |
| Consensus contract | `blockfinax-stellar/contracts/rate-oracle` | Fixing key is (benchmark, observation day); exact match; final fixings never change; MISSING by governance |
| Node submitter | `server/rates/submitter.ts` | Submits only values past their revision cutoff; records fixings already on chain instead of resubmitting |

**Testnet deployment:** contract `CD365JGPPVPSTUWRSSLWNB663TE5XEYY72OXWV6ZROF4UD5XYA5T4BC2`, owner `bfx-tn-admin`, nodes `bfx-tn-oracle-1` and `bfx-tn-oracle-2`, quorum 2 of 2. Benchmarks registered: SOFR (−2% to 25%), KESONIA (above 0% to 40%), both accepting observations up to 30 days old.

## 2. Evidence

- **Live sources (2026-10-17):** both adapters fetched 30 observations with none rejected. Latest: SOFR 3.89% and KESONIA 8.7504%, both for observation date 2026-10-15, both state PUBLISHED.
- **Calendars:** checked against the gaps in each source's own history. SOFR from Jan 2025 to Oct 2026 matched the bond-market holidays, including Good Friday, Columbus Day and Veterans Day. KESONIA from Sept 2025 to Oct 2026 matched the Kenyan holidays, including the one-off 17 Oct 2025 holiday.
- **On chain:** 7 fixings formed (SOFR 9, 13, 14, 15 Oct; KESONIA 12, 13, 14 Oct). KESONIA 15 Oct was correctly held back until its revision window closes (Monday 19 Oct, 12:00 Nairobi time). A second run submitted nothing and recorded the existing fixings.
- **Tests:**
  - Server: 24 tests in `server/rates/__tests__/rate-oracle.test.ts`. The full suite has 354 tests, all passing.
  - Contract: 15 tests, all passing.

| Plan case (architecture section 10) | Covered by |
| --- | --- |
| Successful fetch and expected observation date | parse tests, expected-date tests, live run |
| Weekend, public holiday, delayed publication | calendar and freshness tests |
| Duplicate fetch, malformed response, zero, negative where allowed | store and validation tests |
| Wrong decimal scale, wrong tenor, old observation date | validation tests, contract range and age tests |
| Revised publication (before and after cutoff) | store tests, contract vote-correction and final-fixing tests |
| Source outage and fallback | outage and fallback tests |
| Consensus agreement, disagreement, same value for different dates | contract tests |

## 3. Known limits on testnet

1. **Both nodes run in one server with keys held together.** This proves the protocol, not independence. A single bad fetch reaches both nodes.
2. **Future holidays are provisional.** Eid dates and Kenya's short-notice holidays can differ. An unlisted holiday shows as DELAYED until an operator adds the date.
3. **No validation source yet.** There is no third-party comparison or anomaly flag beyond the registry's plausible range.
4. **MISSING is manual.** The contract supports it, but nothing raises it automatically after the settlement deadline.
5. **On-chain fixing storage lives about 6 months per extension.** Each read extends it, but a keeper should extend fixings that open protections depend on.

## 4. Before production

1. **Licensing:**
   - KESONIA is UNCONFIRMED. Write to CBK about commercial use, on-chain publication and the correction policy.
   - SOFR is cleared, but the notice must also appear in the UI wherever SOFR is shown.
2. **Independent operators:** at least two separate operators, each with its own infrastructure and keys, then raise the quorum.
3. **KESONIA revision policy:** the 12:00 next-business-day lock is our assumption until CBK states its policy.
4. **Calendar sources:** an official 12-month calendar for each administrator, with an owner who updates it.
5. **Monitoring:** an alert when a benchmark is DELAYED, when a fetch is rejected, and when on-chain and stored values differ.
6. **Governance key:** move the contract owner to a multisig.

## 5. Next stage

Interest-rate protection pools:
- the market type
- the payout formula (compounded in arrears for SOFR and KESONIA)
- pricing per the [pricing integration](pricing-integration-v1.0.md) plan

These read fixings by observation day from this contract.

## 6. Benchmarks on testnet (update, 2026-10-17)

| ID | Market | Kind | Official source | Calendar | Basis |
| --- | --- | --- | --- | --- | --- |
| SOFR | USD | Overnight | New York Fed Markets API | US bond market (SIFMA) | 360 |
| EFFR | USD | Overnight | New York Fed Markets API | Fedwire (open on Good Friday) | 360 |
| ESTR | EUR | Overnight | ECB Data Portal (SDMX) | TARGET2 | 360 |
| KESONIA | KES | Overnight | Central Bank of Kenya table | Kenya | 365 |
| NOFR | NGN | Overnight | Central Bank of Nigeria API | Nigeria | 360 |
| GHS_INTERBANK | GHS | Overnight | Bank of Ghana interbank table (same-day) | Ghana | 365 |
| KES_CBR | KES | Policy, in force each weekday | Central Bank of Kenya CBR table | Weekdays | 365 |
| GHS_MPR | GHS | Policy, in force each weekday | Bank of Ghana policy rate history (effective dates) | Weekdays | 365 |
| UK_BANK_RATE | GBP | Policy, in force each weekday | Bank of England database (IUDBEDR) | Weekdays | 365 |

Calendars for Ghana, Nigeria, TARGET2 and Fedwire were derived from the gaps in each source's own history; future dates are provisional.

Not built, and why:
- **South Africa (ZARONIA, repo rate):** the SARB data service did not respond from our network.
- **Egypt, Morocco, Uganda, Rwanda, Tanzania, Zambia, Mauritius, Botswana, BCEAO:** no machine-readable official source was found yet.
- **Nigeria MPR:** CBN publishes it only monthly, about two months late; NOFR covers Nigeria instead.
- **SONIA:** needs a Bank of England licence for redistribution.
- **Treasury bill rates:** excluded by product decision.

Kenya CBR uses the MPC meeting date in the CBK table as the effective date; confirm against CBK statements.
Policy-rate protection compounds the daily rate in force (ADR-RATE-005 amendment).
