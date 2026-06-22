/**
 * Supertest integration tests for SSO route handlers (T2.3).
 *
 * Covers: auth + tenant scope + route behaviour per conventions/testing.md.
 *
 * The OIDC client (openid-client) and Prisma client are mocked so no real IdP
 * or DB is needed — consistent with the project's Supertest test pattern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { authRouter } from "./router.js";
import { signSsoState } from "./sso-service.js";

// ── Hoist mock handles ────────────────────────────────────────────────────────

const { mockCallback, mockDiscover, mockGetPrisma } = vi.hoisted(() => {
  const mockCallback = vi.fn();
  const mockAuthorizationUrl = vi
    .fn()
    .mockReturnValue("https://idp.example.com/authorize?response_type=code");
  const MockClientConstructor = vi.fn(() => ({
    authorizationUrl: mockAuthorizationUrl,
    callback: mockCallback,
  }));
  const mockDiscover = vi
    .fn()
    .mockResolvedValue({ Client: MockClientConstructor });
  const mockGetPrisma = vi.fn();
  return { mockCallback, mockDiscover, mockGetPrisma };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("openid-client", () => ({
  Issuer: { discover: mockDiscover },
  generators: {
    codeVerifier: () => "rt-verifier",
    codeChallenge: () => "rt-challenge",
    state: () => "rt-oidc-state",
    nonce: () => "rt-nonce",
  },
}));

vi.mock("../db/client.js", () => ({
  getPrisma: mockGetPrisma,
}));

vi.mock("./token-service.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./token-service.js")>();
  return {
    ...real,
    createRefreshToken: vi.fn().mockResolvedValue({
      raw: "raw-refresh-token",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-secret-at-least-32-bytes!!";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRouter);
  return app;
}

const TENANT_ROW = {
  id: "tenant-1",
  slug: "acme",
  displayName: "Acme",
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SSO_CONFIG_ROW = {
  id: "cfg-1",
  tenantId: "tenant-1",
  issuer: "https://idp.example.com",
  clientId: "client-id",
  clientSecret: "client-secret",
  callbackUrl: "https://app.example.com/api/auth/sso/acme/callback",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ACTIVE_USER = {
  id: "user-1",
  email: "alice@acme.com",
  passwordHash: "$argon2id$hash",
  displayName: "Alice",
  status: "active",
  tenantId: "tenant-1",
  roleId: "role-viewer",
  ssoSubject: "idp-sub-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeDb(userRow: typeof ACTIVE_USER | null = ACTIVE_USER) {
  return {
    tenant: { findUnique: vi.fn().mockResolvedValue(TENANT_ROW) },
    tenantSsoConfig: { findUnique: vi.fn().mockResolvedValue(SSO_CONFIG_ROW) },
    user: {
      findUnique: vi.fn().mockResolvedValue(userRow),
      update: vi.fn().mockResolvedValue(userRow),
    },
  };
}

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", TEST_SECRET);
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

// ── GET /api/auth/sso/:tenant/start ──────────────────────────────────────────

describe("GET /api/auth/sso/:tenant/start", () => {
  it("redirects 302 to the IdP authorization URL", async () => {
    mockGetPrisma.mockReturnValue(makeDb());
    const app = buildApp();

    const res = await request(app)
      .get("/api/auth/sso/acme/start")
      .redirects(0); // don't follow redirect

    expect(res.status).toBe(302);
    expect(res.headers["location"]).toContain("idp.example.com/authorize");
  });

  it("sets an httpOnly sso_state cookie on redirect", async () => {
    mockGetPrisma.mockReturnValue(makeDb());
    const app = buildApp();

    const res = await request(app)
      .get("/api/auth/sso/acme/start")
      .redirects(0);

    const rawCookies = res.headers["set-cookie"];
    const cookieArr = rawCookies
      ? Array.isArray(rawCookies) ? rawCookies : [rawCookies]
      : [];
    const stateCookie = cookieArr.find((c) => c.startsWith("sso_state="));
    expect(stateCookie).toBeTruthy();
    expect(stateCookie).toContain("HttpOnly");
  });

  it("returns 404 when tenant not found", async () => {
    const db = makeDb();
    vi.mocked(db.tenant.findUnique).mockResolvedValue(null);
    mockGetPrisma.mockReturnValue(db);
    const app = buildApp();

    const res = await request(app).get("/api/auth/sso/unknown/start");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns 404 when tenant has no SSO config", async () => {
    const db = makeDb();
    vi.mocked(db.tenantSsoConfig.findUnique).mockResolvedValue(null);
    mockGetPrisma.mockReturnValue(db);
    const app = buildApp();

    const res = await request(app).get("/api/auth/sso/acme/start");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "NOT_FOUND" });
  });
});

// ── GET /api/auth/sso/:tenant/callback ───────────────────────────────────────

describe("GET /api/auth/sso/:tenant/callback", () => {
  it("returns 200 with accessToken and sets refresh cookie for a known user", async () => {
    mockGetPrisma.mockReturnValue(makeDb());
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "idp-sub-1", email: "alice@acme.com" }),
    });

    const stateCookie = await signSsoState({
      oidcState: "rt-oidc-state",
      nonce: "rt-nonce",
      codeVerifier: "rt-verifier",
      tenantSlug: "acme",
    });

    const app = buildApp();
    const res = await request(app)
      .get("/api/auth/sso/acme/callback")
      .query({ code: "auth-code", state: "rt-oidc-state" })
      .set("Cookie", `sso_state=${stateCookie}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
    expect(typeof res.body.accessToken).toBe("string");

    const rawCookies = res.headers["set-cookie"];
    const cookieArr = rawCookies
      ? Array.isArray(rawCookies) ? rawCookies : [rawCookies]
      : [];
    expect(cookieArr.some((c) => c.startsWith("refresh_token="))).toBe(true);
  });

  it("returns 401 when OIDC subject not linked to any tenant user", async () => {
    const db = makeDb(null); // no user
    mockGetPrisma.mockReturnValue(db);
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "unknown-sub", email: "nobody@external.com" }),
    });

    const stateCookie = await signSsoState({
      oidcState: "rt-oidc-state",
      nonce: "rt-nonce",
      codeVerifier: "rt-verifier",
      tenantSlug: "acme",
    });

    const app = buildApp();
    const res = await request(app)
      .get("/api/auth/sso/acme/callback")
      .query({ code: "auth-code", state: "rt-oidc-state" })
      .set("Cookie", `sso_state=${stateCookie}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: "AUTH" });
  });

  it("returns 400 when code parameter is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/auth/sso/acme/callback")
      .query({ state: "rt-oidc-state" }); // no code

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION" });
  });

  it("returns 400 when SSO state cookie is absent", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/auth/sso/acme/callback")
      .query({ code: "auth-code", state: "rt-oidc-state" });
    // No cookie set.

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION" });
  });

  it("returns 401 when tenant in URL does not match SSO state cookie", async () => {
    mockGetPrisma.mockReturnValue(makeDb());
    // State cookie says tenantSlug=other-tenant but URL says :tenant=acme.
    const stateCookie = await signSsoState({
      oidcState: "rt-oidc-state",
      nonce: "rt-nonce",
      codeVerifier: "rt-verifier",
      tenantSlug: "other-tenant",
    });

    const app = buildApp();
    const res = await request(app)
      .get("/api/auth/sso/acme/callback")
      .query({ code: "auth-code", state: "rt-oidc-state" })
      .set("Cookie", `sso_state=${stateCookie}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: "AUTH" });
  });

  it("returns 401 when SSO state cookie is tampered", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/auth/sso/acme/callback")
      .query({ code: "auth-code", state: "some-state" })
      .set("Cookie", "sso_state=tampered.jwt.value");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: "AUTH" });
  });
});
