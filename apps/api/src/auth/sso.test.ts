/**
 * Unit tests for T2.3 SSO / OIDC service.
 *
 * Subject-binding model tested:
 *   Phase 1 — primary lookup by ssoSubject (already bound from a prior login).
 *   Phase 2 — first-login: lookup by email (lowercase) with null ssoSubject →
 *             bind subject → activate if invited.
 *   Reject — no match, wrong tenant, suspended, already bound to different subject.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoist mock handles ────────────────────────────────────────────────────────

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

// User with ssoSubject already bound.
const BOUND_USER = {
  id: "user-1",
  email: "alice@tenant-a.com",
  passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$hash",
  displayName: "Alice",
  status: "active" as const,
  tenantId: "tenant-1",
  roleId: "role-viewer",
  ssoSubject: "idp-sub-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  refreshTokens: [],
};

// User not yet bound (first SSO login).
const UNBOUND_USER = { ...BOUND_USER, ssoSubject: null };
const INVITED_UNBOUND_USER = { ...UNBOUND_USER, status: "invited" as const };
const SUSPENDED_BOUND_USER = { ...BOUND_USER, status: "suspended" as const };

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
  it("round-trips the state payload", async () => {
    const token = await signSsoState(SSO_STATE);
    const result = await verifySsoState(token);
    expect(result).toEqual(SSO_STATE);
  });

  it("throws AUTH on a tampered token", async () => {
    await expect(verifySsoState("tampered.token.value")).rejects.toMatchObject({
      code: "AUTH",
    });
  });

  it("throws AUTH on empty string", async () => {
    await expect(verifySsoState("")).rejects.toMatchObject({ code: "AUTH" });
  });

  it("surfaces INTERNAL (not AUTH) when JWT_SECRET is missing", async () => {
    vi.unstubAllEnvs(); // remove JWT_SECRET stub
    // getSecretKey() throws before the try-catch, so it propagates directly.
    await expect(verifySsoState("any")).rejects.toThrow(
      "JWT_SECRET env var is required"
    );
    // Confirm it is NOT wrapped as AUTH.
    await expect(verifySsoState("any")).rejects.not.toMatchObject({
      code: "AUTH",
    });
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
      id: "tenant-1", slug: "acme", displayName: "Acme",
      status: "active", createdAt: new Date(), updatedAt: new Date(),
    });
    vi.mocked(db.tenantSsoConfig.findUnique).mockResolvedValue(null);
    await expect(loadSsoConfig("acme", db)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns resolved config when both rows exist", async () => {
    const db = makeDb();
    vi.mocked(db.tenant.findUnique).mockResolvedValue({
      id: "tenant-1", slug: "acme", displayName: "Acme",
      status: "active", createdAt: new Date(), updatedAt: new Date(),
    });
    vi.mocked(db.tenantSsoConfig.findUnique).mockResolvedValue({
      id: "cfg-1", tenantId: "tenant-1", issuer: "https://idp.example.com",
      clientId: "client-id", clientSecret: "client-secret",
      callbackUrl: "https://app.example.com/api/auth/sso/acme/callback",
      createdAt: new Date(), updatedAt: new Date(),
    });

    const config = await loadSsoConfig("acme", db);
    expect(config.tenantId).toBe("tenant-1");
    expect(config.issuer).toBe("https://idp.example.com");
  });
});

// ── buildSsoStartUrl ──────────────────────────────────────────────────────────

describe("buildSsoStartUrl", () => {
  it("calls Issuer.discover with the config issuer", async () => {
    await buildSsoStartUrl(SSO_CONFIG, "acme");
    expect(mockDiscover).toHaveBeenCalledWith(SSO_CONFIG.issuer);
  });

  it("returns authUrl and a signed stateCookie (3-part JWT)", async () => {
    const { authUrl, stateCookie } = await buildSsoStartUrl(SSO_CONFIG, "acme");
    expect(authUrl).toContain("idp.example.com");
    expect(stateCookie.split(".")).toHaveLength(3);
  });

  it("state cookie encodes correct tenantSlug and OIDC state", async () => {
    const { stateCookie } = await buildSsoStartUrl(SSO_CONFIG, "acme");
    const decoded = await verifySsoState(stateCookie);
    expect(decoded.tenantSlug).toBe("acme");
    expect(decoded.oidcState).toBe("mock-oidc-state");
    expect(decoded.nonce).toBe("mock-nonce");
    expect(decoded.codeVerifier).toBe("mock-verifier");
  });
});

// ── handleSsoCallback — Phase 1: bound subject ────────────────────────────────

describe("handleSsoCallback — Phase 1: bound subject lookup", () => {
  it("issues tokens for an active user with matching ssoSubject", async () => {
    const db = makeDb();
    // Primary lookup by sub returns the bound user.
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(BOUND_USER);
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "idp-sub-1", email: "alice@tenant-a.com" }),
    });

    const result = await handleSsoCallback(
      "auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db
    );

    expect(result.accessToken).toBeTypeOf("string");
    expect(result.refreshRaw).toBe("raw-refresh-token");
    // No subject-binding update needed (already bound).
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("throws AUTH when bound subject belongs to a different tenant", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValueOnce({
      ...BOUND_USER, tenantId: "tenant-OTHER",
    });
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "idp-sub-1", email: "alice@tenant-a.com" }),
    });

    await expect(
      handleSsoCallback("auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  it("throws AUTH when bound user is suspended", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(SUSPENDED_BOUND_USER);
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "idp-sub-1", email: "alice@tenant-a.com" }),
    });

    await expect(
      handleSsoCallback("auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });
});

// ── handleSsoCallback — Phase 2: first-login subject binding ─────────────────

describe("handleSsoCallback — Phase 2: first-login subject binding", () => {
  it("binds ssoSubject on first login for unbound invited user", async () => {
    const db = makeDb();
    // Phase 1 (sub lookup) misses; Phase 2 (email lookup) finds unbound user.
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce(null)           // sub lookup: no bound user
      .mockResolvedValueOnce(INVITED_UNBOUND_USER); // email lookup: found
    // Binding update then activation update.
    vi.mocked(db.user.update)
      .mockResolvedValueOnce({ ...INVITED_UNBOUND_USER, ssoSubject: "idp-sub-new" })
      .mockResolvedValueOnce({ ...INVITED_UNBOUND_USER, ssoSubject: "idp-sub-new", status: "active" });
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "idp-sub-new", email: "alice@tenant-a.com" }),
    });

    await handleSsoCallback("auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db);

    // First update: bind the subject.
    expect(db.user.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: { ssoSubject: "idp-sub-new" } })
    );
    // Second update: activate invited user.
    expect(db.user.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: { status: "active" } })
    );
  });

  it("binds ssoSubject on first login for unbound active user", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(UNBOUND_USER);
    vi.mocked(db.user.update).mockResolvedValueOnce({
      ...UNBOUND_USER, ssoSubject: "idp-sub-new",
    });
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "idp-sub-new", email: "alice@tenant-a.com" }),
    });

    const result = await handleSsoCallback(
      "auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db
    );
    expect(result.accessToken).toBeTypeOf("string");
    // Only one update (binding; no activation needed for active user).
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });

  it("normalises email to lowercase before lookup", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(UNBOUND_USER);
    vi.mocked(db.user.update).mockResolvedValueOnce({
      ...UNBOUND_USER, ssoSubject: "idp-sub-1",
    });
    mockCallback.mockResolvedValue({
      // IdP returns mixed-case email.
      claims: () => ({ sub: "idp-sub-1", email: "Alice@Tenant-A.Com" }),
    });

    await handleSsoCallback("auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db);

    // Email lookup should be called with lowercase.
    expect(db.user.findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { email: "alice@tenant-a.com" } })
    );
  });

  it("throws AUTH when email not found in tenant (unknown subject)", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce(null)   // sub: not found
      .mockResolvedValueOnce(null);  // email: not found
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "unknown-sub", email: "unknown@external.com" }),
    });

    await expect(
      handleSsoCallback("auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  it("throws AUTH when email found but belongs to a different tenant", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...UNBOUND_USER, tenantId: "tenant-OTHER" });
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "new-sub", email: "alice@tenant-a.com" }),
    });

    await expect(
      handleSsoCallback("auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  it("throws AUTH when email found but already bound to a different subject", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique)
      .mockResolvedValueOnce(null) // new sub not bound
      .mockResolvedValueOnce(BOUND_USER); // email found but ssoSubject is not null
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "different-sub", email: "alice@tenant-a.com" }),
    });

    await expect(
      handleSsoCallback("auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });

  it("throws AUTH when id_token missing email and subject is unbound", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(null); // sub: not bound
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "unbound-sub" }), // no email
    });

    await expect(
      handleSsoCallback("auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });
});

// ── handleSsoCallback — token claims ─────────────────────────────────────────

describe("handleSsoCallback — token claims", () => {
  it("access token carries {sub, tenantId, roleId}", async () => {
    const { jwtVerify } = await import("jose");
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValueOnce(BOUND_USER);
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "idp-sub-1", email: "alice@tenant-a.com" }),
    });

    const { accessToken } = await handleSsoCallback(
      "auth-code", "mock-oidc-state", SSO_STATE, SSO_CONFIG, db
    );

    const secretKey = new TextEncoder().encode(TEST_SECRET);
    const { payload } = await jwtVerify(accessToken, secretKey, {
      algorithms: ["HS256"],
    });

    expect(payload["sub"]).toBe(BOUND_USER.id);
    expect(payload["tenantId"]).toBe(BOUND_USER.tenantId);
    expect(payload["roleId"]).toBe(BOUND_USER.roleId);
  });
});

// ── handleSsoCallback — state integrity ───────────────────────────────────────

describe("handleSsoCallback — state integrity", () => {
  it("throws AUTH and skips token exchange on state mismatch", async () => {
    const db = makeDb();
    mockCallback.mockResolvedValue({
      claims: () => ({ sub: "idp-sub-1", email: "alice@tenant-a.com" }),
    });

    await expect(
      handleSsoCallback(
        "auth-code",
        "WRONG-STATE",  // does not match SSO_STATE.oidcState
        SSO_STATE,
        SSO_CONFIG,
        db
      )
    ).rejects.toMatchObject({ code: "AUTH" });

    // Token exchange must NOT be attempted.
    expect(mockCallback).not.toHaveBeenCalled();
  });
});
