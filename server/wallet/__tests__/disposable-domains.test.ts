import { test } from "node:test";
import assert from "node:assert/strict";
import { isDisposableEmail } from "../disposable-domains";

test("throwaway domains and their subdomains are refused", () => {
  assert.equal(isDisposableEmail("laawtsztr@fldubai.com"), true);
  assert.equal(isDisposableEmail("x@mail.fldubai.com"), true);
  assert.equal(isDisposableEmail("b@mailinator.com"), true);
});

test("ordinary providers and company domains are allowed", () => {
  for (const e of ["a@gmail.com", "b@outlook.com", "c@yahoo.com", "d@icloud.com", "e@blockfinax.com", "f@company.com.gh"]) {
    assert.equal(isDisposableEmail(e), false, e);
  }
});
