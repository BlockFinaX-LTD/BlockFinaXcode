# Interest-Rate Oracle Architecture v1.0

| Field | Value |
| --- | --- |
| Title | Interest-rate oracle architecture |
| Version | 1.0 |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related documents | [Benchmark registry](benchmark-registry-v1.0.md), [Settlement rules](settlement-rules-v1.0.md), [Pricing integration](pricing-integration-v1.0.md), ADR-RATE-001 to ADR-RATE-004 |
| Supersedes | None |

## 1. Principle

The oracle attests to **what an official benchmark published**: value, observation date and publication. It never predicts. Expectations of future rates belong in the pricing engine.

## 2. Components

```
official source  ──fetch──>  adapter (one per benchmark)  ──normalise──>  observation store (off chain, raw evidence kept)
                                                                     │
validation source ──compare──> anomaly check (flag only)            ▼
                                                     oracle nodes (2 of 2 today) submit
                                                     {benchmarkId, observationDate, rate}
                                                                     │
                                                                     ▼
                                                  rate consensus contract (on chain)
```

- **Adapter per benchmark:** knows the source URL and format, the field holding the observation date, precision, and revision fields.
- **Observation store:** keeps every fetch with the raw payload, fetch time, publication time and observation date. This is the audit trail and is never put on chain.
- **Scheduler:** knows each benchmark's calendar (business days, holidays, expected time, grace). It fetches only around expected publication and marks states.
- **Nodes:** independent operators running the same adapters against the same official source.

## 3. Canonical rate format

- **Stored and on chain:** an integer number of **millionths of a percent** (rate × 10^6, in percent). 3.87% is `3870000`. 27.50% is `27500000`. It is signed, because some benchmarks can go negative.
- **API and documents:** a decimal string in percent with six places: `"3.870000"`. Fractions such as 0.0387 are never used anywhere.
- **Conversion:** each adapter converts from the source's own scale, and validation rejects implausible scales (section 6).

Normalised observation:

```json
{
  "benchmark": "SOFR",
  "currency": "USD",
  "ratePercent": "3.890000",
  "rateMicroPercent": 3890000,
  "observationDate": "2026-10-15",
  "publishedAt": "2026-10-16T12:00:00Z",
  "fetchedAt": "2026-10-16T12:03:11Z",
  "source": "NEW_YORK_FED",
  "sourceReference": "markets.newyorkfed.org/api/rates/secured/sofr",
  "revision": "NONE",
  "status": "PUBLISHED"
}
```

## 4. Three different dates

| Field | Meaning | Example (KESONIA) |
| --- | --- | --- |
| `observationDate` | The business day the rate represents | Thursday |
| `publishedAt` | When the administrator published it | Friday 09:00 |
| `fetchedAt` | When our node read it | Friday 09:04 |

Settlement always selects by **observationDate**, as product terms define it, never by "latest fetched".

## 5. Freshness is per benchmark

| Benchmark | Expected publication | Valid until | Grace |
| --- | --- | --- | --- |
| SOFR | US business days ~08:00 ET | Next expected publication | 4 hours |
| KESONIA | KE business days by 09:00 EAT | Next expected publication | 4 hours |
| ZARONIA | SA business days 10:00 SAST | Next expected publication | 4 hours |
| GRR | About monthly, irregular | Until the next GRR's effective date (at least 30 working days per GAB) | 10 business days past the expected month |
| Ghana 91-day | Weekly auction results | Until the next auction's results | 3 business days |
| Policy rates | Only at decisions | Until the next decision | Not applicable |

Weekends and official holidays never make a value stale. The FX oracle's 15-minute rule does not apply here.

## 6. Validation before accepting a value
1. The benchmark ID and source match the registry entry.
2. The observation date is a valid business day in the benchmark's calendar, and is the one expected for this publication.
3. Publication falls in the expected window, or is flagged DELAYED.
4. Decimal scale: within the registry's plausible range (for example SOFR −2% to 25%; KESONIA 0% to 40%; NOFR 0% to 60%). Values outside are rejected as malformed, not clipped.
5. Zero is rejected unless the registry says it is legitimate.
6. Negative values are allowed only where the registry permits them.
7. For term benchmarks, the tenor must match the ID exactly (EURIBOR_3M is never EURIBOR_1M).
8. The validation source is compared only to flag differences beyond a tolerance. It never replaces the official value.

## 7. Consensus

Each submission carries the identity `(benchmarkId, observationDate)` and a value. Consensus forms only when the quorum agrees on the **same identity and the same value within tolerance** (proposed: exact match for official published decimals). Two nodes can never agree on a number for different observation dates. This extends today's oracle-consensus contract, whose key is a hedge event ID: the new key is the benchmark and observation date.

## 8. What goes on chain

| Field | Purpose |
| --- | --- |
| benchmarkId (short code) | Which benchmark |
| observationDate (days since epoch) | Which fixing |
| rateMicroPercent (signed integer) | The value |
| acceptedAt (timestamp) | When consensus formed |
| round (counter) | Audit |
| status | PUBLISHED, REVISED or MISSING |

Raw payloads, URLs and fetch logs stay off chain in the observation store. Writing the number on chain may count as redistribution, which is a licensing question per benchmark (see [licensing](licensing-v1.0.md)).

## 9. States

`PENDING → PUBLISHED`, `PENDING → DELAYED → PUBLISHED | MISSING`, `PUBLISHED → REVISED` (before the cutoff only), `ANY → DISCONTINUED`.

## 10. Testing plan (when built)

For each integrated benchmark:
- successful fetch, and the expected observation date
- weekend, public holiday, and delayed publication
- duplicate fetch, malformed response, zero rate, and a negative rate where allowed
- wrong decimal scale, wrong tenor, and an old observation date
- revised publication, official-source outage, and fallback handling
- consensus agreement and disagreement, including two nodes agreeing on a value but for different dates

Holiday calendars are tested against each administrator's published calendar for the next 12 months.
