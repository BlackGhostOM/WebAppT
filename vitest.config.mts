import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts", "lib/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

