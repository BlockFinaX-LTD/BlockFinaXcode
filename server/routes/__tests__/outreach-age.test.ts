import { test } from "node:test";
import assert from "node:assert/strict";
import { howLongAgo } from "../../outreach/prompt";
import { readPostedAt } from "../../outreach/provider";

const NOW = new Date("2026-08-20T12:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

test("reads as a person would say it", () => {
  assert.equal(howLongAgo(ago(30_000), NOW), "just now");
  assert.equal(howLongAgo(ago(25 * MIN), NOW), "25 minutes ago");
  assert.equal(howLongAgo(ago(HOUR), NOW), "1 hour ago");
  assert.equal(howLongAgo(ago(5 * HOUR), NOW), "5 hours ago");
  assert.equal(howLongAgo(ago(DAY), NOW), "1 day ago");
  assert.equal(howLongAgo(ago(3 * DAY), NOW), "3 days ago");
  assert.equal(howLongAgo(ago(9 * DAY), NOW), "1 week ago");
  assert.equal(howLongAgo(ago(45 * DAY), NOW), "1 month ago");
  assert.equal(howLongAgo(ago(400 * DAY), NOW), "1 year ago");
});

/** Singular and plural are where these always break. */
test("never says 1 hours or 1 days", () => {
  for (const ms of [HOUR, DAY, 7 * DAY, 30 * DAY, 365 * DAY]) {
    const out = howLongAgo(ago(ms), NOW)!;
    assert.ok(!/\b1 (hours|days|weeks|months|years)\b/.test(out), `bad plural: ${out}`);
  }
});

test("a missing or unreadable date says nothing rather than guessing", () => {
  assert.equal(howLongAgo(null), null);
  assert.equal(howLongAgo(undefined), null);
  assert.equal(howLongAgo("not a date"), null);
});

/**
 * Clock skew between the provider and us can put a post a few seconds in the
 * future. "in -1 minutes" would be worse than rounding to now.
 */
test("a post slightly in the future reads as just now", () => {
  assert.equal(howLongAgo(new Date(NOW + 30_000).toISOString(), NOW), "just now");
});

/**
 * Seconds versus milliseconds is the difference between 2026 and 1970, and
 * scraper payloads carry both.
 */
test("epoch seconds and milliseconds both resolve to the same instant", () => {
  const secs = Math.floor(NOW / 1000);
  const a = readPostedAt({ timestamp: secs });
  const b = readPostedAt({ timestamp: NOW });
  assert.ok(a && b);
  assert.equal(new Date(a!).getUTCFullYear(), 2026);
  assert.equal(new Date(b!).getUTCFullYear(), 2026);
});

test("an implausible date is discarded rather than stored", () => {
  assert.equal(readPostedAt({ timestamp: 0 }), null, "1970 should be refused");
  assert.equal(readPostedAt({ date: "1999-01-01" }), null, "too old should be refused");
  assert.equal(readPostedAt({ date: "2099-01-01" }), null, "the future should be refused");
  assert.equal(readPostedAt({ date: "banana" }), null);
  assert.equal(readPostedAt({}), null);
});

test("an ISO string is taken as it stands", () => {
  const iso = new Date(NOW - 2 * DAY).toISOString();
  assert.equal(readPostedAt({ postedAt: iso }), iso);
});
