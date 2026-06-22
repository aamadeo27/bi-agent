/**
 * Unit tests for T2.3 SSO / OIDC service.
 *
 * Uses vi.hoisted() to create mock handles accessible inside vi.mock() factories
 * (required because vi.mock() is hoisted before module-scope declarations).
 *
 * Tests cover:
 *   - Successful callback: known invited/active user → tokens issued, invited activated.
 *   - Unknown subject (email not in tenant): rejected with AUTH.
 *   - Suspended user: rejected with AUTH.
 *   - Missing email claim: rejected with AUTH.
 *   - State mismatch: rejected with AUTH.
 *   - SSO state cookie: sign → verify round-trip, tamper detection.
 *   - loadSsoConfig: tenant not found, SSO not configured.
 *   - buildSsoStartUrl: returns auth URL + signed state cookie.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoist mock handles so they're accessible inside vi.mock() factories ────────

const { mockCallback, mockDiscover } = vi.hoisted(() => {
  const mockCallback = vi.fn();
  const mockAuthorizationUrl = vi
    .fn()
    .mockReturnValue(
      "https://idp.example.com/authorize?client_id=test&response_type=code"
    );
  const MockClientConstructor = vi.fn(() => ({
    authorizationUrl: mockAuthorizationUrl,
    callback: mockCallback,
  }));
  const mockDiscover = vi
    .fn()
    .mockResolvedValue({ Client: MockClientConstructor });
  return { mockCallback, mockDiscover };
});

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("openid-client", () => ({
  Issuer: { discover: mockDiscover },
  generators: {
    codeVerifier: () => "mock-verifier",
    codeChallenge: () => "mock-challenge",
    state: () => "mock-oidc-state",
    nonce: () => "mock-nonce",
  },
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

import {
  handleSsoCallback,
  loadSsoConfig,
  buildSsoStartUrl,
  signSsoState,
  verifySsoState,
} from "./sso-service.js";
import type { SsoStatePayload, ResolvedSsoConfig } from "./sso-service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-secret-at-least-32-bytes!!";

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    tenant: { findUnique: vi.fn() },
    tenantSsoConfig: { findUnique: vi.fn() },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    ...overrides,
  } as unknown as import("@prisma/client").PrismaClient;
}

const ACTIVE_USER = {
  id: "user-1",
  email: "alice@tenant-a.com",
  passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$hash",
  displayName: "Alice",
  status: "active" as const,
  tenantId: "tenant-1",
  roleId: "role-viewer",
  createdAt: new Date(),
  updatedAt: new Date(),
  refreshTokens: [],
};

const INVITED_USER = { ...ACTIVE_USER, status: "invited" as const };
const SUSPENDED_USER = { ...ACTIVE_USER, status: "suspended" as const };

const SSO_CONFIG: ResolvedSsoConfig = {
  tenantId: "tenant-1",
  issuer: "https://idp.example.com",
  clientId: "client-id",
  clientSecret: "client-secret",
  callbackUrl: "https://app.example.com/api/auth/sso/acme/callback",
};

const SSO_STATE: SsoStatePayload = {
  oidcState: "mock-oidc-state",
  nonce: "mock-nonce",
  codeVerifier: "mock-verifier",
  tenantSlug: "acme",
};

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", TEST_SECRET);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

// ── SSO state cookie ──────────────────────────────────────────────────────────

describe("signSsoState / verifySsoState", () => {
  it("round-trips the state payload through sign and verify", async () => {
    const token = await signSsoState(SSO_STATE);
    const result = await verifySsoState(token);
    expect(result).toEqual(SSO_STATE);
  });

  it("throws AUTH on a tampered state token", async () => {
    await expect(verifySsoState("tampered.token.value")).rejects.toMatchObject({
      code: "AUTH",
    });
  });

  it("throws AUTH on an empty string", async () => {
    await expect(verifySsoState("")).rejects.toMatchObject({ code: "AUTH" });
  });
});

// ── loadSsoConfig ─────────────────────────────────────────────────────────────

describe("loadSsoConfig", () => {
  it("throws NOT_FOUND when tenant slug is unknown", async () => {
    const db = makeDb();
    vi.mocked(db.tenant.findUnique).mockResolvedValue(null);

    await expect(loadSsoConfig("unknown", db)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws NOT_FOUND when tenant has no SSO config", async () => {
    const db = makeDb();
    vi.mocked(db.tenant.findUnique).mockResolvedValue({
      id: "tenant-1",
      slug: "acme",
      displayName: "Acme",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(db.tenantSsoConfig.findUnique).mockResolvedValue(null);

    await expect(loadSsoConfig("acme", db)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns resolved config when tenant and SSO config exist", async () => {
    const db = makeDb();
    vi.mocked(db.tenant.findUnique).mockResolvedValue({
      id: "tenant-1",
      slug: "acme",
      displayName: "Acme",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(db.tenantSsoConfig.findUnique).mockResolvedValue({
      id: "cfg-1",
      tenantId: "tenant-1",
      issuer: "https://idp.example.com",
      clientId: "client-id",
      clientSecret: "client-secret",
      callbackUrl: "https://app.example.com/api/auth/sso/acme/callback",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const config = await loadSsoConfig("acme", db);
    expect(config.tenantId).toBe("tenant-1");
    expect(config.issuer).toBe("https://idp.example.com");
    expect(config.clientId).toBe("client-id");
  });
});

// ── buildSsoStartUrl ──────────────────────────────────────────────────────────

describe("buildSsoStartUrl", () => {
  it("calls Issuer.discover with the config issuer", async () => {
    await buildSsoStartUrl(SSO_CONFIG, "acme");
    expect(mockDiscover).toHaveBeenCalledWith(SSO_CONFIG.issuer);
  });

  it("returns an authUrl and a signed stateCookie", async () => {
    const { authUrl, stateCookie } = await buildSsoStartUrl(SSO_CONFIG, "acme");

    expect(authUrl).toContain("idp.example.com");
    expect(stateCookie).toBeTypeOf("string");
    expect(stateCookie.split(".")).toHaveLength(3); // JWT: header.payload.sig
  });

  it("state cookie encodes the correct tenantSlug and OIDC state", async () => {
    const { stateCookie } = await buildSsoStartUrl(SSO_CONFIG, "acme");
    const decoded = await verifySsoState(stateCookie);

    expect(decoded.tenantSlug).toBe("acme");
    expect(decoded.oidcState).toBe("mock-oidc-state");
    expect(decoded.nonce).toBe("mock-nonce");
    expect(decoded.codeVerifier).toBe("mock-verifier");
  });
});

// ── handleSsoCallback — success ───────────────────────────────────────────────

describe("handleSsoCallback — success paths", () => {
  it("issues tokens for a known active user", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue(ACTIVE_USER);
    mockCallback.mockResolvedValue({
      claims: () => ({ email: "alice@tenant-a.com", sub: "idp-sub-1" }),
    });

    const result = await handleSsoCallback(
      "auth-code",
      "mock-oidc-state",
      SSO_STATE,
      SSO_CONFIG,
      db
    );

    expect(result.accessToken).toBeTypeOf("string");
    expect(result.refreshRaw).toBe("raw-refresh-token");
    expect(result.refreshExpiresAt).toBeInstanceOf(Date);
    // user.update should NOT be called for already-active user
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("activates an invited user on first SSO login", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue(INVITED_USER);
    vi.mocked(db.user.update).mockResolvedValue({
      ...INVITED_USER,
      status: "active",
    });
    mockCallback.mockResolvedValue({
      claims: () => ({ email: "alice@tenant-a.com", sub: "idp-sub-1" }),
    });

    await handleSsoCallback(
      "auth-code",
      "mock-oidc-state",
      SSO_STATE,
      SSO_CONFIG,
      db
    );

    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INVITED_USER.id },
        data: { status: "active" },
      })
    );
  });

  it("issued access token carries {sub, tenantId, roleId}", async () => {
    const { jwtVerify } = await import("jose");
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue(ACTIVE_USER);
    mockCallback.mockResolvedValue({
      claims: () => ({ email: "alice@tenant-a.com", sub: "idp-sub-1" }),
    });

    const { accessToken } = await handleSsoCallback(
      "auth-code",
      "mock-oidc-state",
      SSO_STATE,
      SSO_CONFIG,
      db
    );

    const secretKey = new TextEncoder().encode(TEST_SECRET);
    const { payload } = await jwtVerify(accessToken, secretKey, {
      algorithms: ["HS256"],
    });

    expect(payload["sub"]).toBe(ACTIVE_USER.id);
    expect(payload["tenantId"]).toBe(ACTIVE_USER.tenantId);
    expect(payload["roleId"]).toBe(ACTIVE_USER.roleId);
  });
});

// ── handleSsoCallback — rejection ─────────────────────────────────────────────

describe("handleSsoCallback — unknown-subject rejection", () => {
  it("throws AUTH when email is not found in tenant", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    mockCallback.mockResolvedValue({
      claims: () => ({ email: "unknown@external.com", sub: "idp-sub-999" }),
    });

    await expect(
      handleSsoCallback("auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  it("throws AUTH when email belongs to a different tenant", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue({
      ...ACTIVE_USER,
      tenantId: "tenant-OTHER",
    });
    mockCallback.mockResolvedValue({
      claims: () => ({ email: "alice@tenant-a.com", sub: "idp-sub-1" }),
    });

    await expect(
      handleSsoCallback("auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  it("throws AUTH when user is suspended", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue(SUSPENDED_USER);
    mockCallback.mockResolvedValue({
      claims: () => ({ email: "alice@tenant-a.com", sub: "idp-sub-1" }),
    });

    await expect(
      handleSsoCallback("auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  it("throws AUTH when id_token is missing the email claim", async () => {
    const db = makeDb();
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "idp-sub-1" }), // no email
    });

    await expect(
      handleSsoCallback("auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });
});

// ── handleSsoCallback — state integrity ───────────────────────────────────────

describe("handleSsoCallback — state integrity", () => {
  it("throws AUTH when OIDC state param does not match cookie state", async () => {
    const db = makeDb();
    mockCallback.mockResolvedValue({
      claims: () => ({ email: "alice@tenant-a.com", sub: "idp-sub-1" }),
    });

    await expect(
      handleSsoCallback(
        "auth-code",
        "WRONG-STATE", // does not match SSO_STATE.oidcState
        SSO_STATE,
        SSO_CONFIG,
        db
      )
    ).rejects.toMatchObject({ code: "AUTH" });

    // IdP token exchange should NOT be attempted after state mismatch.
    expect(mockCallback).not.toHaveBeenCalled();
  });
});
