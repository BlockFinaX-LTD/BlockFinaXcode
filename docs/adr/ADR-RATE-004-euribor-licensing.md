# ADR-RATE-004: No EURIBOR (and no SONIA redistribution) without a licence

| Field | Value |
| --- | --- |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related | [Licensing](../rates/v1/licensing-v1.0.md) |

**Context.** EMMI requires a subscription for any commercial use of EURIBOR. Free delayed data is non-commercial only, and derived products need a separate licence. The Bank of England requires a direct licence to redistribute SONIA to clients. A value written on a public chain may be redistribution.

**Decision.** EURIBOR stays out of scope until licensed. SONIA is not enabled until the Bank confirms the licensing position in writing. Every other benchmark stays disabled until its administrator confirms commercial and on-chain use.

**Reason.** Running a settlement feed without data rights risks shutdown and liability.

**Alternatives.** Use delayed or third-party EURIBOR (rejected: still non-commercial or unlicensed).

**Consequences.** SOFR (cleared, with notices) and KESONIA (pending CBK confirmation) lead. EUR exposure waits.
