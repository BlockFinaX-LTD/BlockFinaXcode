import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV || "development",
    ),
  },
  server: {
    proxy: { "/api": process.env.API_PROXY_URL || "http://127.0.0.1:4100" },
  },
  build: { outDir: "dist", commonjsOptions: { transformMixedEsModules: true } },
});
