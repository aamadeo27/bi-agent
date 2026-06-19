import { defineConfig } from "vitest/config";
import { sharedResolve } from "./vitest.base.config.js";

export default defineConfig({
  resolve: sharedResolve,
  test: {
    include: ["src/**/*.security.test.ts"],
    environment: "node",
    passWithNoTests: true,
    testTimeout: 30000,
  },
});
