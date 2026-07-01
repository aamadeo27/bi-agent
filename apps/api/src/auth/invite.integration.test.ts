/**
 * Integration tests for invite routes — exercises the full Express middleware
 * chain (auth, tenant-scope) via Supertest against the real app instance.
 *
 * DB calls and invite-service logic are mocked so tests run without Postgres.
 * Covers: auth enforcement, admin guard, validation, password accept, SSO accept,
 * and duplicate-email rejection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { SignJWT } from "jose";

// ── Mocks (hoisted before any module import that touches these paths) ─────────

vi.mock("../db/client.js", () => ({
  getPrisma: vi.fn(),
}));

// Fail-open: authMiddleware catches withTenant errors and continues.
vi.mock("../db/with-tenant.js", () => ({
  withTenant: vi.fn().mockResolvedValue([{ token_invalidated_at: null }]),
}));

vi.mock("./invite-service.js", () => ({
  createInvite: vi.fn(),
  acceptInvite: vi.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { app } from "../index.js";
import * as inviteService from "./invite-service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-secret-at-least-32-bytes!!";
const SECRET_KEY = new TextEncoder().encode(TEST_SECRET);

async function signToken(
  claims: Record<string, unknown>,
  expiresIn = "15m"
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(claims["sub"]))
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(SECRET_KEY);
}

const ADMIN_CLAIMS = { sub: "admin-1", tenantId: "tenant01", roleId: "role-admin" };
const NO_ROLE_CLAIMS = { sub: "user-1", tenantId: "tenant01", roleId: null };

const FAKE_AUTH_TOKENS = {
  accessToken: "fake-access-tok",
  refreshRaw: "fake-refresh-raw",
  refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  userId: "new-user-id",
  tenantId: "tenant01",
  roleId: null,
};

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", TEST_SECRET);
  vi.mocked(inviteService.createInvite).mockResolvedValue({ userId: "new-user-id" });
  vi.mocked(inviteService.acceptInvite).mockResolvedValue(FAKE_AUTH_TOKENS);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

// ── POST /api/admin/users/invite ──────────────────────────────────────────────

describe("integration: POST /api/admin/users/invite", () => {
  it("returns 401 AUTH when no Authorization header is present", async () => {
    const res = await request(app)
      .post("/api/admin/users/invite")
      .send({ email: "x@x.com", displayName: "X" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 401 AUTH when token is expired", async () => {
    const token = await signToken(ADMIN_CLAIMS, "-1m");
    const res = await request(app)
      .post("/api/admin/users/invite")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "x@x.com", displayName: "X" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 403 AUTH when caller has no role (admin guard)", async () => {
    const token = await signToken(NO_ROLE_CLAIMS);
    const res = await request(app)
      .post("/api/admin/users/invite")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "new@example.com", displayName: "New" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 400 VALIDATION when body is missing required fields", async () => {
    const token = await signToken(ADMIN_CLAIMS);
    const res = await request(app)
      .post("/api/admin/users/invite")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 201 with userId on valid invite", async () => {
    const token = await signToken(ADMIN_CLAIMS);
    const res = await request(app)
      .post("/api/admin/users/invite")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "new@example.com", displayName: "New User" });

    expect(res.status).toBe(201);
    expect(res.body.userId).toBe("new-user-id");
    expect(inviteService.createInvite).toHaveBeenCalledOnce();
  });

  it("returns 400 VALIDATION when email already exists (duplicate)", async () => {
    vi.mocked(inviteService.createInvite).mockRejectedValue(
      Object.assign(new Error("email taken"), { code: "VALIDATION" })
    );
    const token = await signToken(ADMIN_CLAIMS);
    const res = await request(app)
      .post("/api/admin/users/invite")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "existing@example.com", displayName: "Dup" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("tenant-scope middleware blocks requests with a foreign tenantId in body", async () => {
    const token = await signToken(ADMIN_CLAIMS); // tenantId = "tenant01"
    const res = await request(app)
      .post("/api/admin/users/invite")
      .set("Authorization", `Bearer ${token}`)
      // tenantId in body differs from JWT tenant → 403 TENANT
      .send({ email: "x@x.com", displayName: "X", tenantId: "other-tenant" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT");
  });
});

// ── POST /api/auth/invite/accept ──────────────────────────────────────────────

describe("integration: POST /api/auth/invite/accept", () => {
  it("returns 400 VALIDATION when body is missing token", async () => {
    const res = await request(app)
      .post("/api/auth/invite/accept")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });

  it("returns 401 AUTH when invite token is invalid or expired", async () => {
    vi.mocked(inviteService.acceptInvite).mockRejectedValue(
      Object.assign(new Error("invalid token"), { code: "AUTH" })
    );
    const res = await request(app)
      .post("/api/auth/invite/accept")
      .send({ token: "bad-token", password: "Pass123!!" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH");
  });

  it("returns 200 with accessToken and sets refresh cookie on valid password accept", async () => {
    const res = await request(app)
      .post("/api/auth/invite/accept")
      .send({ token: "valid-token", password: "Pass123!!" });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe("fake-access-tok");
    // Refresh token must be set as an httpOnly cookie.
    expect(res.headers["set-cookie"]).toBeDefined();
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
  });

  it("returns 200 with accessToken on valid SSO accept (no password)", async () => {
    const res = await request(app)
      .post("/api/auth/invite/accept")
      .send({ token: "valid-token", ssoSubject: "oidc|sub-9999" });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe("fake-access-tok");
    const [callArgs] = vi.mocked(inviteService.acceptInvite).mock.calls[0]!;
    expect(callArgs).toMatchObject({ token: "valid-token", ssoSubject: "oidc|sub-9999" });
  });

  it("returns 400 VALIDATION when service throws VALIDATION (missing credential)", async () => {
    vi.mocked(inviteService.acceptInvite).mockRejectedValue(
      Object.assign(new Error("credential required"), { code: "VALIDATION" })
    );
    const res = await request(app)
      .post("/api/auth/invite/accept")
      .send({ token: "valid-token" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION");
  });
});
