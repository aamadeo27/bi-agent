import { test, expect } from "@playwright/test";

/**
 * E2E smoke test — verifies the app loads in a real browser and the
 * root page renders the expected heading text.
 *
 * This is the framework-verification smoke test only. Feature e2e
 * tests will be added per-Task as screens are implemented.
 */
test("home page renders BI Result Presenter heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "BI Result Presenter" })).toBeVisible();
});
