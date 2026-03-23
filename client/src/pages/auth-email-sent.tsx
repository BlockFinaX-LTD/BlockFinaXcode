/**
 * auth-email-sent.tsx — "Check your email" confirmation screen
 * Shown after user submits their email for a magic link.
 */

import { useLocation } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Mail, ArrowLeft } from 'lucide-react';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from '@/assets/logo.png';

export default function AuthEmailSent() {
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const email = params.get('email') || 'your inbox';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
      <FinanceAnimatedBackground />
      <Card className="w-full max-w-md relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardContent className="pt-8 pb-8 text-center space-y-6">
          <div className="flex justify-center">
            <img src={logoPath} alt="BlockFinaX" className="h-10 w-10 object-contain" />
          </div>

          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
              <Mail className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold">Check your email</h1>
            <p className="text-muted-foreground text-sm leading-relaxed max-w-xs">
              We sent a sign-in link to <strong>{email}</strong>.
              Click the link in the email to continue — it expires in 15 minutes.
            </p>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            <p>No email? Check your spam folder.</p>
          </div>

          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setLocation('/auth')}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to sign in
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
