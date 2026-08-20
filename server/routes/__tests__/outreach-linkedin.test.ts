import { test } from "node:test";
import assert from "node:assert/strict";
import { activityUrnFrom, isExpired } from "../../outreach/linkedin";

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
