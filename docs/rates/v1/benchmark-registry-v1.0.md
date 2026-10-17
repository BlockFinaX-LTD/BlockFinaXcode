# Interest-Rate Benchmark Registry v1.0

| Field | Value |
| --- | --- |
| Title | Interest-rate benchmark registry |
| Version | 1.0 |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related documents | [Oracle architecture](oracle-architecture-v1.0.md), [Benchmark research](benchmark-research-v1.0.md) |
| Supersedes | None |

Code refers to benchmarks only by canonical ID, never by free-text names.

## 1. Shape

```
Benchmark {
  id                      canonical ID, e.g. KESONIA
  name                    official name
  currency                ISO 4217
  administrator           e.g. CENTRAL_BANK_OF_KENYA
  type                    DAILY_OVERNIGHT | TERM | MONTHLY_REFERENCE | AUCTION | POLICY
  tenor                   for TERM only, e.g. 3M
  frequency               BUSINESS_DAILY | MONTHLY | WEEKLY_AUCTION | ON_DECISION
  source                  primary official endpoint and parser
  fallbackSource          official alternative (never a third party)
  validationSource        third party, anomaly checks only
  decimals                published precision
  publicationTime         local time and zone
  observationConvention   SAME_DAY | PREVIOUS_BUSINESS_DAY | EFFECTIVE_DATE | AUCTION_DATE | IN_FORCE_ON_DATE
  businessDayCalendar     calendar ID
  revisionCutoff          rule
  plausibleRange          [min, max] in percent
  allowsNegative          boolean
  dayCountBasis           360 | 365
  compoundedIndex         official index ID if one exists
  licensingStatus         CLEARED | NEEDS_LICENCE | UNCONFIRMED | BLOCKED
  enabled                 boolean (false until licensing CLEARED and tests pass)
}
```

## 2. Initial entries (all `enabled: false` until cleared)

| ID | Type | Observation | Publication | Calendar | Range | Negative | Basis | Licensing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SOFR | DAILY_OVERNIGHT | PREVIOUS_BUSINESS_DAY (`effectiveDate`) | ~08:00 America/New_York | US_FED | −2 to 25 | yes | 360 | CLEARED (notice and disclaimer) |
| SONIA | DAILY_OVERNIGHT | PREVIOUS_BUSINESS_DAY | 09:00 Europe/London | UK_LONDON | −2 to 25 | yes | 365 | NEEDS_LICENCE |
| EURIBOR_1M | TERM | SAME_DAY | 11:00 Europe/Brussels | TARGET2 | −2 to 25 | yes | 360 | BLOCKED |
| EURIBOR_3M | TERM | SAME_DAY | 11:00 Europe/Brussels | TARGET2 | −2 to 25 | yes | 360 | BLOCKED |
| EURIBOR_6M | TERM | SAME_DAY | 11:00 Europe/Brussels | TARGET2 | −2 to 25 | yes | 360 | BLOCKED |
| KESONIA | DAILY_OVERNIGHT | PREVIOUS_BUSINESS_DAY | by 09:00 Africa/Nairobi | KE_CBK | 0 to 40 | no | 365 (confirm) | UNCONFIRMED |
| NOFR | DAILY_OVERNIGHT | PREVIOUS_BUSINESS_DAY | 10:00 Africa/Lagos | NG_CBN | 0 to 60 | no | 360 (confirm) | UNCONFIRMED |
| GHS_REFERENCE_RATE | MONTHLY_REFERENCE | EFFECTIVE_DATE (in force on date) | irregular, about monthly | GH | 0 to 60 | no | 365 (confirm) | UNCONFIRMED |
| GHS_TBILL_91D | AUCTION | AUCTION_DATE | after the weekly auction | GH | 0 to 60 | no | 364/365 (confirm) | UNCONFIRMED |
| ZARONIA | DAILY_OVERNIGHT | PREVIOUS_BUSINESS_DAY (confirm) | 10:00 Africa/Johannesburg | ZA_SARB | 0 to 30 | no | 365 | UNCONFIRMED |
| KES_CBR | POLICY | IN_FORCE_ON_DATE | on decision | KE_CBK | 0 to 40 | no | 365 | public announcement |
| GHS_MPR | POLICY | IN_FORCE_ON_DATE | on decision | GH | 0 to 60 | no | 365 | public announcement |
| NGN_MPR | POLICY | IN_FORCE_ON_DATE | on decision | NG_CBN | 0 to 60 | no | 360 | public announcement |
| ZAR_REPO | POLICY | IN_FORCE_ON_DATE | on decision | ZA_SARB | 0 to 30 | no | 365 | public announcement |

Values marked "confirm" are working assumptions from research and must be verified with the administrator.
