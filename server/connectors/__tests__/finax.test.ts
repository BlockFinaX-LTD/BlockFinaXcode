import { test } from "node:test";
import assert from "node:assert/strict";
import { connectorBrief } from "../finax";
import { MODULES } from "@shared/connector-programme";

const base = {
  member: { kind: "connector", fullName: "Ama Mensah", status: "active", country: "GH", areas: ["hedgers"] },
  document: "connector" as const, signed: true, passed: ["programme"], missing: ["Complete the training"],
  counts: { registrations: 2, approved: 1, referrals: 0, offers: 0, new_offers: 1 },
  registrations: [{ organisation: "Kumasi Imports Ltd", area: "hedgers", status: "approved", rewardTerms: "25% for 12 months", createdAt: "2026-10-29T10:00:00.000Z" }],
};

test("the brief carries the member's own status, prospects and next step", () => {
  const b = connectorBrief(base);
  assert.match(b, /Ama Mensah/);
  assert.match(b, /Complete the training/);
  assert.match(b, /Kumasi Imports Ltd: Hedgers, approved/);
  assert.match(b, /Connector Agreement, version/);
});

test("the brief never contains the quiz answers", () => {
  const b = connectorBrief(base);
  for (const m of MODULES) for (const q of m.questions) {
    assert.ok(!b.includes(q.q), `question ${q.id} is in the brief`);
  }
});

test("someone who has not applied is pointed to the application", () => {
  assert.match(connectorBrief({ ...base, member: null, counts: null, registrations: [] }), /not applied yet/);
});
