/**
 * useOpenMarkets — live open cover pools for the global market search.
 *
 * Reads the hedge contract for the active chain and returns only pools that are
 * open and not yet expired. Lazily enabled (e.g. when the search field is
 * focused) so it doesn't run on every page mount, and cached so repeat opens
 * are instant.
 */
import { useQuery } from '@tanstack/react-query';
import { hedgeContract } from '@/lib/hedge-contract';
import { useWallet } from './use-wallet';
import { getNetworkById, DEFAULT_NETWORK } from '@/lib/networks';

export interface OpenMarket {
  id: number;
  underlying: string;
  name: string;
  strike: number;
  premiumRate: number;
  strikeAbove: boolean;
  expiryDate: Date;
}

export function useOpenMarkets(enabled: boolean): OpenMarket[] {
  const { settings } = useWallet();
  const chainId = (getNetworkById(settings?.selectedNetworkId ?? DEFAULT_NETWORK.id) ?? DEFAULT_NETWORK).chainId;
  const { data } = useQuery<OpenMarket[]>({
    queryKey: ['open-markets', chainId],
    queryFn: async () => {
      hedgeContract.setChain(chainId);
      const evs = await hedgeContract.getAllEvents();
      const now = Date.now();
      return evs
        .filter((e) => e.status === 'open' && e.expiryDate.getTime() > now)
        .map((e) => ({
          id: e.id,
          underlying: e.underlying,
          name: e.name,
          strike: e.strike,
          premiumRate: e.premiumRate,
          strikeAbove: e.strikeAbove,
          expiryDate: e.expiryDate,
        }));
    },
    enabled,
    staleTime: 60_000,
    refetchInterval: false,
  });
  return data ?? [];
}
