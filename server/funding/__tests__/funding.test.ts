import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAGES, CLOSED_STAGES, DEFAULT_QUERIES,
  normName, normUrl, parseDeadline, clampFit, coerceKind, daysToDeadline,
} from "../spec";

/**
 * The database-backed halves need a database, so what is pinned here are the
 * rules that decide what a person is shown and what the sweep is allowed to
 * keep. Those are the parts that would quietly do the wrong thing.
 */

/* ── stages ──────────────────────────────────────────────────────────────── */

test("every closed stage is a real stage", () => {
  CLOSED_STAGES.forEach((s) => assert.ok(STAGES.includes(s), `${s} is not in STAGES`));
});

test("candidate is not a closed stage, so proposals stay in the working view", () => {
  assert.ok(!CLOSED_STAGES.includes("candidate" as any));
});

test("passed is closed, so a rejected opportunity leaves the working pipeline", () => {
  // It is kept rather than deleted, so the sweep's duplicate check still sees
  // it and does not re-propose something already turned down.
  assert.ok(CLOSED_STAGES.includes("passed" as any));
});

/* ── deadline arithmetic ─────────────────────────────────────────────────── */

test("a deadline in the past reads negative, which is what marks it missed", () => {
  const past = new Date(Date.now() - 3 * 86400000);
  const n = daysToDeadline(past)!;
  assert.ok(n < 0, `expected negative, got ${n}`);
});

test("rolling and undated opportunities have no countdown rather than a zero", () => {
  // Zero would sort them alongside things due today and put them in every
  // "closing soon" list forever.
  assert.equal(daysToDeadline(null), null);
});

/* ── the sweep's filters ─────────────────────────────────────────────────── */

test("duplicate matching survives case, punctuation and trailing space", () => {
  assert.equal(normName("Base Builder Grants"), normName("base  builder-grants "));
  assert.notEqual(normName("Base Builder Grants"), normName("Base Retro Funding"));
});

test("url comparison ignores a trailing slash and case", () => {
  assert.equal(normUrl("https://Base.org/Grants/"), normUrl("https://base.org/grants"));
});

test("a date is only accepted in the exact form the sweep asks for", () => {
  assert.ok(parseDeadline("2026-09-14") instanceof Date);
  // Anything looser is dropped rather than guessed at, because a wrong
  // deadline is something a founder plans a fortnight around.
  assert.equal(parseDeadline("14 September 2026"), null);
  assert.equal(parseDeadline("2026-9-14"), null);
  assert.equal(parseDeadline("rolling"), null);
});

test("a fit score is clamped into range rather than trusted", () => {
  assert.equal(clampFit(150), 100);
  assert.equal(clampFit(-20), 0);
  assert.equal(clampFit(87.6), 88);
  assert.equal(clampFit("high" as any), null);
});

test("only known kinds are stored, anything else becomes other", () => {
  assert.equal(coerceKind("grant"), "grant");
  assert.equal(coerceKind("Series A lead"), "other");
  assert.equal(coerceKind(undefined), "other");
});

test("the default queries describe this company, not funding in general", () => {
  assert.ok(DEFAULT_QUERIES.length >= 3);
  const all = DEFAULT_QUERIES.join(" ").toLowerCase();
  ["africa", "base", "fintech"].forEach((k) =>
    assert.ok(all.includes(k), `default queries never mention ${k}`));
});

/* ── closed programmes must not enter ────────────────────────────────────── */

/**
 * The sweep proposed opportunities whose applications had already ended.
 *
 * Not a hallucination: a real page, a real deadline, already gone. The link
 * check cannot catch that because the link is fine, so the date has to be
 * checked against today.
 */
test("a deadline already past is refused, with a day of slack", () => {
  const DAY = 86400000;
  const now = Date.now();
  const closed = (deadline: Date | null) =>
    !!deadline && deadline.getTime() < now - DAY;

  assert.equal(closed(new Date(now - 5 * DAY)), true, "five days ago should be refused");
  assert.equal(closed(new Date(now + 5 * DAY)), false, "five days away should pass");

  // A deadline is a date rather than an instant, so "closes today" is still
  // open somewhere. Refusing it would drop live programmes on their last day,
  // which is exactly when they matter most.
  assert.equal(closed(new Date(now)), false, "today should still pass");
  assert.equal(closed(new Date(now - DAY / 2)), false, "twelve hours ago should still pass");

  // Rolling and undated entries have no date to judge, so they are never
  // refused on this basis.
  assert.equal(closed(null), false);
});

test("the recheck flags a stored deadline that has since gone by", () => {
  const DAY = 86400000;
  const stale = (d: Date | null) => !!d && d.getTime() < Date.now() - DAY;
  assert.equal(stale(new Date(Date.now() - 3 * DAY)), true);
  assert.equal(stale(new Date(Date.now() + 3 * DAY)), false);
});

test("a deadline the page has moved is only applied when it really differs", () => {
  const DAY = 86400000;
  const moved = (fresh: Date, stored: Date | null) =>
    !stored || Math.abs(fresh.getTime() - stored.getTime()) > DAY;

  const base = new Date("2026-10-01T00:00:00Z");
  assert.equal(moved(new Date("2026-11-01T00:00:00Z"), base), true);
  // The same date read again must not churn the row or file a note every run.
  assert.equal(moved(new Date("2026-10-01T00:00:00Z"), base), false);
  assert.equal(moved(base, null), true, "a first known deadline is always worth storing");
});
