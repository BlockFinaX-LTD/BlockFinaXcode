import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EthIcon, UsdcIcon, UsdtIcon, BnbIcon } from '@/components/crypto-icons';
import { Copy, QrCode, Check, ArrowLeft, Wallet, CreditCard, Loader2, ExternalLink } from 'lucide-react';
import { useWallet } from '@/hooks/use-wallet';
import { useToast } from '@/hooks/use-toast';
import { getNetworkById } from '@/lib/networks';
import QRCode from 'qrcode';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedNetworkId?: number;
}

type DepositView = 'options' | 'onchain' | 'mercuryo';
type MercuryoCurrency = 'USDC' | 'USDT' | 'ETH' | 'BNB';

const MERCURYO_CURRENCIES: { symbol: MercuryoCurrency; label: string; networks: number[] }[] = [
  { symbol: 'USDC', label: 'USDC', networks: [1, 3, 4] },
  { symbol: 'USDT', label: 'USDT', networks: [1, 3, 4] },
  { symbol: 'ETH',  label: 'ETH',  networks: [1, 3] },
  { symbol: 'BNB',  label: 'BNB',  networks: [4] },
];

export function DepositModal({ isOpen, onClose, selectedNetworkId = 1 }: DepositModalProps) {
  const { address } = useWallet();
  const { toast } = useToast();
  const [view, setView] = useState<DepositView>('options');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<MercuryoCurrency>('USDC');
  const [mercuryoLoading, setMercuryoLoading] = useState(false);
  const [mercuryoConfigured, setMercuryoConfigured] = useState<boolean | null>(null);

  const network = getNetworkById(selectedNetworkId);

  useEffect(() => {
    if (!isOpen) {
      setView('options');
      setMercuryoLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    fetch('/api/mercuryo/status').then(r => r.json()).then(d => setMercuryoConfigured(d.configured)).catch(() => setMercuryoConfigured(false));
  }, []);

  useEffect(() => {
    if (address && isOpen && view === 'onchain') {
      QRCode.toDataURL(address, { width: 200, margin: 2, color: { dark: '#000000', light: '#FFFFFF' } })
        .then(setQrCodeDataUrl)
        .catch(() => {});
    }
  }, [address, isOpen, view]);

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      toast({ title: "Copied!", description: `${fieldName} copied to clipboard` });
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast({ title: "Error", description: "Failed to copy to clipboard", variant: "destructive" });
    }
  };

  const handleOpenMercuryo = async () => {
    if (!address) return;
    setMercuryoLoading(true);
    try {
      const res = await fetch('/api/mercuryo/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, chainId: network?.chainId ?? 8453, currency: selectedCurrency }),
      });
      const data = await res.json();
      if (!data.configured) {
        toast({ title: "Mercuryo not configured", description: "Widget credentials are not yet set up. Contact the platform admin.", variant: "destructive" });
        return;
      }
      window.open(data.widgetUrl, '_blank', 'noopener,noreferrer');
    } catch {
      toast({ title: "Error", description: "Could not open Mercuryo. Please try again.", variant: "destructive" });
    } finally {
      setMercuryoLoading(false);
    }
  };

  const handleClose = () => {
    setView('options');
    onClose();
  };

  const availableCurrencies = MERCURYO_CURRENCIES.filter(c => c.networks.includes(selectedNetworkId));

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
            <span>
              {view === 'options' ? 'Deposit Funds' : view === 'onchain' ? 'Onchain Deposit' : 'Buy with Card'}
            </span>
          </DialogTitle>
          <DialogDescription>
            {view === 'options' && 'Choose how you want to add funds to your wallet'}
            {view === 'onchain' && 'Send crypto to your wallet address'}
            {view === 'mercuryo' && 'Buy crypto with Visa, Mastercard, or bank transfer'}
          </DialogDescription>
        </DialogHeader>

        {/* Options */}
        {view === 'options' && (
          <div className="grid gap-3 py-4">
            <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => setView('onchain')}>
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

            <Card className="cursor-pointer hover:border-primary transition-colors" onClick={() => setView('mercuryo')}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center">
                  <CreditCard className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">Buy with Card</h3>
                  <p className="text-sm text-muted-foreground">Visa, Mastercard, Apple Pay, Google Pay</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                    Mercuryo
                  </Badge>
                  {mercuryoConfigured === false && (
                    <span className="text-[10px] text-amber-500">Setup needed</span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Onchain */}
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
                <code className="flex-1 text-xs font-mono break-all">{address}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => address && copyToClipboard(address, 'Address')}>
                  {copiedField === 'Address' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800 text-xs">
              <p className="font-medium text-amber-700 dark:text-amber-300 mb-1">Supported Networks</p>
              <p className="text-amber-600 dark:text-amber-400">
                Send to this address on <strong>Base or BSC Mainnet</strong>. Make sure the network matches.
              </p>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs flex items-center gap-1"><EthIcon className="w-3.5 h-3.5" /> ETH</Badge>
              <Badge variant="outline" className="text-xs flex items-center gap-1"><UsdcIcon className="w-3.5 h-3.5" /> USDC</Badge>
              <Badge variant="outline" className="text-xs flex items-center gap-1"><UsdtIcon className="w-3.5 h-3.5" /> USDT</Badge>
              <Badge variant="outline" className="text-xs flex items-center gap-1"><BnbIcon className="w-3.5 h-3.5" /> BNB</Badge>
            </div>
          </div>
        )}

        {/* Mercuryo */}
        {view === 'mercuryo' && (
          <div className="py-4 space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-100 dark:border-blue-900">
              <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                <CreditCard className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-sm">Powered by Mercuryo</p>
                <p className="text-xs text-muted-foreground">KYC-compliant • 50+ cryptocurrencies • 40+ fiat currencies</p>
              </div>
            </div>

            {/* Currency selector */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Select asset to buy</label>
              <div className="grid grid-cols-2 gap-2">
                {availableCurrencies.map(({ symbol }) => (
                  <button
                    key={symbol}
                    onClick={() => setSelectedCurrency(symbol)}
                    className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-all ${
                      selectedCurrency === symbol
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border hover:border-primary/50 text-foreground'
                    }`}
                  >
                    <span className="flex-shrink-0">
                      {symbol === 'USDC' && <UsdcIcon className="w-5 h-5" />}
                      {symbol === 'USDT' && <UsdtIcon className="w-5 h-5" />}
                      {symbol === 'ETH'  && <EthIcon  className="w-4 h-4" />}
                      {symbol === 'BNB'  && <BnbIcon  className="w-5 h-5" />}
                    </span>
                    {symbol}
                  </button>
                ))}
              </div>
            </div>

            {/* Network + address info */}
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between py-1 border-b border-border/50">
                <span>Network</span>
                <span className="font-medium text-foreground">{network?.name ?? 'Base'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/50">
                <span>Receiving address</span>
                <span className="font-mono font-medium text-foreground">{address ? `${address.slice(0,6)}…${address.slice(-4)}` : '—'}</span>
              </div>
            </div>

            {/* Info note */}
            <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
              The Mercuryo widget will open in a new tab. Complete KYC and payment there — crypto will arrive directly in your wallet.
            </div>

            {/* CTA */}
            <Button
              className="w-full h-11"
              onClick={handleOpenMercuryo}
              disabled={mercuryoLoading || !address}
            >
              {mercuryoLoading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Opening…</>
              ) : (
                <><ExternalLink className="h-4 w-4 mr-2" /> Buy {selectedCurrency} with Card</>
              )}
            </Button>

            {mercuryoConfigured === false && (
              <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                Mercuryo credentials are not yet configured. The widget will be available once the Widget ID and Secret Key are added.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t">
          <Button variant="outline" size="sm" onClick={handleClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
