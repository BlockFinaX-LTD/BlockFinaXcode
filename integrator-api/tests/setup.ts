/**
 * Global test setup. Sets predictable env vars so config-driven modules
 * (chains.ts, rift-auth.ts) don't blow up when imported with no .env present.
 */

process.env.NODE_ENV = "test";
process.env.RIFT_API_KEY = process.env.RIFT_API_KEY || "test-rift-key";
process.env.RIFT_API_BASE = process.env.RIFT_API_BASE || "https://payment.riftfi.xyz";

// Make sure the chain configs use deterministic, stable RPCs (no env override).
// Tests that hit reader.ts will stub the contracts directly; tests that hit
// the broadcast endpoint or estimateGas use a tiny mock that doesn't actually
// dial the RPC.
process.env.LISK_RPC_URL = process.env.LISK_RPC_URL || "https://rpc.api.lisk.com";
process.env.BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
process.env.BSC_RPC_URL  = process.env.BSC_RPC_URL  || "https://bsc-dataseed.binance.org";
