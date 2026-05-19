import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let mermaidInit = false;
function ensureMermaidInit() {
  if (mermaidInit) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "strict",
    fontFamily: "Inter, system-ui, sans-serif",
    themeVariables: {
      primaryColor: "#eaf1fb",
      primaryTextColor: "#1a4480",
      primaryBorderColor: "#1a4480",
      lineColor: "#4a90e2",
      secondaryColor: "#f3f6fc",
      tertiaryColor: "#ffffff",
    },
  });
  mermaidInit = true;
}

let idCounter = 0;

export function MermaidBlock({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureMermaidInit();
    const id = `mermaid-${++idCounter}-${Date.now()}`;
    (async () => {
      try {
        const { svg } = await mermaid.render(id, code);
        if (cancelled) return;
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "Failed to render diagram");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="my-6 p-4 bg-red-50 border border-red-200 rounded-xl">
        <p className="text-sm font-medium text-red-700 mb-2">Mermaid render error</p>
        <pre className="text-xs text-red-600 whitespace-pre-wrap font-mono">{error}</pre>
        <pre className="text-xs text-gray-500 whitespace-pre-wrap font-mono mt-2 pt-2 border-t border-red-200">{code}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-6 p-4 bg-gray-50 border border-gray-100 rounded-xl flex justify-center overflow-x-auto"
    />
  );
}
