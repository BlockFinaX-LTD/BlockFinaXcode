import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@/hooks/use-wallet";
import { Copy, Users, Gift, Trophy, ArrowLeft, Send, Share2, Link } from "lucide-react";
import { useLocation } from "wouter";

export default function Referrals() {
  const { wallet } = useWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data: userPoints, isLoading: pointsLoading } = useQuery({
    queryKey: ['/api/points', wallet?.address],
    queryFn: () => fetch(`/api/points/${wallet?.address}`).then(res => res.json()),
    enabled: !!wallet?.address,
  });

  const { data: referralCode, isLoading: codeLoading } = useQuery({
    queryKey: ['/api/referrals/codes', wallet?.address],
    queryFn: () => fetch(`/api/referrals/codes/${wallet?.address}`).then(res => res.json()),
    enabled: !!wallet?.address,
  });

  const { data: referrals, isLoading: referralsLoading } = useQuery({
    queryKey: ['/api/referrals', wallet?.address],
    queryFn: () => fetch(`/api/referrals/${wallet?.address}`).then(res => res.json()),
    enabled: !!wallet?.address,
  });

  const { data: pointTransactions, isLoading: transactionsLoading } = useQuery({
    queryKey: ['/api/points/transactions', wallet?.address],
    queryFn: () => fetch(`/api/points/transactions/${wallet?.address}`).then(res => res.json()),
    enabled: !!wallet?.address,
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: `${label} copied to clipboard.`,
    });
  };

  const referralLink = referralCode?.code
    ? `${window.location.origin}/create-wallet?ref=${referralCode.code}`
    : '';

  if (!wallet) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Connect Wallet</CardTitle>
            <CardDescription>
              Please connect your wallet to access the referral system.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation('/wallet')}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Rewards</h1>
            <p className="text-sm sm:text-base text-muted-foreground">
              Invite friends, earn points — redeemable at launch!
            </p>
          </div>
        </div>
      </div>

      {/* Referral Code Card */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center space-x-2 text-lg">
            <Share2 className="h-5 w-5 text-primary" />
            <span>Your Referral Code</span>
          </CardTitle>
          <CardDescription>Share this code with friends — you both earn 50 points</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {codeLoading ? (
            <div className="h-12 bg-muted rounded-lg animate-pulse" />
          ) : referralCode?.code ? (
            <>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xl font-mono font-bold bg-card border border-border px-4 py-3 rounded-lg text-center tracking-wider">
                  {referralCode.code}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 shrink-0"
                  onClick={() => copyToClipboard(referralCode.code, 'Referral code')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => copyToClipboard(referralLink, 'Referral link')}
                >
                  <Link className="h-4 w-4 mr-2" />
                  Copy Invite Link
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {referralCode.currentUses || 0} friends invited
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Points Overview */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <Trophy className="h-5 w-5 text-amber-500 mx-auto mb-1" />
            <div className="text-xl font-bold">
              {pointsLoading ? "..." : (userPoints as any)?.totalPoints || 0}
            </div>
            <p className="text-[10px] text-muted-foreground">Total Points</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Gift className="h-5 w-5 text-primary mx-auto mb-1" />
            <div className="text-xl font-bold">
              {pointsLoading ? "..." : (userPoints as any)?.referralPoints || 0}
            </div>
            <p className="text-[10px] text-muted-foreground">Referral Points</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Users className="h-5 w-5 text-emerald-500 mx-auto mb-1" />
            <div className="text-xl font-bold">
              {referralsLoading ? "..." : (referrals as any)?.length || 0}
            </div>
            <p className="text-[10px] text-muted-foreground">Invited</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="referrals" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="referrals" className="text-xs sm:text-sm">Referrals</TabsTrigger>
          <TabsTrigger value="transactions" className="text-xs sm:text-sm">Points History</TabsTrigger>
        </TabsList>

        <TabsContent value="referrals" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your Referrals</CardTitle>
              <CardDescription>Friends who joined using your code</CardDescription>
            </CardHeader>
            <CardContent>
              {referralsLoading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : (referrals as any)?.length > 0 ? (
                <div className="space-y-3">
                  {(referrals as any).map((referral: any) => (
                    <div key={referral.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <div className="text-sm font-mono">
                          {referral.referredWalletAddress?.slice(0, 6)}...{referral.referredWalletAddress?.slice(-4)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(referral.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={referral.status === 'completed' ? "default" : "secondary"} className="text-[10px]">
                          {referral.status}
                        </Badge>
                        <span className="text-sm font-bold text-emerald-600">+{referral.pointsEarned || 50}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  No referrals yet. Share your code to start earning!
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transactions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Points History</CardTitle>
              <CardDescription>All your point earnings</CardDescription>
            </CardHeader>
            <CardContent>
              {transactionsLoading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : (pointTransactions as any)?.length > 0 ? (
                <div className="space-y-3">
                  {(pointTransactions as any).map((tx: any) => (
                    <div key={tx.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <div className="text-sm font-medium">{tx.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(tx.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <span className="text-sm font-bold text-emerald-600">+{tx.points}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  No points earned yet. Complete tasks or invite friends!
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
