import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { SignJWT } from "jose";
import { authMiddleware, type AuthContext } from "./auth.js";

const TEST_SECRET = "test-secret-at-least-32-bytes!!";
const SECRET_KEY = new TextEncoder().encode(TEST_SECRET);

async function signToken(
  claims: Record<string, unknown>,
  key: Uint8Array = SECRET_KEY,
  expiresIn = "15m"
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(claims["sub"]))
    .setExpirationTime(expiresIn)
    .sign(key);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get("/protected", authMiddleware, (req, res) => {
    res.json(req.auth ?? null);
  });
  return app;
}

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
    const res = await request(buildApp())
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
    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.roleId).toBeNull();
  });
});

describe("authMiddleware — missing / malformed header", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
  });

  it("returns 401 AUTH when Authorization header is absent", async () => {
    const res = await request(buildApp()).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 401 AUTH when Authorization scheme is not Bearer", async () => {
    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", "Basic dXNlcjpwYXNz");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 401 AUTH for a completely garbage token string", async () => {
    const res = await request(buildApp())
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
