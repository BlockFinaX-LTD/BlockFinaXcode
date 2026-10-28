import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findConflict, isReferralCode, missingSteps, newReferralCode, orgDomain, orgKey, paymentDue, quarterOf,
  referralRevenue, scoreModule, statement,
} from "../logic";
import { ANSWERS } from "../course-answers";
import { AGREEMENTS, MODULES, agreementText } from "@shared/connector-programme";

test("organisation names match regardless of legal suffixes and punctuation", () => {
  assert.equal(orgKey("The Acme Trading Co. Ltd"), "acme trading");
  assert.equal(orgKey("ACME TRADING LIMITED"), "acme trading");
  assert.equal(orgKey("Dangote & Sons PLC"), "dangote and sons");
  assert.equal(orgKey("Société Générale S.A."), "societe generale");
});

test("domains come from websites and work emails, never free mail", () => {
  assert.equal(orgDomain("https://www.acme.com.ng/about"), "acme.com.ng");
  assert.equal(orgDomain("cfo@acme.com"), "acme.com");
  assert.equal(orgDomain("someone@gmail.com"), null);
  assert.equal(orgDomain("not a site"), null);
  assert.equal(orgDomain(""), null);
});

test("one organisation counts once; declined never blocks; closed blocks for 12 months", () => {
  const now = new Date("2027-06-01T00:00:00Z");
  const row = (status: string, createdAt: string, userId = 2) =>
    ({ id: "r", userId, orgKey: "acme trading", domain: "acme.com", status, createdAt: new Date(createdAt) });
  const cand = { orgKey: "acme trading", domain: null };
  assert.ok(findConflict(cand, [row("pending", "2027-05-01")], now));
  assert.ok(findConflict(cand, [row("live", "2025-01-01")], now));
  assert.equal(findConflict(cand, [row("declined", "2027-05-01")], now), null);
  assert.ok(findConflict(cand, [row("closed", "2027-01-01")], now));
  assert.equal(findConflict(cand, [row("closed", "2026-01-01")], now), null);
  assert.ok(findConflict({ orgKey: "other name", domain: "acme.com" }, [row("approved", "2027-05-01")], now));
});

test("every question has an answer key within its options", () => {
  for (const m of MODULES) for (const q of m.questions) {
    assert.ok(q.id in ANSWERS, `missing answer for ${q.id}`);
    assert.ok(ANSWERS[q.id]! >= 0 && ANSWERS[q.id]! < q.options.length, `answer out of range for ${q.id}`);
  }
});

test("a module passes at 80% and lists what was wrong", () => {
  const rules = MODULES.find((m) => m.id === "rules")!;
  const all = Object.fromEntries(rules.questions.map((q) => [q.id, ANSWERS[q.id]]));
  assert.equal(scoreModule("rules", all).passed, true);
  const oneWrong = { ...all, r1: 0 };
  const r = scoreModule("rules", oneWrong);
  assert.equal(r.correct, 4);
  assert.equal(r.passed, true);
  assert.deepEqual(r.wrong, ["r1"]);
  assert.equal(scoreModule("rules", { ...oneWrong, r2: 0 }).passed, false);
  assert.equal(scoreModule("rules", { r1: String(ANSWERS.r1) }).correct, 0, "strings are not answers");
  assert.throws(() => scoreModule("nope", {}));
});

test("quarters and payment due dates", () => {
  assert.equal(quarterOf(new Date("2027-02-14T12:00:00Z")), "2027-Q1");
  assert.equal(quarterOf(new Date("2026-12-31T23:00:00Z")), "2026-Q4");
  assert.equal(paymentDue("2027-Q1").toISOString().slice(0, 10), "2027-04-30");
  assert.throws(() => paymentDue("2027-Q5"));
});

test("referral revenue counts 25% of fees for 12 months from the first fee", () => {
  const t = (iso: string) => Date.parse(iso) / 1000;
  const r = referralRevenue([
    { createdAt: t("2027-03-01T00:00:00Z"), fee: "0" },
    { createdAt: t("2027-03-10T00:00:00Z"), fee: "40" },
    { createdAt: t("2027-09-10T00:00:00Z"), fee: "60" },
    { createdAt: t("2028-03-11T00:00:00Z"), fee: "100" },
  ], new Date("2027-10-01T00:00:00Z"));
  assert.equal(r.contracts, 4);
  assert.equal(r.fees, 100);
  assert.equal(r.share, 25);
  assert.equal(r.periodStart, "2027-03-10T00:00:00.000Z");
  assert.equal(r.periodEnd, "2028-03-10T00:00:00.000Z");
  assert.equal(r.active, true);
  assert.equal(referralRevenue([]).share, 0);
});

test("what blocks a member from registering prospects", () => {
  const passedAll = MODULES.filter((m) => m.required).map((m) => m.id);
  assert.deepEqual(missingSteps({ status: "active", agreementSigned: true, modulesPassed: passedAll, screening: "clear" }), []);
  const m = missingSteps({ status: "applied", agreementSigned: false, modulesPassed: [], screening: "hit" });
  assert.equal(m.length, 4);
  assert.match(m[0]!, /approve/);
});

test("statements sum earnings and payments per quarter", () => {
  const s = statement([
    { kind: "revenue_share", quarter: "2027-Q2", amountUsd: 120.5 },
    { kind: "bonus", quarter: "2027-Q1", amountUsd: 500 },
    { kind: "payment", quarter: "2027-Q1", amountUsd: 500 },
    { kind: "adjustment", quarter: "2027-Q2", amountUsd: -20.5 },
  ]);
  assert.deepEqual(s.quarters.map((q) => q.quarter), ["2027-Q1", "2027-Q2"]);
  assert.equal(s.earned, 600);
  assert.equal(s.paid, 500);
  assert.equal(s.owed, 100);
});

test("referral codes are readable and recognised", () => {
  for (let i = 0; i < 50; i++) assert.ok(isReferralCode(newReferralCode()));
  assert.equal(isReferralCode("BFX0OIL11"), false);
  assert.equal(isReferralCode("bfx7k2qma"), false);
});

test("agreement text is stable and carries the version", () => {
  for (const doc of Object.values(AGREEMENTS)) {
    const text = agreementText(doc);
    assert.ok(text.startsWith(`${doc.title}, version ${doc.version}`));
    assert.equal(text, agreementText(doc));
    assert.ok(!/[–—]/.test(text), `${doc.title} contains a dash character`);
  }
});
