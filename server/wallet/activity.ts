/**
 * Wallet activity: every USDC movement in or out of a BlockFinaX wallet on the hub chain.
 *
 * Stellar RPC keeps only about a week of events, so a background job reads the USDC
 * contract's transfer, mint and burn events every 30 seconds and saves the ones that touch
 * a BlockFinaX wallet (personal or business) in wallet_activity. History therefore runs from
 * about a week before the job first ran, and is kept from then on.
 *
 * Each movement is labelled when read: by the call that caused it (from the compliance log's
 * transaction.relayed entries, matched on transaction hash) or by who was on the other side
 * (a pool contract, the test USDC faucet, Circle CCTP). Several transfers in one transaction
 * and direction (a premium and its fee, say) are shown as one line.
 */
import { Keypair, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { chainRegistry } from "../chain/config";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
async function getDb(): Promise<Db> {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  return pool as unknown as Db;
}

let ready: Promise<void> | null = null;
async function activityDb(): Promise<Db> {
  const db = await getDb();
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS wallet_activity (
      id bigserial PRIMARY KEY,
      network_key text NOT NULL,
      event_id text NOT NULL UNIQUE,
      tx_hash text NOT NULL,
      ledger integer NOT NULL,
      at timestamptz NOT NULL,
      address text NOT NULL,
      direction text NOT NULL,
      amount numeric NOT NULL,
      counterparty text,
      event text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS wallet_activity_address_idx ON wallet_activity (network_key, address, at DESC);
    CREATE TABLE IF NOT EXISTS wallet_activity_cursor (network_key text PRIMARY KEY, cursor text, ledger integer, updated_at timestamptz NOT NULL DEFAULT now());
  `).then(() => undefined);
  await ready;
  return db;
}

/** Every wallet BlockFinaX knows on this network: personal smart accounts and business accounts. */
async function knownAddresses(db: Db, network: string): Promise<Set<string>> {
  const found = new Set<string>();
  const add = (rows: any[]) => rows.forEach((r) => r.address && found.add(String(r.address)));
  add((await db.query(`SELECT address FROM chain_wallet_accounts WHERE network_key = $1`, [network]).catch(() => ({ rows: [] }))).rows);
  add((await db.query(`SELECT account_address AS address FROM business_accounts WHERE network_key = $1 AND account_address IS NOT NULL`, [network]).catch(() => ({ rows: [] }))).rows);
  return found;
}

/** The ledger an RPC event cursor points at (its TOID's upper 32 bits). */
const ledgerOf = (cursor: string) => { try { return Number(BigInt(cursor.split("-")[0]!) >> 32n); } catch { return 0; } };

const native = (v: xdr.ScVal) => { try { return scValToNative(v); } catch { return null; } };
const isAddress = (v: unknown) => typeof v === "string" && /^[GCM][A-Z2-7]{55}$/.test(v);

/** One USDC event as movements: [address, direction, amount, counterparty]. */
export function movementsOf(topics: unknown[], data: unknown): { from: string | null; to: string | null; amount: bigint } | null {
  const name = String(topics[0] ?? "");
  const amount = typeof data === "bigint" ? data : typeof data === "object" && data && "amount" in data ? BigInt((data as { amount: bigint }).amount) : null;
  if (amount === null) return null;
  const addrs = topics.slice(1).filter(isAddress) as string[];
  if (name === "transfer" && addrs.length >= 2) return { from: addrs[0]!, to: addrs[1]!, amount };
  // mint: [mint, (admin,) to, asset]; the recipient is the last address. burn: [burn, from, asset].
  if (name === "mint" && addrs.length >= 1) return { from: null, to: addrs[addrs.length - 1]!, amount };
  if ((name === "burn" || name === "clawback") && addrs.length >= 1) return { from: addrs[addrs.length - 1]!, to: null, amount };
  return null;
}

/** Read new USDC events since the saved cursor and keep those that touch our wallets. */
export async function indexWalletActivity(): Promise<{ saved: number }> {
  const hub = chainRegistry()?.hub;
  const usdc = hub?.assets?.USDC;
  if (!hub || hub.family !== "stellar" || !usdc) return { saved: 0 };
  const db = await activityDb();
  const server = new rpc.Server(hub.rpcUrls[0], { allowHttp: hub.rpcUrls[0].startsWith("http://") });
  const ours = await knownAddresses(db, hub.key);
  const decimals = usdc.decimals;
  const { rows: [saved] } = await db.query(`SELECT cursor FROM wallet_activity_cursor WHERE network_key = $1`, [hub.key]);

  let count = 0;
  let cursor: string | undefined = saved?.cursor ?? undefined;
  let start: number | undefined;
  if (!cursor) {
    // First run: as far back as the RPC keeps events (about a week).
    const health = await server.getHealth();
    start = Math.max(health.oldestLedger + 10, health.latestLedger - 120_000);
  }
  // The RPC scans a window of ledgers per call and returns a cursor, often with no events in
  // that window, so keep reading until the cursor reaches the latest ledger.
  for (let page = 0; page < 200; page++) {
    const res = await server.getEvents({
      ...(cursor ? { cursor } : { startLedger: start! }),
      filters: [{ type: "contract", contractIds: [usdc.addressOrContract] }],
      limit: 200,
    });
    for (const e of res.events) {
      const m = movementsOf(e.topic.map(native), native(e.value));
      if (!m) continue;
      const at = new Date(e.ledgerClosedAt);
      const rows: [string, "in" | "out", string | null][] = [];
      if (m.to && ours.has(m.to)) rows.push([m.to, "in", m.from]);
      if (m.from && ours.has(m.from)) rows.push([m.from, "out", m.to]);
      for (const [address, direction, counterparty] of rows) {
        const r = await db.query(
          `INSERT INTO wallet_activity (network_key, event_id, tx_hash, ledger, at, address, direction, amount, counterparty, event)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (event_id) DO NOTHING`,
          [hub.key, `${e.id}:${direction}`, e.txHash, e.ledger, at, address, direction, (Number(m.amount) / 10 ** decimals).toFixed(decimals), counterparty, String(native(e.topic[0]!))],
        );
        count += (r as any).rowCount ?? 0;
      }
    }
    cursor = res.cursor;
    if (!cursor || ledgerOf(cursor) >= res.latestLedger - 1) break;
  }
  if (cursor) {
    await db.query(
      `INSERT INTO wallet_activity_cursor (network_key, cursor, updated_at) VALUES ($1,$2,now())
       ON CONFLICT (network_key) DO UPDATE SET cursor = $2, updated_at = now()`,
      [hub.key, cursor],
    );
  }
  return { saved: count };
}

/** Run the indexer every 30 seconds. Failures are logged and retried on the next run. */
export function startWalletActivity() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await indexWalletActivity(); } catch (err) { console.warn(`[wallet-activity] ${(err as Error).message}`); }
    finally { running = false; }
  };
  void tick();
  setInterval(tick, 30_000);
}

export interface ActivityRow {
  txHash: string;
  at: string;
  direction: "in" | "out";
  amount: string;
  kind: string;
  counterparty: string | null;
}

const METHOD_KIND: Record<string, { in?: string; out?: string }> = {
  buy_protection: { out: "Bought cover" },
  claim_payout: { in: "Payout received" },
  deposit: { out: "Added liquidity" },
  create_pool: { out: "Created a pool" },
  execute_withdrawal: { in: "Withdrew from a pool" },
  withdraw_creator_earnings: { in: "Pool creator earnings" },
  transfer: { out: "Sent", in: "Received" },
};

/** The latest movements for one wallet, newest first, each labelled in plain words. */
export async function walletActivity(network: string, address: string, limit = 50): Promise<ActivityRow[]> {
  const db = await activityDb();
  const hub = chainRegistry()?.get(network as never) as any;
  const pools = new Set<string>([hub?.contracts?.currencyPool, ...((hub?.contracts?.legacy ?? []) as any[]).map((l) => l.currencyPool)].filter(Boolean));
  const cctp = new Set<string>([hub?.cctp?.tokenMessenger, hub?.cctp?.forwarder, hub?.cctp?.messageTransmitter].filter(Boolean));
  let faucet: string | null = null;
  try { faucet = process.env.TESTNET_USDC_FAUCET_SECRET ? Keypair.fromSecret(process.env.TESTNET_USDC_FAUCET_SECRET).publicKey() : null; } catch { faucet = null; }
  const hasLog = (await db.query(`SELECT to_regclass('compliance_log') IS NOT NULL AS ok`)).rows[0]?.ok;

  const { rows } = await db.query(`
    SELECT a.tx_hash, max(a.at) AS at, a.direction, sum(a.amount) AS amount,
           (array_agg(a.counterparty ORDER BY a.amount DESC))[1] AS counterparty,
           bool_or(a.event = 'mint') AS minted, bool_or(a.event = 'burn') AS burned,
           ${hasLog ? `(SELECT l.data->>'method' FROM compliance_log l WHERE l.action = 'transaction.relayed' AND l.data->>'hash' = a.tx_hash LIMIT 1)` : "NULL"} AS method
    FROM wallet_activity a
    WHERE a.network_key = $1 AND a.address = $2
    GROUP BY a.tx_hash, a.direction
    ORDER BY max(a.at) DESC
    LIMIT $3`, [network, address, Math.min(Math.max(limit, 1), 200)]);

  return rows.map((r) => {
    const dir = r.direction as "in" | "out";
    const cp: string | null = r.counterparty;
    let kind = METHOD_KIND[r.method ?? ""]?.[dir]
      ?? (cp && cp === faucet ? "Test USDC"
        : r.burned || (cp && cctp.has(cp)) ? (dir === "out" ? "Sent to another network" : "From another network")
        : r.minted ? "Received"
        : cp && pools.has(cp) ? (dir === "out" ? "Paid to a pool" : "From a pool")
        : dir === "out" ? "Sent" : "Received");
    if (kind === "Sent" && cp && pools.has(cp)) kind = "Paid to a pool";
    return { txHash: r.tx_hash, at: new Date(r.at).toISOString(), direction: dir, amount: String(r.amount), kind, counterparty: cp };
  });
}
