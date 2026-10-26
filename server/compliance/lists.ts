/**
 * Sanctions lists, fetched from the issuing authorities.
 *
 * Policy §5 names four lists. Two are published directly by their issuers, in
 * the public domain, with no key and no licence:
 *
 *   OFAC SDN   US Treasury. The list that matters most commercially — US
 *              secondary sanctions reach any dollar-denominated transaction.
 *   UN         Security Council Consolidated List.
 *
 * The EU list and the Ghana FIC designations are not machine-readable without
 * a key or scraping, so they remain a manual check. That gap is recorded here
 * and surfaced in the admin UI rather than left implied — a control you
 * believe you have and don't is worse than a known gap.
 *
 * OpenSanctions was the first choice and aggregates all four, but now requires
 * a paid key. If OPENSANCTIONS_API_KEY is set, sanctions.ts prefers it and
 * this becomes the fallback.
 *
 * Lists are cached in memory for a day. They change slowly, they are several
 * megabytes, and re-fetching per screen would be both slow and rude.
 */

export interface ListEntry {
  name: string;
  /** Aliases, which is where most real matches are found. */
  aliases: string[];
  list: string;
  program?: string;
  type?: string;
  country?: string;
  id?: string;
  /**
   * Designated crypto addresses. OFAC publishes these inside the free-text
   * remarks column as "Digital Currency Address - ETH 0x…", so they are
   * extracted rather than read from a field of their own.
   */
  wallets?: string[];
}

export interface LoadedLists {
  entries: ListEntry[];
  sources: { list: string; count: number; error?: string }[];
  loadedAt: Date;
}

const CACHE_TTL_MS = 24 * 60 * 60_000;
let cache: LoadedLists | null = null;
let loading: Promise<LoadedLists> | null = null;

const OFAC_SDN = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV";
const OFAC_ALT = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV";
const UN_CONSOLIDATED = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";

/** Minimal CSV row splitter — OFAC quotes fields containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((f) => f.trim().replace(/^"|"$/g, ""));
}

async function fetchText(url: string, timeoutMs = 60_000): Promise<string> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

/**
 * OFAC SDN.CSV has no header. Columns are:
 *   ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign, Vess_type,
 *   Tonnage, GRT, Vess_flag, Vess_owner, Remarks
 * A literal "-0-" means null.
 */
async function loadOfac(): Promise<{ entries: ListEntry[]; count: number }> {
  const csv = await fetchText(OFAC_SDN);
  const byId = new Map<string, ListEntry>();

  for (const line of csv.split("\n")) {
    if (!line.trim()) continue;
    const f = splitCsvLine(line);
    const id = f[0];
    const name = f[1];
    if (!id || !name || name === "-0-") continue;
    const remarks = f[11] ?? "";
    const wallets: string[] = [];
    // "Digital Currency Address - ETH 0xabc…; Digital Currency Address - XBT 1A1z…"
    // exec loop rather than matchAll: the build targets ES5.
    const walletRe = /Digital Currency Address\s*-\s*\w+\s+([A-Za-z0-9]{20,})/g;
    let wm: RegExpExecArray | null;
    while ((wm = walletRe.exec(remarks)) !== null) wallets.push(wm[1]);

    byId.set(id, {
      name,
      aliases: [],
      list: "OFAC SDN",
      program: f[3] && f[3] !== "-0-" ? f[3] : undefined,
      type: f[2] && f[2] !== "-0-" ? f[2] : undefined,
      id,
      wallets: wallets.length ? wallets : undefined,
    });
  }

  // ALT.CSV carries the aliases, which is where a real match usually lands —
  // a designated person rarely transacts under the name on the primary row.
  try {
    const alt = await fetchText(OFAC_ALT, 45_000);
    for (const line of alt.split("\n")) {
      if (!line.trim()) continue;
      const f = splitCsvLine(line);
      const [entNum, , , altName] = f;
      const entry = byId.get(entNum);
      if (entry && altName && altName !== "-0-") entry.aliases.push(altName);
    }
  } catch {
    // Aliases are an enhancement; primary names still screen without them.
  }

  const entries: ListEntry[] = [];
  byId.forEach((e) => entries.push(e));
  return { entries, count: entries.length };
}

/** UN Consolidated List — XML, one <INDIVIDUAL> or <ENTITY> per designation. */
async function loadUn(): Promise<{ entries: ListEntry[]; count: number }> {
  const xml = await fetchText(UN_CONSOLIDATED);
  const entries: ListEntry[] = [];

  const blocks = xml.match(/<(INDIVIDUAL|ENTITY)>[\s\S]*?<\/\1>/g) ?? [];
  for (const block of blocks) {
    const isPerson = block.startsWith("<INDIVIDUAL>");
    const pick = (tag: string) => {
      const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
      return m ? m[1].trim() : "";
    };

    const name = isPerson
      ? [pick("FIRST_NAME"), pick("SECOND_NAME"), pick("THIRD_NAME"), pick("FOURTH_NAME")]
          .filter(Boolean).join(" ").trim()
      : pick("FIRST_NAME");
    if (!name) continue;

    const aliases: string[] = [];
    for (const a of block.match(/<ALIAS_NAME>([\s\S]*?)<\/ALIAS_NAME>/g) ?? []) {
      const v = a.replace(/<\/?ALIAS_NAME>/g, "").trim();
      if (v) aliases.push(v);
    }

    entries.push({
      name,
      aliases,
      list: "UN Consolidated",
      type: isPerson ? "Individual" : "Entity",
      country: pick("NATIONALITY") || undefined,
      id: pick("DATAID") || undefined,
    });
  }
  return { entries, count: entries.length };
}

/** Loads and caches both lists. Concurrent callers share one fetch. */
export async function loadLists(force = false): Promise<LoadedLists> {
  if (!force && cache && Date.now() - cache.loadedAt.getTime() < CACHE_TTL_MS) return cache;
  if (loading) return loading;

  loading = (async () => {
    const entries: ListEntry[] = [];
    const sources: LoadedLists["sources"] = [];

    for (const [list, loader] of [["OFAC SDN", loadOfac], ["UN Consolidated", loadUn]] as const) {
      try {
        const r = await loader();
        entries.push(...r.entries);
        sources.push({ list, count: r.count });
      } catch (err: any) {
        // One list failing must not silently disable the other. The error is
        // carried through so screening can report a partial result rather
        // than a clean one.
        sources.push({ list, count: 0, error: String(err?.message || err) });
        console.error(`[sanctions] could not load ${list}:`, err?.message);
      }
    }

    cache = { entries, sources, loadedAt: new Date() };
    loading = null;
    return cache;
  })();

  return loading;
}

// ── Matching ──────────────────────────────────────────────────────────────

/** Strips accents, punctuation and case so spelling variants still meet. */
export function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Legal-form words say what kind of company a name is, not which one. Left in, a
 * list entry such as "I.C.I.C. LTD." reduces to "ltd" and matches every limited company.
 */
const LEGAL_FORMS = new Set([
  "ltd", "limited", "plc", "llc", "llp", "lp", "inc", "incorporated", "corp", "corporation", "co", "company",
  "gmbh", "ag", "sa", "sas", "sarl", "srl", "spa", "bv", "nv", "kft", "ooo", "oao", "zao", "pao", "jsc", "pjsc", "ojsc",
  "fze", "fzco", "fzc", "pte", "pty", "sdn", "bhd", "tbk", "ab", "as", "oy", "kg", "group", "holding", "holdings",
]);

/**
 * The words that identify a name. Runs of single letters are joined first, so
 * "I.C.I.C." becomes "icic" and still meets "ICIC"; legal forms are then dropped.
 */
export function nameTokens(s: string): Set<string> {
  const words: string[] = [];
  let initials = "";
  for (const w of normalise(s).split(" ").filter(Boolean)) {
    if (w.length === 1) { initials += w; continue; }
    if (initials) { words.push(initials); initials = ""; }
    words.push(w);
  }
  if (initials) words.push(initials);
  return new Set(words.filter((w) => w.length > 1 && !LEGAL_FORMS.has(w)));
}

/**
 * Token-set similarity, 0–1.
 *
 * Deliberately order-insensitive: "Putin Vladimir" and "Vladimir Putin" are the
 * same person, and transliterated names arrive in either order. Scored against
 * the shorter side so "Vladimir Putin" still matches a list entry reading
 * "Vladimir Vladimirovich Putin" — a middle name should not hide a designation.
 */
export function similarity(a: string, b: string): number {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (!A.size || !B.size) return 0;

  let shared = 0;
  A.forEach((w) => { if (B.has(w)) shared += 1; });
  return shared / Math.min(A.size, B.size);
}

export interface LocalMatch {
  name: string;
  matchedOn: string;
  score: number;
  list: string;
  program?: string;
  type?: string;
  country?: string;
  id?: string;
}

/** Screens a name against every loaded entry and alias. */
export async function matchName(query: string, threshold = 0.7): Promise<{
  matches: LocalMatch[];
  sources: LoadedLists["sources"];
}> {
  const { entries, sources } = await loadLists();
  const q = normalise(query);
  if (!q) return { matches: [], sources };

  const matches: LocalMatch[] = [];
  for (const e of entries) {
    let best = similarity(q, e.name);
    let matchedOn = e.name;
    for (const alias of e.aliases) {
      const s = similarity(q, alias);
      if (s > best) { best = s; matchedOn = alias; }
    }
    if (best >= threshold) {
      matches.push({
        name: e.name,
        matchedOn,
        score: best,
        list: e.list,
        program: e.program,
        type: e.type,
        country: e.country,
        id: e.id,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return { matches: matches.slice(0, 10), sources };
}

/**
 * Exact lookup of a designated crypto address.
 *
 * Exact, not fuzzy: an address either is on the list or is not, and a near
 * miss on a hex string carries no meaning at all.
 */
export async function matchWallet(address: string): Promise<{
  matches: LocalMatch[];
  sources: LoadedLists["sources"];
}> {
  const { entries, sources } = await loadLists();
  const needle = address.trim().toLowerCase();
  const matches: LocalMatch[] = [];

  for (const e of entries) {
    if (!e.wallets?.length) continue;
    const hit = e.wallets.find((w) => w.toLowerCase() === needle);
    if (hit) {
      matches.push({
        name: e.name,
        matchedOn: hit,
        score: 1,
        list: e.list,
        program: e.program,
        type: e.type,
        country: e.country,
        id: e.id,
      });
    }
  }
  return { matches, sources };
}

/** What's loaded, for the admin view. */
export async function listStatus(): Promise<LoadedLists> {
  return loadLists();
}
