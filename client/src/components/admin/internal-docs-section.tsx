/**
 * Admin: Dev docs. Internal developer guides (server/internal-docs), stored in the
 * database rather than the public repository. Upload an HTML file; read it here in a
 * sandboxed frame.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ExternalLink, FileCode2, Loader2, Upload } from "lucide-react";

async function api(url: string, token: string, body?: unknown) {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `Request failed (${res.status})`);
  return json;
}

interface Doc { slug: string; title: string; description: string | null; updatedBy: string | null; updatedAt: string; size: number }

const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const slugFrom = (s: string) => s.toLowerCase().replace(/\.html?$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export function InternalDocsSection({ token }: { token: string }) {
  const { toast } = useToast();
  const q = useQuery<{ docs: Doc[] }>({ queryKey: ["admin-internal-docs"], queryFn: () => api("/api/admin/internal-docs", token) });
  const [open, setOpen] = useState<{ doc: Doc; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ slug: "", title: "", description: "", html: "", file: "" });

  const view = async (doc: Doc) => {
    try { const { url } = await api(`/api/admin/internal-docs/${doc.slug}/view`, token, {}); setOpen({ doc, url }); }
    catch (e) { toast({ title: "Could not open", description: (e as Error).message, variant: "destructive" }); }
  };
  const pick = async (file: File | undefined) => {
    if (!file) return;
    const html = await file.text();
    const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || file.name.replace(/\.html?$/i, "");
    setForm((f) => ({ ...f, html, file: file.name, title: f.title || title, slug: f.slug || slugFrom(title) }));
  };
  const save = async () => {
    setUploading(true);
    try {
      await api("/api/admin/internal-docs", token, { slug: form.slug, title: form.title, description: form.description, html: form.html });
      toast({ title: "Saved", description: form.title });
      setForm({ slug: "", title: "", description: "", html: "", file: "" });
      await queryClient.invalidateQueries({ queryKey: ["admin-internal-docs"] });
    } catch (e) { toast({ title: "Not saved", description: (e as Error).message, variant: "destructive" }); }
    finally { setUploading(false); }
  };
  const remove = async (doc: Doc) => {
    try { await api(`/api/admin/internal-docs/${doc.slug}/delete`, token, {}); await queryClient.invalidateQueries({ queryKey: ["admin-internal-docs"] }); }
    catch (e) { toast({ title: "Not removed", description: (e as Error).message, variant: "destructive" }); }
  };

  if (open) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(null)}><ArrowLeft className="h-4 w-4 mr-1.5" />All dev docs</Button>
          <a href={open.url} target="_blank" rel="noopener noreferrer"><Button variant="outline" size="sm"><ExternalLink className="h-4 w-4 mr-1.5" />Open in a new tab</Button></a>
        </div>
        <iframe title={open.doc.title} src={open.url} sandbox="allow-scripts" className="w-full rounded-lg border bg-white" style={{ height: "calc(100vh - 160px)", minHeight: 600 }} />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Dev docs</h1>
        <p className="text-sm text-gray-500 max-w-2xl">Internal guides for developers: how the contracts and systems work. Stored in the database, never in the public code repository. Admins only.</p>
      </div>

      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : !q.data?.docs.length ? (
        <p className="text-sm text-gray-500">No documents yet. Upload the first one below.</p>
      ) : (
        <div className="grid gap-3">
          {q.data.docs.map((d) => (
            <Card key={d.slug}>
              <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                <button className="flex items-start gap-3 text-left" onClick={() => view(d)}>
                  <FileCode2 className="h-5 w-5 mt-0.5 text-blue-600 shrink-0" />
                  <span>
                    <span className="font-semibold block">{d.title}</span>
                    {d.description && <span className="text-sm text-gray-500 block">{d.description}</span>}
                    <span className="text-xs text-gray-400">Updated {day(d.updatedAt)}{d.updatedBy ? ` by ${d.updatedBy}` : ""} · {Math.round(d.size / 1024)} KB</span>
                  </span>
                </button>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => view(d)}>Read</Button>
                  <Button size="sm" variant="outline" onClick={() => setForm({ slug: d.slug, title: d.title, description: d.description ?? "", html: "", file: "" })}>Replace</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(d)}>Remove</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-semibold">{form.slug && q.data?.docs.some((d) => d.slug === form.slug) ? `Replace "${form.title}"` : "Upload a document"}</h2>
          <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
            <span className="inline-flex items-center rounded-md border px-3 py-1.5"><Upload className="h-4 w-4 mr-1.5" />Choose HTML file</span>
            <input type="file" accept=".html,.htm,text/html" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
            <span className="text-gray-500">{form.file || "No file chosen"}</span>
          </label>
          <div className="grid md:grid-cols-2 gap-2">
            <Input id="doc-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" aria-label="Title" />
            <Input id="doc-slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: slugFrom(e.target.value) })} placeholder="short-name" aria-label="Short name" />
            <Input id="doc-desc" className="md:col-span-2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="One line about it (optional)" aria-label="Description" />
          </div>
          <Button disabled={uploading || !form.html || !form.title || !form.slug} onClick={save}>{uploading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}Save document</Button>
        </CardContent>
      </Card>
    </div>
  );
}
