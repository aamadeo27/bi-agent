import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "src/**/*.security.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
