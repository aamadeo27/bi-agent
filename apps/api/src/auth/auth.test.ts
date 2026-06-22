/**
 * Unit tests for T2.2 auth service — wrong password, token claims,
 * refresh rotation, and GAP-17 role propagation.
 *
 * All DB and argon2 calls are mocked — no DB or real crypto needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { jwtVerify } from "jose";

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock("@node-rs/argon2", () => ({
  verify: vi.fn(),
}));

vi.mock("./token-service.js", async (importOriginal) => {
  // Keep real implementations for the pure crypto helpers; mock only DB ops.
  const real = await importOriginal<typeof import("./token-service.js")>();
  return {
    ...real,
    createRefreshToken: vi.fn(),
    findValidRefreshToken: vi.fn(),
    revokeRefreshToken: vi.fn(),
  };
});

import * as argon2 from "@node-rs/argon2";
import * as tokenService from "./token-service.js";
import { login, refresh, logout } from "./auth-service.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-secret-at-least-32-bytes!!";
const SECRET_KEY = new TextEncoder().encode(TEST_SECRET);

/** Minimal fake PrismaClient stub. */
function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: vi.fn(),
    },
    ...overrides,
  } as unknown as import("@prisma/client").PrismaClient;
}

const ACTIVE_USER = {
  id: "user-1",
  email: "alice@example.com",
  passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$hash",
  displayName: "Alice",
  status: "active" as const,
  tenantId: "tenant-1",
  roleId: "role-viewer",
  ssoSubject: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  refreshTokens: [],
};

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", TEST_SECRET);

  vi.mocked(tokenService.createRefreshToken).mockResolvedValue({
    raw: "raw-refresh-token",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  vi.mocked(tokenService.revokeRefreshToken).mockResolvedValue(ACTIVE_USER.id);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

// ── login ─────────────────────────────────────────────────────────────────────

describe("login — wrong password", () => {
  it("throws AUTH when password does not match", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue(ACTIVE_USER);
    vi.mocked(argon2.verify).mockResolvedValue(false);

    await expect(login("alice@example.com", "wrong", db)).rejects.toMatchObject({
      code: "AUTH",
    });
  });

  it("throws AUTH when user is not found (timing-safe path)", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    // argon2.verify is still called with the dummy hash — result is irrelevant.
    vi.mocked(argon2.verify).mockResolvedValue(false);

    await expect(login("unknown@example.com", "pass", db)).rejects.toMatchObject({
      code: "AUTH",
    });
  });

  it("throws AUTH when user is suspended", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue({
      ...ACTIVE_USER,
      status: "suspended",
    });
    vi.mocked(argon2.verify).mockResolvedValue(true);

    await expect(login("alice@example.com", "correct", db)).rejects.toMatchObject({
      code: "AUTH",
    });
  });
});

describe("login — success", () => {
  it("returns accessToken and refreshRaw on valid credentials", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue(ACTIVE_USER);
    vi.mocked(argon2.verify).mockResolvedValue(true);

    const result = await login("alice@example.com", "correct", db);

    expect(result.accessToken).toBeTypeOf("string");
    expect(result.refreshRaw).toBe("raw-refresh-token");
    expect(result.refreshExpiresAt).toBeInstanceOf(Date);
  });

  it("access token carries correct claims {sub, tenantId, roleId}", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue(ACTIVE_USER);
    vi.mocked(argon2.verify).mockResolvedValue(true);

    const { accessToken } = await login("alice@example.com", "correct", db);
    const { payload } = await jwtVerify(accessToken, SECRET_KEY, {
      algorithms: ["HS256"],
    });

    expect(payload["sub"]).toBe("user-1");
    expect(payload["tenantId"]).toBe("tenant-1");
    expect(payload["roleId"]).toBe("role-viewer");
    expect(payload["exp"]).toBeTypeOf("number");
    // TTL should be approximately 15 minutes from now.
    const ttlSeconds = (payload["exp"] as number) - Math.floor(Date.now() / 1000);
    expect(ttlSeconds).toBeGreaterThan(14 * 60);
    expect(ttlSeconds).toBeLessThanOrEqual(15 * 60);
  });
});

// ── expired access token ──────────────────────────────────────────────────────

describe("access token — expiry", () => {
  it("jwtVerify rejects a token signed with exp in the past", async () => {
    // Sign a token with -1m TTL (already expired).
    const { SignJWT } = await import("jose");
    const expired = await new SignJWT({ tenantId: "t1", roleId: null })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setExpirationTime("-1m")
      .sign(SECRET_KEY);

    await expect(
      jwtVerify(expired, SECRET_KEY, { algorithms: ["HS256"] })
    ).rejects.toThrow();
  });
});

// ── refresh rotation ──────────────────────────────────────────────────────────

/** Minimal fake RefreshToken matching all Prisma-required fields. */
const FAKE_REFRESH_RECORD = {
  id: "rt-1",
  userId: ACTIVE_USER.id,
  tokenHash: "hash",
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  revokedAt: null,
  createdAt: new Date(),
};

describe("refresh — rotation", () => {
  it("revokes old token and issues new access + refresh tokens", async () => {
    const db = makeDb();
    vi.mocked(tokenService.findValidRefreshToken).mockResolvedValue(FAKE_REFRESH_RECORD);
    vi.mocked(db.user.findUnique).mockResolvedValue(ACTIVE_USER);

    const result = await refresh("old-raw-token", db);

    expect(tokenService.revokeRefreshToken).toHaveBeenCalledWith("old-raw-token", db);
    expect(tokenService.createRefreshToken).toHaveBeenCalledWith(ACTIVE_USER.id, db);
    expect(result.accessToken).toBeTypeOf("string");
    expect(result.refreshRaw).toBe("raw-refresh-token");
  });

  it("throws AUTH when refresh token is invalid or revoked", async () => {
    const db = makeDb();
    vi.mocked(tokenService.findValidRefreshToken).mockResolvedValue(null);

    await expect(refresh("bad-token", db)).rejects.toMatchObject({ code: "AUTH" });
  });

  it("throws AUTH when refresh token is presented after revocation", async () => {
    const db = makeDb();
    // findValidRefreshToken returns null for a revoked token.
    vi.mocked(tokenService.findValidRefreshToken).mockResolvedValue(null);

    await expect(refresh("revoked-token", db)).rejects.toMatchObject({ code: "AUTH" });
    // Confirm revokeRefreshToken was NOT called (token already invalid).
    expect(tokenService.revokeRefreshToken).not.toHaveBeenCalled();
  });
});

// ── GAP-17: role change reflected after refresh ───────────────────────────────

describe("refresh — GAP-17 role propagation", () => {
  it("new access token carries the updated roleId from DB, not the old token", async () => {
    const db = makeDb();
    vi.mocked(tokenService.findValidRefreshToken).mockResolvedValue(FAKE_REFRESH_RECORD);
    // Simulate admin upgraded the user to role-admin.
    vi.mocked(db.user.findUnique).mockResolvedValue({
      ...ACTIVE_USER,
      roleId: "role-admin",
    });

    const { accessToken } = await refresh("any-raw-token", db);
    const { payload } = await jwtVerify(accessToken, SECRET_KEY, {
      algorithms: ["HS256"],
    });

    expect(payload["roleId"]).toBe("role-admin");
  });

  it("new access token reflects roleId=null when role is removed", async () => {
    const db = makeDb();
    vi.mocked(tokenService.findValidRefreshToken).mockResolvedValue(FAKE_REFRESH_RECORD);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      ...ACTIVE_USER,
      roleId: null,
    });

    const { accessToken } = await refresh("any-raw-token", db);
    const { payload } = await jwtVerify(accessToken, SECRET_KEY, {
      algorithms: ["HS256"],
    });

    expect(payload["roleId"]).toBeNull();
  });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe("logout", () => {
  it("revokes the refresh token", async () => {
    const db = makeDb();
    await logout("raw-token", db);
    expect(tokenService.revokeRefreshToken).toHaveBeenCalledWith("raw-token", db);
  });
});

// ── token-service pure helpers ────────────────────────────────────────────────

describe("hashRefreshToken", () => {
  it("is deterministic for same input", () => {
    // Import real implementation (not mocked at module level here — we call directly).
    const { hashRefreshToken } = tokenService;
    expect(hashRefreshToken("abc")).toBe(hashRefreshToken("abc"));
  });

  it("produces different hashes for different inputs", () => {
    const { hashRefreshToken } = tokenService;
    expect(hashRefreshToken("abc")).not.toBe(hashRefreshToken("xyz"));
  });

  it("returns a 64-char hex string (SHA-256)", () => {
    const { hashRefreshToken } = tokenService;
    expect(hashRefreshToken("any")).toMatch(/^[0-9a-f]{64}$/);
  });
});
