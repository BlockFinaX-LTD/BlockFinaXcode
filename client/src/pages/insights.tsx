import { Link, useRoute, useLocation } from "wouter";
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
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import logoPath from "@/assets/logo.png";

type ArticleSection =
  | { type: "heading"; content: string }
  | { type: "subheading"; content: string }
  | { type: "text"; content: string }
  | { type: "list"; items: string[] }
  | { type: "callout"; content: string }
  | { type: "cta"; title: string; description: string; link: string; linkText: string };

interface Article {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  readTime: string;
  date: string;
  content: ArticleSection[];
}

function useArticles() {
  return useQuery<any[]>({
    queryKey: ["/api/articles"],
  });
}

function mapRawArticle(raw: any): Article {
  const dateStr = raw.date || (raw.publishedAt
    ? new Date(raw.publishedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "");
  return {
    id: raw.slug,
    title: raw.title,
    subtitle: raw.subtitle,
    category: raw.category,
    readTime: raw.readTime || raw.read_time || "5 min read",
    date: dateStr,
    content: raw.content || [],
  };
}

const categories = ["All", "Hedging", "Payments", "Education", "Earning"];

function SiteNav({ insightsActive }: { insightsActive?: boolean }) {
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
                  <Link href="/home" className="block px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors no-underline flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-gray-400" /> Wallet
                  </Link>
                  <Link href="/hedge" className="block px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors no-underline flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-gray-400" /> Hedge
                  </Link>
                </div>
              )}
            </div>
            <Link href="/insights" className={`text-sm transition-colors no-underline ${insightsActive ? 'text-[#1a4480] font-semibold' : 'text-gray-500 hover:text-gray-900'}`}>Insights</Link>
            <Link href="/home" className="no-underline">
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
                    <Link href="/home" onClick={() => setMobileMenuOpen(false)} className="block w-full text-left py-2 px-3 text-sm text-gray-500 hover:text-gray-900 rounded-lg no-underline">Wallet</Link>
                    <Link href="/hedge" onClick={() => setMobileMenuOpen(false)} className="block w-full text-left py-2 px-3 text-sm text-gray-500 hover:text-gray-900 rounded-lg no-underline">Hedge</Link>
                  </div>
                )}
              </div>
              <Link href="/insights" onClick={() => setMobileMenuOpen(false)} className={`block w-full text-left px-3 py-2 text-sm rounded-lg transition-colors no-underline ${insightsActive ? 'text-[#1a4480] font-semibold bg-blue-50' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}>Insights</Link>
              <div className="px-3 pt-2">
                <Link href="/home" className="no-underline">
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

function ArticleCard({ article }: { article: Article }) {
  const categoryColors: Record<string, string> = {
    "Hedging": "bg-blue-100 text-blue-700",
    "Payments": "bg-green-100 text-green-700",
    "Education": "bg-amber-100 text-amber-700",
    "Earning": "bg-emerald-100 text-emerald-700",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="group border border-gray-100 rounded-2xl p-6 hover:border-gray-200 hover:shadow-sm transition-all bg-white"
    >
      <div className="flex items-center gap-3 mb-3">
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${categoryColors[article.category] || 'bg-gray-100 text-gray-600'}`}>
          {article.category}
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <Clock className="h-3 w-3" /> {article.readTime}
        </span>
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2 group-hover:text-[#1a4480] transition-colors leading-snug">
        {article.title}
      </h3>
      <p className="text-sm text-gray-500 leading-relaxed mb-4 line-clamp-2">
        {article.subtitle}
      </p>
      <Link href={`/insights/${article.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-[#1a4480] hover:text-[#153a6e] transition-colors cursor-pointer no-underline">
        Read Article <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </motion.div>
  );
}

function ArticleListing() {
  const [activeCategory, setActiveCategory] = useState("All");
  const { data: rawArticles, isLoading } = useArticles();
  const articles = (rawArticles || []).map(mapRawArticle);

  const filtered = activeCategory === "All"
    ? articles
    : articles.filter(a => a.category === activeCategory);

  return (
    <div className="min-h-screen bg-white">
      <SiteNav insightsActive />

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
              <span className="text-sm font-medium text-[#1a4480] uppercase tracking-wider">Insights</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Learn. Protect. Grow.
            </h1>
            <p className="text-base text-gray-500 max-w-xl mx-auto">
              Educational resources on cross-border payments and FX protection in Africa.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="pb-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
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

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-6">
                {filtered.map(article => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </div>

              {filtered.length === 0 && (
                <div className="text-center py-16">
                  <p className="text-gray-400">No articles in this category yet.</p>
                </div>
              )}
            </>
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

function renderSection(section: ArticleSection, index: number) {
  switch (section.type) {
    case "heading":
      return (
        <h2 key={index} className="text-xl sm:text-2xl font-bold text-gray-900 mt-10 mb-4 pb-2 border-b border-gray-100">
          {section.content}
        </h2>
      );
    case "subheading":
      return (
        <h3 key={index} className="text-lg font-semibold text-gray-800 mt-6 mb-3">
          {section.content}
        </h3>
      );
    case "text":
      return (
        <p key={index} className="text-[15px] text-gray-600 leading-[1.8] mb-4">
          {section.content}
        </p>
      );
    case "list":
      return (
        <ul key={index} className="mb-4 space-y-2 pl-1">
          {section.items.map((item, i) => (
            <li key={i} className="flex gap-3 text-[15px] text-gray-600 leading-[1.7]">
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[#1a4480] flex-shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "callout":
      return (
        <div key={index} className="my-6 p-5 bg-blue-50 border-l-4 border-[#1a4480] rounded-r-xl">
          <p className="text-[15px] text-[#1a4480] leading-[1.7] font-medium">
            {section.content}
          </p>
        </div>
      );
    case "cta":
      return (
        <div key={index} className="my-8 p-6 bg-gradient-to-r from-[#1a4480] to-[#2E5BBA] rounded-2xl text-white">
          <h4 className="text-lg font-bold mb-2">{section.title}</h4>
          <p className="text-sm text-blue-100 mb-4">{section.description}</p>
          <Link href={(() => { try { const u = new URL(section.link, window.location.href); return (u.protocol === 'https:' || u.protocol === 'http:' || u.pathname === section.link) ? section.link : '#'; } catch { return '#'; } })()} rel="noopener noreferrer" className="no-underline inline-block">
            <Button className="bg-white text-[#1a4480] hover:bg-blue-50 rounded-full px-6 font-medium">
              {section.linkText} <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      );
    default:
      return null;
  }
}

function ArticleView({ slug }: { slug: string }) {
  const { data: rawArticles, isLoading } = useArticles();
  const articles = (rawArticles || []).map(mapRawArticle);
  const article = articles.find(a => a.id === slug);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white">
        <SiteNav insightsActive />
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="min-h-screen bg-white">
        <SiteNav insightsActive />
        <div className="max-w-3xl mx-auto px-4 py-20 text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Article Not Found</h1>
          <p className="text-gray-500 mb-6">The article you are looking for does not exist.</p>
          <Link href="/insights" className="no-underline inline-block">
            <Button className="bg-[#1a4480] text-white hover:bg-[#153a6e] rounded-full">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Insights
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const categoryColors: Record<string, string> = {
    "Hedging": "bg-blue-100 text-blue-700",
    "Payments": "bg-green-100 text-green-700",
    "Education": "bg-amber-100 text-amber-700",
    "Earning": "bg-emerald-100 text-emerald-700",
  };

  const related = articles
    .filter(a => a.category === article.category && a.id !== article.id)
    .slice(0, 3);

  return (
    <div className="min-h-screen bg-white">
      <SiteNav insightsActive />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <Link href="/insights" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors cursor-pointer mb-6 no-underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Insights
        </Link>

        <div className="flex flex-col lg:flex-row gap-10">
          <motion.article
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex-1 min-w-0"
          >
            <div className="flex items-center gap-3 mb-4">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${categoryColors[article.category] || 'bg-gray-100 text-gray-600'}`}>
                {article.category}
              </span>
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Clock className="h-3 w-3" /> {article.readTime}
              </span>
              <span className="text-xs text-gray-400">{article.date}</span>
            </div>

            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 leading-tight mb-3">
              {article.title}
            </h1>
            <p className="text-base text-gray-500 mb-8 leading-relaxed">
              {article.subtitle}
            </p>

            <div className="border-t border-gray-100 pt-6">
              {article.content.map((section, i) => renderSection(section, i))}
            </div>
          </motion.article>

          {related.length > 0 && (
            <aside className="hidden lg:block w-72 flex-shrink-0">
              <div className="sticky top-20">
                <h4 className="text-sm font-semibold text-gray-900 mb-4 uppercase tracking-wider">Related Articles</h4>
                <div className="space-y-4">
                  {related.map(r => (
                    <Link key={r.id} href={`/insights/${r.id}`} className="no-underline block">
                      <div className="group p-3 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-all cursor-pointer">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium mb-2 ${categoryColors[r.category] || 'bg-gray-100 text-gray-600'}`}>
                          {r.category}
                        </span>
                        <h5 className="text-sm font-medium text-gray-900 group-hover:text-[#1a4480] transition-colors leading-snug">
                          {r.title}
                        </h5>
                        <span className="text-xs text-gray-400 mt-1 block">{r.readTime}</span>
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

export default function InsightsPage() {
  const [match, params] = useRoute("/insights/:slug");

  if (match && params?.slug) {
    return <ArticleView slug={params.slug} />;
  }

  return <ArticleListing />;
}
