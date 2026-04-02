import type { Express } from "express";
import { db } from "../db";
import { storage } from "../storage";
import { eq, desc } from "drizzle-orm";
import { wallets } from "../../shared/schema";
import { authSessions } from "../../shared/schema";
import { requireAdmin } from "../middleware/admin-auth";

export function registerWalletRoutes(app: Express) {
  app.get("/api/wallets", async (req, res) => {
    const token = (req.headers['x-session-token'] as string) || null;
    if (!token) return res.status(401).json({ message: 'Authentication required' });
    try {
      const [session] = await db.select().from(authSessions).where(eq(authSessions.sessionToken, token));
      if (!session || session.expiresAt < new Date()) return res.status(401).json({ message: 'Session expired' });

      const sessionWalletAddress = session.walletAddress;
      if (!sessionWalletAddress) return res.json([]);

      const wallet = await storage.getWalletByAddress(sessionWalletAddress);
      if (!wallet) return res.json([]);

      const { encryptedPrivateKey: _k, encryptedMnemonic: _m, ...safeWallet } = wallet as any;
      res.json([safeWallet]);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch wallets" });
    }
  });

  app.post("/api/wallets", async (req, res) => {
    try {
      const existing = await storage.getWalletByAddress(req.body.address);
      if (existing) return res.status(200).json(existing);

      const wallet = await storage.createWallet(req.body);

      const SIGNUP_BONUS = 100;
      let pts = await storage.getUserPoints(wallet.address);
      if (!pts) {
        pts = await storage.createUserPoints({ walletAddress: wallet.address, totalPoints: SIGNUP_BONUS, referralPoints: 0 });
      } else {
        await storage.updateUserPoints(wallet.address, SIGNUP_BONUS);
      }
      await storage.createPointTransaction({
        walletAddress: wallet.address,
        type: 'signup_bonus',
        points: SIGNUP_BONUS,
        description: 'Welcome bonus for creating an account',
        referenceId: wallet.address,
      });

      res.status(201).json(wallet);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to create wallet" });
    }
  });

  app.post("/api/wallets/email", async (req, res) => {
    const emailToken = (req.headers['x-session-token'] as string) || null;
    if (!emailToken) return res.status(401).json({ error: 'Authentication required' });
    const [emailSess] = await db.select().from(authSessions).where(eq(authSessions.sessionToken, emailToken));
    if (!emailSess || emailSess.expiresAt < new Date()) return res.status(401).json({ error: 'Session expired' });
    try {
      const { walletAddress, email } = req.body;
      if (!walletAddress || !email) return res.status(400).json({ error: "walletAddress and email required" });
      await db.update(wallets).set({ email }).where(eq(wallets.address, walletAddress));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save email" });
    }
  });

  app.get("/api/wallets/:id", async (req, res) => {
    const token = (req.headers['x-session-token'] as string) || null;
    if (!token) return res.status(401).json({ message: 'Authentication required' });
    try {
      const [session] = await db.select().from(authSessions).where(eq(authSessions.sessionToken, token));
      if (!session || session.expiresAt < new Date()) return res.status(401).json({ message: 'Session expired' });
      const wallet = await storage.getWallet(parseInt(req.params.id));
      if (!wallet) return res.status(404).json({ message: "Wallet not found" });
      const { encryptedPrivateKey: _k, encryptedMnemonic: _m, ...safeWallet } = wallet as any;
      res.json(safeWallet);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch wallet" });
    }
  });

  app.get("/api/wallet/:address/token-balances", async (req, res) => {
    try {
      const { address } = req.params;
      const { networkId } = req.query;
      const chainId = networkId ? parseInt(networkId as string) : 1135;

      const ethers = await import("ethers");

      type TokenDef = { symbol: string; name: string; address: string; decimals: number; icon: string; color: string };
      const NETWORK_CONFIG: Record<number, { rpcUrl: string; tokens: TokenDef[] }> = {
        1135: {
          rpcUrl: "https://rpc.api.lisk.com",
          tokens: [
            { symbol: "USDC", name: "USD Coin", address: "0xF242275d3a6527d877f2c927a82D9b057609cc71", decimals: 6, icon: "💵", color: "#2775CA" },
            { symbol: "USDT", name: "Tether USD", address: "0x05D032ac25d322df992303dCa074EE7392C117b9", decimals: 6, icon: "💲", color: "#26A17B" },
          ],
        },
        4202: {
          rpcUrl: "https://rpc.sepolia-api.lisk.com",
          tokens: [
            { symbol: "USDC", name: "Test USDC", address: "0xf52Ad63619Bf9cFeF510341ac6b4038554399562", decimals: 6, icon: "💵", color: "#2775CA" },
            { symbol: "USDT", name: "Tether USD", address: "0x05D032ac25d322df992303dCa074EE7392C117b9", decimals: 6, icon: "💲", color: "#26A17B" },
          ],
        },
        8453: {
          rpcUrl: "https://mainnet.base.org",
          tokens: [
            { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, icon: "💵", color: "#2775CA" },
            { symbol: "USDT", name: "Tether USD", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6, icon: "💲", color: "#26A17B" },
          ],
        },
        56: {
          rpcUrl: "https://bsc-dataseed.binance.org",
          tokens: [
            { symbol: "USDC", name: "USD Coin (BSC)", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, icon: "💵", color: "#2775CA" },
            { symbol: "USDT", name: "Tether USD", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, icon: "💲", color: "#26A17B" },
          ],
        },
      };

      const config = NETWORK_CONFIG[chainId];
      if (!config) return res.json({ balances: [] });

      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const tokenAbi = [
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)"
      ];

      const results = await Promise.all(
        config.tokens.map(async (token) => {
          try {
            const contract = new ethers.Contract(token.address, tokenAbi, provider);
            const [rawBalance, onchainDecimals] = await Promise.all([
              contract.balanceOf(address),
              contract.decimals().catch(() => token.decimals),
            ]);
            const dec = Number(onchainDecimals);
            const balance = ethers.formatUnits(rawBalance, dec);
            const usdValue = parseFloat(balance) * 1.0;
            return { token: { ...token, decimals: dec }, balance, usdValue };
          } catch {
            return { token, balance: "0", usdValue: 0 };
          }
        })
      );

      res.json({ balances: results });
    } catch (error: any) {
      res.json({ balances: [] });
    }
  });

  app.get("/api/wallet/:address/transactions", async (req, res) => {
    try {
      const { address } = req.params;
      const { networkId } = req.query;
      const chainId = networkId ? parseInt(networkId as string) : 4202;

      let baseUrl = '';
      if (chainId === 4202) baseUrl = 'https://sepolia-blockscout.lisk.com/api';
      if (!baseUrl) return res.json({ transactions: [] });

      const usdcContracts = [
        '0x0e82fddad51cc3ac12b69761c45bbcb9a2bf3c83',
        '0xf52ad63619bf9cfef510341ac6b4038554399562',
      ];

      const txListUrl = `${baseUrl}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc`;
      const tokenTxUrl = `${baseUrl}?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc`;

      const [txResponse, tokenResponse] = await Promise.all([
        fetch(txListUrl).then(r => r.json()).catch(() => ({ status: '0', result: [] })),
        fetch(tokenTxUrl).then(r => r.json()).catch(() => ({ status: '0', result: [] })),
      ]);

      const allTransactions: any[] = [];
      const seenHashes = new Set<string>();

      if (tokenResponse.status === '1' && Array.isArray(tokenResponse.result)) {
        for (const tx of tokenResponse.result) {
          const contractAddr = tx.contractAddress?.toLowerCase() || '';
          const isUsdc = usdcContracts.includes(contractAddr);
          const decimals = parseInt(tx.tokenDecimal) || 6;
          const rawAmount = BigInt(tx.value || '0');
          const displayValue = (Number(rawAmount) / Math.pow(10, decimals)).toString();
          const usdValue = isUsdc ? Number(rawAmount) / Math.pow(10, decimals) : 0;

          allTransactions.push({
            hash: tx.hash, from: tx.from, to: tx.to, value: displayValue,
            type: tx.from.toLowerCase() === address.toLowerCase() ? 'sent' : 'received',
            status: 'confirmed', timestamp: new Date(parseInt(tx.timeStamp) * 1000),
            blockNumber: tx.blockNumber, gasUsed: tx.gasUsed || '0', gasPrice: tx.gasPrice || '0',
            usdValue, tokenSymbol: isUsdc ? 'USDC' : (tx.tokenSymbol || 'TOKEN'), isTokenTransfer: true
          });
          seenHashes.add(tx.hash);
        }
      }

      if (txResponse.status === '1' && Array.isArray(txResponse.result)) {
        for (const tx of txResponse.result) {
          if (seenHashes.has(tx.hash)) continue;
          const ethValue = parseFloat(tx.value) / 1e18;
          if (ethValue === 0 && tx.input && tx.input !== '0x') continue;
          allTransactions.push({
            hash: tx.hash, from: tx.from, to: tx.to, value: ethValue.toString(),
            type: tx.from.toLowerCase() === address.toLowerCase() ? 'sent' : 'received',
            status: tx.txreceipt_status === '1' ? 'confirmed' : 'failed',
            timestamp: new Date(parseInt(tx.timeStamp) * 1000),
            blockNumber: tx.blockNumber, gasUsed: tx.gasUsed, gasPrice: tx.gasPrice,
            usdValue: ethValue * 3200, tokenSymbol: 'ETH', isTokenTransfer: false
          });
        }
      }

      allTransactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      res.json({ transactions: allTransactions.slice(0, 50) });
    } catch (error) {
      res.json({ transactions: [] });
    }
  });

  app.get("/api/networks", async (req, res) => {
    try {
      const networks = await storage.getAllNetworks();
      res.json(networks);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch networks" });
    }
  });

  app.post("/api/networks", requireAdmin, async (req, res) => {
    try {
      const network = await storage.createNetwork(req.body);
      res.status(201).json(network);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Failed to create network" });
    }
  });

  app.get("/api/stats/platform", async (_req, res) => {
    try {
      const { db: _db } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const walletResult = await _db.execute(sql`SELECT COUNT(*)::int as count FROM wallets`);
      const profileResult = await _db.execute(sql`SELECT COUNT(*)::int as count FROM user_profiles`);
      const activeResult = await _db.execute(sql`SELECT COUNT(*)::int as count FROM hedge_events WHERE status = 'open'`);
      const totalResult = await _db.execute(sql`SELECT COUNT(*)::int as count FROM hedge_events`);
      const rows = walletResult.rows || walletResult;
      const pRows = profileResult.rows || profileResult;
      const aRows = activeResult.rows || activeResult;
      const tRows = totalResult.rows || totalResult;
      res.json({
        totalWallets: Number(rows[0]?.count || 0),
        totalProfiles: Number(pRows[0]?.count || 0),
        activeHedgeEvents: Number(aRows[0]?.count || 0),
        totalHedgeEvents: Number(tRows[0]?.count || 0),
      });
    } catch (error) {
      console.error("Platform stats error:", error);
      res.json({ totalWallets: 0, totalProfiles: 0, activeHedgeEvents: 0, totalHedgeEvents: 0 });
    }
  });
}
