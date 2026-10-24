import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSponsorshipFee } from "../server/sponsorship.js";

test("testnet deployment has a separate bounded budget from payments", () => {
  checkSponsorshipFee("217557061", "deployment");
  assert.throws(() => checkSponsorshipFee("217557061", "payment"));
  checkSponsorshipFee("100000000", "payment");
  assert.throws(() => checkSponsorshipFee("100000001", "payment"));
  checkSponsorshipFee("300000000", "deployment");
  assert.throws(() => checkSponsorshipFee("300000001", "deployment"));
});

test("invalid fee estimates cannot reach signing or submission", () => {
  for (const fee of ["NaN", "Infinity", "", "-1", "0", "1.5", "1e5", "9007199254740993"])
    for (const kind of ["payment", "deployment"] as const)
      assert.throws(() => checkSponsorshipFee(fee, kind));
});
