import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { authMiddleware, type AuthContext } from "./auth.js";
import { TEST_SECRET, signToken, buildAuthApp } from "./test-helpers.js";
import { withTenant } from "../db/with-tenant.js";

vi.mock("../db/with-tenant.js", () => ({ withTenant: vi.fn() }));

// Default before every test: DB reports no session invalidation.
// Tests that need a different value use mockImplementationOnce.
beforeEach(() => {
  vi.mocked(withTenant).mockImplementation(
    ((_tenantId: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ token_invalidated_at: null }]),
      })) as unknown as typeof withTenant,
  );
});

describe("authMiddleware — happy path", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
  });

  it("populates req.auth with userId, tenantId, roleId from a valid token", async () => {
    const token = await signToken({
      sub: "user1",
      tenantId: "tenant1",
      roleId: "role1",
    });
    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const auth = res.body as AuthContext;
    expect(auth.userId).toBe("user1");
    expect(auth.tenantId).toBe("tenant1");
    expect(auth.roleId).toBe("role1");
  });

  it("accepts null roleId (platform admin with no tenant role)", async () => {
    const token = await signToken({
      sub: "user2",
      tenantId: "tenant1",
      roleId: null,
    });
    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.roleId).toBeNull();
  });
});

describe("authMiddleware — session invalidation", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
    // module-level beforeEach already sets withTenant to return token_invalidated_at: null
  });

  it("returns 401 AUTH when token_invalidated_at is set and token has no iat", async () => {
    // Token without iat (no .setIssuedAt()) — treated as issued before any logout-all
    vi.mocked(withTenant).mockImplementationOnce(
      ((_: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          $queryRawUnsafe: vi.fn().mockResolvedValue([
            { token_invalidated_at: new Date("2099-01-01T00:00:00Z") },
          ]),
        })) as unknown as typeof withTenant,
    );

    const token = await signToken({ sub: "user1", tenantId: "tenant1", roleId: null });
    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("allows the request when token_invalidated_at is null (no logout-all)", async () => {
    const token = await signToken({ sub: "user1", tenantId: "tenant1", roleId: null });
    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it("allows the request (fail-open) when the DB check throws", async () => {
    vi.mocked(withTenant).mockImplementationOnce(
      (() => { throw new Error("DB connection lost"); }) as unknown as typeof withTenant,
    );

    const token = await signToken({ sub: "user1", tenantId: "tenant1", roleId: null });
    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});

describe("authMiddleware — missing / malformed header", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
  });

  it("returns 401 AUTH when Authorization header is absent", async () => {
    const res = await request(buildAuthApp()).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 401 AUTH when Authorization scheme is not Bearer", async () => {
    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", "Basic dXNlcjpwYXNz");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 401 AUTH for a completely garbage token string", async () => {
    const res = await request(buildAuthApp())
      .get("/protected")
      .set("Authorization", "Bearer not.a.valid.jwt");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("does not call next() when token is invalid (no partial auth context)", async () => {
    const captured: unknown[] = [];
    const app = express();
    app.use(express.json());
    app.get("/protected", authMiddleware, (req, res) => {
      captured.push(req.auth);
      res.json(null);
    });

    await request(app)
      .get("/protected")
      .set("Authorization", "Bearer garbage");

    expect(captured).toHaveLength(0);
  });
});
