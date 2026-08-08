import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import logoPath from "@/assets/logo.png";

export default function Waitlist() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30">
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/">
              <div className="flex items-center space-x-3 cursor-pointer">
                <img src={logoPath} alt="BlockFinaX" className="w-8 h-8" />
                <span className="text-xl font-bold bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
                  BlockFinaX
                </span>
              </div>
            </Link>
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="button-back-home">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="text-center mb-8">
            <h1 className="text-3xl md:text-4xl font-bold mb-4 bg-gradient-to-r from-foreground via-primary to-blue-600 bg-clip-text text-transparent">
              Join the BlockFinaX Waitlist
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Be among the first to access cross-border payment and FX protection tools when we launch. 
              Get early adopter benefits and exclusive updates.
            </p>
          </div>

          <div className="bg-background/80 backdrop-blur-sm rounded-xl border border-border/50 shadow-xl overflow-hidden">
            <iframe 
              aria-label="BlockFinaX Early Adopter Waitlist" 
              frameBorder="0" 
              style={{ height: '700px', width: '100%', border: 'none' }}
              src="https://forms.zohopublic.com/anthonykumako8gm1/form/BlockFinaXEarlyAdopterWaitlist/formperma/zBteo-73BotXOX_JiOu946gYsUHW968kR77P9XiTjmw"
              data-testid="waitlist-form-iframe"
            />
          </div>

          <div className="mt-8 text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              Questions? Contact us at{" "}
              <a href="mailto:info@blockfinax.com" className="text-primary hover:underline">
                info@blockfinax.com
              </a>
            </p>
            
            <div className="flex flex-col sm:flex-row justify-center gap-4 mt-6">
              <Link href="/">
                <Button size="lg" variant="outline" className="border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground" data-testid="button-learn-more">
                  Learn More About BlockFinaX
                </Button>
              </Link>
            </div>
          </div>
        </motion.div>
      </main>

      <footer className="border-t border-border py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-muted-foreground">
          <p>BlockFinaX Inc. — Delaware, USA · BlockFinaX Ltd — Registered in Ghana</p>
        </div>
      </footer>
    </div>
  );
}
