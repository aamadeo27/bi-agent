import { defineConfig } from "vitest/config";
import { sharedResolve } from "./vitest.base.config.js";

export default defineConfig({
  resolve: sharedResolve,
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts", "src/**/*.security.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
