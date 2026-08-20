import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseProfileUrl } from "../../outreach/people";
import { pairsMentioned } from "../../outreach/market-brief";
import { matchedTopics } from "../outreach-relevance";

/**
 * URL normalisation is what keeps the people list a list of people.
 *
 * LinkedIn appends per-view tracking to profile links, so the same person
 * arrives with a different URL every single time. Without this the table fills
 * with duplicates of one human and the whole list becomes useless — which is a
 * silent failure, not a loud one, so it gets a test.
 */
test("the same person normalises to one identity", () => {
  const variants = [
    "https://www.linkedin.com/in/ada-boateng",
    "https://www.linkedin.com/in/ada-boateng/",
    "https://www.linkedin.com/in/ada-boateng?miniProfileUrn=urn%3Ali%3A123",
    "https://linkedin.com/in/Ada-Boateng",
    "https://www.linkedin.com/in/ada-boateng/overlay/contact-info/",
  ];
  const seen = new Set(variants.map(normaliseProfileUrl));
  assert.equal(seen.size, 1, `expected one identity, got ${Array.from(seen).join(" | ")}`);
  assert.equal(Array.from(seen)[0], "https://www.linkedin.com/in/ada-boateng");
});

/**
 * A post permalink names an article, not a human. Storing one as a profile URL
 * would create a row nobody can act on and that can never be merged with the
 * real person when they turn up properly.
 */
test("post permalinks are refused as identities", () => {
  assert.equal(normaliseProfileUrl("https://www.linkedin.com/feed/update/urn:li:activity:12345/"), null);
  assert.equal(normaliseProfileUrl("https://example.com/in/ada"), null);
  assert.equal(normaliseProfileUrl("not a url"), null);
  assert.equal(normaliseProfileUrl(""), null);
});

/**
 * Citing the wrong country's data is worse than citing none — it is confidently
 * wrong in public, under the founder's name. "Shilling" is Kenyan, Ugandan or
 * Tanzanian depending on who is speaking, so it must not resolve on its own.
 */
test("ambiguous currency names do not resolve to a pair", () => {
  assert.deepEqual(pairsMentioned("the shilling has been weak"), []);
  assert.deepEqual(pairsMentioned("Doing business in Africa is rewarding"), []);
  assert.deepEqual(pairsMentioned("Happy Friday!"), []);
});

test("unambiguous mentions resolve to the right pair", () => {
  assert.deepEqual(pairsMentioned("the cedi moved again"), ["USD/GHS"]);
  assert.deepEqual(pairsMentioned("naira stability at last"), ["USD/NGN"]);
  assert.deepEqual(pairsMentioned("our Nairobi office"), ["USD/KES"]);
  // Explicit notation wins and leads.
  assert.equal(pairsMentioned("USD/GHS is at 11.2")[0], "USD/GHS");
});

/** Topics describe a person by what they write about, so they must be specific. */
test("topics reflect what the post was actually about", () => {
  const t = matchedTopics("Our Ghana importers keep getting hit by cedi depreciation");
  assert.ok(t.includes("african-currency"), `expected african-currency in ${t.join(",")}`);
  assert.ok(t.includes("trade"), `expected trade in ${t.join(",")}`);
  assert.ok(t.includes("frontier"), `expected frontier in ${t.join(",")}`);
  assert.deepEqual(matchedTopics("Happy birthday!"), []);
});

/**
 * Half the accounts driving these threads are publications rather than people.
 * The first live scan surfaced MarketForces Africa, TopStories Nigeria and The
 * Journal Nigeria, and a list that silently drops all of them is missing the
 * accounts with the most reach.
 */
test("company pages are tracked as well as people", () => {
  assert.equal(
    normaliseProfileUrl("https://www.linkedin.com/company/marketforcesafrica/"),
    "https://www.linkedin.com/company/marketforcesafrica",
  );
  assert.equal(
    normaliseProfileUrl("https://www.linkedin.com/company/MarketForcesAfrica?trk=abc"),
    "https://www.linkedin.com/company/marketforcesafrica",
  );
});

/**
 * A post link must still never become an identity. The provider returns one for
 * nearly every result, so if this ever passed, the people table would fill with
 * one row per post instead of one per account.
 */
test("the public post link is still refused as an identity", () => {
  assert.equal(
    normaliseProfileUrl("https://www.linkedin.com/posts/marketforcesafrica_naira-weakens-activity-7496146729793261569-h3xB"),
    null,
  );
});
