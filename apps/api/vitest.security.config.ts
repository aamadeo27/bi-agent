import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve @bi/contracts from TypeScript source — dist/ is not committed.
      "@bi/contracts": resolve(__dirname, "../../packages/contracts/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.security.test.ts"],
    environment: "node",
    passWithNoTests: true,
    testTimeout: 30000,
  },
});
