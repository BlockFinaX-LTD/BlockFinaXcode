/**
 * Loads markdown articles from /client/src/blog/articles/*.md at build time
 * via Vite's import.meta.glob. Each article has YAML-ish frontmatter and a
 * markdown body. The body may include ```mermaid``` fenced blocks which the
 * renderer in <BlogArticle /> turns into actual diagrams.
 */

export interface ArticleMeta {
  slug: string;
  title: string;
  subtitle?: string;
  date: string;
  author?: string;
  category?: string;
  readTime?: string;
}

export interface Article extends ArticleMeta {
  body: string;
}

const rawArticles = import.meta.glob<string>("../blog/articles/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[m[1]] = value;
  }
  return { data, body: match[2] };
}

function filenameToSlug(path: string): string {
  const file = path.split("/").pop() || "";
  return file.replace(/\.md$/, "");
}

let cache: Article[] | null = null;

export function loadArticles(): Article[] {
  if (cache) return cache;
  const list: Article[] = [];
  for (const [path, raw] of Object.entries(rawArticles)) {
    const { data, body } = parseFrontmatter(raw);
    const slug = data.slug || filenameToSlug(path);
    list.push({
      slug,
      title: data.title || slug,
      subtitle: data.subtitle,
      date: data.date || "",
      author: data.author,
      category: data.category,
      readTime: data.readTime,
      body,
    });
  }
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  cache = list;
  return list;
}

export function findArticle(slug: string): Article | undefined {
  return loadArticles().find(a => a.slug === slug);
}
