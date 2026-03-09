import { useState } from "react";
import { useWallet } from "@/hooks/use-wallet";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { ArrowLeft, Droplets, ExternalLink, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import logoPath from "@/assets/logo.png";

export default function Faucet() {
  const { wallet } = useWallet();
  const { toast } = useToast();
  const [amount, setAmount] = useState("100");
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState("");

  const handleClaim = async () => {
    if (!wallet?.address) {
      toast({ title: "No wallet", description: "Please create or unlock your wallet first.", variant: "destructive" });
      return;
    }
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0 || parsed > 500) {
      toast({ title: "Invalid amount", description: "Enter an amount between 1 and 500 USDC.", variant: "destructive" });
      return;
    }
    setLoading(true);
    setTxHash("");
    try {
      const res = await fetch("/api/faucet/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet.address, amount: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Request failed");
      setTxHash(data.txHash);
      toast({ title: "USDC sent!", description: `${parsed} test USDC has been sent to your wallet.` });
    } catch (err: any) {
      toast({ title: "Faucet error", description: err.message || "Something went wrong.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const presetAmounts = [10, 50, 100, 250, 500];

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="border-b border-gray-800 bg-black/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="w-full px-4 py-3 flex items-center gap-3">
          <Link href="/home">
            <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <img src={logoPath} alt="BlockFinaX" className="w-8 h-8" />
          <h1 className="text-lg font-bold">Test USDC Faucet</h1>
          <Badge variant="outline" className="ml-auto border-blue-500/50 text-blue-400 text-xs">
            Lisk Sepolia Testnet
          </Badge>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
        <Card className="bg-gray-900/80 border-gray-700">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mb-3">
              <Droplets className="w-8 h-8 text-blue-400" />
            </div>
            <CardTitle className="text-white text-xl">Claim Test USDC</CardTitle>
            <CardDescription className="text-gray-400">
              Get free test USDC to try out hedge events, provide liquidity, and explore the platform on Lisk Sepolia testnet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!wallet?.address ? (
              <div className="text-center py-6 space-y-3">
                <AlertTriangle className="w-10 h-10 text-yellow-400 mx-auto" />
                <p className="text-gray-400">You need a wallet to claim test USDC.</p>
                <Link href="/create-wallet">
                  <Button className="bg-blue-600 hover:bg-blue-700">Create Wallet</Button>
                </Link>
              </div>
            ) : (
              <>
                <div>
                  <Label className="text-gray-300 text-sm">Your Wallet</Label>
                  <div className="mt-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 text-sm font-mono break-all">
                    {wallet.address}
                  </div>
                </div>

                <div>
                  <Label className="text-gray-300 text-sm">Amount (USDC)</Label>
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="1"
                    max="500"
                    className="mt-1 bg-gray-800 border-gray-700 text-white"
                    placeholder="Enter amount (1 - 500)"
                  />
                  <div className="flex flex-wrap gap-2 mt-2">
                    {presetAmounts.map((val) => (
                      <Button
                        key={val}
                        variant="outline"
                        size="sm"
                        onClick={() => setAmount(String(val))}
                        className={`text-xs border-gray-600 ${
                          amount === String(val)
                            ? "bg-blue-600/30 border-blue-500 text-blue-300"
                            : "text-gray-400 hover:text-white hover:border-gray-500"
                        }`}
                      >
                        {val} USDC
                      </Button>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={handleClaim}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white h-12 text-base"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Sending USDC...
                    </>
                  ) : (
                    <>
                      <Droplets className="w-5 h-5 mr-2" />
                      Claim {amount || "0"} Test USDC
                    </>
                  )}
                </Button>

                {txHash && (
                  <div className="rounded-lg bg-green-900/30 border border-green-700/50 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-green-400">
                      <CheckCircle2 className="w-5 h-5" />
                      <span className="font-semibold">Transaction Successful!</span>
                    </div>
                    <a
                      href={`https://sepolia-blockscout.lisk.com/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm break-all"
                    >
                      View on Explorer <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    </a>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gray-900/50 border-gray-800">
          <CardContent className="pt-5 space-y-3 text-sm text-gray-400">
            <p className="font-medium text-gray-300">How it works:</p>
            <ul className="space-y-2 list-disc list-inside">
              <li>This faucet sends test USDC on the Lisk Sepolia testnet</li>
              <li>You can request up to 500 USDC per day</li>
              <li>Use test USDC to buy hedge protection or provide liquidity</li>
              <li>Gas fees are automatically covered — no ETH needed</li>
              <li>Test USDC has no real monetary value</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
