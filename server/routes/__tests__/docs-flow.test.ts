import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// Exercise the real route handlers with isolated database/mail adapters.
// No live database, credentials, or email recipients are involved.
async function harness() {
  const rows: any[] = [];
  const writes: any[] = [];
  const sends: any[] = [];
  const sessions: any[] = [];
  const revocations: number[] = [];
  let mailOk = true;
  const db: any = {
    insert: (table: any) => ({ values: (values: any) => {
      writes.push({ kind: 'insert', table, values });
      return { returning: async () => [{ id: 42 }] };
    } }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows.shift() || [] }) }) }),
    update: (table: any) => ({ set: (values: any) => ({ where: () => {
      writes.push({ kind: 'update', table, values });
      return { returning: async () => rows.shift() || [] };
    } }) }),
  };
  const adapters: Record<string, string> = {
    '../db': 'export const db = globalThis.adapters.db;',
    '../storage': 'export const storage = {};',
    '../middleware/admin-auth': `export const requireAdmin = (req,res,next) => req.headers['x-admin-token'] === 'admin' ? next() : res.status(401).json({error:'Unauthorized'}); export const getOwnerEmails = () => ['admin@example.com'];`,
    './investor': 'export const mintInvestorSession = globalThis.adapters.mint; export const revokeDocsInvestorSessions = globalThis.adapters.revoke;',
    '../email': `export const APP_URL = 'https://www.blockfinax.com'; export const DOCS_URL = 'https://docs.blockfinax.com';
      export const emailDocsToken = globalThis.adapters.send;
      export const emailAdminNewDocsRequest = globalThis.adapters.notify;
      export const emailAdminNewAccessRequest = async () => ({});
      export const emailUserAccessReceived = async () => ({});
      export const emailUserAccessApproved = async () => ({});
      export const emailUserAccessRejected = async () => ({});`,
  };
  const result = await build({
    entryPoints: ['server/routes/gate.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
    packages: 'external', plugins: [{ name: 'isolated-adapters', setup(b) {
      b.onResolve({ filter: /.*/ }, args => adapters[args.path] ? { path: args.path, namespace: 'adapter' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'adapter' }, args => ({ contents: adapters[args.path], loader: 'js' }));
    } }],
  });
  const module = { exports: {} as any };
  vm.runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports, require: createRequire(import.meta.url), process, console, Date, Buffer,
    adapters: {
      db,
      revoke: (id: number) => revocations.push(id),
      send: async (...args: any[]) => { sends.push(args); return { ok: mailOk }; },
      notify: async () => ({ ok: true }),
      mint: (opts: any) => { sessions.push(opts); return { token: 'investor-session', expiresAt: Date.now() + 10000 }; },
    },
  });
  const routes = new Map<string, any[]>();
  const app: any = {};
  for (const method of ['get','post','delete','options']) app[method] = (path: string, ...handlers: any[]) => routes.set(`${method} ${path}`, handlers);
  module.exports.registerGateRoutes(app);
  async function call(method: string, path: string, request: any = {}) {
    const req = { body: {}, query: {}, params: {}, headers: {}, adminEmail: 'admin@example.com', ...request };
    const response: any = { code: 200, data: undefined, status(code: number) { this.code = code; return this; }, json(data: any) { this.data = data; return this; }, setHeader() {} };
    for (const handler of routes.get(`${method} ${path}`) || []) {
      let proceed = false;
      await handler(req, response, () => { proceed = true; });
      if (!proceed) break;
    }
    return response;
  }
  return { rows, writes, sends, sessions, revocations, call, failMail: () => { mailOk = false; } };
}
const admin = { headers: { 'x-admin-token': 'admin' }, params: { id: '1' } };
const pending = { id: 1, email: 'visitor@example.com', name: 'Visitor', reason: 'Review', emailSentAt: null, status: 'pending' };

test('visitor request queues review without issuing or emailing an access token', async () => {
  const h = await harness();
  const r = await h.call('post', '/api/docs/request', { body: { email: 'Visitor@example.com', reason: 'Review' } });
  assert.equal(r.data.status, 'pending');
  assert.equal(h.sends.length, 0);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].values.email, 'visitor@example.com');
  assert.equal(h.writes[0].values.tokenHash, undefined);
});
test('approval requires an admin session', async () => {
  const h = await harness();
  const r = await h.call('post', '/api/admin/docs/requests/:id', { body: { action: 'approve' }, params: { id: '1' } });
  assert.equal(r.code, 401);
  assert.equal(h.writes.length, 0);
});
test('approval issues a hashed read-only 7-day token and confirms successful delivery', async () => {
  const h = await harness(); h.rows.push([pending], [pending]);
  const before = Date.now();
  const r = await h.call('post', '/api/admin/docs/requests/:id', { ...admin, body: { action: 'approve' } });
  assert.equal(r.data.status, 'approved');
  assert.equal(r.data.emailSent, true);
  const issued = h.writes.find(w => w.kind === 'insert').values;
  assert.equal(issued.isAdmin, false);
  assert.equal(issued.tokenHash.length, 64);
  assert.notEqual(issued.tokenHash, h.sends[0][2]);
  assert.ok(issued.expiresAt.getTime() - before >= 7 * 86400000);
  assert.ok(issued.expiresAt.getTime() - before < 7 * 86400000 + 1000);
  assert.equal(h.writes.at(-1).values.status, 'approved');
});
test('email failure revokes the unsent credential and returns request to pending for retry', async () => {
  const h = await harness(); h.rows.push([pending], [pending]); h.failMail();
  const r = await h.call('post', '/api/admin/docs/requests/:id', { ...admin, body: { action: 'approve' } });
  assert.equal(r.code, 502);
  assert.ok(h.writes.some(w => w.values.revokedAt));
  assert.equal(h.writes.at(-1).values.status, 'pending');
  assert.ok(h.writes.at(-1).values.deliveryError);
});
test('another approval cannot send while a request is claimed', async () => {
  const h = await harness(); h.rows.push([pending], []);
  const r = await h.call('post', '/api/admin/docs/requests/:id', { ...admin, body: { action: 'approve' } });
  assert.equal(r.code, 409);
  assert.equal(h.sends.length, 0);
});
test('rejection sends no document token', async () => {
  const h = await harness(); h.rows.push([pending], [{ ...pending, status: 'rejected' }]);
  const r = await h.call('post', '/api/admin/docs/requests/:id', { ...admin, body: { action: 'reject' } });
  assert.equal(r.data.status, 'rejected');
  assert.equal(h.sends.length, 0);
  assert.equal(h.writes.filter(w => w.kind === 'insert').length, 0);
});
for (const isAdmin of [false, true]) test(`docs verification preserves ${isAdmin ? 'admin editing' : 'visitor read-only'} permissions`, async () => {
  const h = await harness(); h.rows.push([{ id: 1, expiresAt: new Date(Date.now() + 10000), usedAt: new Date(), revokedAt: null, isAdmin }]);
  const r = await h.call('get', '/api/docs/verify', { query: { t: 'docs-token' } });
  assert.equal(r.data.valid, true);
  assert.equal(h.sessions[0].editEnabled, isAdmin);
  assert.equal(h.writes.length, 0, 'verification must not extend expiry');
});
for (const kind of ['revoked', 'expired']) test(`${kind} document token cannot mint an investor session`, async () => {
  const h = await harness(); h.rows.push([{ id: 1, expiresAt: new Date(Date.now() + (kind === 'expired' ? -1000 : 10000)), revokedAt: kind === 'revoked' ? new Date() : null }]);
  const r = await h.call('get', '/api/docs/verify', { query: { t: 'docs-token' } });
  assert.equal(r.data.valid, false);
  assert.equal(h.sessions.length, 0);
});

test('revoking an issued link also revokes derived data-room sessions', async () => {
  const h = await harness();
  const r = await h.call('delete', '/api/admin/docs/tokens/:id', admin);
  assert.equal(r.data.status, 'revoked');
  assert.deepEqual(h.revocations, [1]);
});
