import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@fineprint/core": fileURLToPath(new URL("../core/src/types.ts", import.meta.url)),
    },
  },
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    include: ["test/**/*.test.ts"],
  },
});
