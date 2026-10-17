/**
 * Daily snapshots of the live FX rate shown to users (one row per pair per UTC day).
 * Kept apart from historical_fx_closes, which feeds the pricing engine from another
 * source: comparing the two shows a provider gap, not a move.
 */
import { decimal, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const rateSnapshots = pgTable(
  "rate_snapshots",
  {
    id: serial("id").primaryKey(),
    pair: text("pair").notNull(),
    /** UTC date, YYYY-MM-DD. */
    day: text("day").notNull(),
    rate: decimal("rate", { precision: 30, scale: 10 }).notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pairDay: uniqueIndex("rate_snapshots_pair_day_uq").on(t.pair, t.day) }),
);
