import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, ExternalLink, CheckCircle2 } from "lucide-react";
import { TERMS_VERSION } from "@/pages/terms";

const STORAGE_KEY = `blockfinax_terms_v${TERMS_VERSION}`;

async function recordAcceptance(walletAddress: string) {
  try {
    await fetch("/api/terms/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress, version: TERMS_VERSION }),
    });
  } catch {
    // non-blocking — localStorage is the primary gate
  }
}

export function useTermsGate(walletAddress?: string) {
  const [accepted, setAccepted] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEY) === "accepted";
  });

  function accept() {
    localStorage.setItem(STORAGE_KEY, "accepted");
    setAccepted(true);
    if (walletAddress) recordAcceptance(walletAddress);
  }

  return { accepted, accept };
}

interface TermsModalProps {
  walletAddress?: string;
  onAccept: () => void;
}

export function TermsModal({ walletAddress, onAccept }: TermsModalProps) {
  const [, navigate] = useLocation();
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [accepting, setAccepting] = useState(false);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      setScrolledToBottom(true);
    }
  }

  async function handleAccept() {
    setAccepting(true);
    localStorage.setItem(STORAGE_KEY, "accepted");
    if (walletAddress) await recordAcceptance(walletAddress);
    setAccepting(false);
    onAccept();
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
        style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
      >
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-lg mx-0 sm:mx-4 flex flex-col"
          style={{ maxHeight: "90vh" }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Terms of Use</h2>
              <p className="text-xs text-muted-foreground">Version {TERMS_VERSION} · Please read before continuing</p>
            </div>
          </div>

          {/* Summary */}
          <div className="px-5 py-4 bg-muted/30 border-b border-border shrink-0 space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Key points</p>
            {[
              "BlockFinaX is a decentralised P2P protocol — we are not a broker or counterparty.",
              "All funds are held by smart contracts on-chain, not by BlockFinaX.",
              "Settlements are cash-settled in USDC. No physical assets are bought or sold.",
              "Smart contract, oracle, and market risks exist. You may lose funds.",
              "By agreeing, you confirm you are legally permitted to use this protocol in your jurisdiction.",
            ].map((pt, i) => (
              <div key={i} className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">{pt}</p>
              </div>
            ))}
          </div>

          {/* Scroll area */}
          <div
            className="flex-1 overflow-y-auto px-5 py-4 text-xs text-muted-foreground space-y-4 leading-relaxed"
            onScroll={handleScroll}
            style={{ minHeight: 0 }}
          >
            <p>BlockFinaX is a decentralised peer-to-peer hedging protocol. You interact directly with open-source smart contracts on Base and BNB Smart Chain. BlockFinaX does not hold your funds, act as a counterparty, or provide financial advice.</p>
            <p>Use of this protocol involves significant risks including smart contract vulnerabilities, oracle failures, FX volatility, and liquidity limitations. You may lose all funds you commit to the protocol.</p>
            <p>The protocol is restricted to users who are legally permitted to use decentralised financial protocols in their jurisdiction. Use by persons in sanctioned jurisdictions or subject to OFAC restrictions is prohibited.</p>
            <p>All fees charged by the protocol are final and non-refundable. Protocol rules are enforced by smart contracts and cannot be overridden by BlockFinaX.</p>
            <p>By clicking "I Agree", you confirm that you have read, understood, and accepted the full Terms of Use and all associated risks.</p>
            <button
              onClick={() => navigate("/terms")}
              className="flex items-center gap-1 text-primary underline underline-offset-2 font-medium"
            >
              Read full Terms of Use <ExternalLink className="h-3 w-3" />
            </button>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-border shrink-0 space-y-2">
            {!scrolledToBottom && (
              <p className="text-center text-xs text-muted-foreground">Scroll down to read before agreeing</p>
            )}
            <Button
              className="w-full"
              onClick={handleAccept}
              disabled={accepting}
            >
              {accepting ? "Recording..." : "I Agree — Continue to BlockFinaX"}
            </Button>
            <p className="text-center text-[10px] text-muted-foreground">
              By continuing you agree to the Terms of Use v{TERMS_VERSION}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function TermsGate({ walletAddress, children }: { walletAddress?: string; children: React.ReactNode }) {
  const { accepted, accept } = useTermsGate(walletAddress);

  if (!accepted) {
    return <TermsModal walletAddress={walletAddress} onAccept={accept} />;
  }

  return <>{children}</>;
}
