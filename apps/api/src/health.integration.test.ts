import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "./index.js";

/**
 * Integration smoke test — boots the Express app in-process and
 * asserts the /health endpoint contract via Supertest (real HTTP
 * handler chain; no mocks).
 *
 * No database is touched here; the health endpoint is intentionally
 * stateless in the bootstrap scaffold (DB ping is deferred to T1.2).
 */
describe("integration: GET /health", () => {
  it("returns 200 with {status:'ok'}", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
