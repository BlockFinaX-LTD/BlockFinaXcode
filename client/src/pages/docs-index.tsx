/**
 * docs-index.tsx — Hub page listed at /docs.
 *
 * The magic link from the docs-access email lands here (with ?t=<token>).
 * DocsGate consumes the token, persists it, and renders this page. From
 * here the user picks which of the three private docs to read.
 */

import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Presentation, Folder, ChevronRight, FileText } from 'lucide-react';
import logoPath from '@/assets/logo.png';

// The whitepaper is reached from the data room rather than listed separately.
const DOCS = [
  { href: '/docs/technical', icon: FileText, title: 'Technical documentation', sub: 'API reference, SDK guides, and protocol documentation.' },
  { href: '/data-room/whitepaper', icon: FileText, title: 'Whitepaper', sub: 'Protocol design and strategy.' },
  {
    href: '/pitch',
    icon: Presentation,
    title: 'Pitch deck',
    sub: 'The investor framing — problem, solution, team.',
  },
  {
    href: '/data-room',
    icon: Folder,
    title: 'Data room',
    sub: 'Financial model, traction, audits, and references.',
  },
];

export default function DocsIndex() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur border-b border-border/60">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <img src={logoPath} alt="BlockFinaX" className="h-7 w-7 object-contain" />
          <span className="bfx-display text-[15px] font-semibold tracking-tight">BlockFinaX docs</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-8">
        <div className="mb-6">
          <h1 className="bfx-display text-2xl font-semibold tracking-tight">Documentation</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Explore our documentation. No sign-in or access approval is required.
          </p>
        </div>

        <div className="space-y-3">
          {DOCS.map(({ href, icon: Icon, title, sub }) => (
            <Link key={href} href={href}>
              <Card className="rounded-2xl cursor-pointer hover:border-primary/30 hover:bg-muted/20 transition-colors">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="h-11 w-11 rounded-full bg-primary/10 text-primary inline-flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5" strokeWidth={1.7} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="text-[12px] text-muted-foreground leading-snug">{sub}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>


      </main>
    </div>
  );
}
