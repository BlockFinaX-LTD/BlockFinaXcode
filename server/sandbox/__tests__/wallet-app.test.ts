import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxWalletApp } from '../wallet-app';

test('sandbox rejects mainnet RPC, broadcasts, unsupported features, and malformed wallets', async () => {
  const app = createSandboxWalletApp({ rpcUrl: 'https://sandbox.invalid', publicDir: '/tmp' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const post = (url: string, body: unknown) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    for (const chain of [8453, 56, 1]) {
      assert.equal((await post(`/api/rpc/${chain}`, { method: 'eth_chainId' })).status, 400);
    }
    for (const body of [{ method: 'eth_sendRawTransaction', params: ['0x1234'] }, [{ method: 'eth_call' }, { method: 'eth_sendTransaction' }], {}, []]) {
      assert.equal((await post('/api/rpc/84532', body)).status, 400);
    }
    assert.equal((await post('/api/tasks/complete', {})).status, 503);
    assert.equal((await fetch(base + '/api/sandbox/balances/not-an-address')).status, 400);
    const status = await (await fetch(base + '/api/sandbox/status')).json();
    assert.equal(status.chainId, 84532);
    assert.equal(status.signingReady, false);
    assert.equal(status.contractsReady, false);
    const balances = await (await fetch(base + '/api/sandbox/balances/0x0000000000000000000000000000000000000001')).json();
    assert.deepEqual(balances.balances, []);
    assert.equal(balances.tokenConfigured, false);
    assert.equal((await (await fetch(base + '/api/fx/rates')).json()).synthetic, true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
