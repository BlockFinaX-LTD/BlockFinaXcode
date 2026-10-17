# ADR-RATE-003: Freshness follows each benchmark's publication schedule

| Field | Value |
| --- | --- |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related | [Oracle architecture](../rates/v1/oracle-architecture-v1.0.md) |

**Context.** The FX oracle treats prices older than 15 minutes as stale. Rate benchmarks publish daily, weekly, monthly or only at decisions.

**Decision.** Each registry entry carries its calendar, expected publication time, grace period and validity rule. A value is stale only when its next expected publication has passed plus grace. Weekends and holidays are never stale.

**Reason.** Applying FX rules would mark valid rates stale every night and every weekend, and block settlement.

**Alternatives.** One global staleness window (rejected).

**Consequences.** Holiday calendars must be maintained and tested per administrator.
