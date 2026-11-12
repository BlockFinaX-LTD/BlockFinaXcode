/**
 * finder.tsx, the one search panel every Agent tab uses.
 *
 * Outreach, Email and Investors each grew their own search box with its own
 * buttons, chips and wording, so the same act (pick where to look, say what
 * for, press one button) looked different on every tab. This is that act once:
 *
 *   Where to look   [Source] [Source] [Source]
 *   one line saying what that source finds
 *   the inputs
 *   suggestion chips
 *   [ the one button ]   a status line
 */

import type { ReactNode } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FinderSource<K extends string> {
  key: K;
  label: string;
  /** One sentence on what this source finds. */
  about: string;
}

export const finderInput =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none " +
  "focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

export function FinderPanel<K extends string>(props: {
  sources?: FinderSource<K>[];
  source?: K;
  onSource?: (k: K) => void;
  /** Shown when there is only one source, in place of the source buttons. */
  about?: string;
  children: ReactNode;
  suggestions?: string[];
  onSuggest?: (s: string) => void;
  action: { label: string; busyLabel?: string; busy?: boolean; disabled?: boolean; onClick: () => void };
  /** Status under the button: schedule, missing setup, cost. */
  note?: ReactNode;
  /** Anything else beside the button, like the reply style. */
  extra?: ReactNode;
}) {
  const { sources, source, onSource } = props;
  const current = sources?.find(s => s.key === source);
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      {sources && sources.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] text-muted-foreground">Where to look</span>
          {sources.map(s => (
            <button
              key={s.key}
              onClick={() => onSource?.(s.key)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[12.5px] transition-colors",
                s.key === source
                  ? "border-primary bg-primary/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <p className="mb-2.5 text-[12.5px] text-muted-foreground">{current?.about ?? props.about}</p>

      {props.children}

      {props.suggestions && props.suggestions.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {props.suggestions.map(q => (
            <button
              key={q}
              onClick={() => props.onSuggest?.(q)}
              className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={props.action.disabled || props.action.busy} onClick={props.action.onClick}>
          {props.action.busy
            ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {props.action.busyLabel ?? "Searching…"}</>
            : <><Search className="mr-1.5 h-3.5 w-3.5" /> {props.action.label}</>}
        </Button>
        {props.extra}
      </div>
      {props.note && <p className="mt-2 text-[12px] text-muted-foreground">{props.note}</p>}
    </div>
  );
}

// ── Shared by the finder and the drafts list ──────────────────────────────

export type Intent = "reply" | "comment" | "connect" | "dm" | "insight_call";

export const INTENTS: { key: Intent; label: string; hint: string }[] = [
  { key: "comment", label: "Insight comment", hint: "70 to 110 words: mechanism, a number, then the second-order effect" },
  { key: "reply", label: "Public reply", hint: "under 60 words, has to add something to the thread" },
  { key: "insight_call", label: "Ask for their view", hint: "under 120 words, asks about their subject rather than ours" },
  { key: "connect", label: "Connection note", hint: "under 300 characters, LinkedIn's limit" },
  { key: "dm", label: "Direct message", hint: "under 120 words, one question worth answering" },
];

/**
 * How long ago, in words.
 *
 * The same wording the drafter is given, so a card cannot say "2 days ago"
 * while the draft it holds was written as though the thread were live.
 */
export function howLongAgo(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return w === 1 ? "1 week ago" : `${w} weeks ago`;
  }
  if (days < 365) {
    const m = Math.floor(days / 30);
    return m === 1 ? "1 month ago" : `${m} months ago`;
  }
  const y = Math.floor(days / 365);
  return y === 1 ? "1 year ago" : `${y} years ago`;
}

/** "about 3 hours", for the next scheduled run. */
export function minutesUntil(iso: string | null): string {
  if (!iso) return "a while";
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (mins <= 0) return "a few minutes";
  if (mins < 60) return `${mins} minutes`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem >= 15 ? `${h}h ${rem}m` : `${h} hour${h === 1 ? "" : "s"}`;
}


export async function adminApi(url: string, token: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers, "x-admin-token": token },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.message || `Request failed (${res.status})`);
  }
  return res.json();
}
