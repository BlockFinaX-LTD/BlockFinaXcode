import { test } from "node:test";
import assert from "node:assert/strict";
import { activityUrnFrom, isExpired, postedAtFromUrn } from "../../outreach/linkedin";

/**
 * A comment names the thing it is attached to by URN, and getting that wrong
 * publishes a comment onto someone else's thread under Anthony's name. There is
 * no undo from the console, so this function has to refuse rather than guess.
 */

test("reads the urn out of the permalinks the provider returns", () => {
  assert.equal(
    activityUrnFrom("https://www.linkedin.com/feed/update/urn:li:activity:7231234567890123456/"),
    "urn:li:activity:7231234567890123456",
  );
  assert.equal(
    activityUrnFrom("https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A7231234567890123456/"),
    "urn:li:activity:7231234567890123456",
  );
  assert.equal(
    activityUrnFrom("https://www.linkedin.com/posts/someone_thing-activity-x?utm=1&x=urn:li:ugcPost:99887766554433"),
    "urn:li:ugcPost:99887766554433",
  );
});

/**
 * A profile link is the common case here: when a post carries no activity urn,
 * the reader falls back to the author's profile. That must not be treated as
 * something to comment on.
 */
test("refuses anything that is not a post", () => {
  assert.equal(activityUrnFrom("https://www.linkedin.com/in/ada-boateng"), null);
  assert.equal(activityUrnFrom("https://www.linkedin.com/company/acme"), null);
  assert.equal(activityUrnFrom("https://www.linkedin.com/feed/"), null);
  assert.equal(activityUrnFrom(""), null);
  assert.equal(activityUrnFrom(null), null);
  assert.equal(activityUrnFrom(undefined), null);
});

/** A token that dies mid-request should read as expired, not as a stray 401. */
test("a token about to expire counts as expired", () => {
  const base = { accessToken: "x", personUrn: "urn:li:person:y", name: null, connectedAt: 0, connectedBy: null };
  assert.equal(isExpired({ ...base, expiresAt: Date.now() + 3_600_000 }), false);
  assert.equal(isExpired({ ...base, expiresAt: Date.now() + 10_000 }), true, "inside the slack window");
  assert.equal(isExpired({ ...base, expiresAt: Date.now() - 1 }), true);
});

/**
 * The URLs below are real, taken from the first live scan. Every one of them
 * failed the original parser, which meant the send button appeared on nothing
 * at all. Keeping them here means a future tidy-up of the regex has to keep
 * working against what LinkedIn actually returns rather than what the docs
 * show.
 */
const REAL = [
  ["https://www.linkedin.com/posts/marketforcesafrica_naira-weakens-against-usd-eur-gbp-on-squeezed-activity-7496146729793261569-h3xB",
   "urn:li:activity:7496146729793261569"],
  ["https://www.linkedin.com/posts/topstories-nigeria_naira-to-dollar-exchange-rate-today-friday-activity-7493938257186062337-2dFD",
   "urn:li:activity:7493938257186062337"],
  ["https://www.linkedin.com/posts/dr-collins-ugorji-4111a5197_nigeria-naira-cbn-activity-7495569729533915137-0zWg",
   "urn:li:activity:7495569729533915137"],
] as const;

test("parses the public post links the provider actually returns", () => {
  for (const [url, expected] of REAL) {
    assert.equal(activityUrnFrom(url), expected, `failed on ${url}`);
  }
});

test("post time is recovered from the id when no date field is supplied", () => {
  // The provider returned thirty posts and not one date, so this path is the
  // one that runs in practice rather than a fallback.
  const iso = postedAtFromUrn("urn:li:activity:7496146729793261569");
  assert.ok(iso, "expected a date");
  const d = new Date(iso!);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 7, "August");
  assert.equal(d.getUTCDate(), 20);
});

test("an id that decodes to nonsense is refused", () => {
  assert.equal(postedAtFromUrn("urn:li:activity:1"), null);
  assert.equal(postedAtFromUrn("urn:li:activity:99999999999999999999"), null);
  assert.equal(postedAtFromUrn(null), null);
});
