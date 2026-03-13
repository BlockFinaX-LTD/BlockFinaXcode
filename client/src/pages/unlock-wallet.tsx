import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWallet } from '@/hooks/use-wallet';
import { Loader2, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { FinanceAnimatedBackground } from '@/components/ui/finance-background';
import logoPath from "@/assets/logo.png";

const unlockSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});

type UnlockFormData = z.infer<typeof unlockSchema>;

export default function UnlockWallet() {
  const [, setLocation] = useLocation();
  const { unlockWallet, isLoading, deleteWallet } = useWallet();
  
  const [showPassword, setShowPassword] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<UnlockFormData>({
    resolver: zodResolver(unlockSchema),
  });

  const onSubmit = async (data: UnlockFormData) => {
    try {
      const wallet = await unlockWallet(data.password);
      if (wallet) {
        window.location.replace('/home');
      }
    } catch (error) {
      setError('password', {
        type: 'manual',
        message: 'Invalid password. Please try again.',
      });
    }
  };

  const handleDeleteWallet = () => {
    deleteWallet();
    setLocation('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50 p-4 relative overflow-hidden">
      <FinanceAnimatedBackground />

      <Card className="w-full max-w-md relative z-10 shadow-xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardHeader className="text-center">
          <div className="flex justify-start mb-1">
            <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to site
            </Link>
          </div>
          <CardTitle className="text-2xl font-bold">
            <div className="flex items-center justify-center space-x-2 mb-2">
              <img 
                src={logoPath} 
                alt="BlockFinaX Logo" 
                className="w-8 h-8 object-contain"
              />
              <span>Unlock Wallet</span>
            </div>
          </CardTitle>
          <p className="text-muted-foreground">
            Enter your password to access your BlockFinaX wallet
          </p>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  {...register('password')}
                  className={errors.password ? 'border-destructive' : ''}
                  autoFocus
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            <Button 
              type="submit" 
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Unlocking...
                </>
              ) : (
                'Unlock Wallet'
              )}
            </Button>
          </form>

          <div className="mt-6 space-y-4">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Don't have a wallet?{' '}
                <Link href="/create-wallet" className="text-primary hover:underline">
                  Create new wallet
                </Link>
                {' or '}
                <Link href="/import-wallet" className="text-primary hover:underline">
                  import existing
                </Link>
              </p>
            </div>

            <div className="pt-4 border-t border-border">
              {!showDeleteConfirm ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  Delete Wallet
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-center text-muted-foreground">
                    Are you sure? This action cannot be undone.
                  </p>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDeleteWallet}
                      className="flex-1"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
