import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight, CheckCircle2, TrendingUp, DollarSign, Rocket, Globe, Shield, Wallet, Download, AlertTriangle, HandCoins, Users, Megaphone, Building2, Gift, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useToast } from "@/hooks/use-toast";
import logoPath from "@/assets/logo.png";
import { DEFAULT_ANNUALS, fmtUSD } from "@/lib/financial-model-data";

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
        <Link href="/">
          <Button size="sm" className="bg-white/10 hover:bg-white/20 text-white/70 border border-white/10">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Home
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
              <div className="text-center space-y-8">
                <motion.img src={logoPath} alt="BlockFinaX" className="w-24 h-24 mx-auto" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2 }} />
                <motion.h1 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="text-8xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                  BlockFinaX
                </motion.h1>
                <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }} className="text-3xl text-slate-200 max-w-3xl mx-auto leading-relaxed">
                  One platform to move money across borders and protect it from currency swings
                </motion.p>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }} className="flex items-center justify-center gap-8 mt-10">
                  <div className="flex items-center gap-3 text-slate-300">
                    <Wallet className="w-6 h-6 text-blue-400" />
                    <span className="text-lg">Instant USDC payments</span>
                  </div>
                  <span className="text-slate-600 text-2xl">|</span>
                  <div className="flex items-center gap-3 text-slate-300">
                    <Shield className="w-6 h-6 text-emerald-400" />
                    <span className="text-lg">Built-in FX protection</span>
                  </div>
                </motion.div>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} className="text-base text-slate-600 mt-12">
                  Use arrow keys to navigate
                </motion.p>
              </div>
            )}

            {slide.type === "problem" && (
              <div className="space-y-8">
                <h2 className="text-5xl font-bold text-center text-white">The Problem</h2>
                <div className="grid grid-cols-2 gap-6">
                  <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="bg-white/[0.04] rounded-2xl p-8 border border-red-500/20">
                    <DollarSign className="w-10 h-10 text-red-400 mb-4" />
                    <h3 className="text-5xl font-bold text-red-400 mb-2">6-9%</h3>
                    <p className="text-xl font-semibold text-white mb-2">Cross-Border Transfer Fees</p>
                    <p className="text-slate-300 text-base leading-relaxed">Sending money to/from Africa costs 6-9% through banks and remittance services. Takes 3-7 days.</p>
                  </motion.div>
                  <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="bg-white/[0.04] rounded-2xl p-8 border border-orange-500/20">
                    <AlertTriangle className="w-10 h-10 text-orange-400 mb-4" />
                    <h3 className="text-5xl font-bold text-orange-400 mb-2">7-10%</h3>
                    <p className="text-xl font-semibold text-white mb-2">Lost to Currency Swings</p>
                    <p className="text-slate-300 text-base leading-relaxed">Every 60 days, African currencies swing 7%+ up or down. Importers pay more for goods, exporters lose profit — with no affordable way to protect themselves.</p>
                  </motion.div>
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="grid grid-cols-4 gap-4">
                  <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.06] text-center">
                    <p className="text-2xl font-bold text-white">7M+</p>
                    <p className="text-sm text-slate-300">African SMEs in cross-border trade</p>
                  </div>
                  <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.06] text-center">
                    <p className="text-2xl font-bold text-white">$210B</p>
                    <p className="text-sm text-slate-300">Annual import + export volume</p>
                  </div>
                  <div className="bg-white/[0.04] rounded-xl p-4 border border-white/[0.06] text-center">
                    <p className="text-2xl font-bold text-white">15-18%</p>
                    <p className="text-sm text-slate-300">Lost to fees + currency swings</p>
                  </div>
                  <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20 text-center">
                    <p className="text-2xl font-bold text-red-400">$35B+</p>
                    <p className="text-sm text-slate-300">Value destroyed every year</p>
                  </div>
                </motion.div>
              </div>
            )}

            {slide.type === "solution" && (
              <div className="space-y-8">
                <h2 className="text-5xl font-bold text-center text-white">Our Solution</h2>
                <p className="text-center text-slate-300 text-xl max-w-3xl mx-auto leading-relaxed">One platform where businesses send money across borders and protect it from currency loss — all in USDC</p>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="bg-gradient-to-r from-blue-500/[0.06] via-white/[0.03] to-emerald-500/[0.06] rounded-2xl p-8 border border-white/[0.08]">
                  <div className="grid grid-cols-3 gap-8">
                    {[
                      { icon: Wallet, color: "text-blue-400", title: "Send & Receive", desc: "Move USDC across borders instantly at 0.3% — no banks, no delays" },
                      { icon: Shield, color: "text-emerald-400", title: "Protect", desc: "Lock in an FX rate and get paid automatically if the currency drops" },
                      { icon: HandCoins, color: "text-purple-400", title: "Earn", desc: "Provide liquidity to back hedges and earn premiums from every position" },
                    ].map((item, idx) => (
                      <div key={idx} className="text-center">
                        <div className="w-14 h-14 rounded-xl bg-white/[0.06] flex items-center justify-center mx-auto mb-4">
                          <item.icon className={`w-7 h-7 ${item.color}`} />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">{item.title}</h3>
                        <p className="text-base text-slate-300 leading-relaxed">{item.desc}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="grid grid-cols-4 gap-4">
                  {["Zero gas cost for users", "40+ African FX pairs", "Automated settlement", "Auditable smart contracts"].map((item, idx) => (
                    <div key={idx} className="bg-white/[0.04] rounded-lg p-3 border border-white/[0.06] text-center">
                      <p className="text-sm text-slate-300">{item}</p>
                    </div>
                  ))}
                </motion.div>
              </div>
            )}

            {slide.type === "opportunity" && (
              <div className="space-y-8">
                <h2 className="text-5xl font-bold text-center text-white">The Opportunity</h2>
                <p className="text-center text-slate-300 text-xl max-w-3xl mx-auto">African SMEs lose $35B+ every year to transfer fees and currency swings. This is a solvable problem.</p>
                <div className="grid grid-cols-3 gap-6">
                  <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="bg-gradient-to-b from-blue-500/10 to-blue-500/[0.03] rounded-2xl p-6 border border-blue-500/25 text-center">
                    <p className="text-sm font-semibold text-blue-400 uppercase tracking-wider mb-2">TAM</p>
                    <p className="text-4xl font-bold text-white mb-2">$210B</p>
                    <p className="text-lg font-semibold text-slate-200 mb-2">Total Addressable Market</p>
                    <p className="text-sm text-slate-300">Annual cross-border payment volume from 7M+ African SMEs doing imports and exports</p>
                  </motion.div>
                  <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }} className="bg-gradient-to-b from-emerald-500/10 to-emerald-500/[0.03] rounded-2xl p-6 border border-emerald-500/25 text-center">
                    <p className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-2">SAM</p>
                    <p className="text-4xl font-bold text-white mb-2">$35B</p>
                    <p className="text-lg font-semibold text-slate-200 mb-2">Serviceable Addressable Market</p>
                    <p className="text-sm text-slate-300">Value lost to fees (8.4%) and FX swings (7-10%) — the pain we directly solve</p>
                  </motion.div>
                  <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="bg-gradient-to-b from-purple-500/10 to-purple-500/[0.03] rounded-2xl p-6 border border-purple-500/25 text-center">
                    <p className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-2">SOM</p>
                    <p className="text-4xl font-bold text-white mb-2">$2B</p>
                    <p className="text-lg font-semibold text-slate-200 mb-2">Serviceable Obtainable Market</p>
                    <p className="text-sm text-slate-300">Achievable by Year 2 (2028) — generating {fm.somRevenue}+ in platform revenue at 0.7% blended take rate plus $25/event creation fee</p>
                  </motion.div>
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }} className="grid grid-cols-3 gap-4">
                  {["8.4% avg fees — highest globally", "0% SMEs have affordable FX hedging", "68% cite payments as #1 barrier"].map((item, idx) => (
                    <div key={idx} className="bg-white/[0.04] rounded-lg p-3 border border-white/[0.06] text-center">
                      <p className="text-sm text-slate-300">{item}</p>
                    </div>
                  ))}
                </motion.div>
              </div>
            )}

            {slide.type === "revenue" && (
              <div className="space-y-8">
                <h2 className="text-5xl font-bold text-center text-white">Revenue Model</h2>
                <div className="grid grid-cols-4 gap-5">
                  {[
                    { stream: "Transfer Fees", rate: "0.3%", desc: "Per payment (min $0.50)", projection: "$300K per $100M volume", color: "border-blue-500/25" },
                    { stream: "Protection Fees", rate: "0.5%", desc: "On hedged notional (~35% of volume)", projection: "$175K per $100M volume", color: "border-emerald-500/25" },
                    { stream: "Settlement Fees", rate: "1%", desc: "On payouts + LP claims", projection: "$100K per $100M volume", color: "border-purple-500/25" },
                    { stream: "Event Creation Fee", rate: "$25", desc: "Flat fee per hedge event created", projection: "$500K at 20K events/yr", color: "border-amber-500/25" },
                  ].map((item, idx) => (
                    <motion.div key={idx} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 + idx * 0.1 }} className={`bg-white/[0.04] rounded-xl p-6 border ${item.color}`}>
                      <p className="text-4xl font-bold text-white mb-2">{item.rate}</p>
                      <p className="text-lg font-semibold text-slate-200 mb-1">{item.stream}</p>
                      <p className="text-base text-slate-300 mb-4">{item.desc}</p>
                      <p className="text-sm text-emerald-400 font-semibold">{item.projection}</p>
                    </motion.div>
                  ))}
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }} className="bg-gradient-to-r from-blue-500/[0.08] to-emerald-500/[0.08] border border-white/[0.08] rounded-xl p-5 text-center">
                  <p className="text-2xl font-bold text-white">~0.7% blended take rate + $25/event &rarr; $12M+ at $2B SOM</p>
                  <p className="text-base text-slate-300 mt-1">All fees active from day one — revenue scales with volume</p>
                </motion.div>
              </div>
            )}

            {slide.type === "competition" && (
              <div className="space-y-8">
                <h2 className="text-5xl font-bold text-center text-white">Why No One Else Does This</h2>
                <p className="text-center text-slate-300 text-xl max-w-3xl mx-auto">FX hedging for African SMEs is a massive blind spot — we own it</p>
                <div className="overflow-hidden rounded-xl border border-white/[0.08]">
                  <table className="w-full text-base">
                    <thead>
                      <tr className="bg-white/[0.04]">
                        <th className="text-left p-4 text-slate-300 font-medium">FX Hedging Feature</th>
                        <th className="text-center p-4 text-emerald-400 font-bold">BlockFinaX</th>
                        <th className="text-center p-4 text-slate-400 font-medium">Banks</th>
                        <th className="text-center p-4 text-slate-400 font-medium">OTC Brokers</th>
                        <th className="text-center p-4 text-slate-400 font-medium">DeFi</th>
                        <th className="text-center p-4 text-slate-400 font-medium">Prediction Mkts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { feature: "African FX pairs (40+)", us: true, banks: "5-10 majors", otc: "5-10 majors", defi: false, prediction: false },
                        { feature: "No minimum / no credit check", us: true, banks: false, otc: false, defi: true, prediction: true },
                        { feature: "SME accessible", us: true, banks: false, otc: false, defi: false, prediction: false },
                        { feature: "On-chain / transparent", us: true, banks: false, otc: false, defi: true, prediction: true },
                        { feature: "Predetermined payout", us: true, banks: "Varies", otc: "Varies", defi: false, prediction: "Binary only" },
                        { feature: "P2P liquidity pools", us: true, banks: false, otc: false, defi: true, prediction: true },
                        { feature: "Real FX risk coverage", us: true, banks: true, otc: true, defi: false, prediction: false },
                      ].map((row, idx) => (
                        <tr key={idx} className="border-t border-white/[0.04]">
                          <td className="p-4 text-slate-200 font-medium">{row.feature}</td>
                          {[row.us, row.banks, row.otc, row.defi, row.prediction].map((val, ci) => (
                            <td key={ci} className="p-4 text-center">
                              {val === true ? <CheckCircle2 className={`w-5 h-5 mx-auto ${ci === 0 ? 'text-emerald-400' : 'text-slate-500'}`} /> : val === false ? <span className="text-slate-600 text-lg">&mdash;</span> : <span className="text-sm text-amber-400 font-medium">{val}</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 }} className="bg-emerald-500/[0.08] border border-emerald-500/25 rounded-xl p-5 text-center">
                  <p className="text-base font-semibold text-emerald-400">Banks need $100K+ minimums. OTC brokers require credit history. DeFi ignores African currencies. We serve the 7M SMEs everyone else locks out.</p>
                </motion.div>
              </div>
            )}

            {slide.type === "go_to_market" && (
              <div className="space-y-8">
                <h2 className="text-5xl font-bold text-center text-white">Go-to-Market Strategy</h2>
                <p className="text-center text-slate-300 text-xl max-w-3xl mx-auto">Land with hedge, expand with payments — bottom-up adoption</p>
                <div className="grid grid-cols-2 gap-6">
                  {[
                    { title: "Phase 1: Community-Led Growth", icon: Users, color: "text-blue-400 border-blue-500/25", items: ["Testnet incentives — daily tasks, referral points, leaderboards", "Crypto-native traders as early LPs and hedgers", "Twitter/X, Telegram, Discord community building", "Ambassador program in key African markets"] },
                    { title: "Phase 2: SME Direct Sales", icon: Building2, color: "text-emerald-400 border-emerald-500/25", items: ["Target importers/exporters in Ghana, Nigeria, Kenya", "Partner with trade associations and chambers of commerce", "On-ground workshops: 'Protect your margins in 5 minutes'", "Case studies showing real FX savings vs bank alternatives"] },
                    { title: "Phase 3: Channel Partnerships", icon: Megaphone, color: "text-purple-400 border-purple-500/25", items: ["Integrate with African fintech wallets (Flutterwave, Paystack)", "B2B API for platforms to offer hedge-as-a-service", "Accounting software plugins for automated FX protection", "White-label hedge pools for trade finance providers"] },
                    { title: "Phase 4: Flywheel Effects", icon: Gift, color: "text-amber-400 border-amber-500/25", items: ["More LPs → better rates → more hedgers → more volume", "LP yield attracts DeFi capital globally", "Revenue share with channel partners drives distribution", "Network effects: each new FX pair unlocks new corridors"] },
                  ].map((phase, idx) => (
                    <motion.div key={idx} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 + idx * 0.1 }} className={`bg-white/[0.04] rounded-xl p-6 border ${phase.color.split(' ')[1]}`}>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-lg bg-white/[0.06] flex items-center justify-center">
                          <phase.icon className={`w-5 h-5 ${phase.color.split(' ')[0]}`} />
                        </div>
                        <h3 className="font-bold text-lg text-white">{phase.title}</h3>
                      </div>
                      <ul className="space-y-2">
                        {phase.items.map((item, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-slate-600" />
                            <span className="text-sm text-slate-300">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {slide.type === "financials" && (
              <div className="space-y-8">
                <h2 className="text-5xl font-bold text-center text-white">3-Year Financial Projections</h2>
                <p className="text-center text-slate-300 text-xl max-w-3xl mx-auto">Mainnet Jul 2026 · Year 1 = 2027 · Year 2 = 2028 · Year 3 = 2029</p>
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
                        { metric: "Hedge Protocol Fees (0.7% net)", y1: fm.hedgeFees.y1, y2: fm.hedgeFees.y2, y3: fm.hedgeFees.y3 },
                        { metric: "Event Creation Fees ($25/event)", y1: fm.eventFees.y1, y2: fm.eventFees.y2, y3: fm.eventFees.y3 },
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
                <h2 className="text-5xl font-bold text-center text-white">Traction & Roadmap</h2>
                <div className="grid grid-cols-4 gap-5">
                  {[
                    { label: "Now", items: ["Live on testnet", "Payments & FX protection working", "FX oracle (40+ pairs)", "Community + referrals"], highlight: true },
                    { label: "Q2 2026", items: ["2 security audits", "Multi-sig controls", "Mobile optimization"], highlight: false },
                    { label: "Q3 2026", items: ["Mainnet launch", "$5M+ LP liquidity", "100+ active users"], highlight: false },
                    { label: "Q4 2026 – Q3 2027", items: ["$50M+ volume", "Mobile apps", "Series A raise (closes Q3 2027)"], highlight: false },
                  ].map((q, idx) => (
                    <motion.div key={idx} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 + idx * 0.1 }} className={`rounded-xl p-5 border ${q.highlight ? 'bg-emerald-500/[0.08] border-emerald-500/25' : 'bg-white/[0.04] border-white/[0.06]'}`}>
                      <h3 className={`text-xl font-bold mb-4 ${q.highlight ? 'text-emerald-400' : 'text-slate-200'}`}>{q.label}</h3>
                      <ul className="space-y-3">
                        {q.items.map((item, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${q.highlight ? 'text-emerald-400' : 'text-slate-600'}`} />
                            <span className="text-sm text-slate-300">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {slide.type === "ask" && (
              <div className="space-y-8 text-center">
                <h2 className="text-5xl font-bold text-white">The Ask</h2>
                <p className="text-xl text-slate-300 max-w-3xl mx-auto leading-relaxed">
                  Affordable payments and FX protection for 7M+ African SMEs in cross-border trade.
                </p>
                <div className="grid grid-cols-2 gap-6 max-w-4xl mx-auto">
                  {[
                    { cat: "Seed Investment", desc: "Accelerate mainnet launch and user acquisition" },
                    { cat: "Early LPs", desc: "Bootstrap hedge pool liquidity and earn premiums" },
                    { cat: "Strategic Partners", desc: "FX data providers, stablecoin issuers, African fintechs" },
                    { cat: "Pilot Users", desc: "SMEs and traders ready to test on testnet" },
                  ].map((item, idx) => (
                    <motion.div key={idx} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1 + idx * 0.1 }} className="bg-white/[0.04] rounded-xl p-6 border border-white/[0.06] text-left">
                      <h3 className="font-bold text-white text-lg mb-2">{item.cat}</h3>
                      <p className="text-base text-slate-300">{item.desc}</p>
                    </motion.div>
                  ))}
                </div>
                <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }}>
                  <Button size="lg" className="bg-gradient-to-r from-blue-500 to-emerald-500 hover:from-blue-600 hover:to-emerald-600 text-white px-10 py-7 text-xl" data-testid="button-contact-cta">
                    <Rocket className="w-6 h-6 mr-3" />
                    Get in Touch
                  </Button>
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
