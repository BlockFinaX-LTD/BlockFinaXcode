import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "**/*.d.ts"],
    },
    // E2E tests spin up real HTTP — give them headroom
    testTimeout: 15_000,
    // Run unit + integration in parallel; the E2E test serializes itself
    pool: "forks",
  },
});
