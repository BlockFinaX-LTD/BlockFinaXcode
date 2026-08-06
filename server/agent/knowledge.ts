/**
 * Knowledge Finax learns from — uploaded documents and images.
 *
 * Two kinds, handled differently because they are read differently:
 *
 *   text    PDFs, plain text, markdown. Extracted once at upload, chunked, and
 *           retrieved by keyword at query time.
 *   image   Screenshots, diagrams, photos of a whiteboard. Stored as-is and
 *           passed to the model as an image block — the model reads pictures
 *           natively, so describing them into text first would only lose
 *           detail.
 *
 * Retrieval is keyword overlap, not embeddings. That is a deliberate starting
 * point: it needs no vector store, no embedding spend, and no extra moving
 * part, and at the scale of a company handbook it retrieves about as well.
 * If the corpus grows past a few hundred documents it will start missing
 * paraphrases, and that is the moment to add embeddings — not before.
 *
 * Each source is marked public or internal. The website agent is only ever
 * given public sources, so the pitch can be uploaded without the P&L leaking
 * to a stranger who asks nicely.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { agentSources } from "@shared/agent-schema";
import type { AgentScope } from "@shared/agent-schema";

/** Words too common to discriminate between documents. */
const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "should", "could", "may", "might", "must", "can", "of", "to", "in", "for",
  "on", "with", "at", "by", "from", "as", "it", "its", "we", "our", "you", "your", "they", "their",
  "what", "which", "who", "when", "where", "how", "why", "about", "into", "over", "under", "me", "my",
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Splits text into overlapping chunks on paragraph boundaries.
 *
 * The overlap matters: a fact that straddles a boundary would otherwise be
 * retrievable by neither half.
 */
export function chunkText(text: string, target = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= target) return clean ? [clean] : [];

  const paras = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const p of paras) {
    if (current && current.length + p.length + 2 > target) {
      chunks.push(current.trim());
      current = current.slice(-overlap) + "\n\n" + p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // A single paragraph longer than the target still has to be broken up.
  return chunks.flatMap((c) =>
    c.length <= target * 2
      ? [c]
      : (c.match(new RegExp(`[\\s\\S]{1,${target}}`, "g")) ?? [c]),
  );
}

/**
 * Pulls readable text out of an uploaded file.
 *
 * PDF extraction is deliberately shallow — it lifts the text operators out of
 * uncompressed streams and gives up otherwise, rather than pulling in a parser
 * dependency. A PDF it cannot read returns empty, and the caller says so
 * plainly instead of storing a document that silently contributes nothing.
 */
export function extractText(buffer: Buffer, mime: string, filename: string): string {
  if (mime.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(filename)) {
    return buffer.toString("utf8");
  }

  if (mime === "application/pdf" || /\.pdf$/i.test(filename)) {
    const raw = buffer.toString("latin1");
    const out: string[] = [];
    // Text-showing operators: (string) Tj  and  [(a) (b)] TJ
    const re = /\((?:\\.|[^\\()])*\)\s*T[jJ]|\[((?:\((?:\\.|[^\\()])*\)|[^\]])*)\]\s*TJ/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const piece = m[0]
        .replace(/\\(\d{3})/g, (_s, o) => String.fromCharCode(parseInt(o, 8)))
        .replace(/\\([()\\])/g, "$1");
      const strings = piece.match(/\((?:\\.|[^\\()])*\)/g) ?? [];
      const text = strings.map((s) => s.slice(1, -1)).join("");
      if (text.trim()) out.push(text);
    }
    return out.join(" ").replace(/\s{2,}/g, " ").trim();
  }

  return "";
}

export interface StoredSource {
  id: number;
  title: string;
  kind: string;
  visibility: string;
  chunks: number;
  createdAt: Date | null;
}

/** Stores a document, chunked and ready to retrieve. */
export async function addTextSource(args: {
  title: string;
  text: string;
  visibility: AgentScope | "both";
  filename?: string;
  mime?: string;
  addedBy?: string;
}): Promise<{ id: number; chunks: number }> {
  const chunks = chunkText(args.text);
  const [row] = await db
    .insert(agentSources)
    .values({
      title: args.title.slice(0, 300),
      kind: "text",
      visibility: args.visibility,
      filename: args.filename,
      mime: args.mime,
      content: args.text.slice(0, 2_000_000),
      chunks,
      addedBy: args.addedBy,
    })
    .returning();
  return { id: row.id, chunks: chunks.length };
}

/** Stores an image for the model to read directly. */
export async function addImageSource(args: {
  title: string;
  dataUrl: string;
  visibility: AgentScope | "both";
  filename?: string;
  mime?: string;
  note?: string;
  addedBy?: string;
}): Promise<{ id: number }> {
  const [row] = await db
    .insert(agentSources)
    .values({
      title: args.title.slice(0, 300),
      kind: "image",
      visibility: args.visibility,
      filename: args.filename,
      mime: args.mime,
      // The note is what makes an image findable: nothing in a PNG is
      // searchable, so the words the uploader used are the only index there is.
      content: args.note ?? "",
      imageData: args.dataUrl,
      chunks: [],
      addedBy: args.addedBy,
    })
    .returning();
  return { id: row.id };
}

export async function listSources(): Promise<StoredSource[]> {
  const rows = await db.select().from(agentSources).orderBy(desc(agentSources.id));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    visibility: r.visibility,
    chunks: (r.chunks ?? []).length,
    createdAt: r.createdAt,
  }));
}

export async function deleteSource(id: number): Promise<void> {
  await db.delete(agentSources).where(eq(agentSources.id, id));
}

export interface Retrieved {
  text: string[];
  images: { title: string; dataUrl: string; mime: string }[];
}

/**
 * Finds the passages and images most relevant to a question.
 *
 * Visibility is filtered in SQL, not by ranking: an internal document must be
 * unreachable from the public agent, not merely unlikely to surface.
 */
export async function retrieve(
  query: string,
  scope: AgentScope,
  opts: { maxChunks?: number; maxImages?: number } = {},
): Promise<Retrieved> {
  const maxChunks = opts.maxChunks ?? 4;
  const maxImages = opts.maxImages ?? 2;
  const terms = tokenise(query);
  if (!terms.length) return { text: [], images: [] };

  let rows;
  try {
    rows = await db
      .select()
      .from(agentSources)
      .where(
        scope === "internal"
          ? sql`true`
          : and(
              sql`${agentSources.visibility} IN ('public', 'both')`,
              sql`true`,
            ),
      );
  } catch {
    // Knowledge is an enhancement — a failed lookup must not break the reply.
    return { text: [], images: [] };
  }

  const scored: { score: number; text: string }[] = [];
  const images: { score: number; title: string; dataUrl: string; mime: string }[] = [];

  for (const src of rows) {
    if (src.kind === "image") {
      const hay = tokenise(`${src.title} ${src.content ?? ""}`);
      const score = terms.filter((t) => hay.includes(t)).length;
      if (score > 0 && src.imageData) {
        images.push({ score, title: src.title, dataUrl: src.imageData, mime: src.mime ?? "image/png" });
      }
      continue;
    }
    for (const chunk of src.chunks ?? []) {
      const hay = tokenise(chunk);
      if (!hay.length) continue;
      // Count distinct matching terms rather than raw frequency, so one word
      // repeated forty times cannot outrank a passage covering the question.
      const score = terms.filter((t) => hay.includes(t)).length;
      if (score > 0) scored.push({ score, text: `From "${src.title}":\n${chunk}` });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  images.sort((a, b) => b.score - a.score);

  return {
    text: scored.slice(0, maxChunks).map((s) => s.text),
    images: images.slice(0, maxImages).map(({ title, dataUrl, mime }) => ({ title, dataUrl, mime })),
  };
}
