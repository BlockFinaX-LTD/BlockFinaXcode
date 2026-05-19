import { FxLossScene } from "./blog-scenes/fx-loss-scene";
import { BankWallScene } from "./blog-scenes/bank-wall-scene";
import { InsuranceFlowScene } from "./blog-scenes/insurance-flow-scene";

function parseParams(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function num(p: Record<string, string>, key: string, fallback = 0): number {
  const v = p[key];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(p: Record<string, string>, key: string, fallback = ""): string {
  return p[key] ?? fallback;
}

function listParams(body: string): Array<{ title: string; detail: string }> {
  const items: Array<{ title: string; detail: string }> = [];
  let current: { title: string; detail: string } | null = null;
  for (const line of body.split(/\r?\n/)) {
    const itemMatch = line.match(/^\s*-\s+(.+)$/);
    if (itemMatch) {
      if (current) items.push(current);
      current = { title: itemMatch[1].trim(), detail: "" };
      continue;
    }
    const detailMatch = line.match(/^\s{2,}(.+)$/);
    if (detailMatch && current) {
      current.detail = (current.detail ? current.detail + " " : "") + detailMatch[1].trim();
    }
  }
  if (current) items.push(current);
  return items;
}

export function BlogScene({ body }: { body: string }) {
  const params = parseParams(body);
  const type = params.type;

  if (type === "fx-loss") {
    return (
      <FxLossScene
        invoice={num(params, "invoice", 50000)}
        fromCurrency={str(params, "fromCurrency", "USD")}
        toCurrency={str(params, "toCurrency", "GHS")}
        fromSymbol={str(params, "fromSymbol", "$")}
        toSymbol={str(params, "toSymbol", "₵")}
        startRate={num(params, "startRate", 14.5)}
        endRate={num(params, "endRate", 15.8)}
        days={num(params, "days", 60)}
        marginStart={num(params, "marginStart", 18)}
        marginEnd={num(params, "marginEnd", 9)}
      />
    );
  }

  if (type === "bank-wall") {
    const barriersIdx = body.indexOf("barriers:");
    const barriers = barriersIdx >= 0 ? listParams(body.slice(barriersIdx + "barriers:".length)) : [];
    return <BankWallScene barriers={barriers} />;
  }

  if (type === "insurance-flow") {
    return (
      <InsuranceFlowScene
        premium={num(params, "premium", 750)}
        protected={num(params, "protected", 50000)}
        days={num(params, "days", 60)}
        payout={num(params, "payout", 3250)}
        currencySymbol={str(params, "currencySymbol", "$")}
      />
    );
  }

  return (
    <div className="my-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
      Unknown scene type: <code>{type || "(missing)"}</code>
    </div>
  );
}
