import { Link, useRoute } from "wouter";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  Menu,
  X,
  Wallet,
  TrendingUp,
  ArrowRight,
  ArrowLeft,
  Clock,
  BookOpen,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { MermaidBlock } from "@/components/mermaid-block";
import { BlogScene } from "@/components/blog-scene";
import { loadArticles, findArticle, type Article } from "@/lib/blog-loader";
import logoPath from "@/assets/logo.png";

function SiteNav({ blogActive }: { blogActive?: boolean }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [mobileProductsOpen, setMobileProductsOpen] = useState(false);

  return (
    <nav className="border-b border-gray-100/80 sticky top-0 bg-white/60 backdrop-blur-xl" style={{ zIndex: 50 }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14">
          <Link href="/" className="flex items-center space-x-2 cursor-pointer no-underline">
            <img src={logoPath} alt="BlockFinaX" className="w-7 h-7" />
            <span className="text-lg font-bold text-[#1a4480]">BlockFinaX</span>
          </Link>

          <div className="hidden md:flex items-center space-x-6">
            <div className="relative" onMouseEnter={() => setProductsOpen(true)} onMouseLeave={() => setProductsOpen(false)}>
              <button className="text-sm text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1">
                Products <ChevronDown className={`h-3.5 w-3.5 transition-transform ${productsOpen ? 'rotate-180' : ''}`} />
              </button>
              {productsOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-100 shadow-lg rounded-xl py-1">
                  <Link href="/wallet" className="block px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors no-underline flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-gray-400" /> Wallet
                  </Link>
                  <Link href="/hedge" className="block px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors no-underline flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-gray-400" /> Hedge
                  </Link>
                </div>
              )}
            </div>
            <Link href="/whitepaper" className="text-sm text-gray-500 hover:text-gray-900 transition-colors no-underline">Whitepaper</Link>
            <Link href="/blog" className={`text-sm transition-colors no-underline ${blogActive ? 'text-[#1a4480] font-semibold' : 'text-gray-500 hover:text-gray-900'}`}>Blog</Link>
            <Link href="/wallet" className="no-underline">
              <Button size="sm" className="bg-[#1a4480] text-white hover:bg-[#153a6e] rounded-full px-5 text-sm font-medium">
                Launch App
              </Button>
            </Link>
          </div>

          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2 hover:bg-gray-50 rounded-lg transition-colors">
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white pb-4">
            <div className="py-2 space-y-1">
              <div>
                <button onClick={() => setMobileProductsOpen(!mobileProductsOpen)} className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors">
                  Products <ChevronDown className={`h-3.5 w-3.5 transition-transform ${mobileProductsOpen ? 'rotate-180' : ''}`} />
                </button>
                {mobileProductsOpen && (
                  <div className="pl-6 space-y-1">
                    <Link href="/wallet" onClick={() => setMobileMenuOpen(false)} className="block w-full text-left py-2 px-3 text-sm text-gray-500 hover:text-gray-900 rounded-lg no-underline">Wallet</Link>
                    <Link href="/hedge" onClick={() => setMobileMenuOpen(false)} className="block w-full text-left py-2 px-3 text-sm text-gray-500 hover:text-gray-900 rounded-lg no-underline">Hedge</Link>
                  </div>
                )}
              </div>
              <Link href="/whitepaper" onClick={() => setMobileMenuOpen(false)} className="block w-full text-left px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors no-underline">Whitepaper</Link>
              <Link href="/blog" onClick={() => setMobileMenuOpen(false)} className={`block w-full text-left px-3 py-2 text-sm rounded-lg transition-colors no-underline ${blogActive ? 'text-[#1a4480] font-semibold bg-blue-50' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}>Blog</Link>
              <div className="px-3 pt-2">
                <Link href="/wallet" className="no-underline">
                  <Button className="w-full bg-[#1a4480] text-white hover:bg-[#153a6e] rounded-full font-medium" size="sm">Launch App</Button>
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  "Hedging": "bg-blue-100 text-blue-700",
  "Payments": "bg-green-100 text-green-700",
  "Education": "bg-amber-100 text-amber-700",
  "Earning": "bg-emerald-100 text-emerald-700",
  "Engineering": "bg-purple-100 text-purple-700",
  "Product": "bg-indigo-100 text-indigo-700",
};

function ArticleCard({ article }: { article: Article }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="group border border-gray-100 rounded-2xl p-6 hover:border-gray-200 hover:shadow-sm transition-all bg-white"
    >
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        {article.category && (
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[article.category] || 'bg-gray-100 text-gray-600'}`}>
            {article.category}
          </span>
        )}
        {article.readTime && (
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Clock className="h-3 w-3" /> {article.readTime}
          </span>
        )}
        {article.date && <span className="text-xs text-gray-400">{article.date}</span>}
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2 group-hover:text-[#1a4480] transition-colors leading-snug">
        {article.title}
      </h3>
      {article.subtitle && (
        <p className="text-sm text-gray-500 leading-relaxed mb-4 line-clamp-2">
          {article.subtitle}
        </p>
      )}
      <Link href={`/blog/${article.slug}`} className="inline-flex items-center gap-1 text-sm font-medium text-[#1a4480] hover:text-[#153a6e] transition-colors cursor-pointer no-underline">
        Read article <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </motion.div>
  );
}

function BlogListing() {
  const articles = loadArticles();
  const categories = ["All", ...Array.from(new Set(articles.map(a => a.category).filter((c): c is string => Boolean(c))))];
  const [activeCategory, setActiveCategory] = useState("All");

  const filtered = activeCategory === "All"
    ? articles
    : articles.filter(a => a.category === activeCategory);

  return (
    <div className="min-h-screen bg-white">
      <SiteNav blogActive />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors no-underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Home
        </Link>
      </div>

      <section className="pt-10 pb-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <div className="flex items-center justify-center gap-2 mb-4">
              <BookOpen className="h-5 w-5 text-[#1a4480]" />
              <span className="text-sm font-medium text-[#1a4480] uppercase tracking-wider">Blog</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Notes from BlockFinaX
            </h1>
            <p className="text-base text-gray-500 max-w-xl mx-auto">
              Engineering, product, and FX-protection deep dives — straight from the team building the protocol.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="pb-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-2 mb-8 justify-center">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                    activeCategory === cat
                      ? 'bg-[#1a4480] text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400">No articles yet — drop a .md file into client/src/blog/articles/ to publish one.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {filtered.map(article => (
                <ArticleCard key={article.slug} article={article} />
              ))}
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs text-gray-400">&copy; 2026 BlockFinaX. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function ArticleView({ slug }: { slug: string }) {
  const article = findArticle(slug);

  if (!article) {
    return (
      <div className="min-h-screen bg-white">
        <SiteNav blogActive />
        <div className="max-w-3xl mx-auto px-4 py-20 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Article not found</h1>
          <p className="text-gray-500 mb-6">The article you are looking for does not exist.</p>
          <Link href="/blog" className="no-underline inline-block">
            <Button className="bg-[#1a4480] text-white hover:bg-[#153a6e] rounded-full">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Blog
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const all = loadArticles();
  const related = all
    .filter(a => a.category && a.category === article.category && a.slug !== article.slug)
    .slice(0, 3);

  return (
    <div className="min-h-screen bg-white">
      <SiteNav blogActive />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <Link href="/blog" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors cursor-pointer mb-6 no-underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Blog
        </Link>

        <div className="flex flex-col lg:flex-row gap-10">
          <motion.article
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex-1 min-w-0"
          >
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              {article.category && (
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[article.category] || 'bg-gray-100 text-gray-600'}`}>
                  {article.category}
                </span>
              )}
              {article.readTime && (
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Clock className="h-3 w-3" /> {article.readTime}
                </span>
              )}
              {article.date && <span className="text-xs text-gray-400">{article.date}</span>}
              {article.author && <span className="text-xs text-gray-400">by {article.author}</span>}
            </div>

            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 leading-tight mb-3">
              {article.title}
            </h1>
            {article.subtitle && (
              <p className="text-base text-gray-500 mb-8 leading-relaxed">
                {article.subtitle}
              </p>
            )}

            <div className="border-t border-gray-100 pt-6 prose prose-slate max-w-none prose-headings:font-semibold prose-headings:text-gray-900 prose-h2:text-xl prose-h2:sm:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-3 prose-p:text-[15px] prose-p:text-gray-600 prose-p:leading-[1.8] prose-li:text-[15px] prose-li:text-gray-600 prose-a:text-[#1a4480] prose-a:no-underline hover:prose-a:underline prose-code:text-[13px] prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:rounded-xl prose-blockquote:border-l-4 prose-blockquote:border-[#1a4480] prose-blockquote:bg-blue-50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-xl prose-blockquote:not-italic prose-blockquote:text-[#1a4480]">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code(props: any) {
                    const { inline, className, children, ...rest } = props;
                    const match = /language-(\w+)/.exec(className || "");
                    const lang = match ? match[1] : "";
                    const codeText = String(children).replace(/\n$/, "");
                    if (!inline && lang === "mermaid") {
                      return <MermaidBlock code={codeText} />;
                    }
                    if (!inline && lang === "scene") {
                      return <BlogScene body={codeText} />;
                    }
                    if (!inline && lang) {
                      return (
                        <code className={className} {...rest}>
                          {children}
                        </code>
                      );
                    }
                    return (
                      <code className={className} {...rest}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {article.body}
              </ReactMarkdown>
            </div>
          </motion.article>

          {related.length > 0 && (
            <aside className="hidden lg:block w-72 flex-shrink-0">
              <div className="sticky top-20">
                <h4 className="text-sm font-semibold text-gray-900 mb-4 uppercase tracking-wider">Related</h4>
                <div className="space-y-4">
                  {related.map(r => (
                    <Link key={r.slug} href={`/blog/${r.slug}`} className="no-underline block">
                      <div className="group p-3 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-all cursor-pointer">
                        {r.category && (
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium mb-2 ${CATEGORY_COLORS[r.category] || 'bg-gray-100 text-gray-600'}`}>
                            {r.category}
                          </span>
                        )}
                        <h5 className="text-sm font-medium text-gray-900 group-hover:text-[#1a4480] transition-colors leading-snug">
                          {r.title}
                        </h5>
                        {r.readTime && <span className="text-xs text-gray-400 mt-1 block">{r.readTime}</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>

      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs text-gray-400">&copy; 2026 BlockFinaX. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

export default function BlogPage() {
  const [match, params] = useRoute("/blog/:slug");

  if (match && params?.slug) {
    return <ArticleView slug={params.slug} />;
  }

  return <BlogListing />;
}
