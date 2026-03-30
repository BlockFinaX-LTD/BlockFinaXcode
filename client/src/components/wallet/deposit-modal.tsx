import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EthIcon, UsdcIcon, UsdtIcon } from '@/components/crypto-icons';
import { Copy, QrCode, Check, ArrowLeft, Wallet, CreditCard, Clock } from 'lucide-react';
import { useWallet } from '@/hooks/use-wallet';
import { useToast } from '@/hooks/use-toast';
import QRCode from 'qrcode';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type DepositView = 'options' | 'onchain' | 'bank';

export function DepositModal({ isOpen, onClose }: DepositModalProps) {
  const { address } = useWallet();
  const { toast } = useToast();
  const [view, setView] = useState<DepositView>('options');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setView('options');
    }
  }, [isOpen]);

  useEffect(() => {
    if (address && isOpen && view === 'onchain') {
      QRCode.toDataURL(address, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      })
        .then(setQrCodeDataUrl)
        .catch(() => {});
    }
  }, [address, isOpen, view]);

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      toast({
        title: "Copied!",
        description: `${fieldName} copied to clipboard`,
      });
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleClose = () => {
    setView('options');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {view !== 'options' && (
              <Button variant="ghost" size="icon" className="h-6 w-6 -ml-1" onClick={() => setView('options')}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <span>{view === 'options' ? 'Deposit Funds' : view === 'onchain' ? 'Onchain Deposit' : 'Buy with Card'}</span>
          </DialogTitle>
          <DialogDescription>
            {view === 'options' && 'Choose how you want to add funds to your wallet'}
            {view === 'onchain' && 'Send crypto to your wallet address'}
            {view === 'bank' && 'Purchase crypto with your bank card'}
          </DialogDescription>
        </DialogHeader>

        {view === 'options' && (
          <div className="grid gap-3 py-4">
            <Card 
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => setView('onchain')}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Wallet className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">Onchain Deposit</h3>
                  <p className="text-sm text-muted-foreground">Send crypto from another wallet</p>
                </div>
              </CardContent>
            </Card>

            <Card 
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => setView('bank')}
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <CreditCard className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">Buy with Bank Card</h3>
                  <p className="text-sm text-muted-foreground">Use Visa, Mastercard, or bank transfer</p>
                </div>
                <Badge variant="secondary" className="text-xs">Soon</Badge>
              </CardContent>
            </Card>
          </div>
        )}

        {view === 'onchain' && (
          <div className="space-y-4 py-2">
            <div className="flex justify-center">
              <div className="p-3 bg-white rounded-lg border">
                {qrCodeDataUrl ? (
                  <img src={qrCodeDataUrl} alt="Wallet QR Code" className="w-40 h-40" />
                ) : (
                  <div className="w-40 h-40 bg-gray-100 rounded flex items-center justify-center">
                    <QrCode className="h-10 w-10 text-gray-400" />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Wallet Address</label>
              <div className="flex items-center gap-2 p-2.5 bg-muted rounded-lg">
                <code className="flex-1 text-xs font-mono break-all">
                  {address}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={() => address && copyToClipboard(address, 'Address')}
                >
                  {copiedField === 'Address' ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800 text-xs">
              <p className="font-medium text-amber-700 dark:text-amber-300 mb-1">
                Supported Networks
              </p>
              <p className="text-amber-600 dark:text-amber-400">
                Send ETH, USDC, or USDT on <strong>Lisk Mainnet</strong> to this address. Make sure you're on the correct network.
              </p>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                <EthIcon className="w-3.5 h-3.5" /> ETH
              </Badge>
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                <UsdcIcon className="w-3.5 h-3.5" /> USDC
              </Badge>
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                <UsdtIcon className="w-3.5 h-3.5" /> USDT
              </Badge>
            </div>
          </div>
        )}

        {view === 'bank' && (
          <div className="py-8 text-center space-y-4">
            <div className="h-16 w-16 rounded-full bg-muted mx-auto flex items-center justify-center">
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Coming Soon</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Bank card purchases will be available soon. Stay tuned!
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t">
          <Button variant="outline" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
