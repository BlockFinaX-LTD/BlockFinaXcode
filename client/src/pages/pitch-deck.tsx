import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight, CheckCircle2, TrendingUp, DollarSign, Rocket, Globe, Shield, Wallet, Download, HandCoins, Users, Megaphone, Building2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useToast } from "@/hooks/use-toast";
import logoPath from "@/assets/logo.png";
import problemImagePath from "@/assets/problem-story.png";
import { DEFAULT_ANNUALS, fmtUSD } from "@/lib/financial-model-data";
import { TAM, SAM, SOURCES_NOTE } from "@/lib/market-figures";

const slides = [
  { id: 1, type: "cover" },
  { id: 2, type: "problem" },
  { id: 3, type: "solution" },
  { id: 4, type: "opportunity" },
  { id: 5, type: "revenue" },
  { id: 6, type: "competition" },
  { id: 7, type: "go_to_market" },
  { id: 8, type: "traction" },
  { id: 9, type: "financials" },
  { id: 10, type: "ask" },
];

export default function PitchDeck() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  // Live financial figures — pulled directly from the same model the financial model page uses
  const fm = useMemo(() => {
    const a = DEFAULT_ANNUALS; // [0]=2026H2, [1]=2027, [2]=2028, [3]=2029, [4]=2030
    const cumWallets26 = a[0].totalNewWallets;
    const cumWallets27 = cumWallets26 + a[1].totalNewWallets;
    const cumWallets28 = cumWallets27 + a[2].totalNewWallets;
    const cumWallets29 = cumWallets28 + a[3].totalNewWallets;
    const cumWallets30 = cumWallets29 + a[4].totalNewWallets;
    const fmtWallets = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : `${n}`;
    const fmtNum = (n: number) => n >= 1_000_000_000 ? `${(n / 1_000_000_000).toFixed(1)}B` : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(0)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : `${n}`;
    const volGrowth = a[3].notionalHedged > 0 && a[1].notionalHedged > 0
      ? `${Math.round(a[3].notionalHedged / a[1].notionalHedged)}x`
      : 'n/a';
    return {
      // Y1 = 2027, Y2 = 2028, Y3 = 2029
      y1: a[1], y2: a[2], y3: a[3],
      cumWallets: { y1: fmtWallets(cumWallets27), y2: fmtWallets(cumWallets28), y3: fmtWallets(cumWallets29), y4: fmtWallets(cumWallets30) },
      notional: { y1: `$${fmtNum(a[1].notionalHedged)}`, y2: `$${fmtNum(a[2].notionalHedged)}`, y3: `$${fmtNum(a[3].notionalHedged)}` },
      hedgeFees: { y1: fmtUSD(a[1].hedgeFees), y2: fmtUSD(a[2].hedgeFees), y3: fmtUSD(a[3].hedgeFees) },
      eventFees: { y1: fmtUSD(a[1].eventCreationFees), y2: fmtUSD(a[2].eventCreationFees), y3: fmtUSD(a[3].eventCreationFees) },
      walletFees: { y1: fmtUSD(a[1].walletFees), y2: fmtUSD(a[2].walletFees), y3: fmtUSD(a[3].walletFees) },
      revenue: { y1: fmtUSD(a[1].totalRevenue), y2: fmtUSD(a[2].totalRevenue), y3: fmtUSD(a[3].totalRevenue) },
      costs: { y1: fmtUSD(a[1].totalCosts), y2: fmtUSD(a[2].totalCosts), y3: fmtUSD(a[3].totalCosts) },
      ebitda: { y1: fmtUSD(a[1].ebitda), y2: fmtUSD(a[2].ebitda), y3: fmtUSD(a[3].ebitda) },
      volGrowth,
      somRevenue: fmtUSD(a[2].totalRevenue), // Y2 (2028) revenue for SOM slide
    };
  }, []);

  const nextSlide = () => {
    setDirection(1);
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  };

  const prevSlide = () => {
    setDirection(-1);
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  };

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") nextSlide();
      if (e.key === "ArrowLeft") prevSlide();
    };
    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [currentSlide]);

  const downloadPDF = async () => {
    try {
      setIsDownloading(true);
      const originalSlide = currentSlide;
      toast({ title: "Generating PDF", description: `Capturing ${slides.length} slides — please wait...` });

      const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [1920, 1080] });

      for (let i = 0; i < slides.length; i++) {
        setDirection(0);
        setCurrentSlide(i);
        // Wait long enough for Framer Motion animations (max delay 0.7s + duration 0.3s + buffer)
        await new Promise(resolve => setTimeout(resolve, 1400));
        const el = document.querySelector('[data-slide-container]');
        if (!el) throw new Error("Slide container not found");
        const canvas = await html2canvas(el as HTMLElement, {
          scale: 2,
          backgroundColor: "#0c1222",
          logging: false,
          useCORS: true,
          allowTaint: true,
          windowWidth: 1920,
          windowHeight: 1080,
          foreignObjectRendering: true,
          imageTimeout: 15000,
          onclone: (_doc, cloned) => {
            // Remove navigation UI elements so they don't appear on slides
            cloned.querySelectorAll('[data-pdf-hide]').forEach(el => {
              (el as HTMLElement).style.display = 'none';
            });
          },
        });
        const imgData = canvas.toDataURL("image/png", 1.0);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), undefined, "FAST");
      }

      setDirection(0);
      setCurrentSlide(originalSlide);
      pdf.save("BlockFinaX-Pitch-Deck.pdf");
      toast({ title: "Downloaded!", description: "PDF saved successfully" });
    } catch (error) {
      toast({ title: "Download Failed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setIsDownloading(false);
    }
  };

  const slideVariants = {
    enter: (d: number) => ({ x: d > 0 ? 800 : -800, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -800 : 800, opacity: 0 }),
  };

  const slide = slides[currentSlide];

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col" style={{ background: 'linear-gradient(135deg, #0c1222 0%, #162040 50%, #0f1a30 100%)' }} data-slide-container>
      <div className="fixed top-6 right-6 z-50 flex items-center gap-2" data-pdf-hide>
        <Link href="/data-room">
          <Button size="sm" className="bg-white/10 hover:bg-white/20 text-white/70 border border-white/10">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Data Room
          </Button>
        </Link>
        <Button onClick={downloadPDF} disabled={isDownloading} size="sm" className="bg-white/10 hover:bg-white/20 text-white/70 border border-white/10" data-testid="button-download-pdf">
          <Download className="w-4 h-4 mr-2" />
          {isDownloading ? "..." : "PDF"}
        </Button>
      </div>

      <div className="flex-1 flex items-center justify-center px-8 md:px-12 lg:px-20" role="main">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentSlide}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="w-full max-w-[1400px]"
            role="region"
            aria-live="polite"
            aria-label={`Slide ${currentSlide + 1} of ${slides.length}`}
          >

            {slide.type === "cover" && (
              <div className="text-center space-y-6">
                <motion.img src={logoPath} alt="BlockFinaX" className="w-20 h-20 mx-auto" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2 }} />
                <motion.h1 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="text-8xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                  BlockFinaX
                </motion.h1>
                <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }} className="text-2xl text-slate-300 max-w-2xl mx-auto">
                  Cross-border payments + P2P hedging for African SMEs
                </motion.p>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }} className="flex items-center justify-center gap-10 mt-6">
                  <div className="flex items-center gap-3 text-slate-400">
                    <Wallet className="w-5 h-5 text-blue-400" />
                    <span>Instant USDC payments · 0.3%</span>
                  </div>
                  <span className="text-slate-700">|</span>
                  <div className="flex items-center gap-3 text-slate-400">
                    <Shield className="w-5 h-5 text-emerald-400" />
                    <span>P2P parametric hedging · On-chain</span>
                  </div>
                </motion.div>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="text-sm text-slate-700 pt-6">
                  Use arrow keys or click dots to navigate
                </motion.p>
              </div>
            )}

            {slide.type === "problem" && (
              <div className="relative w-full" style={{ height: '72vh' }}>
                {/* Full-bleed storytelling image */}
                <motion.img
                  src={problemImagePath}
                  alt="African SME trader facing currency loss"
                  className="absolute inset-0 w-full h-full object-cover rounded-2xl"
                  initial={{ opacity: 0, scale: 1.03 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.8 }}
                />
                {/* Dark gradient overlay */}
                <div className="absolute inset-0 rounded-2xl" style={{ background: 'linear-gradient(to right, rgba(8,14,28,0.92) 35%, rgba(8,14,28,0.3) 100%)' }} />
                {/* Text content over image */}
                <div className="absolute inset-0 flex flex-col justify-center px-12">
                  <motion.h2 initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="text-5xl font-bold text-white mb-6">
                    The money leaves.<br />Before the goods arrive.
                  </motion.h2>
                  <motion.div initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.5 }} className="flex flex-col gap-4 max-w-sm">
                    <div className="bg-black/40 backdrop-blur-sm rounded-xl px-5 py-4 border border-red-500/30">
                      <p className="text-4xl font-bold text-red-400">6–9%</p>
                      <p className="text-slate-300 text-sm mt-1">eaten by transfer fees · takes 3–7 days</p>
                    </div>
                    <div className="bg-black/40 backdrop-blur-sm rounded-xl px-5 py-4 border border-orange-500/30">
                      <p className="text-4xl font-bold text-orange-400">7–10%</p>
                      <p className="text-slate-300 text-sm mt-1">lost to currency swings · no affordable hedge</p>
                    </div>
                    <div className="bg-black/40 backdrop-blur-sm rounded-xl px-5 py-4 border border-white/10">
                      <p className="text-4xl font-bold text-white">$1.4B</p>
                      <p className="text-slate-300 text-sm mt-1">FX losses booked by 10 listed Nigerian firms in 2024 alone</p>
                    </div>
                  </motion.div>
                </div>
              </div>
            )}

            {slide.type === "solution" && (
              <div className="space-y-10">
                <div className="text-center">
                  <motion.h2 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-5xl font-bold text-white">One platform. Two tools.</motion.h2>
                  <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="text-slate-400 mt-3 text-lg">Move money. Protect it. All in USDC.</motion.p>
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="grid grid-cols-3 gap-6">
                  {[
                    { icon: Wallet, color: "text-blue-400", border: "border-blue-500/20", bg: "from-blue-500/10", title: "Send & Receive", line: "Cross-border USDC at 0.3% flat" },
                    { icon: Shield, color: "text-emerald-400", border: "border-emerald-500/20", bg: "from-emerald-500/10", title: "Protect", line: "Lock an FX rate. Auto-settle on-chain." },
                    { icon: HandCoins, color: "text-purple-400", border: "border-purple-500/20", bg: "from-purple-500/10", title: "Earn", line: "Back hedge pools. Earn every premium." },
                  ].map((item, idx) => (
                    <div key={idx} className={`bg-gradient-to-b ${item.bg} to-transparent rounded-2xl p-8 border ${item.border} text-center`}>
                      <div className="w-16 h-16 rounded-2xl bg-white/[0.06] flex items-center justify-center mx-auto mb-5">
                        <item.icon className={`w-8 h-8 ${item.color}`} />
                      </div>
                      <h3 className="text-2xl font-bold text-white mb-3">{item.title}</h3>
                      <p className="text-slate-300">{item.line}</p>
                    </div>
                  ))}
                </motion.div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="flex justify-center gap-6">
                  {["Gas sponsorship may be available", "Selected FX corridors", "Oracle-based on-chain settlement", "Transactions recorded on chain"].map((item, idx) => (
                    <div key={idx} className="bg-white/[0.04] rounded-full px-5 py-2 border border-white/[0.08]">
                      <p className="text-sm text-slate-400">{item}</p>
                    </div>
                  ))}
                </motion.div>
              </div>
            )}

            {slide.type === "opportunity" && (
              <div className="space-y-8">
                <div className="text-center">
                  <motion.h2 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-5xl font-bold text-white">Foreign exchange risk affects business cash flows.</motion.h2>
                  <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="text-slate-400 mt-2 text-lg">The scale and direction of currency moves vary by corridor and period. Any market-size or volatility estimate should be checked against its cited source and date.</motion.p>
                </div>
                <div className="grid grid-cols-3 gap-6">
                  {[
                    { label: "TAM", color: "text-blue-400", border: "border-blue-500/25", bg: "from-blue-500/10", val: TAM.display, sub: "African merchandise trade, 2024" },
                    { label: "SAM", color: "text-emerald-400", border: "border-emerald-500/25", bg: "from-emerald-500/10", val: SAM.display, sub: "Trade finance demand Africa cannot meet" },
                    { label: "Revenue scenario", color: "text-purple-400", border: "border-purple-500/25", bg: "from-purple-500/10", val: fm.somRevenue, sub: "Model output, not market size or actual revenue" },
                  ].map((item, idx) => (
                    <motion.div key={idx} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 + idx * 0.1 }} className={`bg-gradient-to-b ${item.bg} to-transparent rounded-2xl p-8 border ${item.border} text-center`}>
                      <p className={`text-xs font-bold uppercase tracking-widest mb-3 ${item.color}`}>{item.label}</p>
                      <p className="text-6xl font-bold text-white mb-3">{item.val}</p>
                      <p className="text-slate-400 text-sm">{item.sub}</p>
                    </motion.div>
                  ))}
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }} className="flex justify-center gap-8 text-center">
                  {[["Not verified", "average corridor fees"], ["Not verified", "underserved business count"], ["Not assessed", "available competing products"]].map(([val, lbl], idx) => (
                    <div key={idx}>
                      <p className="text-2xl font-bold text-white">{val}</p>
                      <p className="text-xs text-slate-500 mt-1">{lbl}</p>
                    </div>
                  ))}
                </motion.div>
              </div>
            )}

            {slide.type === "revenue" && (
              <div className="space-y-8">
                <div className="text-center">
                  <motion.h2 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-5xl font-bold text-white">Illustrative fee model</motion.h2>
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="grid grid-cols-4 gap-5">
                  {[
                    { rate: "Model input", label: "Transfer fee", note: "Confirm current terms", color: "text-blue-400", border: "border-blue-500/20" },
                    { rate: "Model input", label: "Hedge fees", note: "Basis and rate depend on deployment", color: "text-emerald-400", border: "border-emerald-500/20" },
                    { rate: "Model input", label: "Settlement fees", note: "Confirm current contract config", color: "text-purple-400", border: "border-purple-500/20" },
                    { rate: "Model input", label: "Event creation", note: "Confirm current contract config", color: "text-amber-400", border: "border-amber-500/20" },
                  ].map((item, idx) => (
                    <div key={idx} className={`bg-white/[0.04] rounded-2xl p-7 border ${item.border} text-center`}>
                      <p className={`text-5xl font-bold mb-3 ${item.color}`}>{item.rate}</p>
                      <p className="text-white font-semibold">{item.label}</p>
                      <p className="text-slate-500 text-sm mt-1">{item.note}</p>
                    </div>
                  ))}
                </motion.div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="bg-gradient-to-r from-blue-500/[0.07] to-emerald-500/[0.07] border border-white/[0.07] rounded-xl p-5 text-center">
                  <p className="text-xl font-semibold text-white">Illustrative model output: <span className="text-emerald-400">{fm.somRevenue}</span>. Assumptions are not live fees or actual revenue.</p>
                </motion.div>
              </div>
            )}

            {slide.type === "competition" && (
              <div className="space-y-6">
                <div className="text-center">
                  <motion.h2 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-5xl font-bold text-white">A market opportunity to validate.</motion.h2>
                  <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="text-slate-400 mt-2">Competitor coverage and customer demand require corridor-specific research.</motion.p>
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="overflow-hidden rounded-xl border border-white/[0.08]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/[0.04]">
                        <th className="text-left p-3 text-slate-400 font-medium">Feature</th>
                        <th className="text-center p-3 text-emerald-400 font-bold">BlockFinaX</th>
                        <th className="text-center p-3 text-slate-500 font-medium">Banks</th>
                        <th className="text-center p-3 text-slate-500 font-medium">OTC Brokers</th>
                        <th className="text-center p-3 text-slate-500 font-medium">DeFi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { feature: "Minimum size", us: "Check selected market", banks: "Not assessed", otc: "Not assessed", defi: "Not assessed" },
                        { feature: "Supported corridors", us: "Check current network", banks: "Not assessed", otc: "Not assessed", defi: "Not assessed" },
                        { feature: "Eligibility and pricing", us: "Check current terms", banks: "Not assessed", otc: "Not assessed", defi: "Not assessed" },
                        { feature: "Settlement process", us: "Check contract and oracle state", banks: "Not assessed", otc: "Not assessed", defi: "Not assessed" },
                      ].map((row, idx) => (
                        <tr key={idx} className="border-t border-white/[0.04]">
                          <td className="p-3 text-slate-300">{row.feature}</td>
                          {[row.us, row.banks, row.otc, row.defi].map((val, ci) => (
                            <td key={ci} className="p-3 text-center">
                              <span className={ci === 0 ? "text-slate-300" : "text-slate-500"}>{val}</span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </motion.div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="bg-emerald-500/[0.07] border border-emerald-500/20 rounded-xl p-4 text-center">
                  <p className="text-emerald-400 font-semibold">No validated competitor minimums or underserved-customer count are presented here.</p>
                </motion.div>
              </div>
            )}

            {slide.type === "go_to_market" && (
              <div className="space-y-8">
                <div className="text-center">
                  <motion.h2 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-5xl font-bold text-white">Land with hedge. Expand with payments.</motion.h2>
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="grid grid-cols-4 gap-5">
                  {[
                    { phase: "Phase 1", title: "Community", icon: Users, color: "text-blue-400", border: "border-blue-500/20", items: ["Testnet incentives + leaderboard", "Crypto traders as early LPs", "Ambassador program"] },
                    { phase: "Phase 2", title: "SME Direct", icon: Building2, color: "text-emerald-400", border: "border-emerald-500/20", items: ["Ghana, Nigeria, Kenya importers", "Trade association partnerships", "On-ground workshops"] },
                    { phase: "Phase 3", title: "Channels", icon: Megaphone, color: "text-purple-400", border: "border-purple-500/20", items: ["Flutterwave, Paystack APIs", "Hedge-as-a-service B2B", "White-label pools"] },
                    { phase: "Phase 4", title: "Flywheel", icon: TrendingUp, color: "text-amber-400", border: "border-amber-500/20", items: ["More LPs → better rates", "LP yield attracts global DeFi", "Network effects per corridor"] },
                  ].map((p, idx) => (
                    <div key={idx} className={`bg-white/[0.04] rounded-xl p-5 border ${p.border}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <p className={`text-xs font-bold uppercase tracking-wider ${p.color}`}>{p.phase}</p>
                      </div>
                      <div className="flex items-center gap-2 mb-4">
                        <p.icon className={`w-5 h-5 ${p.color}`} />
                        <h3 className="font-bold text-white">{p.title}</h3>
                      </div>
                      <ul className="space-y-2">
                        {p.items.map((item, i) => (
                          <li key={i} className="text-sm text-slate-400 flex items-start gap-2">
                            <span className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${p.color.replace('text-', 'bg-')}`} />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </motion.div>
              </div>
            )}

            {slide.type === "financials" && (
              <div className="space-y-6">
                <div className="text-center">
                  <motion.h2 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-5xl font-bold text-white">3-Year Projections</motion.h2>
                  <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="text-slate-500 mt-2 text-sm">Mainnet Jul 2026 · Y1 = 2027 · Y2 = 2028 · Y3 = 2029</motion.p>
                </div>
                <div className="overflow-hidden rounded-xl border border-white/[0.08]">
                  <table className="w-full text-base">
                    <thead>
                      <tr className="bg-white/[0.04]">
                        <th className="text-left p-4 text-slate-300 font-medium">Metric</th>
                        <th className="text-center p-4 text-slate-400 font-medium">Year 1 (2027)</th>
                        <th className="text-center p-4 text-slate-400 font-medium">Year 2 (2028)</th>
                        <th className="text-center p-4 text-emerald-400 font-bold">Year 3 (2029)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { metric: "Hedge Notional Volume", y1: fm.notional.y1, y2: fm.notional.y2, y3: fm.notional.y3 },
                        { metric: "New Wallets (Cumulative)", y1: fm.cumWallets.y1, y2: fm.cumWallets.y2, y3: fm.cumWallets.y3 },
                        { metric: "Hedge Protocol Fees (~0.225% net)", y1: fm.hedgeFees.y1, y2: fm.hedgeFees.y2, y3: fm.hedgeFees.y3 },
                        { metric: "Event Creation Fees ($2/event)", y1: fm.eventFees.y1, y2: fm.eventFees.y2, y3: fm.eventFees.y3 },
                        { metric: "Wallet Transfer Fees (0.3%)", y1: fm.walletFees.y1, y2: fm.walletFees.y2, y3: fm.walletFees.y3 },
                        { metric: "Total Revenue", y1: fm.revenue.y1, y2: fm.revenue.y2, y3: fm.revenue.y3, highlight: true },
                        { metric: "Total Operating Costs", y1: fm.costs.y1, y2: fm.costs.y2, y3: fm.costs.y3 },
                        { metric: "EBITDA", y1: fm.ebitda.y1, y2: fm.ebitda.y2, y3: fm.ebitda.y3, highlight: true },
                      ].map((row, idx) => (
                        <tr key={idx} className={`border-t border-white/[0.04] ${row.highlight ? 'bg-white/[0.03]' : ''}`}>
                          <td className={`p-4 font-medium ${row.highlight ? 'text-white' : 'text-slate-200'}`}>{row.metric}</td>
                          <td className="p-4 text-center text-slate-300">{row.y1}</td>
                          <td className="p-4 text-center text-slate-300">{row.y2}</td>
                          <td className={`p-4 text-center font-semibold ${row.highlight ? 'text-emerald-400' : 'text-white'}`}>{row.y3}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="grid grid-cols-3 gap-5">
                  <div className="bg-blue-500/[0.08] border border-blue-500/25 rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-blue-400">~80%</p>
                    <p className="text-sm text-slate-300">Gross margin at scale</p>
                  </div>
                  <div className="bg-emerald-500/[0.08] border border-emerald-500/25 rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-emerald-400">EBITDA+</p>
                    <p className="text-sm text-slate-300">Positive from H2 of Year 1</p>
                  </div>
                  <div className="bg-purple-500/[0.08] border border-purple-500/25 rounded-xl p-4 text-center">
                    <p className="text-3xl font-bold text-purple-400">{fm.volGrowth}</p>
                    <p className="text-sm text-slate-300">Volume growth (Y1 → Y3)</p>
                  </div>
                </motion.div>
              </div>
            )}

            {slide.type === "traction" && (
              <div className="space-y-8">
                <div className="text-center">
                  <motion.h2 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-5xl font-bold text-white">Traction & Roadmap</motion.h2>
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="grid grid-cols-4 gap-5">
                  {[
                    { label: "Live chain state", dot: "bg-emerald-400", border: "border-emerald-500/25", bg: "bg-emerald-500/[0.07]", text: "text-emerald-400", items: ["Base and BNB Smart Chain Diamonds are deployed", "Current owner and Safe relationship: see live Data Room reads", "Oracle quorum and signer roster: see live Data Room reads"] },
                    { label: "Before institutional capital", dot: "bg-blue-400", border: "border-blue-500/20", bg: "bg-white/[0.03]", text: "text-blue-400", items: ["Verify current bytecode against reviewed source", "Reconcile historical audit findings against current deployments", "Document enforced upgrade and settlement controls"] },
                    { label: "Operating evidence", dot: "bg-purple-400", border: "border-purple-500/20", bg: "bg-white/[0.03]", text: "text-purple-400", items: ["Publish dated liquidity and user metrics with source", "Report oracle and settlement service availability", "Track completed transactions on chain"] },
                    { label: "Forward plan", dot: "bg-amber-400", border: "border-amber-500/20", bg: "bg-white/[0.03]", text: "text-amber-400", items: ["Mobile optimisation", "Additional FX corridors subject to data and liquidity validation", "Fundraising milestones subject to operating results"] },
                  ].map((q, idx) => (
                    <div key={idx} className={`rounded-xl p-5 border ${q.border} ${q.bg}`}>
                      <div className="flex items-center gap-2 mb-4">
                        <span className={`w-2 h-2 rounded-full ${q.dot}`} />
                        <h3 className={`font-bold ${q.text}`}>{q.label}</h3>
                      </div>
                      <ul className="space-y-2">
                        {q.items.map((item, i) => (
                          <li key={i} className="text-sm text-slate-400">{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </motion.div>
              </div>
            )}

            {slide.type === "ask" && (
              <div className="space-y-8">
                <div className="text-center">
                  <motion.h2 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-5xl font-bold text-white">Pre-Seed Round</motion.h2>
                  <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="text-slate-400 mt-2">Runway to 10,000 users before Seed in Jan 2027</motion.p>
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }} className="grid grid-cols-2 gap-5 max-w-3xl mx-auto">
                  {[
                    { cat: "Seed Investment", desc: "Mainnet launch + user acquisition", icon: DollarSign, color: "text-blue-400", border: "border-blue-500/20" },
                    { cat: "Early LPs", desc: "Seed hedge pool liquidity", icon: HandCoins, color: "text-emerald-400", border: "border-emerald-500/20" },
                    { cat: "Strategic Partners", desc: "Fintechs, stablecoin issuers, FX providers", icon: Globe, color: "text-purple-400", border: "border-purple-500/20" },
                    { cat: "Pilot Users", desc: "SMEs ready to test on testnet today", icon: Users, color: "text-amber-400", border: "border-amber-500/20" },
                  ].map((item, idx) => (
                    <div key={idx} className={`bg-white/[0.04] rounded-xl p-5 border ${item.border} flex items-start gap-4`}>
                      <item.icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${item.color}`} />
                      <div>
                        <h3 className="font-bold text-white mb-1">{item.cat}</h3>
                        <p className="text-sm text-slate-400">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </motion.div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }} className="text-center">
                  <a href="https://calendly.com/anthonykumako8/30min" target="_blank" rel="noopener noreferrer">
                    <Button size="lg" className="bg-gradient-to-r from-blue-500 to-emerald-500 hover:from-blue-600 hover:to-emerald-600 text-white px-10 py-6 text-lg" data-testid="button-contact-cta">
                      <Rocket className="w-5 h-5 mr-3" />
                      Book a Discovery Call
                    </Button>
                  </a>
                </motion.div>
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between px-16 pb-6" data-pdf-hide>
        <Button onClick={prevSlide} variant="ghost" size="icon" className="text-slate-500 hover:text-white hover:bg-white/10" disabled={currentSlide === 0} data-testid="button-prev-slide">
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="flex gap-2">
          {slides.map((_, idx) => (
            <button
              key={idx}
              onClick={() => { setDirection(idx > currentSlide ? 1 : -1); setCurrentSlide(idx); }}
              className={`h-1.5 rounded-full transition-all ${idx === currentSlide ? 'w-8 bg-blue-400' : 'w-2 bg-slate-700 hover:bg-slate-500'}`}
              aria-label={`Go to slide ${idx + 1}`}
              data-testid={`button-slide-${idx + 1}`}
            />
          ))}
        </div>
        <Button onClick={nextSlide} variant="ghost" size="icon" className="text-slate-500 hover:text-white hover:bg-white/10" disabled={currentSlide === slides.length - 1} data-testid="button-next-slide">
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
