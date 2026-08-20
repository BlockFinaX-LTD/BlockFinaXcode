import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, type Candidate } from "../../outreach/prompt";

/**
 * The live book must never reach a public comment.
 *
 * This broke once. The single-post route carried a line reading "Live
 * BlockFinaX figures you may quote", and the draft that came back opened with
 * a genuine piece of analysis and closed with "we have settled 6 parametric FX
 * pools on that basis". That is a sales line wearing an analyst's jacket, and
 * it costs the credibility the analysis just earned.
 *
 * The fix was structural rather than instructional: the book is not fetched at
 * all for public writing. An instruction not to sell competes with tempting
 * material sitting in the same context window and loses often enough to matter.
 * Withholding the material wins every time, and a test can prove withholding in
 * a way it can never prove a model resisted temptation.
 */

const POST: Candidate = {
  text: "Africa faces an estimated $92 billion trade finance gap, limiting the ability of "
      + "businesses to access working capital and foreign exchange to trade across borders.",
  url: "https://www.linkedin.com/feed/update/urn:li:activity:1",
  name: "African Startup Metrics",
  headline: null,
  score: 6,
};

const BOOK = "Open cover pools right now: 3.\n  USD/GHS: strike 11.30, premium 3.00%\nPools settled to date: 6.";

test("public writing never receives the live book", () => {
  for (const kind of ["reply", "comment"] as const) {
    const p = buildPrompt(POST, kind, "", "", BOOK);
    assert.ok(!p.includes("Pools settled to date"), `${kind} prompt leaked the settled count`);
    assert.ok(!p.includes("Open cover pools"), `${kind} prompt leaked the open pools`);
    assert.ok(!p.includes(BOOK), `${kind} prompt contained the book verbatim`);
  }
});

test("public writing is told explicitly not to name the company", () => {
  for (const kind of ["reply", "comment"] as const) {
    const p = buildPrompt(POST, kind, "", "", BOOK);
    assert.match(p, /Do not name BlockFinaX/);
    assert.match(p, /under a stranger's name/);
  }
});

/**
 * A direct message is the opposite case. Someone reading a message from a
 * stranger is entitled to know who is writing and why, so withholding the book
 * there would make the message evasive rather than restrained.
 */
test("a direct message does receive the book", () => {
  const p = buildPrompt(POST, "dm", "", "", BOOK);
  assert.ok(p.includes("Pools settled to date"), "dm prompt should carry the book");
  assert.ok(!/Do not name BlockFinaX/.test(p), "dm should not carry the public-writing warning");
});

test("a connection note also receives it", () => {
  const p = buildPrompt(POST, "connect", "", "", BOOK);
  assert.ok(p.includes("Open cover pools"));
});

/** With no market data, the drafter is told so rather than left to invent. */
test("an empty brief produces an explicit instruction to quote nothing", () => {
  const p = buildPrompt(POST, "comment", "", "", "");
  assert.match(p, /No market data matched this post/);
  assert.match(p, /quote\s*\n?no figures/);
});

test("a brief is passed through and marked as the only quotable figures", () => {
  const brief = "USD/GHS: spot 10.9800 as of 2026-08-20";
  const p = buildPrompt(POST, "comment", brief, "", "");
  assert.ok(p.includes(brief));
  assert.match(p, /the only figures you may quote/);
  assert.ok(!/No market data matched/.test(p));
});

/** Remembered facts must arrive with the instruction that keeps them dated. */
test("recalled memory carries the instruction to quote its age", () => {
  const p = buildPrompt(POST, "comment", "", "- [policy, 5 months ago] BoG held at 27%", "");
  assert.match(p, /Quote it with that age/);
  assert.match(p, /never in the present tense/);
});

/** No em dashes anywhere in what the model reads. */
test("the assembled prompt contains no dashes", () => {
  const p = buildPrompt(POST, "comment", "USD/GHS: spot 10.98", "- [news, today] x", "");
  assert.equal((p.match(/—|–/g) || []).length, 0, "prompt contains an em or en dash");
});
