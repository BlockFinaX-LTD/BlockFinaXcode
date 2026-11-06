/**
 * Demo recording helper: a sign-in session for a fresh demo account in the LOCAL database,
 * so the recording can show the email sign-in screen without a real inbox. Refuses any
 * database that is not on this computer.
 */
const url = process.env.DATABASE_URL ?? "";
if (!/@?(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("Demo sessions are only made against a local database (DATABASE_URL on localhost).");
  process.exit(1);
}
const email = process.argv[2];
if (!email) { console.error("Usage: session.ts <email>"); process.exit(1); }
const { findOrCreateUser, createSession } = await import("../../server/auth-routes");
const user = await findOrCreateUser(email);
const token = await createSession(user.id, undefined, 2);
process.stdout.write(JSON.stringify({ userId: user.id, token }) + "\n");
process.exit(0);
