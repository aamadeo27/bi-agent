import { describe, it, expect } from "vitest";
import { app } from "./index.js";

/**
 * Unit test — verifies the /health route is registered on the Express app
 * without making an HTTP call. True unit scope: no network, no Supertest.
 *
 * Tier distinction vs health.integration.test.ts:
 *   - THIS file: route registration check only (pure in-process, no I/O)
 *   - health.integration.test.ts: end-to-end HTTP call via Supertest confirming
 *     the full handler chain (middleware, JSON serialization, status code)
 */
describe("health route — unit (route registration)", () => {
  it("registers GET /health on the Express router stack", () => {
    // Express stores the layer stack on app._router after the first route is added.
    // We access it via the internal property to confirm registration without I/O.
    type ExpressLayer = { route?: { path: string; methods: Record<string, boolean> } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const router = (app as any)._router as { stack: ExpressLayer[] } | undefined;
    expect(router).toBeDefined();

    const routes = (router?.stack ?? [])
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route!.path,
        method: Object.keys(layer.route!.methods)[0],
      }));

    expect(routes).toContainEqual({ path: "/health", method: "get" });
  });
});
