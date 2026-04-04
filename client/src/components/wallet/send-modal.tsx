import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTransactions } from '@/hooks/use-transactions';
import { NETWORKS, DEFAULT_NETWORK, getNetworkById } from '@/lib/networks';
import { getTokensForNetwork } from '@/lib/tokens';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle, Loader2, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@/hooks/use-wallet';
import { mainnetGuard } from '@/lib/mainnet-guard';

const sendSchema = z.object({
  to: z.string().min(1, 'Recipient address is required')
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  amount: z.string().min(1, 'Amount is required')
    .refine((val) => !isNaN(Number(val)) && Number(val) > 0, 'Amount must be a positive number'),
  networkId: z.number().min(1, 'Network is required'),
  token: z.string().min(1, 'Token is required'),
});

type SendFormData = z.infer<typeof sendSchema>;

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultNetworkId?: number;
}

type Step = 'form' | 'confirm' | 'sending';

export function SendModal({ isOpen, onClose, defaultNetworkId = DEFAULT_NETWORK.id }: SendModalProps) {
  const { toast } = useToast();
  const { wallet } = useWallet();
  const [step, setStep] = useState<Step>('form');
  const [selectedNetworkId, setSelectedNetworkId] = useState(defaultNetworkId);
  const [selectedToken, setSelectedToken] = useState('native');
  const [feeInfo, setFeeInfo] = useState<{ feeAmount: number; feePercent: number; minimumFee: number; netAmount: number } | null>(null);
  const [pendingData, setPendingData] = useState<SendFormData | null>(null);

  const {
    sendTransaction,
    isSendingTransaction,
    gasEstimate,
    estimateGas,
    isEstimatingGas,
    balance,
    tokenBalances,
    formatCrypto,
  } = useTransactions(selectedNetworkId);

  const { data: treasuryData } = useQuery({
    queryKey: ['/api/fees/treasury-address'],
    queryFn: async () => {
      const res = await fetch('/api/fees/treasury-address');
      if (!res.ok) return null;
      return res.json();
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isValid },
  } = useForm<SendFormData>({
    resolver: zodResolver(sendSchema),
    defaultValues: { networkId: selectedNetworkId, to: '', amount: '', token: 'native' },
    mode: 'onChange',
  });

  const watchedValues = watch();
  const selectedNetwork = getNetworkById(selectedNetworkId);
  const resolvedNetwork = selectedNetwork ?? DEFAULT_NETWORK;

  // Build the token list: native token first, then any ERC-20s for this network
  const getAvailableTokens = useCallback(() => {
    const erc20s = getTokensForNetwork(selectedNetworkId).filter(t => t.address !== '0x'); // skip placeholder addresses
    const nativeSymbol = resolvedNetwork?.symbol ?? 'ETH';
    const nativeName = nativeSymbol === 'BNB' ? 'BNB' : nativeSymbol === 'ETH' ? 'Ethereum' : nativeSymbol;
    return [
      { symbol: nativeSymbol, name: nativeName, address: 'native', decimals: 18 },
      ...erc20s.map(t => ({ symbol: t.symbol, name: t.name, address: t.address, decimals: t.decimals })),
    ];
  }, [selectedNetworkId, selectedNetwork]);

  const getSelectedTokenInfo = useCallback(() => {
    const tokens = getAvailableTokens();
    return tokens.find(t => selectedToken === 'native' ? t.address === 'native' : t.address === selectedToken) || tokens[0];
  }, [selectedNetworkId, selectedToken, getAvailableTokens]);

  useEffect(() => {
    if (watchedValues.to && watchedValues.amount && selectedNetworkId) {
      const tokenInfo = getSelectedTokenInfo();
      estimateGas(
        watchedValues.to,
        watchedValues.amount,
        selectedNetworkId,
        tokenInfo.address === 'native' ? undefined : tokenInfo.address,
        tokenInfo.address === 'native' ? undefined : tokenInfo.decimals,
      );
    }
  }, [watchedValues.to, watchedValues.amount, selectedNetworkId, selectedToken]);

  useEffect(() => {
    const tokenInfo = getSelectedTokenInfo();
    const isStablecoin = tokenInfo.symbol === 'USDC' || tokenInfo.symbol === 'USDT';
    const amount = parseFloat(watchedValues.amount || '0');
    if (isStablecoin && amount > 0) {
      fetch(`/api/fees/calculate?amount=${amount}`)
        .then(r => r.json())
        .then(data => setFeeInfo(data))
        .catch(() => setFeeInfo(null));
    } else {
      setFeeInfo(null);
    }
  }, [watchedValues.amount, selectedToken]);

  useEffect(() => {
    setValue('networkId', selectedNetworkId);
    setSelectedToken('native');
    setValue('token', 'native');
  }, [selectedNetworkId, setValue]);

  useEffect(() => {
    setValue('token', selectedToken);
  }, [selectedToken, setValue]);

  const getTokenBalance = useCallback(() => {
    const tokenInfo = getSelectedTokenInfo();
    if (tokenInfo.address === 'native') return balance;
    const tb = tokenBalances.find(t => t.token.address.toLowerCase() === tokenInfo.address.toLowerCase());
    return tb ? { balance: tb.balance, symbol: tb.token.symbol } : { balance: '0', symbol: tokenInfo.symbol };
  }, [balance, tokenBalances, getSelectedTokenInfo]);

  const calculateTotal = useCallback(() => {
    const amount = parseFloat(watchedValues.amount || '0');
    const gas = parseFloat(gasEstimate || '0');
    const tokenInfo = getSelectedTokenInfo();
    if (tokenInfo.address !== 'native') return { tokenAmount: amount, gasAmount: gas };
    return { tokenAmount: amount + gas, gasAmount: 0 };
  }, [watchedValues.amount, gasEstimate, getSelectedTokenInfo]);

  const isInsufficientBalance = useCallback(() => {
    const tokenInfo = getSelectedTokenInfo();
    const amounts = calculateTotal();
    const tokenAmount = parseFloat(watchedValues.amount || '0');
    const nativeBalance = parseFloat(balance?.balance || '0');
    if (tokenInfo.address !== 'native') {
      // For ERC-20 tokens: only check the token balance — gas is sponsored automatically
      // when native balance is 0, so don't block the send on gas
      const tb = getTokenBalance();
      if (!tb || tokenAmount > parseFloat(tb.balance)) return true;
      return false;
    }
    // For native token (ETH/BNB): check total amount including gas
    return amounts.tokenAmount > nativeBalance;
  }, [balance, tokenBalances, watchedValues.amount, gasEstimate, getSelectedTokenInfo]);

  const handleReview = (data: SendFormData) => {
    const chainCheck = mainnetGuard.validateChainId(resolvedNetwork.chainId);
    if (!chainCheck.allowed) {
      toast({ title: 'Network error', description: chainCheck.reason, variant: 'destructive' });
      return;
    }
    const tokenInfo = getSelectedTokenInfo();
    const isStablecoin = tokenInfo.symbol === 'USDC' || tokenInfo.symbol === 'USDT';
    if (isStablecoin) {
      const txCheck = mainnetGuard.validateTransaction(parseFloat(data.amount) || 0, wallet?.address || '');
      if (!txCheck.allowed) {
        toast({ title: 'Transaction blocked', description: txCheck.reason, variant: 'destructive' });
        return;
      }
    }
    setPendingData(data);
    setStep('confirm');
  };

  const handleConfirm = async () => {
    if (!pendingData) return;

    // Safety re-check: balance may have changed since the form step
    if (isInsufficientBalance()) {
      const tokenInfo = getSelectedTokenInfo();
      const tokenBal = getTokenBalance();
      toast({
        title: 'Insufficient balance',
        description: `You need more ${tokenInfo.symbol} to complete this transaction. Your balance: ${tokenBal ? formatCrypto(tokenBal.balance, tokenBal.symbol) : '0'}.`,
        variant: 'destructive',
      });
      setStep('form');
      return;
    }

    setStep('sending');
    try {
      const tokenInfo = getSelectedTokenInfo();
      const isStablecoin = tokenInfo.symbol === 'USDC' || tokenInfo.symbol === 'USDT';
      const treasuryAddress = treasuryData?.address;

      if (isStablecoin && wallet?.address) {
        mainnetGuard.recordTransaction(wallet.address, parseFloat(pendingData.amount) || 0);
      }

      if (isStablecoin && feeInfo && treasuryAddress) {
        await sendTransaction({
          to: pendingData.to,
          amount: pendingData.amount,
          networkId: pendingData.networkId,
          tokenAddress: tokenInfo.address,
          tokenDecimals: tokenInfo.decimals,
          feeAmount: feeInfo.feeAmount.toString(),
          treasuryAddress,
        });
      } else {
        await sendTransaction({
          to: pendingData.to,
          amount: pendingData.amount,
          networkId: pendingData.networkId,
          tokenAddress: tokenInfo.address === 'native' ? undefined : tokenInfo.address,
          tokenDecimals: tokenInfo.decimals,
        });
      }

      handleClose();
    } catch (err: any) {
      setStep('confirm');
      const msg = err?.message || 'Transaction failed';
      const isBalanceError = msg.toLowerCase().includes('insufficient') || msg.toLowerCase().includes('exceeds balance');
      toast({
        title: isBalanceError ? 'Insufficient balance' : 'Transaction failed',
        description: isBalanceError
          ? `You don't have enough funds to complete this transaction.`
          : msg,
        variant: 'destructive',
      });
    }
  };

  const handleClose = () => {
    reset();
    setSelectedToken('native');
    setFeeInfo(null);
    setPendingData(null);
    setStep('form');
    onClose();
  };

  const tokenInfo = getSelectedTokenInfo();
  const tokenBalance = getTokenBalance();
  const amounts = calculateTotal();

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-md mx-auto max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <div className="w-7 h-7 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
              <Send className="text-primary w-3.5 h-3.5" />
            </div>
            {step === 'confirm' || step === 'sending' ? 'Confirm Transaction' : 'Send Crypto'}
          </DialogTitle>
        </DialogHeader>

        {/* ── STEP 1: FORM ─────────────────────────────────────────────── */}
        {step === 'form' && (
          <form onSubmit={handleSubmit(handleReview)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label>Network</Label>
              <Select value={selectedNetworkId.toString()} onValueChange={(v) => setSelectedNetworkId(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: resolvedNetwork.color }} />
                      <span>{resolvedNetwork.name}</span>
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {NETWORKS.map(n => (
                    <SelectItem key={n.id} value={n.id.toString()}>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: n.color }} />
                        <span>{n.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Token</Label>
              <Select value={selectedToken} onValueChange={setSelectedToken}>
                <SelectTrigger>
                  <SelectValue>
                    <span className="font-medium">{tokenInfo.symbol}</span>
                    <span className="text-sm text-muted-foreground ml-1">({tokenInfo.name})</span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {getAvailableTokens().map(t => (
                    <SelectItem key={t.address} value={t.address === 'native' ? 'native' : t.address}>
                      <span className="font-medium">{t.symbol}</span>
                      <span className="text-sm text-muted-foreground ml-1">({t.name})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="to">Recipient Address</Label>
              <Input
                id="to"
                placeholder="0x..."
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                {...register('to')}
                className={errors.to ? 'border-destructive' : ''}
              />
              {errors.to && <p className="text-sm text-destructive">{errors.to.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">Amount</Label>
              <div className="relative">
                <Input
                  id="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  {...register('amount')}
                  className={`pr-16 ${errors.amount ? 'border-destructive' : ''}`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <span className="text-sm font-medium text-muted-foreground">{tokenInfo.symbol}</span>
                </div>
              </div>
              {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
              {tokenBalance && (
                <p className="text-sm text-muted-foreground">
                  Balance: {formatCrypto(tokenBalance.balance, tokenBalance.symbol)}
                </p>
              )}
            </div>

            {(watchedValues.amount || gasEstimate) && (
              <div className="bg-muted rounded-lg p-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-medium">{formatCrypto(watchedValues.amount || '0', tokenInfo.symbol)}</span>
                </div>
                {feeInfo && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Platform Fee ({feeInfo.feePercent}%)</span>
                      <span className="text-orange-500 font-medium">-{feeInfo.feeAmount.toFixed(6)} USDC</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Recipient Gets</span>
                      <span className="text-green-500 font-medium">{feeInfo.netAmount.toFixed(6)} USDC</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Network Fee</span>
                  <span className="font-medium">
                    {isEstimatingGas ? <Loader2 className="h-4 w-4 animate-spin" /> : formatCrypto(gasEstimate || '0', resolvedNetwork.symbol)}
                  </span>
                </div>
                <hr className="border-border" />
                <div className="flex justify-between font-medium">
                  <span>You Pay</span>
                  <span className={isInsufficientBalance() ? 'text-destructive' : ''}>
                    {formatCrypto(amounts.tokenAmount.toString(), tokenInfo.address !== 'native' ? tokenInfo.symbol : resolvedNetwork.symbol)}
                    {tokenInfo.address !== 'native' && amounts.gasAmount > 0 && (
                      <span className="text-xs text-muted-foreground ml-1">+ gas</span>
                    )}
                  </span>
                </div>
                {isInsufficientBalance() && (
                  <p className="text-sm text-destructive flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Insufficient balance
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!isValid || isInsufficientBalance()}
              size="lg"
            >
              Review Transaction
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </form>
        )}

        {/* ── STEP 2: CONFIRM ──────────────────────────────────────────── */}
        {(step === 'confirm' || step === 'sending') && pendingData && (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Blockchain transactions cannot be reversed. Please check all details carefully.
              </p>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Network</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: resolvedNetwork.color }} />
                  <span className="font-medium">{resolvedNetwork.name}</span>
                </div>
              </div>

              <div className="py-2 border-b border-border">
                <span className="text-muted-foreground block mb-1">To</span>
                <span className="font-mono text-xs break-all font-medium">{pendingData.to}</span>
              </div>

              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">{formatCrypto(pendingData.amount, tokenInfo.symbol)}</span>
              </div>

              {feeInfo && (
                <>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">Platform Fee ({feeInfo.feePercent}%)</span>
                    <span className="text-orange-500 font-medium">-{feeInfo.feeAmount.toFixed(6)} USDC</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-muted-foreground">Recipient Gets</span>
                    <span className="text-green-500 font-semibold">{feeInfo.netAmount.toFixed(6)} USDC</span>
                  </div>
                </>
              )}

              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Network Fee</span>
                <span className="font-medium">{formatCrypto(gasEstimate || '0', resolvedNetwork.symbol)}</span>
              </div>

              <div className="flex justify-between py-3 bg-muted rounded-lg px-3">
                <span className="font-semibold">Total You Pay</span>
                <span className="font-bold text-base">
                  {formatCrypto(amounts.tokenAmount.toString(), tokenInfo.address !== 'native' ? tokenInfo.symbol : resolvedNetwork.symbol)}
                </span>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setStep('form')}
                disabled={step === 'sending'}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Go Back
              </Button>
              <Button
                className="flex-1"
                onClick={handleConfirm}
                disabled={step === 'sending'}
                size="lg"
              >
                {step === 'sending' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Sending...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Confirm & Send
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
