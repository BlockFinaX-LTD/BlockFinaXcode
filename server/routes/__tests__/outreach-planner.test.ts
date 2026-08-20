import { test } from "node:test";
import assert from "node:assert/strict";
import { normalisePlan } from "../../outreach/planner";

/**
 * Every planned query becomes a paid provider call, so this function decides a
 * bill rather than merely tidying a list. The cap and the dedupe are enforced
 * here instead of being trusted to the tool schema, because a schema states an
 * intention and the model is free to miss it.
 */

test("duplicate queries are charged for once", () => {
  const p = normalisePlan([
    { query: "cedi importers", angle: "a", why: "b" },
    { query: "Cedi Importers", angle: "c", why: "d" },
    { query: "  cedi   importers ", angle: "e", why: "f" },
  ]);
  assert.equal(p.length, 1, "case and spacing variants should collapse to one search");
  assert.equal(p[0].query, "cedi importers");
});

test("never plans more than five searches", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ query: `query number ${i}`, angle: "", why: "" }));
  assert.equal(normalisePlan(many).length, 5);
});

test("unusable queries are dropped rather than searched for", () => {
  const p = normalisePlan([
    { query: "ok", angle: "", why: "" },
    { query: "", angle: "", why: "" },
    { query: null, angle: "", why: "" },
    { query: "a real query", angle: "", why: "" },
  ]);
  assert.deepEqual(p.map(x => x.query), ["a real query"]);
});

test("a malformed response plans nothing rather than guessing", () => {
  assert.deepEqual(normalisePlan(null), []);
  assert.deepEqual(normalisePlan("searches"), []);
  assert.deepEqual(normalisePlan([]), []);
});

test("the rationale is carried through so the plan stays auditable", () => {
  const p = normalisePlan([{ query: "naira finally stable", angle: "relief", why: "vol at 7th percentile" }]);
  assert.equal(p[0].angle, "relief");
  assert.equal(p[0].why, "vol at 7th percentile");
});
