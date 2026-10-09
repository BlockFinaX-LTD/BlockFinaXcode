import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 180000,
  use: { baseURL: "http://localhost:5178", headless: true },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5178",
    url: "http://localhost:5178",
    reuseExistingServer: false,
    env: { API_PROXY_URL: "http://127.0.0.1:4180" },
    timeout: 30000,
  },
});
