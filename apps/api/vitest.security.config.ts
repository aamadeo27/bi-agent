import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.security.test.ts"],
    environment: "node",
    passWithNoTests: true,
    testTimeout: 30000,
  },
});
