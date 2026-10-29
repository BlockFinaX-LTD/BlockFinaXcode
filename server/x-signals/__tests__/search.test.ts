import { test } from "node:test";
import assert from "node:assert/strict";
import { TOPICS, isNoise, score, searchTopic, toPost } from "../search";

const tweet = (over: any = {}) => ({
  id: "1", url: "https://x.com/ada/status/1", createdAt: "Tue Oct 29 10:00:00 +0000 2026",
  text: "Our supplier in China wants payment in dollars and the naira just fell again. How are other importers handling this?",
  likeCount: 12, replyCount: 4, retweetCount: 1, quoteCount: 0, viewCount: 900,
  author: { userName: "ada", name: "Ada O.", followers: 2300, location: "Lagos, Nigeria", description: "Founder, food importer", isAutomated: false },
  ...over,
});

test("a tweet becomes a post; retweets and malformed items are skipped", () => {
  const p = toPost(tweet())!;
  assert.equal(p.author.handle, "ada");
  assert.equal(p.replies, 4);
  assert.equal(toPost(tweet({ retweeted_tweet: { id: "9" } })), null);
  assert.equal(toPost({ id: 1 }), null);
  assert.equal(toPost(tweet({ url: "" }))!.url, "https://x.com/ada/status/1");
});

test("promotions, bots and hashtag walls are noise", () => {
  assert.equal(isNoise(toPost(tweet())!), false);
  assert.equal(isNoise(toPost(tweet({ text: "Naira forex signals group, join my telegram t.me/fx now for 100x" }))!), true);
  assert.equal(isNoise(toPost(tweet({ author: { ...tweet().author, isAutomated: true } }))!), true);
  assert.equal(isNoise(toPost(tweet({ text: "#naira #cedi #fx #forex #trading http://x.co" }))!), true);
  assert.equal(isNoise(toPost(tweet({ text: "2019 Toyota Prado fresh import straight out of the port, KES 2,650,000 only, call/whatsapp now" }))!), true);
  assert.equal(isNoise(toPost(tweet({ text: "WE'RE HIRING: VP Finance, Lagos. Job type: full-time. Apply now with your CV" }))!), true);
  const offTopic = toPost(tweet({ text: "A lot of these AI platforms need enormous amounts of tokens and refined prompts to build anything" }))!;
  assert.equal(isNoise(offTopic), false);
  assert.equal(isNoise(offTopic, TOPICS[0]), true, "a naira search hit that never mentions the naira is dropped");
});

test("a business owner describing a real problem scores above a casual remark", () => {
  const pain = score(toPost(tweet())!);
  const casual = score(toPost(tweet({ text: "The naira is doing something today lol, wild times for everyone out here",
    likeCount: 0, replyCount: 0, author: { ...tweet().author, description: "Football and music", location: "", followers: 40 } }))!);
  assert.ok(pain >= 70, `pain scored ${pain}`);
  assert.ok(casual < 30, `casual scored ${casual}`);
  assert.ok(pain <= 100);
});

test("search pages through results, stops at the limit, and reports API errors", async () => {
  const calls: string[] = [];
  const fake = (async (url: URL) => {
    calls.push(url.toString());
    const page = calls.length;
    return new Response(JSON.stringify({ tweets: [tweet({ id: String(page) })], has_next_page: true, next_cursor: `c${page}` }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await searchTopic("k", TOPICS[0]!, 1700000000, 2, fake);
  assert.equal(r.pages, 2);
  assert.equal(r.posts.length, 2);
  assert.match(calls[0]!, /since_time%3A1700000000/);
  assert.match(calls[1]!, /cursor=c1/);
  const failing = (async () => new Response(JSON.stringify({ message: "bad key" }), { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(searchTopic("k", TOPICS[0]!, 0, 1, failing), /401: bad key/);
});

test("Claude's verdicts are kept only when well formed and about posts we asked for", async () => {
  const { cleanVerdicts } = await import("../classify");
  const v = cleanVerdicts({ verdicts: [
    { id: "1", relevance: 140, kind: "hedger", reason: "Importer — paying a dollar invoice" },
    { id: "2", relevance: 10, kind: "nonsense", reason: "x" },
    { id: "9", relevance: 90, kind: "hedger", reason: "not asked" },
    null,
  ] }, new Set(["1", "2"]));
  assert.equal(v.length, 2);
  assert.equal(v[0]!.relevance, 100);
  assert.equal(v[0]!.reason, "Importer , paying a dollar invoice");
  assert.equal(v[1]!.kind, "other");
  assert.deepEqual(cleanVerdicts("junk", new Set(["1"])), []);
});

test("politics and big media accounts are noise", () => {
  assert.equal(isNoise(toPost(tweet({ text: "Congratulations to the APC team, the naira will recover under this government, mark my words" }))!), true);
  assert.equal(isNoise(toPost(tweet({ author: { ...tweet().author, followers: 850_000 } }))!), true);
});
