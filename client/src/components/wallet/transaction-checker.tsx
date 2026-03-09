import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useWallet } from '@/hooks/use-wallet';
import { NETWORKS } from '@/lib/networks';
import { fallbackProvider } from '@/lib/rpc-provider';
import { 
  Search, 
  ExternalLink, 
  Copy, 
  AlertCircle, 
  CheckCircle, 
  Clock,
  Gift,
  Zap,
  RefreshCw
} from 'lucide-react';
import { ethers } from 'ethers';

interface TransactionStatus {
  hash: string;
  status: 'pending' | 'confirmed' | 'failed' | 'not_found';
  blockNumber?: number;
  from?: string;
  to?: string;
  value?: string;
  gasUsed?: string;
  network?: string;
}

export function TransactionChecker() {
  const [txHash, setTxHash] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [txStatus, setTxStatus] = useState<TransactionStatus | null>(null);
  const { toast } = useToast();
  const { address } = useWallet();

  const checkTransaction = async () => {
    if (!txHash.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a transaction hash',
        variant: 'destructive',
      });
      return;
    }

    setIsChecking(true);
    setTxStatus(null);

    try {
      // Check across all testnet networks
      for (const network of NETWORKS) {
        try {
          const provider = new ethers.JsonRpcProvider(network.rpcUrl);
          const receipt = await provider.getTransactionReceipt(txHash);
          
          if (receipt) {
            const transaction = await provider.getTransaction(txHash);
            setTxStatus({
              hash: txHash,
              status: receipt.status === 1 ? 'confirmed' : 'failed',
              blockNumber: receipt.blockNumber,
              from: transaction?.from || undefined,
              to: transaction?.to || undefined,
              value: transaction?.value ? ethers.formatEther(transaction.value) : '0',
              gasUsed: receipt.gasUsed.toString(),
              network: network.name
            });
            break;
          }
        } catch (error) {
          // Continue checking other networks
          continue;
        }
      }

      if (!txStatus) {
        setTxStatus({
          hash: txHash,
          status: 'not_found'
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to check transaction status',
        variant: 'destructive',
      });
    } finally {
      setIsChecking(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied',
      description: 'Address copied to clipboard',
    });
  };

  const getTestnetFaucets = () => [
    {
      name: 'Ethereum Sepolia',
      url: 'https://sepoliafaucet.com/',
      description: 'Get free Sepolia ETH for testing'
    },
    {
      name: 'Polygon Mumbai',
      url: 'https://faucet.polygon.technology/',
      description: 'Get free MATIC for Mumbai testnet'
    },
    {
      name: 'BSC Testnet',
      url: 'https://testnet.bnbchain.org/faucet-smart',
      description: 'Get free BNB for BSC testnet'
    },
    {
      name: 'Arbitrum Goerli',
      url: 'https://faucet.triangleplatform.com/arbitrum/goerli',
      description: 'Get free ETH for Arbitrum Goerli'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Balance Refresh Tool */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <RefreshCw className="h-5 w-5" />
            <span>Force Balance Refresh</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your funds are on the blockchain but not showing due to RPC connection issues. 
              Use this tool to force refresh your balances with updated network endpoints.
            </AlertDescription>
          </Alert>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Wallet Address:</p>
              <p className="text-sm font-mono text-muted-foreground break-all">{address}</p>
            </div>
            <Button 
              onClick={async () => {
                setIsChecking(true);
                try {
                  const results = [];
                  for (const network of NETWORKS) {
                    try {
                      const balanceEth = await fallbackProvider.getBalance(address || '', network.chainId);
                      if (balanceEth !== null) {
                        const balance = parseFloat(balanceEth);
                        if (balance > 0) {
                          results.push(`${network.name}: ${balance.toFixed(6)} ${network.symbol} ✓`);
                        } else {
                          results.push(`${network.name}: 0 ${network.symbol}`);
                        }
                      } else {
                        results.push(`${network.name}: Connection failed`);
                      }
                    } catch (error) {
                      results.push(`${network.name}: Error`);
                    }
                  }
                  
                  const hasBalances = results.some(r => r.includes('✓'));
                  toast({
                    title: hasBalances ? 'Balances Found!' : 'Balance Check Complete',
                    description: results.join(' | '),
                  });
                } catch (error) {
                  toast({
                    title: 'Error',
                    description: 'Failed to refresh balances',
                    variant: 'destructive',
                  });
                } finally {
                  setIsChecking(false);
                }
              }}
              disabled={isChecking || !address}
            >
              {isChecking ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Check All Networks
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Transaction Checker */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Search className="h-5 w-5" />
            <span>Check Transaction Status</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="txHash">Transaction Hash</Label>
            <div className="flex space-x-2">
              <Input
                id="txHash"
                placeholder="Enter transaction hash (0x...)"
                value={txHash}
                onChange={(e) => setTxHash(e.target.value)}
                className="font-mono"
              />
              <Button 
                onClick={checkTransaction}
                disabled={isChecking}
              >
                {isChecking ? (
                  <>
                    <Clock className="h-4 w-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Check
                  </>
                )}
              </Button>
            </div>
          </div>

          {txStatus && (
            <div className="space-y-4">
              <Separator />
              
              {txStatus.status === 'confirmed' && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-2">
                      <p><strong>Transaction Confirmed!</strong></p>
                      <div className="text-sm space-y-1">
                        <p><strong>Network:</strong> {txStatus.network}</p>
                        <p><strong>From:</strong> {txStatus.from}</p>
                        <p><strong>To:</strong> {txStatus.to}</p>
                        <p><strong>Value:</strong> {txStatus.value} {txStatus.network?.includes('Ethereum') ? 'ETH' : 'tokens'}</p>
                        <p><strong>Block:</strong> {txStatus.blockNumber}</p>
                      </div>
                      
                      {txStatus.to?.toLowerCase() === address?.toLowerCase() && (
                        <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                          <p className="text-green-800 dark:text-green-200 font-medium">
                            ✓ This transaction was sent to your wallet address!
                          </p>
                          <p className="text-green-600 dark:text-green-400 text-sm mt-1">
                            If you don't see the balance, make sure you're on the correct network: {txStatus.network}
                          </p>
                        </div>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {txStatus.status === 'failed' && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Transaction failed on {txStatus.network}. The funds were not transferred.
                  </AlertDescription>
                </Alert>
              )}

              {txStatus.status === 'not_found' && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-2">
                      <p>Transaction not found on any testnet network.</p>
                      <p className="text-sm">This could mean:</p>
                      <ul className="text-sm list-disc list-inside space-y-1">
                        <li>The transaction was sent on mainnet (real networks)</li>
                        <li>The transaction hash is incorrect</li>
                        <li>The transaction is still pending</li>
                      </ul>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Your Wallet Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Zap className="h-5 w-5" />
            <span>Your Wallet Address</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Current Address:</p>
              <p className="font-mono text-sm break-all">{address}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => address && copyToClipboard(address)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          
          <Alert className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Make sure you sent testnet ETH to this address, not mainnet ETH. Mainnet and testnet are completely separate networks.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Testnet Faucets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Gift className="h-5 w-5" />
            <span>Get Free Testnet Tokens</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Use these faucets to get free testnet tokens for development and testing:
          </p>
          
          <div className="grid gap-3">
            {getTestnetFaucets().map((faucet, index) => (
              <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex-1">
                  <p className="font-medium">{faucet.name}</p>
                  <p className="text-sm text-muted-foreground">{faucet.description}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(faucet.url, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Visit Faucet
                </Button>
              </div>
            ))}
          </div>

          <Alert className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Copy your wallet address above and paste it into the faucet websites to receive free testnet tokens.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}