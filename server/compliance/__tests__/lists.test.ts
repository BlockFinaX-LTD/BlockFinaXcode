import { test } from "node:test";
import assert from "node:assert/strict";
import { nameTokens, similarity } from "../lists";

test("legal forms alone never make a match", () => {
  assert.equal(similarity("Accra Medical Supplies Ltd", "I.C.I.C. LTD."), 0);
  assert.equal(similarity("Kano Feed Mills Limited", "Example Trading Company Limited"), 0);
});

test("spelled-out initials are kept as one word", () => {
  assert.deepEqual([...nameTokens("I.C.I.C. LTD.")], ["icic"]);
  assert.equal(similarity("ICIC Ltd", "I.C.I.C. LTD."), 1);
});

test("real company and person matches still score fully", () => {
  assert.equal(similarity("Rosneft Oil Company", "ROSNEFT OIL CO"), 1);
  assert.equal(similarity("Putin Vladimir", "Vladimir Vladimirovich Putin"), 1);
});

test("unrelated people do not match", () => {
  assert.ok(similarity("Kofi Boateng", "Vladimir Putin") < 0.7);
});
