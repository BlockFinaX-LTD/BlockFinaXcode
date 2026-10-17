# Interest-Rate Settlement Rules v1.0

| Field | Value |
| --- | --- |
| Title | Interest-rate settlement rules |
| Version | 1.0 |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related documents | [Benchmark research](benchmark-research-v1.0.md), [Oracle architecture](oracle-architecture-v1.0.md), ADR-RATE-002, ADR-RATE-005 |
| Supersedes | None |

Every interest-rate product names its settlement benchmark and its settlement observation precisely. The phrase "latest available rate" is never used.

## 1. Payout

For a protection with amount `N`, strike `K` and cap `C` (rates in percent), and a settlement rate `R` over an accrual fraction `τ`:

```
rate protection payout (rate rises)  = N × max(0, min(R, C) − K) / 100 × τ
rate protection payout (rate falls)  = N × max(0, K − max(R, C)) / 100 × τ
τ = protection days / day-count basis (360 for USD, EUR and NGN; 365 for GBP, KES, GHS and ZAR; confirm per benchmark)
```

Example: 1,000,000 protected, strike 27.50%, settlement rate 29.50%, 90 days, basis 360. Payout = 1,000,000 × 2.00% × 90/360 = **5,000**.

## 2. Settlement observation by benchmark type

### Daily benchmarks (SOFR, KESONIA, ZARONIA, SONIA)
- **Default: compounded in arrears.** The settlement rate is the official daily rates compounded over the protection period, matching how a KESONIA or SOFR loan accrues. Where the administrator publishes a compounded index (SOFR Index, KESONIA Compounded Index, ZARONIA index), use `index(end) / index(start)`.
- **Alternative: single fixing.** The official rate for a named observation date (for example "SOFR for 31 December 2026"). Offered only where a borrower's loan genuinely uses a single fixing.
- **Lookback:** to give the oracle time to publish, the observation window ends a few business days before expiry (for example 2 days). This is the same convention loans use.

### Monthly reference rate (GRR)
- The GRR **in force on the expiry date**: the latest GRR whose effective date is on or before expiry, as published by the administrator.
- Minimum tenor of two publication periods.

### Auction rate (Ghana 91-day T-bill)
- The weighted-average rate of **the 91-day auction held on, or most recently before, the expiry date**, as published by the Bank of Ghana.
- If that week's auction is cancelled or the 91-day tenor gets no allotment, the previous successful auction's result applies. The product terms state how many weeks back this may go (proposed: 2). Beyond that, the protection is settled as MISSING (section 4).

### Policy rates (CBR, Ghana MPR, Nigeria MPR, SARB repo)
- The policy rate **in force at 17:00 local time on the expiry date**, as announced by the central bank. This is ADR-RATE-005.
- It is deliberately **not** "the decision of meeting X". That wording breaks when a meeting is postponed.
- **Postponed meeting:** if the meeting moves past expiry, the rate in force on expiry is unchanged. That is the correct answer for a borrower: their loan was not repriced either.
- **Meeting moved earlier, or an emergency meeting:** whatever was decided and in force by expiry counts.
- **Decision announced but effective later:** use the effective date in the official statement, not the announcement date.
- **Sales rule:** the app shows the next scheduled decision dates and warns when a protection's expiry falls before them, so a buyer does not pay for cover that cannot move.

## 3. Revisions
- **SOFR:** use the value after the same-day revision cutoff (about 14:30 ET). Later corrections are ignored.
- **SONIA:** use the value after the midday republication cutoff. The Bank makes no changes after that.
- **ZARONIA:** use the value after the 12:00 republication cutoff.
- **KESONIA, NOFR, GRR, T-bill:** the revision policy is not confirmed. Until it is, settlement waits a fixed revision window (proposed: until 12:00 local on the next business day after publication), then locks.
- Once a value is locked and submitted on chain, later revisions do not change settled protections. They are recorded as REVISED off chain for audit.

## 4. Missing or delayed publication

| Situation | State | Rule |
| --- | --- | --- |
| Not yet due | PENDING | Wait |
| Published within window | PUBLISHED | Settle after the revision cutoff |
| Past the expected time plus grace | DELAYED | Keep waiting; no substitution |
| Official holiday or weekend | PENDING | Not stale: the schedule knows it does not publish |
| Still absent after the settlement deadline (proposed: 10 business days after expiry) | MISSING | The administrator's own published fallback applies if one exists (for example SONIA's contingency rate, or CBR for KESONIA). Otherwise each protection pays nothing and its premium is refunded, unless governance approves an official late value within a further window. |
| Administrator corrects a value before cutoff | REVISED then PUBLISHED | Use the corrected value |
| Benchmark discontinued (JIBAR-style) | DISCONTINUED | No new sales; outstanding protections use the administrator's published replacement and spread if one exists, otherwise the MISSING rule |

A third-party rate is never substituted silently. Third-party sources only flag anomalies.

## 5. Questions to settle before productising
1. Refund-on-MISSING vs extend-and-wait: which is fairer to hedgers and underwriters? (Proposed: refund premium, release capital.)
2. Day-count basis per benchmark: confirm with each administrator.
3. KESONIA, NOFR and ZARONIA correction policies: request from the administrators.
4. GRR effective-date rule and formula: request from GAB and the Bank of Ghana.
