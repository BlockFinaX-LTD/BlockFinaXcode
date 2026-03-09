import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QRCodeComponent } from './qr-code';
import { Copy, Check } from 'lucide-react';
import { useWallet } from '@/hooks/use-wallet';
import { useToast } from '@/hooks/use-toast';

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ReceiveModal({ isOpen, onClose }: ReceiveModalProps) {
  const { address } = useWallet();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopyAddress = async () => {
    if (!address) return;
    
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast({
        title: "Address Copied",
        description: "Wallet address copied to clipboard",
      });
      
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to copy address",
      });
    }
  };

  if (!address) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-success/10 rounded-full flex items-center justify-center">
              <i className="fas fa-qrcode text-success text-sm"></i>
            </div>
            <span>Receive Crypto</span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* QR Code */}
          <div className="flex justify-center">
            <div className="p-4 bg-white rounded-lg border">
              <QRCodeComponent 
                value={address}
                size={200}
              />
            </div>
          </div>
          
          {/* Address */}
          <div className="space-y-2">
            <Label htmlFor="address">Your Wallet Address</Label>
            <div className="flex space-x-2">
              <Input
                id="address"
                value={address}
                readOnly
                className="flex-1 font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyAddress}
                className="shrink-0"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Send any supported cryptocurrency to this address
            </p>
          </div>
          
          {/* Warning */}
          <div className="p-4 bg-warning/5 border border-warning/20 rounded-lg">
            <div className="flex items-start space-x-2">
              <i className="fas fa-exclamation-triangle text-warning text-sm mt-0.5"></i>
              <div className="text-sm">
                <p className="font-medium text-warning mb-1">Important</p>
                <p className="text-muted-foreground">
                  Only send tokens on supported networks to this address. 
                  Sending tokens on unsupported networks may result in permanent loss.
                </p>
              </div>
            </div>
          </div>
          
          <Button 
            onClick={onClose}
            className="w-full"
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
