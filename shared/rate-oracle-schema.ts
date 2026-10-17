/**
 * Interest-rate observation store (oracle architecture section 2).
 *
 * `rate_observations` holds one accepted value per (benchmark, observation date), with its
 * revision history. `rate_fetches` keeps every fetch, including failures and rejected rows,
 * with the raw payload: this is the audit trail and is never put on chain.
 */
import { pgTable, text, serial, integer, bigint, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

export const rateObservations = pgTable("rate_observations", {
  id: serial("id").primaryKey(),
  benchmark: text("benchmark").notNull(),
  observationDate: text("observation_date").notNull(),          // YYYY-MM-DD; text avoids tz pitfalls
  rateMicroPercent: bigint("rate_micro_percent", { mode: "number" }).notNull(),
  source: text("source").notNull(),
  sourceReference: text("source_reference").notNull(),
  /** PUBLISHED, or REVISED when the administrator changed the value after we first stored it. */
  status: text("status").notNull().default("PUBLISHED"),
  /** Earlier values, oldest first: [{ rateMicroPercent, source, seenAt }]. */
  revisions: jsonb("revisions").notNull().default([]),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  fetchId: integer("fetch_id"),
  /** Set once consensus accepts this value on chain. */
  onChainRound: integer("on_chain_round"),
  onChainTx: text("on_chain_tx"),
}, (t) => ({
  identity: uniqueIndex("rate_observations_identity").on(t.benchmark, t.observationDate),
}));

export const rateFetches = pgTable("rate_fetches", {
  id: serial("id").primaryKey(),
  benchmark: text("benchmark").notNull(),
  source: text("source").notNull(),
  url: text("url").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  ok: boolean("ok").notNull(),
  error: text("error"),
  /** Raw response body as received (trimmed to 200 KB). */
  payload: text("payload"),
  accepted: integer("accepted").notNull().default(0),
  /** [{ observationDate, ratePercent, code, message }] */
  rejected: jsonb("rejected").notNull().default([]),
}, (t) => ({
  byBenchmark: index("rate_fetches_benchmark").on(t.benchmark, t.fetchedAt),
}));

export type RateObservationRow = typeof rateObservations.$inferSelect;
export type RateFetchRow = typeof rateFetches.$inferSelect;
