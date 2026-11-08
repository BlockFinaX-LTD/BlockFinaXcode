/**
 * Daily anchor of the compliance log on Stellar.
 *
 * Once a day the hash of the last log entry of the previous UTC day is written to the hub
 * network as a `manage_data` entry ("bfx-log") on the fee payer's account, with the day in the
 * memo. Anyone can later compare that public, timestamped value with the log: if the log was
 * rewritten after the anchor, the hashes no longer match. The anchor reveals nothing about the
 * entries themselves, only a 32-byte hash.
 *
 * Runs in the server (startLogAnchoring); off when RECORDS_ANCHOR=off or no fee payer key.
 */
import { Keypair, Memo, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { chainRegistry } from "../chain/config";

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

async function anchorsDb(): Promise<Db> {
  const { pool } = await import("../db");
  if (!pool) throw new Error("No database");
  const db = pool as unknown as Db;
  await db.query(`
    CREATE TABLE IF NOT EXISTS compliance_anchors (
      day date PRIMARY KEY,
      last_entry_id bigint NOT NULL,
      digest text NOT NULL,
      network text NOT NULL,
      tx_hash text,
      error text,
      anchored_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  return db;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Anchor the previous UTC day, once. Returns what was done. */
export async function anchorYesterday(now = new Date()): Promise<{ day: string; status: "anchored" | "already" | "empty" | "failed"; txHash?: string; error?: string }> {
  const db = await anchorsDb();
  const today = utcDay(now);
  const day = utcDay(new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000));
  const { rows: [done] } = await db.query(`SELECT tx_hash FROM compliance_anchors WHERE day = $1 AND tx_hash IS NOT NULL`, [day]);
  if (done) return { day, status: "already", txHash: done.tx_hash };
  const { rows: [last] } = await db.query(`SELECT id, hash FROM compliance_log WHERE at < $1::date ORDER BY id DESC LIMIT 1`, [today]).catch(() => ({ rows: [] as any[] }));
  if (!last) return { day, status: "empty" };

  const hub = chainRegistry()?.hub;
  const secret = process.env.STELLAR_FEE_PAYER_SECRET;
  try {
    if (!hub || hub.family !== "stellar" || !secret) throw new Error("No Stellar hub or fee payer key");
    const payer = Keypair.fromSecret(secret);
    const server = new rpc.Server(hub.rpcUrls[0], { allowHttp: hub.rpcUrls[0].startsWith("http://") });
    const account = await server.getAccount(payer.publicKey());
    const tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: hub.networkId })
      .addOperation(Operation.manageData({ name: "bfx-log", value: Buffer.from(last.hash, "hex") }))
      .addMemo(Memo.text(`bfx log ${day}`))
      .setTimeout(120)
      .build();
    tx.sign(payer);
    const sent = await server.sendTransaction(tx);
    if (sent.status === "ERROR") throw new Error(`rejected: ${sent.errorResult?.result().switch().name ?? "unknown"}`);
    let status = "NOT_FOUND";
    for (let i = 0; i < 20 && status === "NOT_FOUND"; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      status = (await server.getTransaction(sent.hash)).status;
    }
    if (status !== "SUCCESS") throw new Error(`transaction ${status.toLowerCase()}`);
    await db.query(
      `INSERT INTO compliance_anchors (day, last_entry_id, digest, network, tx_hash) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (day) DO UPDATE SET last_entry_id = $2, digest = $3, network = $4, tx_hash = $5, error = NULL, anchored_at = now()`,
      [day, last.id, last.hash, hub.key, sent.hash],
    );
    return { day, status: "anchored", txHash: sent.hash };
  } catch (err) {
    const error = (err as Error).message;
    await db.query(
      `INSERT INTO compliance_anchors (day, last_entry_id, digest, network, error) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (day) DO UPDATE SET error = $5, anchored_at = now()`,
      [day, last.id, last.hash, hub?.key ?? "none", error],
    ).catch(() => undefined);
    return { day, status: "failed", error };
  }
}

export async function listAnchors(limit = 60) {
  const db = await anchorsDb();
  const { rows } = await db.query(`SELECT * FROM compliance_anchors ORDER BY day DESC LIMIT $1`, [limit]);
  return rows;
}

/** Check hourly; anchors the previous day once it has ended. */
export function startLogAnchoring(): void {
  if (process.env.RECORDS_ANCHOR === "off" || !process.env.STELLAR_FEE_PAYER_SECRET) {
    console.log("[records] Daily anchoring off (RECORDS_ANCHOR=off or no fee payer key)");
    return;
  }
  const tick = () => anchorYesterday().then((r) => {
    if (r.status === "anchored") console.log(`[records] Anchored ${r.day} on Stellar: ${r.txHash}`);
    if (r.status === "failed") console.warn(`[records] Anchor for ${r.day} failed, will retry: ${r.error}`);
  }).catch((err) => console.warn(`[records] Anchor check failed: ${(err as Error).message}`));
  setTimeout(() => { void tick(); setInterval(() => void tick(), 3_600_000); }, 60_000);
}
