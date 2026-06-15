import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e configuration for apps/web.
 *
 * webServer: builds with `vite build` then serves via `vite preview`
 * on port 4173 (Vite's default preview port). This avoids needing a
 * running API for the scaffold smoke tests; the SPA is fully static at
 * this stage.
 *
 * Browser binaries must be installed via `npx playwright install chromium`
 * before running locally or in CI. The post-merge CI job handles this.
 *
 * test:e2e is NOT a PR gate (see bootstrap-plan.md §3 and turbo.json).
 * The turbo task exists so the post-merge push job can invoke it.
 */
export default defineConfig({
  testDir: "./e2e",
  /* Run each test file in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in source */
  forbidOnly: !!process.env["CI"],
  /* No retries in local dev; 1 retry on CI for transient flakes */
  retries: process.env["CI"] ? 1 : 0,
  /* Reporter: list in CI for clean log lines; html locally for interactive report */
  reporter: process.env["CI"] ? "list" : "html",
  use: {
    /* Base URL matched to vite preview default port */
    baseURL: "http://localhost:4173",
    /* Capture trace on first retry only */
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  /* Start the Vite preview server before running tests */
  webServer: {
    command: "pnpm preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env["CI"],
    /* vite preview starts fast — 10s is generous */
    timeout: 10_000,
  },
});
