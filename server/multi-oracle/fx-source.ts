/**
 * Initial FX oracle source: ExchangeRate-API open-access rates.
 *
 * Every signer uses this same adapter for FX until additional independent
 * providers are integrated. Separate signer keys do not make the price source
 * independent; keep that limitation visible in operations and monitoring.
 */

export type FxPairMap = Record<string, { base: string; quote: string }>;
export type FxPriceMap = Record<string, number>;

const API_URL = "https://open.er-api.com/v6/latest";
const REQUEST_TIMEOUT_MS = 8_000;

interface ExchangeRateResponse {
  result?: string;
  time_last_update_unix?: number;
  rates?: Record<string, number>;
}

export async function fetchExchangeRateApiFxPrices(pairs: FxPairMap): Promise<FxPriceMap> {
  const bases = [...new Set(Object.values(pairs).map(({ base }) => base))];
  const responses = await Promise.all(bases.map(async (base): Promise<[string, ExchangeRateResponse | null]> => {
    try {
      const response = await fetch(`${API_URL}/${encodeURIComponent(base)}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return [base, null];
      const body = (await response.json()) as ExchangeRateResponse;
      if (body.result !== "success" || !body.rates) return [base, null];
      return [base, body];
    } catch {
      return [base, null];
    }
  }));

  const byBase = new Map(responses);
  const prices: FxPriceMap = {};
  for (const [pair, { base, quote }] of Object.entries(pairs)) {
    const response = byBase.get(base);
    const rate = response?.rates?.[quote];
    if (rate !== undefined && Number.isFinite(rate) && rate > 0) prices[pair] = rate;
  }
  return prices;
}
