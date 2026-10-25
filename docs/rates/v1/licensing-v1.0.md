# Interest-Rate Data Licensing v1.0

| Field | Value |
| --- | --- |
| Title | Interest-rate benchmark data rights |
| Version | 1.0 |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related documents | [Benchmark research](benchmark-research-v1.0.md), ADR-RATE-004 |
| Supersedes | None |

This is a research summary, not legal advice. No commercial oracle feed goes live before rights are confirmed in writing where marked.

**An open question for every benchmark:** writing a benchmark value on a public blockchain makes it readable by anyone. Regulators and administrators may treat that as redistribution. Ask each administrator explicitly.

| Benchmark | Free commercial use | Licence needed | Redistribution | Delayed-data rules | API terms | On chain may count as redistribution | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOFR | Yes, under NY Fed Terms of Use | No | Permitted with notice, disclaimer and non-affiliation statement; must not add stricter terms | None | Covered by the website terms; check the API documentation | Allowed under the terms with notice; confirm | **Cleared, with notices** |
| SONIA | Free to access via IADB under the Open Government Licence | Direct licence for redistribution to clients, exchange-listed derivatives, clearing, and client valuation | Restricted (needs a direct licence) | Free on IADB from 10:00 next working day | IADB | Likely yes, so a licence is likely needed | **Needs licence**: email benchmarkadministration@bankofengland.co.uk |
| EURIBOR | No (free data is 24h delayed and non-commercial) | Mandatory subscription; derived-data licence (EMMI 2026-27: EUR 38,000 a year) | Not to third parties under a standard plan | Non-commercial only | Vendor agreements | Yes | **Blocked** until licensed |
| KESONIA | Not stated | Unknown | Unknown | Unknown | No API | Unknown | **Unconfirmed**: ask CBK |
| NOFR | Not stated | Unknown | Unknown | Unknown | Unknown | Unknown | **Unconfirmed**: ask CBN |
| GRR | Not stated (industry association) | Unknown | Unknown | Unknown | None | Unknown | **Unconfirmed**: ask GAB and the Bank of Ghana |
| Ghana 91-day | Government auction results, typically public | Unknown | Unknown | Unknown | Unknown | Unknown | **Unconfirmed**: ask BoG |
| ZARONIA | Not stated; SARB disclaims liability | Unknown | Unknown | Unknown | Unknown | Unknown | **Unconfirmed**: ask sarb-benchmarks@resbank.co.za |
| Policy rates | Public announcements | Usually not | Generally allowed with attribution | None | None | Low risk; confirm | Low risk |

## Actions before production
1. Write to CBK, CBN, SARB, GAB and BoG asking: commercial use, redistribution, on-chain publication, correction policy, official data feed.
2. Write to the Bank of England about a SONIA licence for an on-chain settlement oracle.
3. Keep EURIBOR out of scope until a budget and licence decision.
4. Add the New York Fed notice, disclaimer and non-affiliation statement wherever SOFR is shown.
