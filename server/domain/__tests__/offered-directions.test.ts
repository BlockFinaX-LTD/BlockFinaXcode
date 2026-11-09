import { test } from "node:test";
import assert from "node:assert/strict";
import { isOffered, OFFERED_DIRECTIONS, poolForSale } from "@shared/domain/offered-directions";

test("Cap and Floor are both on sale", () => {
  assert.deepEqual([...OFFERED_DIRECTIONS], ["up", "down"]);
  assert.equal(isOffered("up"), true);
  assert.equal(isOffered("down"), true);
});

test("pools in either direction sell, and so do older two-way pools", () => {
  assert.equal(poolForSale("up"), true);
  assert.equal(poolForSale("down"), true);
  assert.equal(poolForSale("both"), true);
});
