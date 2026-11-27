/**
 * TradingView Advanced Charts on BlockFinaX data.
 *
 * The library is licensed to BlockFinaX and downloaded at build time into
 * /charting_library (scripts/fetch-charting-library.sh); it is not in this repository.
 * `useTradingView()` answers null while loading, false if the library is not there (then the
 * caller shows its built-in chart), or the TradingView namespace.
 *
 * The datafeed serves our own candles (the market rate, or a perp's own prices) through the
 * library's JS API, and polls every few seconds for the live bar.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/wallets/passkey-wallet";

type TV = any;
let loading: Promise<TV | false> | null = null;

/** Load the library once; false if it is not deployed here. */
export function loadTradingView(): Promise<TV | false> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if ((window as any).TradingView?.widget) return Promise.resolve((window as any).TradingView);
  return (loading ??= new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "/charting_library/charting_library.standalone.js";
    s.async = true;
    s.onload = () => resolve((window as any).TradingView?.widget ? (window as any).TradingView : false);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  }));
}

export function useTradingView(): TV | false | null {
  const [tv, setTv] = useState<TV | false | null>(null);
  useEffect(() => { let live = true; void loadTradingView().then((v) => { if (live) setTv(v); }); return () => { live = false; }; }, []);
  return tv;
}

/** TradingView resolution to our candle size in minutes (0 is not used: MAX is a range here). */
const MINUTES: Record<string, number> = { "1": 1, "5": 5, "15": 15, "30": 30, "60": 60, "120": 120, "240": 240, "1D": 1440, D: 1440, "1W": 10080, W: 10080, "1M": 43200, M: 43200 };
const RESOLUTIONS = ["1", "5", "15", "30", "60", "120", "240", "1D", "1W", "1M"];

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface TvSymbol { name: string; description: string; decimals: number; candles: (minutes: number) => string }

function datafeed(symbols: TvSymbol[]) {
  const subs = new Map<string, ReturnType<typeof setInterval>>();
  const find = (name: string) => symbols.find((s) => s.name === name);
  const fetchBars = async (sym: TvSymbol, resolution: string) => {
    const r = await api<{ candles: Candle[] }>(sym.candles(MINUTES[resolution] ?? 1440));
    return (r.candles ?? []).map((k) => ({ time: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v ?? 0 }));
  };
  return {
    onReady: (cb: (c: unknown) => void) => setTimeout(() => cb({ supported_resolutions: RESOLUTIONS, supports_marks: false, supports_timescale_marks: false, supports_time: true }), 0),
    searchSymbols: (_q: string, _e: string, _t: string, onResult: (r: unknown[]) => void) => onResult(symbols.map((s) => ({ symbol: s.name, full_name: s.name, description: s.description, exchange: "BlockFinaX", ticker: s.name, type: "crypto" }))),
    resolveSymbol: (name: string, onResolve: (s: unknown) => void, onError: (e: string) => void) => {
      const s = find(name);
      if (!s) { setTimeout(() => onError("Unknown market"), 0); return; }
      setTimeout(() => onResolve({
        name: s.name, ticker: s.name, description: s.description, type: "crypto", session: "24x7", timezone: "Etc/UTC",
        exchange: "BlockFinaX", listed_exchange: "BlockFinaX", format: "price", minmov: 1, pricescale: 10 ** s.decimals,
        has_intraday: true, has_daily: true, has_weekly_and_monthly: true, supported_resolutions: RESOLUTIONS,
        volume_precision: 0, data_status: "streaming", visible_plots_set: "ohlc",
      }), 0);
    },
    getBars: (info: { name: string }, resolution: string, period: { from: number; to: number; firstDataRequest: boolean }, onResult: (bars: unknown[], meta: { noData: boolean }) => void, onError: (e: string) => void) => {
      const s = find(info.name);
      if (!s) { onError("Unknown market"); return; }
      // Our candle API returns the latest history in one go; later (older) requests get nothing more.
      if (!period.firstDataRequest) { onResult([], { noData: true }); return; }
      fetchBars(s, resolution)
        .then((bars) => { const b = bars.filter((x) => x.time < period.to * 1000 + 86_400_000); onResult(b, { noData: b.length === 0 }); })
        .catch((e: Error) => onError(e.message));
    },
    subscribeBars: (info: { name: string }, resolution: string, onTick: (bar: unknown) => void, guid: string) => {
      const s = find(info.name);
      if (!s) return;
      let last = 0;
      const poll = () => fetchBars(s, resolution).then((bars) => {
        const fresh = bars.filter((b) => b.time >= last);
        for (const b of fresh) onTick(b);
        if (bars.length) last = bars[bars.length - 1].time;
      }).catch(() => undefined);
      subs.set(guid, setInterval(poll, resolution === "1" || resolution === "5" ? 5_000 : 15_000));
      void poll();
    },
    unsubscribeBars: (guid: string) => { const t = subs.get(guid); if (t) clearInterval(t); subs.delete(guid); },
  };
}

/** Blend two #rrggbb colours: `share` of `a` over `b`. Anything else comes back as `b`. */
function mix(a: string, b: string, share: number): string {
  const p = (h: string) => (/^#([0-9a-f]{6})$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
  const x = p(a), y = p(b);
  if (!x || !y) return b;
  return "#" + x.map((v, i) => Math.round(v * share + y[i] * (1 - share)).toString(16).padStart(2, "0")).join("");
}
const rgba = (hex: string, alpha: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/** The app's colour tokens, read from the element so light and dark both match. */
function tokens(el: HTMLElement) {
  const s = getComputedStyle(el);
  const v = (n: string, f: string) => s.getPropertyValue(n).trim() || f;
  return { panel: v("--panel", "#fbfcff"), line: v("--line", "#eceef2"), text: v("--text", "#0f1729"), muted: v("--muted", "#6a7280"), green: v("--green", "#1aa866"), red: v("--red", "#e8526a"), blue: v("--blue", "#1f5fe0") };
}

export function TvChart({ symbols, symbol, interval = "1D", height = "100%" }: { symbols: TvSymbol[]; symbol: string; interval?: string; height?: number | string }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<any>(null);
  const [dark, setDark] = useState(false);

  // Follow the app's light or dark theme.
  useEffect(() => {
    const root = box.current?.closest(".bx");
    const read = () => setDark(root?.getAttribute("data-theme") === "dark");
    read();
    if (!root) return;
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    let disposed = false;
    if (!el) return;
    void loadTradingView().then((TV) => {
      if (!TV || disposed) return;
      const t = tokens(el);
      const w = new TV.widget({
        container: el,
        library_path: "/charting_library/",
        datafeed: datafeed(symbols),
        symbol,
        interval,
        locale: "en",
        timezone: "Etc/UTC",
        autosize: true,
        theme: dark ? "dark" : "light",
        loading_screen: { backgroundColor: t.panel, foregroundColor: t.blue },
        disabled_features: ["header_compare", "symbol_search_hot_key", "popup_hints", "header_saveload", "use_localstorage_for_settings"],
        // Drawing tools open on wide screens; on a phone they stay one tap away.
        enabled_features: el.clientWidth < 600 ? ["hide_left_toolbar_by_default"] : [],
        overrides: {
          // The BlockFinaX background: a faint blue at the top fading into the panel colour.
          "paneProperties.backgroundType": "gradient",
          "paneProperties.backgroundGradientStartColor": mix(t.blue, t.panel, dark ? 0.06 : 0.04),
          "paneProperties.backgroundGradientEndColor": t.panel,
          "paneProperties.vertGridProperties.color": t.line,
          "paneProperties.horzGridProperties.color": t.line,
          "scalesProperties.textColor": t.muted,
          "mainSeriesProperties.candleStyle.upColor": t.green,
          "mainSeriesProperties.candleStyle.downColor": t.red,
          "mainSeriesProperties.candleStyle.borderUpColor": t.green,
          "mainSeriesProperties.candleStyle.borderDownColor": t.red,
          "mainSeriesProperties.candleStyle.wickUpColor": t.green,
          "mainSeriesProperties.candleStyle.wickDownColor": t.red,
        },
      });
      widget.current = w;
      // The BlockFinaX watermark behind the candles, with the market's name under it.
      w.onChartReady(() => {
        try {
          const wm = w.watermark();
          wm.color().setValue(rgba(t.blue, dark ? 0.09 : 0.07));
          wm.setContentProvider((data: { symbolInfo?: { description?: string } }) => [
            { text: "BlockFinaX", fontSize: el.clientWidth < 600 ? 48 : 84, lineHeight: el.clientWidth < 600 ? 56 : 96, vertOffset: 0 },
            { text: data.symbolInfo?.description ?? "", fontSize: el.clientWidth < 600 ? 13 : 16, lineHeight: 22, vertOffset: 0 },
          ]);
          wm.visibility().setValue(true);
          wm.customVisibility().setValue(true);
        } catch { /* an older library without the watermark API: the chart still works */ }
      });
    });
    return () => { disposed = true; try { widget.current?.remove(); } catch { /* already gone */ } widget.current = null; };
    // The widget is rebuilt when the market list or theme changes; symbol changes go through setSymbol below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, symbols.map((s) => s.name).join(",")]);

  // Switching market keeps the same chart (and the reviewer's drawings settings).
  useEffect(() => {
    const w = widget.current;
    if (!w) return;
    try { w.onChartReady(() => w.activeChart().setSymbol(symbol)); } catch { /* not ready yet: the next build uses it */ }
  }, [symbol]);

  return <div ref={box} className="px-tv" style={{ width: "100%", height }} />;
}
