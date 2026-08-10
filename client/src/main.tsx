import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// ── Mobile devtools (eruda) — opt-in ──────────────────────────────────────
// On-screen console + network + elements inspector for browsers where
// opening real DevTools is hard (mostly phones). Zero cost for regular
// users — dynamically imported and only when explicitly triggered.
//
// How to turn it on:
//   1. Append `?eruda=1` to any Blockfinax URL, OR
//   2. In the browser console:  localStorage.setItem('bfx_eruda', '1')
//      then reload.
//
// How to turn it off:
//   - Remove the query param and clear the localStorage key, then reload.
//     Or `localStorage.removeItem('bfx_eruda')`.
//
// The URL param sets localStorage so the flag survives navigation across
// SPA routes. Otherwise a single tap on a link would drop the console.
{
  const params = new URLSearchParams(window.location.search);
  const paramFlag = params.get("eruda");
  if (paramFlag === "1" || paramFlag === "true") {
    try {
      localStorage.setItem("bfx_eruda", "1");
    } catch {
      /* private mode — session-scoped instead */
    }
  } else if (paramFlag === "0" || paramFlag === "false") {
    try {
      localStorage.removeItem("bfx_eruda");
    } catch {
      /* ignore */
    }
  }
  let enabled = false;
  try {
    enabled = localStorage.getItem("bfx_eruda") === "1";
  } catch {
    enabled = paramFlag === "1" || paramFlag === "true";
  }
  if (enabled) {
    // Dynamic import so the ~150KB eruda bundle only ships to users who
    // ask for it. Vite splits this into its own chunk.
    void import("eruda").then(({ default: eruda }) => {
      eruda.init();
      // eslint-disable-next-line no-console
      console.info("[eruda] enabled — tap the corner button to open");
    });
  }
}

createRoot(document.getElementById("root")!).render(<App />);
