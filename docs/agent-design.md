# Mini-CEO Agent — Design

Status: **proposal, not yet built**
Author: drafted for Anthony Kumako, August 2026

---

## 1. What this is

A chief of staff, not a decision-maker.

It watches the business, notices things worth acting on, drafts the action, and
waits. Anthony approves, edits, or rejects. Only then does anything happen.

The distinction matters more than it sounds. An agent that *acts* needs to be
right. An agent that *proposes* only needs to be useful — a bad proposal costs
one click to reject, where a bad action costs a counterparty relationship.

Everything below follows from that.

---

## 2. The spine: propose → approve → act

```
 detector           agent              you              executor
 (SQL, cheap)       (LLM, drafts)      (approve/edit)   (existing code paths)
     │                  │                   │                  │
     ├─ finds a         ├─ writes the       ├─ Approve ────────┤─ sends the email
     │  stale LOI       │  follow-up        ├─ Edit + Approve  │  via the same
     │                  │  and rationale    └─ Reject          │  route the admin
     │                  │                                      │  UI already uses
```

Two deliberate choices here.

**Detection is deterministic; only the writing is model-generated.** Whether an
LOI has gone quiet for twelve days is a SQL question with a correct answer.
Asking a language model to decide that is slower, costlier, and occasionally
wrong. The model's job is the *words*, not the *judgement about facts*.

**Execution reuses existing code paths.** When a follow-up is approved it goes
out through the same `/api/loi/:id/remind` route the admin UI calls. The agent
gets no private back door, so it inherits every guard already written.

---

## 3. Permission tiers

| Tier | Capability | Approval |
|---|---|---|
| **0** | Answer questions, summarise, search | None — read-only |
| **1** | Draft an email, revision, or update | Required before sending |
| **2** | Act on internal state (send a reminder, schedule a follow-up) | Required |
| **3** | **Sign · move money · change contract parameters · publish counterparty names · delete records** | **Never, at any tier** |

Tier 3 is not a setting that defaults to off. **Those tools do not exist.** The
agent has no function to call that signs a document or transfers funds, so no
prompt — mistaken, adversarial, or injected — can reach them.

This matters because of something already built: signing requires a one-time
code sent to the counterparty's own inbox. That exists precisely so a human
proves identity. An agent with a route around it would quietly undo the
guarantee the whole signing system rests on.

The same reasoning covers the data room. Counterparty identities are published
only behind an explicit per-document opt-in, because the letter itself binds
both sides to confidentiality. That decision stays human.

---

## 4. Data model

Four new tables. Names follow the existing convention.

### `agent_proposals`

The queue. One row per thing the agent thinks should happen.

| Column | Notes |
|---|---|
| `id` | serial |
| `kind` | `loi_followup`, `loi_reminder`, `weekly_digest`, … |
| `title` | one line, for the queue list |
| `rationale` | why the agent raised it — shown before you approve |
| `payload` | jsonb — the draft itself (subject, body, target id) |
| `edited_payload` | jsonb — your version, when you change it before approving |
| `status` | `proposed` → `approved` \| `rejected` → `executed` \| `failed` |
| `priority` | `low` \| `normal` \| `high` |
| `source_type` / `source_id` | e.g. `loi` / `12`, so the queue can deep-link |
| `proposed_at`, `decided_at`, `decided_by`, `executed_at` |
| `error` | populated when execution fails |

Rejections are kept, not deleted. A proposal type you reject nine times out of
ten is a signal the detector is wrong, and that only shows up if the rejections
survive.

### `agent_runs`

One row per scan. Makes cost and behaviour observable rather than mysterious.

`id`, `trigger` (`schedule` \| `manual` \| `event`), `started_at`,
`finished_at`, `tokens_in`, `tokens_out`, `cost_usd`, `proposals_created`,
`error`.

### `agent_messages`

The in-app chat. `id`, `thread_id`, `role`, `content`, `tool_calls` jsonb,
`created_at`.

### `agent_facts` *(later)*

Durable notes the agent keeps between runs — "Meridian asked to revisit
exclusivity in September". Deliberately out of phase 1: memory that is wrong is
worse than no memory.

---

## 5. Read tools

The agent answers **only** from tool results, never from what it seems to
remember. Every number it states has to have come back from one of these:

| Tool | Source |
|---|---|
| `get_revenue(period)` | `platform_fees` + on-chain fee reads |
| `get_pools(status?)` | `hedge_events` + the Diamond |
| `get_agreements(status?)` | `loi_documents` |
| `get_activity(limit)` | `hedge_activity` |
| `get_traction()` | the same payload the data room renders |
| `get_users(period)` | `user_accounts`, `wallets` |
| `search_docs(query)` | data room content, academy lessons |

If no tool covers a question, the correct answer is "I can't see that" — not a
plausible number. For a business where the investor pitch rests on figures
being verifiable on-chain, an agent that occasionally invents revenue is worse
than no agent.

---

## 6. Proposal types

Each pairs a deterministic detector with a drafting prompt.

| Kind | Detector (SQL) | Draft |
|---|---|---|
| `loi_followup` | sent ≥ 7 days ago, `first_viewed_at` null | short nudge to the counterparty |
| `loi_reminder` | expires within 3 days, unsigned | reminder referencing the deadline |
| `loi_stale_changes` | `changes_requested` ≥ 4 days, unresolved | reply addressing their comments |
| `pool_low_liquidity` | cover sold, liquidity below threshold | internal alert, no external send |
| `weekly_digest` | every Monday | the week in revenue, pools, agreements |

The first three reuse the LOI system end to end. `weekly_digest` is the one
most likely to earn its keep daily.

---

## 7. Meetings — buy, don't build

[Recall.ai](https://recall.ai) puts a bot into Zoom, Meet and Teams and returns
a transcript over an API. Building the equivalent means running headless
browsers per platform and tracking their changes indefinitely. That is a
product, not a feature.

**Consent is a build requirement, not a footnote.** Several US states require
all-party consent; GDPR applies across the EU. Recording an underwriter call
without explicit, recorded consent is real liability. The flow needs a consent
step captured per meeting — the same audit discipline the signing system
already uses.

Transcript → summary → action items → proposals, through the same queue as
everything else.

---

## 8. Cost

| Item | Estimate |
|---|---|
| Question answered in-app | ~$0.01–0.05 |
| Daily scan across all detectors | ~$0.10–0.50 |
| **Claude API, monthly** | **~$10–40 at current scale** |
| Recall.ai, per meeting | ~$0.50–2.00 |

`agent_runs` records actual spend per run, so this stops being an estimate
after the first week.

---

## 9. Phasing

**Phase 1 — days.** Chat, read tools, `agent_proposals`, approval UI. Read-only:
a wrong answer costs nothing while trust is being built.

**Phase 2 — about a week.** Detectors, drafting, scheduled runs, execution on
approval. The busywork starts disappearing here.

**Phase 3.** Meetings, once consent is designed.

**Phase 4.** Memory (`agent_facts`), and proposals that learn from what gets
rejected.

---

## 10. Prerequisites

1. **An Anthropic API key.** Nothing starts without it — there is currently no
   LLM anywhere in this codebase. [console.anthropic.com](https://console.anthropic.com)
   → API Keys → Create Key. $20 of credit is a comfortable start.
2. **A decision on model tier.** Sonnet is the sensible default for drafting and
   Q&A; Opus only if the drafting quality proves insufficient.
3. **Recall.ai account** — phase 3 only.

---

## 11. Open questions

- **Who else gets access?** Amschel is in `ADMIN_EMAILS`. Should proposals be
  approvable by anyone with admin, or only by you?
- **How do you want to be told?** Email digest, in-app badge, or both.
- **How aggressive should follow-ups be?** Seven days of silence is a guess —
  it should be a setting.
- **Should the agent see counterparty names?** It needs them to draft a useful
  follow-up. Worth deciding deliberately rather than by default.

---

## 12. What this design refuses to do

Worth stating plainly, because "mini CEO" invites the opposite reading.

It will not decide to take a deal, set a price, commit capital, or sign
anything. It drafts, reminds, summarises and answers. Every outward-facing
action passes through a human first.

That is not timidity about capability. It is that the failure modes on the
other side of that line — a signature you did not authorise, funds moved on a
misparse — are not recoverable by clicking undo.
