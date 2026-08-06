/**
 * Telling Anthony there's something waiting.
 *
 * Batched rather than one email per proposal. A scan that finds five stale
 * letters would otherwise produce five emails in the same second, which trains
 * you to ignore them — and an ignored notification is worse than none, because
 * it also stops you checking the dashboard.
 *
 * So: a sweep runs on a timer, and if anything has appeared since the last
 * sweep it sends one digest covering all of it. Nothing pending means no email.
 * `notified_at` is what makes that idempotent — a proposal is only ever in one
 * digest, so a restart mid-sweep cannot double-send.
 *
 * Goes only to the approvers. Notifying people who cannot act on it is noise.
 */

import { and, isNull, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { agentProposals, PROPOSAL_KIND_LABELS, type ProposalKind } from "@shared/agent-schema";
import { sendEmail, shell, escapeHtml, APP_URL } from "../email";
import { getApproverEmails } from "../middleware/admin-auth";

/** How often the sweep runs. Long enough to batch, short enough to be useful. */
export const DIGEST_INTERVAL_MS = 30 * 60_000;

const kindLabel = (k: string) => PROPOSAL_KIND_LABELS[k as ProposalKind] ?? k;

function proposalRow(p: typeof agentProposals.$inferSelect): string {
  const body = String((p.payload as any)?.body ?? (p.payload as any)?.text ?? "").trim();
  const preview = body.length > 220 ? `${body.slice(0, 220)}…` : body;
  const urgent = p.priority === "high";

  return `
    <div style="margin:0 0 14px;padding:14px 16px;border:1px solid ${urgent ? "#fbbf24" : "#e6eaf2"};border-radius:12px;background:${urgent ? "#fffbeb" : "#ffffff"};">
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">
        ${escapeHtml(kindLabel(p.kind))}${urgent ? " · needs attention" : ""}
      </p>
      <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#0f1a2f;">${escapeHtml(p.title)}</p>
      ${p.rationale ? `<p style="margin:0 0 8px;font-size:12px;line-height:1.55;color:#5b6577;">${escapeHtml(p.rationale)}</p>` : ""}
      ${preview ? `<p style="margin:0;padding:10px 12px;background:#f5f7fb;border-radius:8px;font-size:12px;line-height:1.6;color:#0f1a2f;white-space:pre-wrap;">${escapeHtml(preview)}</p>` : ""}
    </div>`;
}

/**
 * Sends one digest of everything not yet notified about.
 *
 * Returns what it did so the caller — and the manual trigger in the admin UI —
 * can report honestly rather than always claiming success.
 */
export async function sendPendingDigest(): Promise<{ sent: boolean; count: number; reason?: string }> {
  let pending: (typeof agentProposals.$inferSelect)[];
  try {
    pending = await db
      .select()
      .from(agentProposals)
      .where(and(eq(agentProposals.status, "proposed"), isNull(agentProposals.notifiedAt)))
      .orderBy(agentProposals.id);
  } catch (err: any) {
    return { sent: false, count: 0, reason: `Could not read proposals: ${err?.message}` };
  }

  if (!pending.length) return { sent: false, count: 0, reason: "Nothing new waiting." };

  const to = getApproverEmails();
  if (!to.length) return { sent: false, count: pending.length, reason: "No approvers configured." };

  const n = pending.length;
  const heading = n === 1 ? "One thing needs your decision" : `${n} things need your decision`;

  const body = `
    <h2 style="font-size:19px;margin:0 0 10px;font-weight:600;letter-spacing:-0.01em;">${heading}</h2>
    <p style="font-size:14px;color:#0f1a2f;line-height:1.55;margin:0 0 18px;">
      The agent has drafted ${n === 1 ? "this" : "these"} and is waiting. Nothing has been sent —
      ${n === 1 ? "it goes out" : "they go out"} only once you approve.
    </p>
    ${pending.map(proposalRow).join("")}
    <div style="margin:22px 0;">
      <a href="${APP_URL}/admin#agent" style="display:inline-block;background:#1a4480;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:12px;">Review and decide</a>
    </div>
    <p style="font-size:12px;color:#6b7280;line-height:1.5;margin:0;">
      You can approve as drafted, edit before approving, or reject. Editing teaches it the most —
      the difference between what it wrote and what you send is what it learns from.
    </p>`;

  const mail = await sendEmail({
    to,
    subject: `[BlockFinaX] ${heading.toLowerCase()}`,
    html: shell("Agent proposals", body, { tag: "" }),
  });

  if (!mail.ok) return { sent: false, count: n, reason: mail.error };

  // Mark only what actually went into this digest. Anything created while the
  // email was in flight stays unnotified and lands in the next one.
  await db
    .update(agentProposals)
    .set({ notifiedAt: new Date() })
    .where(inArray(agentProposals.id, pending.map((p) => p.id)));

  return { sent: true, count: n };
}

/** Starts the sweep. Idempotent per process. */
let timer: ReturnType<typeof setInterval> | null = null;

export function startDigestSweep(): void {
  if (timer) return;
  timer = setInterval(() => {
    sendPendingDigest().catch((err) =>
      console.error("[agent:digest] sweep failed:", err?.message),
    );
  }, DIGEST_INTERVAL_MS);
  console.log(`[agent:digest] sweeping every ${DIGEST_INTERVAL_MS / 60_000} minutes`);
}
