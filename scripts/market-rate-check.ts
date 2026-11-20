/**
 * Read every market-rate source once and print the composite per pair. Changes nothing.
 * Run: npx tsx scripts/market-rate-check.ts   (Monierate needs Rate_API in the environment)
 */
import { SOURCES } from "../server/market-rate/sources";
import { aggregate, type SourceQuote } from "../server/market-rate/aggregate";

const all: SourceQuote[] = [];
for (const s of SOURCES) {
  try {
    const q = await s.read();
    const line = q.map((x) => {
      const vol = x.volumeUsd != null ? ` vol $${Math.round(x.volumeUsd)}` : "";
      const ads = x.ads != null ? ` ads ${x.ads}` : "";
      return `${x.pair} ${x.mid.toFixed(2)}${vol}${ads}`;
    }).join(" | ");
    console.log(s.id.padEnd(12), line || "(none)");
    all.push(...q);
  } catch (e) {
    console.log(s.id.padEnd(12), "ERROR", (e as Error).message);
  }
}
for (const c of ["NGN", "GHS", "KES"]) {
  const r = aggregate(`USD/${c}`, all, Date.now());
  const detail = r ? r.quotes.map((q) => `${q.source}:${q.included ? (q.weight * 100).toFixed(0) + "%" : q.reason}`).join(" ") : "";
  console.log(`USD/${c} composite:`, r ? `${r.rate.toFixed(2)} from ${r.sources} sources | ${detail}` : "not enough sources");
}
process.exit(0);
