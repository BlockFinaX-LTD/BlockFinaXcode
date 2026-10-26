import { test } from "node:test";
import assert from "node:assert/strict";
import { isOffered, OFFERED_DIRECTIONS, poolForSale } from "@shared/domain/offered-directions";

test("only depreciation protection is on sale for launch", () => {
  assert.deepEqual([...OFFERED_DIRECTIONS], ["up"]);
  assert.equal(isOffered("up"), true);
  assert.equal(isOffered("down"), false);
});

test("pools sell only in an offered direction; older two-way pools still sell it", () => {
  assert.equal(poolForSale("up"), true);
  assert.equal(poolForSale("down"), false);
  assert.equal(poolForSale("both"), true);
});
