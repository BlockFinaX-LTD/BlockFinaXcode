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
      if (existing) {
        const { encryptedPrivateKey: _k, encryptedMnemonic: _m, ...safeExisting } = existing as any;
        return res.status(200).json(safeExisting);
      }

      const wallet = await storage.createWallet(req.body);

      // Idempotent signup bonus — only grant once (when no points record exists yet)
      const SIGNUP_BONUS = 100;
      const pts = await storage.getUserPoints(wallet.address);
      if (!pts) {
        await storage.createUserPoints({ walletAddress: wallet.address, totalPoints: SIGNUP_BONUS, referralPoints: 0 });
        await storage.createPointTransaction({
          walletAddress: wallet.address,
          type: 'signup_bonus',
          points: SIGNUP_BONUS,
          description: 'Welcome bonus for creating an account',
          referenceId: wallet.address,
        });
      }

      const { encryptedPrivateKey: _k, encryptedMnemonic: _m, ...safeWallet } = wallet as any;
      res.status(201).json(safeWallet);
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
      if (walletAddress.toLowerCase() !== emailSess.walletAddress?.toLowerCase()) {
        return res.status(403).json({ error: 'You can only update your own wallet profile' });
      }
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
      if (wallet.address.toLowerCase() !== session.walletAddress?.toLowerCase()) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const { encryptedPrivateKey: _k, encryptedMnemonic: _m, ...safeWallet } = wallet as any;
      res.json(safeWallet);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch wallet" });
    }
  });

  app.get("/api/wallet/:address/native-balance", async (req, res) => {
    try {
      const { address } = req.params;
      const { networkId } = req.query;
      const chainId = networkId ? parseInt(networkId as string) : 1135;

      const ethers = await import("ethers");

      const NATIVE_CONFIG: Record<number, { rpcUrl: string; symbol: string; name: string }> = {
        1135: { rpcUrl: "https://rpc.api.lisk.com",           symbol: "ETH", name: "Ethereum" },
        4202: { rpcUrl: "https://rpc.sepolia-api.lisk.com",   symbol: "ETH", name: "Ethereum" },
        8453: { rpcUrl: "https://mainnet.base.org",           symbol: "ETH", name: "Ethereum" },
        56:   { rpcUrl: "https://bsc-dataseed.binance.org",   symbol: "BNB", name: "BNB" },
      };

      const config = NATIVE_CONFIG[chainId];
      if (!config) return res.json({ balance: "0", symbol: "ETH" });

      const provider = new ethers.JsonRpcProvider(config.rpcUrl);
      const balanceWei = await Promise.race([
        provider.getBalance(address),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
      ]);
      const balance = ethers.formatEther(balanceWei);

      res.json({ balance, symbol: config.symbol, name: config.name });
    } catch (error: any) {
      res.json({ balance: "0", symbol: "ETH" });
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

      const timeout = <T>(ms: number, p: Promise<T>): Promise<T> =>
        Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

      const results = await Promise.all(
        config.tokens.map(async (token) => {
          try {
            const contract = new ethers.Contract(token.address, tokenAbi, provider);
            const [rawBalance, onchainDecimals] = await timeout(6000, Promise.all([
              contract.balanceOf(address),
              contract.decimals().catch(() => token.decimals),
            ]));
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

      const EXPLORER_API: Record<number, { url: string; symbol: string; chain: string }> = {
        1135: { url: 'https://blockscout.lisk.com/api',  symbol: 'LSK', chain: 'Lisk' },
        8453: { url: 'https://base.blockscout.com/api',  symbol: 'ETH', chain: 'Base' },
        56:   { url: 'https://api.bscscan.com/api',       symbol: 'BNB', chain: 'BSC'  },
      };

      // Known USDC/USDT token contracts (lower-case)
      const usdcContracts = new Set([
        '0xf242275d3a6527d877f2c927a82d9b057609cc71', // Lisk USDC
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // Base USDC
        '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // Base USDT
        '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // BSC USDC
        '0x55d398326f99059ff775485246999027b3197955', // BSC USDT
      ]);

      // Determine which chains to query — default to all production chains
      const requestedChainId = networkId ? parseInt(networkId as string) : null;
      const chainsToQuery = (requestedChainId && EXPLORER_API[requestedChainId])
        ? [requestedChainId]
        : [1135, 8453, 56];

      // Map raw function signatures → friendly labels
      const FUNCTION_LABELS: Record<string, string> = {
        deposit:                 'LP Deposit',
        buyProtection:           'Buy Protection',
        createHedgeEvent:        'Create Event',
        withdrawCapital:         'Withdraw LP Capital',
        claimPayout:             'Claim Payout',
        claimPremiums:           'Claim Premiums',
        withdrawCreatorEarnings: 'Creator Earnings',
        recoverExpiredPayouts:   'Recover Expired Funds',
        settleEvent:             'Oracle Settlement',
        setPoolSettings:         'Pool Settings Update',
        setAllowedPaymentToken:  'Enable Payment Token',
        initializeHedgeFees:     'Set Fee Config',
        setOracleAdmin:          'Add Oracle',
        withdrawPlatformFees:    'Withdraw Platform Fees',
        withdrawPlatformFeesByToken: 'Withdraw Platform Fees',
        diamondCut:              'Propose Upgrade',
        executeCut:              'Execute Upgrade',
        cancelCut:               'Cancel Upgrade',
        transferOwnership:       'Transfer Ownership',
        approve:                 'USDC Approval',
        transfer:                'Token Transfer',
      };

      function friendlyLabel(functionName: string | undefined): string | undefined {
        if (!functionName) return undefined;
        const sig = functionName.split('(')[0].trim();
        return FUNCTION_LABELS[sig];
      }

      async function fetchChain(chainId: number) {
        const meta = EXPLORER_API[chainId];
        const txListUrl  = `${meta.url}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=30&sort=desc`;
        const tokenTxUrl = `${meta.url}?module=account&action=tokentx&address=${address}&startblock=0&endblock=99999999&page=1&offset=30&sort=desc`;

        const [txResponse, tokenResponse] = await Promise.all([
          fetch(txListUrl).then(r => r.json()).catch(() => ({ status: '0', result: [] })),
          fetch(tokenTxUrl).then(r => r.json()).catch(() => ({ status: '0', result: [] })),
        ]);

        // Build hash → functionName map from txlist so we can label token transfers
        const hashToFn = new Map<string, string>();
        if (txResponse.status === '1' && Array.isArray(txResponse.result)) {
          for (const tx of txResponse.result) {
            if (tx.functionName) hashToFn.set(tx.hash.toLowerCase(), tx.functionName);
          }
        }

        const result: any[] = [];
        const seenHashes = new Set<string>();

        if (tokenResponse.status === '1' && Array.isArray(tokenResponse.result)) {
          for (const tx of tokenResponse.result) {
            const contractAddr = tx.contractAddress?.toLowerCase() || '';
            const isUsdc = usdcContracts.has(contractAddr);
            const decimals = parseInt(tx.tokenDecimal) || 6;
            const rawAmount = BigInt(tx.value || '0');
            const displayValue = (Number(rawAmount) / Math.pow(10, decimals)).toString();
            const usdValue = isUsdc ? Number(rawAmount) / Math.pow(10, decimals) : 0;
            // Use outer contract's function name if available, else fall back to ERC-20 action
            const outerFn = hashToFn.get(tx.hash.toLowerCase());
            const label = friendlyLabel(outerFn) ?? (tx.from.toLowerCase() === address.toLowerCase() ? 'USDC Approval' : undefined);
            result.push({
              hash: tx.hash, from: tx.from, to: tx.to, value: displayValue,
              type: tx.from.toLowerCase() === address.toLowerCase() ? 'sent' : 'received',
              status: 'confirmed', timestamp: new Date(parseInt(tx.timeStamp) * 1000),
              blockNumber: tx.blockNumber, gasUsed: tx.gasUsed || '0', gasPrice: tx.gasPrice || '0',
              usdValue, tokenSymbol: isUsdc ? 'USDC' : (tx.tokenSymbol || 'TOKEN'),
              isTokenTransfer: true, chain: meta.chain, chainId, label,
            });
            seenHashes.add(tx.hash);
          }
        }

        if (txResponse.status === '1' && Array.isArray(txResponse.result)) {
          for (const tx of txResponse.result) {
            if (seenHashes.has(tx.hash)) continue;
            const nativeValue = parseFloat(tx.value) / 1e18;
            if (nativeValue === 0 && tx.input && tx.input !== '0x') continue;
            const label = friendlyLabel(tx.functionName);
            result.push({
              hash: tx.hash, from: tx.from, to: tx.to, value: nativeValue.toString(),
              type: tx.from.toLowerCase() === address.toLowerCase() ? 'sent' : 'received',
              status: tx.txreceipt_status === '1' ? 'confirmed' : 'failed',
              timestamp: new Date(parseInt(tx.timeStamp) * 1000),
              blockNumber: tx.blockNumber, gasUsed: tx.gasUsed, gasPrice: tx.gasPrice,
              usdValue: 0, tokenSymbol: meta.symbol, isTokenTransfer: false,
              chain: meta.chain, chainId, label,
            });
          }
        }
        return result;
      }

      const perChain = await Promise.all(chainsToQuery.map(fetchChain));
      const allTransactions = perChain.flat();
      allTransactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      res.json({ transactions: allTransactions.slice(0, 60) });
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

  // JSON-RPC proxy — routes eth_call / eth_getBalance / etc. from the browser
  // through the server to avoid rate-limits imposed on browser IPs by public nodes.
  // POST { chainId, ...jsonRpcBody }  → forwards to an RPC and returns the JSON result.
  // Only read-only methods are allowed — write/signing methods are blocked.
  const RPC_BLOCKED_METHODS = new Set([
    'eth_sendRawTransaction', 'eth_sendTransaction',
    'eth_sign', 'eth_signTransaction', 'eth_signTypedData',
    'eth_signTypedData_v1', 'eth_signTypedData_v3', 'eth_signTypedData_v4',
    'personal_sign', 'personal_ecRecover',
    'wallet_addEthereumChain', 'wallet_switchEthereumChain',
    'wallet_watchAsset', 'wallet_requestPermissions',
  ]);
  const rpcMethodBlocked = (body: any): boolean => {
    if (Array.isArray(body)) return body.some(r => RPC_BLOCKED_METHODS.has(r?.method));
    return RPC_BLOCKED_METHODS.has(body?.method);
  };

  app.post("/api/rpc/:chainId", async (req, res) => {
    if (rpcMethodBlocked(req.body)) {
      return res.status(403).json({ jsonrpc: "2.0", error: { code: -32601, message: "Method not permitted via proxy" }, id: (req.body as any)?.id ?? null });
    }

    const chainId = parseInt(req.params.chainId, 10);
    const RPC_LIST: Record<number, string[]> = {
      1135: ["https://rpc.api.lisk.com", "https://lisk.drpc.org"],
      4202: ["https://rpc.sepolia-api.lisk.com"],
      8453: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
      56:   ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org"],
    };
    const urls = RPC_LIST[chainId];
    if (!urls) return res.status(400).json({ error: `Unsupported chainId: ${chainId}` });

    const isRateLimitErr = (errObj: any) => {
      if (!errObj) return false;
      const code = errObj?.code;
      const msg: string = (errObj?.message ?? "").toLowerCase();
      return (
        code === -32016 || code === -32005 || code === -32029 ||
        msg.includes("rate limit") || msg.includes("too many requests") ||
        msg.includes("over limit") || msg.includes("exceeded")
      );
    };
    const hasRateLimit = (data: any): boolean => {
      if (Array.isArray(data)) return data.some((item: any) => isRateLimitErr(item?.error));
      return isRateLimitErr(data?.error);
    };
    const firstErrMsg = (data: any): string => {
      if (Array.isArray(data)) return data.find((item: any) => item?.error)?.error?.message ?? "batch error";
      return data?.error?.message ?? "unknown error";
    };

    let lastErr = "";
    for (const url of urls) {
      try {
        const rpcRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
        });
        const data = await rpcRes.json();
        if (hasRateLimit(data)) {
          lastErr = `${url}: ${firstErrMsg(data)}`;
          continue;
        }
        return res.json(data);
      } catch (e: any) {
        lastErr = e.message;
      }
    }
    res.status(503).json({ jsonrpc: "2.0", error: { code: -32603, message: `All RPCs failed: ${lastErr}` }, id: (req.body as any)?.id ?? null });
  });

  // Prepare transaction parameters server-side (nonce, gas, chainId) so the browser
  // never needs to call the RPC directly (avoids CORS on read ops too).
  app.post("/api/wallet/tx-params", async (req, res) => {
    try {
      const { chainId, from, to, data, value } = req.body;
      if (!chainId || !from || !to) {
        return res.status(400).json({ error: "Missing chainId, from, or to" });
      }

      const { ethers } = await import("ethers");

      const RPC_URLS: Record<number, string[]> = {
        1135: ["https://rpc.api.lisk.com", "https://lisk.drpc.org"],
        4202: ["https://rpc.sepolia-api.lisk.com"],
        8453: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
        56:   ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org"],
      };

      const urls = RPC_URLS[Number(chainId)];
      if (!urls) return res.status(400).json({ error: `Unsupported chainId: ${chainId}` });

      let provider: any = null;
      let lastErr = "";
      for (const url of urls) {
        try {
          const p = new ethers.JsonRpcProvider(url);
          await p.getBlockNumber(); // connectivity check
          provider = p;
          break;
        } catch (e: any) { lastErr = e.message; }
      }
      if (!provider) return res.status(503).json({ error: `No reachable RPC: ${lastErr}` });

      const txValue = value ? BigInt(value) : 0n;
      const txData  = data  || "0x";
      // gasBumpPct: optional caller-requested percentage bump on top of base fee (for replacement txs)
      const gasBumpPct = Math.max(0, Math.min(200, Number(req.body.gasBumpPct ?? 0)));

      // Estimate gas — but distinguish contract reverts from network errors.
      // A contract revert during eth_estimateGas means the tx WILL fail on-chain;
      // we should reject it here rather than sending it and wasting gas.
      async function estimateGasSafe(): Promise<bigint> {
        try {
          return await provider.estimateGas({ from, to, data: txData, value: txValue });
        } catch (e: any) {
          const msg: string = e?.message || e?.reason || '';
          const msgLow = msg.toLowerCase();
          const isRevert =
            e?.code === 'CALL_EXCEPTION' ||
            msgLow.includes('execution reverted') ||
            msgLow.includes('revert') ||
            msgLow.includes('invalid opcode') ||
            msgLow.includes('out of gas');

          if (isRevert) {
            // ERC-20 allowance errors occur when the approval TX has confirmed on one
            // RPC node but hasn't propagated to the node used for gas estimation yet.
            // Treat these as soft/transient failures: use a generous fixed gas limit
            // so the TX is still broadcast — by the time it is mined, the approve
            // will already be in a prior block.
            const isAllowanceError =
              msgLow.includes('allowance') ||
              msgLow.includes('transfer amount exceeds') ||
              msgLow.includes('exceeds allowance') ||
              msgLow.includes('insufficient allowance');
            if (isAllowanceError) {
              console.warn('[tx-params] ERC-20 allowance not yet propagated to this RPC node — using safe fallback gas (600000):', msg);
              return 600_000n;
            }
            // All other reverts are definitive — surface the reason to the client.
            const reason = e?.reason || e?.data || msg;
            throw new Error(`Contract simulation failed — transaction would revert: ${reason}`);
          }
          // Pure network / RPC error — fall back silently
          console.warn('[tx-params] gas estimation network error, using fallback:', msg);
          return 100_000n;
        }
      }

      const [nonce, feeData, gasEstimate] = await Promise.all([
        provider.getTransactionCount(from, "pending"),
        provider.getFeeData(),
        estimateGasSafe(),
      ]);

      // BSC doesn't support EIP-1559 — use legacy gasPrice
      const isBsc = Number(chainId) === 56;
      const gasLimit = (BigInt(gasEstimate) * 130n) / 100n; // +30% buffer

      // Apply a 20% baseline buffer so transactions naturally replace any stuck pending ones,
      // plus any additional caller-requested bump (used on retry after "replacement fee too low").
      const bumpFactor = 120n + BigInt(gasBumpPct);   // e.g. 120 = 20% above base

      const tx: any = {
        type:     isBsc ? 0 : 2,
        chainId:  Number(chainId),
        nonce,
        to,
        value:    txValue.toString(),
        data:     txData,
        gasLimit: gasLimit.toString(),
      };

      let effectiveGasPrice: bigint;
      if (isBsc) {
        const baseGasPrice = feeData.gasPrice ?? 3_000_000_000n;
        tx.gasPrice = ((baseGasPrice * bumpFactor) / 100n).toString();
        effectiveGasPrice = ((baseGasPrice * bumpFactor) / 100n);
      } else {
        const baseMaxFee      = feeData.maxFeePerGas         ?? feeData.gasPrice ?? 1_500_000_000n;
        const basePriorityFee = feeData.maxPriorityFeePerGas ?? 1_000_000_000n;
        tx.maxFeePerGas         = ((baseMaxFee      * bumpFactor) / 100n).toString();
        tx.maxPriorityFeePerGas = ((basePriorityFee * bumpFactor) / 100n).toString();
        effectiveGasPrice = ((baseMaxFee * bumpFactor) / 100n);
      }

      // ── Exact-gas sponsorship ────────────────────────────────────────────────
      // Calculate the exact ETH needed for this transaction, then top up the
      // wallet by exactly the shortfall so no excess is ever sent.
      try {
        const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
        if (deployerKey) {
          const maxGasCost = gasLimit * effectiveGasPrice;          // worst-case cost
          const walletBal  = await provider.getBalance(from);

          if (walletBal < maxGasCost) {
            const shortfall  = maxGasCost - walletBal;
            const toSend     = (shortfall * 110n) / 100n;           // +10% buffer

            const deployer   = new ethers.Wallet(deployerKey, provider);
            const depBal     = await provider.getBalance(deployer.address);

            if (depBal > toSend) {
              const sponsorTx = await deployer.sendTransaction({ to: from, value: toSend });
              await sponsorTx.wait();
              console.log(`[GasSponsor] Sent ${ethers.formatEther(toSend)} ETH to ${from} on chain ${chainId} (exact-cost sponsorship)`);
            } else {
              console.warn(`[GasSponsor] Deployer balance too low to sponsor gas on chain ${chainId}`);
            }
          }
        }
      } catch (sponsorErr: any) {
        // Non-fatal — log and continue; transaction may still succeed if wallet has some gas
        console.warn("[GasSponsor] Gas sponsorship failed:", sponsorErr?.message);
      }
      // ────────────────────────────────────────────────────────────────────────

      res.json({ tx });
    } catch (error: any) {
      console.error("tx-params error:", error);
      res.status(500).json({ error: error?.message || "Internal error" });
    }
  });

  // Broadcast a pre-signed transaction via server to bypass browser CORS restrictions
  // The private key never leaves the client — only the signed raw tx is sent here
  app.post("/api/wallet/broadcast", async (req, res) => {
    try {
      const { signedTx, chainId } = req.body;
      if (!signedTx || !chainId) {
        return res.status(400).json({ error: "Missing signedTx or chainId" });
      }

      const { ethers } = await import("ethers");

      const RPC_URLS: Record<number, string[]> = {
        1135: ["https://rpc.api.lisk.com", "https://lisk.drpc.org"],
        4202: ["https://rpc.sepolia-api.lisk.com"],
        8453: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
        56:   ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org"],
      };

      const urls = RPC_URLS[Number(chainId)];
      if (!urls || urls.length === 0) {
        return res.status(400).json({ error: `Unsupported chainId: ${chainId}` });
      }

      let lastError: string = "Broadcast failed";
      for (const url of urls) {
        try {
          const provider = new ethers.JsonRpcProvider(url);
          const tx = await provider.broadcastTransaction(signedTx);
          return res.json({ hash: tx.hash });
        } catch (err: any) {
          lastError = err?.message || "Broadcast failed";
          continue;
        }
      }

      res.status(400).json({ error: lastError });
    } catch (error: any) {
      console.error("Broadcast error:", error);
      res.status(500).json({ error: error?.message || "Internal error" });
    }
  });

  // Server-side tx receipt check — avoids browser polling RPC directly (CORS)
  // Returns { confirmed: true } once mined, { confirmed: false } while pending.
  app.post("/api/wallet/tx-receipt", async (req, res) => {
    try {
      const { txHash, chainId, includeLogs } = req.body;
      if (!txHash || !chainId) {
        return res.status(400).json({ error: "Missing txHash or chainId" });
      }

      const { ethers } = await import("ethers");

      const RPC_URLS: Record<number, string[]> = {
        1135: ["https://rpc.api.lisk.com", "https://lisk.drpc.org"],
        4202: ["https://rpc.sepolia-api.lisk.com"],
        8453: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
        56:   ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org"],
      };

      const urls = RPC_URLS[Number(chainId)];
      if (!urls) return res.status(400).json({ error: `Unsupported chainId: ${chainId}` });

      for (const url of urls) {
        try {
          const provider = new ethers.JsonRpcProvider(url);
          const receipt = await provider.getTransactionReceipt(txHash);
          if (receipt && receipt.blockNumber) {
            const base = { confirmed: true, blockNumber: receipt.blockNumber, status: receipt.status };
            if (includeLogs && receipt.logs?.length) {
              const logs = receipt.logs.map(l => ({ topics: l.topics as string[], data: l.data }));
              return res.json({ ...base, logs });
            }
            return res.json(base);
          }
          return res.json({ confirmed: false });
        } catch {
          continue;
        }
      }

      res.json({ confirmed: false });
    } catch (error: any) {
      console.error("tx-receipt error:", error);
      res.status(500).json({ error: error?.message || "Internal error" });
    }
  });
}
