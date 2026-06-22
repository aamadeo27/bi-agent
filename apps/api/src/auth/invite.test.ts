/**
 * Unit tests for T2.4 invite service.
 *
 * Covers:
 *  - createInvite: happy path, duplicate email rejection
 *  - acceptInvite: happy path (invite → accept → login round trip)
 *  - acceptInvite: expired token rejected
 *  - acceptInvite: used token rejected
 *  - acceptInvite: unknown token rejected
 *  - acceptInvite: missing password rejected
 *
 * All DB and argon2 calls are mocked — no real DB or crypto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { jwtVerify } from "jose";

// ── module mocks ─────────────────────────────────────────────────────────────

vi.mock("@node-rs/argon2", () => ({
  hash: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("../db/with-tenant.js", () => ({
  withTenant: vi.fn(),
}));

vi.mock("./token-service.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./token-service.js")>();
  return {
    ...real,
    createRefreshToken: vi.fn(),
  };
});

import * as argon2 from "@node-rs/argon2";
import * as withTenantMod from "../db/with-tenant.js";
import * as tokenService from "./token-service.js";
import { createInvite, acceptInvite } from "./invite-service.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-secret-at-least-32-bytes!!";
const SECRET_KEY = new TextEncoder().encode(TEST_SECRET);

/** Build a minimal PrismaClient double for invite tests. */
function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    // Prisma naming: camelCase for the model accessor
    inviteToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as import("@prisma/client").PrismaClient;
}

const TENANT_ID = "tenant01";
const USER_ID = "user-invited-1";

/** A valid (not expired, not used) invite token record. */
function makeTokenRecord(overrides: Partial<{
  usedAt: Date | null;
  expiresAt: Date;
}> = {}) {
  return {
    id: "tok-1",
    tokenHash: "sha256hash",
    userId: USER_ID,
    tenantId: TENANT_ID,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 72 * 60 * 60 * 1000),
    usedAt: overrides.usedAt ?? null,
    createdAt: new Date(),
  };
}

const INVITED_USER = {
  id: USER_ID,
  email: "newuser@example.com",
  passwordHash: null as string | null,
  displayName: "New User",
  status: "invited" as const,
  tenantId: TENANT_ID,
  roleId: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ACTIVE_USER = {
  ...INVITED_USER,
  status: "active" as const,
  passwordHash: "$argon2id$hashed" as string | null,
};

const MAILER_STUB = { sendInvite: vi.fn() };

beforeEach(() => {
  vi.stubEnv("JWT_SECRET", TEST_SECRET);
  vi.mocked(withTenantMod.withTenant).mockResolvedValue(undefined as never);
  vi.mocked(MAILER_STUB.sendInvite).mockResolvedValue(undefined);
  vi.mocked(argon2.hash).mockResolvedValue("$argon2id$hashed");
  vi.mocked(tokenService.createRefreshToken).mockResolvedValue({
    raw: "raw-refresh",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

// ── createInvite ──────────────────────────────────────────────────────────────

describe("createInvite — happy path", () => {
  it("creates platform user, tenant entry, token record, and sends email", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue(null); // no existing user
    vi.mocked(db.user.create).mockResolvedValue(INVITED_USER);
    vi.mocked(db.inviteToken.create).mockResolvedValue({} as never);

    const result = await createInvite(
      {
        tenantId: TENANT_ID,
        email: "newuser@example.com",
        displayName: "New User",
        invitedByUserId: "admin-1",
      },
      db,
      MAILER_STUB
    );

    expect(result.userId).toBeTypeOf("string");
    expect(db.user.create).toHaveBeenCalledOnce();
    expect(db.inviteToken.create).toHaveBeenCalledOnce();
    expect(withTenantMod.withTenant).toHaveBeenCalledOnce();
    expect(MAILER_STUB.sendInvite).toHaveBeenCalledOnce();

    const mailArgs = vi.mocked(MAILER_STUB.sendInvite).mock.calls[0]![0];
    expect(mailArgs.to).toBe("newuser@example.com");
    expect(mailArgs.inviteUrl).toContain("token=");
  });

  it("passes roleId to user create and tenant insert when supplied", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.create).mockResolvedValue(INVITED_USER);
    vi.mocked(db.inviteToken.create).mockResolvedValue({} as never);

    await createInvite(
      {
        tenantId: TENANT_ID,
        email: "newuser@example.com",
        displayName: "New User",
        roleId: "role-viewer",
        invitedByUserId: "admin-1",
      },
      db,
      MAILER_STUB
    );

    const createCall = vi.mocked(db.user.create).mock.calls[0]![0];
    expect(createCall.data.roleId).toBe("role-viewer");
  });
});

describe("createInvite — duplicate email", () => {
  it("throws VALIDATION when email already registered", async () => {
    const db = makeDb();
    vi.mocked(db.user.findUnique).mockResolvedValue(ACTIVE_USER);

    await expect(
      createInvite(
        { tenantId: TENANT_ID, email: "existing@example.com", displayName: "X", invitedByUserId: "admin-1" },
        db,
        MAILER_STUB
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });

    expect(db.user.create).not.toHaveBeenCalled();
    expect(MAILER_STUB.sendInvite).not.toHaveBeenCalled();
  });
});

// ── acceptInvite — happy path / round trip ────────────────────────────────────

describe("acceptInvite — happy path", () => {
  it("activates user and returns accessToken + refreshRaw", async () => {
    const db = makeDb();
    vi.mocked(db.inviteToken.findUnique).mockResolvedValue(makeTokenRecord());
    vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue(ACTIVE_USER);
    // Simulate $transaction calling its callback
    vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) => {
      return (fn as (tx: unknown) => Promise<unknown>)({
        inviteToken: { update: vi.fn() },
        user: { update: vi.fn() },
      });
    });

    const result = await acceptInvite({ token: "raw-token", password: "NewPass123!" }, db);

    expect(result.accessToken).toBeTypeOf("string");
    expect(result.refreshRaw).toBe("raw-refresh");
    expect(argon2.hash).toHaveBeenCalledWith("NewPass123!");
    expect(withTenantMod.withTenant).toHaveBeenCalledOnce();
  });

  it("access token carries correct claims after accept", async () => {
    const db = makeDb();
    vi.mocked(db.inviteToken.findUnique).mockResolvedValue(makeTokenRecord());
    vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
      ...ACTIVE_USER,
      roleId: "role-member",
    });
    vi.mocked(db.$transaction).mockImplementation(async (fn: unknown) =>
      (fn as (tx: unknown) => Promise<unknown>)({
        inviteToken: { update: vi.fn() },
        user: { update: vi.fn() },
      })
    );

    const { accessToken } = await acceptInvite({ token: "raw-token", password: "NewPass123!" }, db);
    const { payload } = await jwtVerify(accessToken, SECRET_KEY, { algorithms: ["HS256"] });

    expect(payload["sub"]).toBe(USER_ID);
    expect(payload["tenantId"]).toBe(TENANT_ID);
    expect(payload["roleId"]).toBe("role-member");
  });
});

// ── acceptInvite — token validation failures ──────────────────────────────────

describe("acceptInvite — token not found", () => {
  it("throws AUTH when token hash is not in DB", async () => {
    const db = makeDb();
    vi.mocked(db.inviteToken.findUnique).mockResolvedValue(null);

    await expect(
      acceptInvite({ token: "unknown-token", password: "Pass123!" }, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });
});

describe("acceptInvite — expired token", () => {
  it("throws AUTH when token is past expiry", async () => {
    const db = makeDb();
    vi.mocked(db.inviteToken.findUnique).mockResolvedValue(
      makeTokenRecord({ expiresAt: new Date(Date.now() - 1000) })
    );

    await expect(
      acceptInvite({ token: "expired-token", password: "Pass123!" }, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });
});

describe("acceptInvite — already-used token", () => {
  it("throws AUTH when token was already consumed", async () => {
    const db = makeDb();
    vi.mocked(db.inviteToken.findUnique).mockResolvedValue(
      makeTokenRecord({ usedAt: new Date(Date.now() - 60_000) })
    );

    await expect(
      acceptInvite({ token: "used-token", password: "Pass123!" }, db)
    ).rejects.toMatchObject({ code: "AUTH" });
  });
});

describe("acceptInvite — missing password", () => {
  it("throws VALIDATION when no password provided", async () => {
    const db = makeDb();
    vi.mocked(db.inviteToken.findUnique).mockResolvedValue(makeTokenRecord());

    await expect(
      acceptInvite({ token: "valid-token" }, db)
    ).rejects.toMatchObject({ code: "VALIDATION" });

    expect(argon2.hash).not.toHaveBeenCalled();
  });
});
