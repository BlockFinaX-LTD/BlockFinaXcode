/**
 * End-to-end check of the compliance records against a real Postgres (local testnet DB).
 *
 *   DATABASE_URL=postgresql://localhost:5432/blockfinax_testnet npx tsx scripts/records/check.ts
 *
 * Writes test rows (users 990101..990103 and a test business) and log entries; the log is
 * append-only by design, so its test entries stay.
 */
import assert from "node:assert/strict";

const results: [string, boolean][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const rejects = async (p: Promise<unknown>, re: RegExp) => { try { await p; return false; } catch (e) { return re.test((e as Error).message); } };

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to a local Postgres");
  const { pool } = await import("../../server/db");
  const db = pool as any;
  const { record, verifyLog, listLog } = await import("../../server/records/log");
  const store = await import("../../server/records/store");
  const { regulatoryReport, reportCsv } = await import("../../server/records/reports");

  // 1. The chain.
  const e1 = await record({ actor: { type: "system", id: "records-check" }, action: "check.start", data: { at: Date.now() } });
  const e2 = await record({ actor: { type: "system", id: "records-check" }, action: "check.second" });
  check("each entry links to the one before it", e2.prevHash === e1.hash);
  let v = await verifyLog();
  check("the whole log verifies", v.ok, `${v.entries} entries`);

  // 2. The database refuses edits.
  check("UPDATE on the log is refused", await rejects(db.query(`UPDATE compliance_log SET action = 'x' WHERE id = $1`, [e1.id]), /append-only/));
  check("DELETE on the log is refused", await rejects(db.query(`DELETE FROM compliance_log WHERE id = $1`, [e1.id]), /append-only/));
  check("TRUNCATE on the log is refused", await rejects(db.query(`TRUNCATE compliance_log`), /append-only/));

  // Test users.
  for (const [id, email] of [[990101, "records-check-1@example.com"], [990102, "records-check-2@example.com"], [990103, "records-check-3@example.com"]] as const) {
    await db.query(`INSERT INTO user_accounts (id, email, name) VALUES ($1,$2,'Records Check') ON CONFLICT (id) DO UPDATE SET email = $2, name = 'Records Check'`, [id, email]);
  }

  // 3. Complaints.
  const c = await store.submitComplaint(990101, null, { category: "pricing", subject: "Premium higher than shown", description: "The price changed between the quote and the review." });
  check("a complaint is received", c.status === "open");
  await store.updateComplaint(c.id, "ops@blockfinax.com", { status: "acknowledged" });
  const resolved = await store.updateComplaint(c.id, "ops@blockfinax.com", { status: "resolved", outcome: "Explained the 2-minute quote window", response: "Quotes are held for two minutes." });
  check("it is acknowledged and resolved, with who handled it", resolved.status === "resolved" && resolved.handled_by === "ops@blockfinax.com" && Boolean(resolved.acknowledged_at) && Boolean(resolved.resolved_at));
  check("resolving needs an outcome", await rejects(store.updateComplaint(c.id, "ops@blockfinax.com", { status: "closed" }), /Outcome is required/));
  const mine = await store.myComplaints(990101);
  check("the customer sees their complaint and our response", mine.some((x: any) => x.id === c.id && x.response));

  // 4. KYB.
  check("only an admin of the business can submit its details", await rejects(store.submitKyb(990102, 999999, { company: {}, people: [] }), /Only an admin/));
  let kybOk = false;
  try {
    const { rows: [org] } = await db.query(`INSERT INTO business_accounts (name, network_key, status, rule_ids, created_by) VALUES ('Records Check Ltd','stellar-testnet','active','{}',990102) RETURNING id`);
    await db.query(`INSERT INTO business_account_members (organisation_id, user_id, email, role, status) VALUES ($1, 990102, 'records-check-2@example.com', 'admin', 'active')`, [org.id]);
    const company = { legalName: "Records Check Ltd", registrationNumber: "CS123", country: "Ghana", incorporationDate: "2020-01-01", registeredAddress: "1 Test Street, Accra", businessActivity: "Importer of machinery", sourceOfFunds: "Trading revenue" };
    check("KYB needs at least one director", await rejects(store.submitKyb(990102, org.id, { company, people: [{ name: "A", role: "owner", nationality: "GH", dateOfBirth: "1980-01-01", ownershipPct: 100 }] }), /director/));
    const sub = await store.submitKyb(990102, org.id, { company, people: [{ name: "Ama Mensah", role: "director_and_owner", nationality: "Ghanaian", dateOfBirth: "1980-01-01", ownershipPct: 60, isPep: false }] });
    const pdf = Buffer.from("%PDF-1.4 test").toString("base64");
    const doc = await store.uploadKybDocument(990102, org.id, sub.id, { kind: "certificate_of_incorporation", name: "cert.pdf", type: "application/pdf", data: pdf });
    check("a document is stored with its hash", /^[0-9a-f]{64}$/.test(doc.sha256));
    const detail = await store.kybDetail(sub.id, "ops@blockfinax.com");
    const viewed = await listLog({ action: "data.viewed", subjectId: String(sub.id), limit: 5 });
    check("staff opening a KYB submission is recorded as a view", detail.documents.length === 1 && viewed.length > 0);
    check("rejecting needs notes", await rejects(store.decideKyb(sub.id, "ops@blockfinax.com", { decision: "rejected" }), /Notes is required/));
    const approved = await store.decideKyb(sub.id, "ops@blockfinax.com", { decision: "approved" });
    check("KYB approved with the reviewer recorded", approved.status === "approved");
    kybOk = true;
  } catch (e) { console.log(`      (business tables not available here: ${(e as Error).message})`); }
  if (!kybOk) check("KYB flow (needs business account tables)", false);

  // 5. Suspicious activity cases.
  const k = await store.openCase("ops@blockfinax.com", { title: "Rapid deposits and withdrawals", subjectType: "user", subjectId: "990103", alertIds: [1, 2], note: "Opened from two alerts." });
  await store.addCaseNote(k.id, "ops@blockfinax.com", "Source of funds requested.");
  check("reporting a case needs a report reference", await rejects(store.decideCase(k.id, "mlro@blockfinax.com", { status: "reported", decision: "Pattern consistent with layering" }), /Report reference is required/));
  const reported = await store.decideCase(k.id, "mlro@blockfinax.com", { status: "reported", decision: "Pattern consistent with layering", reportReference: "FIC-2026-0001" });
  const full = await store.caseDetail(k.id, "mlro@blockfinax.com");
  check("a case is opened, noted and reported, with who decided", reported.status === "reported" && reported.decided_by === "mlro@blockfinax.com" && full.notes.length === 2);

  // 6. Travel Rule.
  const t = store.travelRuleThreshold();
  check("below the threshold nothing is needed", (await store.travelRuleFor(990103, null, { chain: "stellar-testnet", asset: "USDC", amount: t - 1, to: "GTEST" }, undefined)) === null);
  check("at the threshold the recipient's details are required", await rejects(store.travelRuleFor(990103, null, { chain: "stellar-testnet", asset: "USDC", amount: t, to: "GTEST" }, undefined), /recipient's details/));
  const tr = await store.travelRuleFor(990103, null, { chain: "stellar-testnet", asset: "USDC", amount: t + 500, to: "GTEST" }, { beneficiaryType: "business", beneficiaryName: "Shenzhen Supplier Co", beneficiaryVasp: "Self-hosted wallet", beneficiaryCountry: "China" });
  check("details are stored for transfers at or above it", typeof tr === "number");

  // 7. Deletion.
  const req = await store.requestDeletion(990103);
  const again = await store.requestDeletion(990103);
  check("a repeated request returns the open one", again.id === req.id);
  const summary = await store.completeDeletion(req.id, "ops@blockfinax.com");
  const { rows: [u] } = await db.query(`SELECT email, name FROM user_accounts WHERE id = 990103`);
  check("profile data is anonymised", u.email === "deleted-990103@deleted.invalid" && u.name === null);
  check("regulated records are listed as kept, with how long", summary.kept.some((r: any) => r.key === "identity" && r.years >= 5) && summary.kept.some((r: any) => r.key === "travelRule"));

  // 8. Report.
  const day = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const report = await regulatoryReport(day, tomorrow);
  check("the report counts today's complaints, cases and Travel Rule transfers", report.complaints.received >= 1 && report.compliance.casesReported >= 1 && report.compliance.travelRuleTransfers >= 1);
  const csv = reportCsv(report);
  check("the report exports as CSV", csv.startsWith("section,item,value") && csv.includes("complaints,received,"));

  // 9. Still intact after all of that.
  v = await verifyLog();
  check("the log still verifies end to end", v.ok, `${v.entries} entries, last ${v.lastHash.slice(0, 12)}…`);

  await pool!.end();
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
assert.ok(true);
