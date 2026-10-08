import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ethers } from 'ethers';
import path from 'node:path';

/** Separate wallet host: no production routes, database, email or oracle workers. */
export function createSandboxWalletApp(config: { rpcUrl: string; tokenAddress?: string; diamondAddress?: string; publicDir: string }) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120 }));
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, 84532, { staticNetwork: true });
  const unavailable = (_req: express.Request, res: express.Response) => res.status(503).json({
    error: 'This feature is awaiting testnet configuration.', environment: 'sandbox', chainId: 84532,
  });
  app.get('/health', (_req, res) => res.json({ ok: true, environment: 'sandbox', chainId: 84532 }));
  app.get('/api/sandbox/status', (_req, res) => res.json({
    environment: 'sandbox', chainId: 84532, signingReady: false,
    contractsReady: Boolean(config.diamondAddress && config.tokenAddress),
    tokenAddress: config.tokenAddress || null, diamondAddress: config.diamondAddress || null,
  }));
  app.get('/api/sandbox/balances/:address', async (req, res) => {
    if (!ethers.isAddress(req.params.address)) return res.status(400).json({ error: 'Invalid wallet address' });
    if (!config.tokenAddress) return res.json({ balances: [], tokenConfigured: false, chainId: 84532 });
    try {
      const token = new ethers.Contract(config.tokenAddress, ['function balanceOf(address) view returns (uint256)'], provider);
      const amount = await token.balanceOf(req.params.address);
      return res.json({ balances: [{ amount: Number(ethers.formatUnits(amount, 6)), token: 'sUSD', chain: 'BASE_SEPOLIA', chainName: 'Base Sepolia' }], tokenConfigured: true, chainId: 84532 });
    } catch { return res.status(502).json({ error: 'Unable to read testnet token balance' }); }
  });
  const readMethods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getBalance', 'eth_getCode', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getLogs', 'eth_getBlockByNumber']);
  app.post('/api/rpc/:chainId', async (req, res) => {
    if (req.params.chainId !== '84532') return res.status(400).json({ error: 'Sandbox supports only Base Sepolia (84532)' });
    const calls = Array.isArray(req.body) ? req.body : [req.body];
    if (!calls.length || calls.length > 20 || calls.some(c => !c || !readMethods.has(c.method))) {
      return res.status(400).json({ error: 'Only supported read-only RPC methods are allowed' });
    }
    try {
      const response = await fetch(config.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body), signal: AbortSignal.timeout(15_000) });
      res.status(response.status).json(await response.json());
    } catch { res.status(502).json({ error: 'Testnet RPC unavailable' }); }
  });
  // Deterministic fixtures for the sandbox; never presented as live oracle prices.
  app.get('/api/fx/rates', (_req, res) => res.json({ synthetic: true,
    rates: { 'USD/GHS': { pair: 'USD/GHS', rate: 10 }, 'USD/NGN': { pair: 'USD/NGN', rate: 1500 }, 'USD/KES': { pair: 'USD/KES', rate: 130 } },
    pairs: ['USD/GHS', 'USD/NGN', 'USD/KES'],
    pairsWithClass: ['USD/GHS', 'USD/NGN', 'USD/KES'].map(pair => ({ pair, assetClass: 'fx' })),
  }));
  // No reward campaigns or stored activity are configured in this fresh environment.
  for (const route of ['/api/tasks', '/api/tasks/leaderboard', '/api/hedge/events/open', '/api/hedge/pool-stats', '/api/hedge/activity/:address', '/api/referrals/:address', '/api/points/transactions/:address']) app.get(route, (_req, res) => res.json([]));
  app.get('/api/tasks/progress/:address', (_req, res) => res.json({ completedTaskIds: [], todayCompletedTaskIds: [], userTotalPoints: 0 }));
  app.get('/api/points/:address', (_req, res) => res.json({ totalPoints: 0, referralPoints: 0 }));
  app.use('/api', unavailable);
  app.use(express.static(config.publicDir, { index: false }));
  app.get('*', (_req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(config.publicDir, 'index.html')); });
  return app;
}
