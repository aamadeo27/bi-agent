/**
 * Unit tests for auth router emission call-sites (T7.1).
 *
 * Verifies that POST /login and login-failure paths invoke the audit helpers
 * (emitLoginAudit / emitLoginFailedForEmail) by mocking their dependencies.
 *
 * Auth-service and DB calls are mocked — no real DB or crypto needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import cookieParser from "cookie-parser";

// ── Shared mock references ────────────────────────────────────────────────────

// Accessible outside the factory so tests can configure per-test behavior
const mockFindUnique = vi.fn();

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("./auth-service.js", () => ({
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("./invite-service.js", () => ({
  acceptInvite: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getPrisma: () => ({
    user: { findUnique: mockFindUnique },
  }),
}));

// Mock withTenant so emitLoginAudit doesn't hit a real DB.
vi.mock("../db/with-tenant.js", () => ({
  withTenant: vi.fn(),
}));

import * as authService from "./auth-service.js";
import { withTenant } from "../db/with-tenant.js";
import { authRouter } from "./router.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRouter);
  return app;
}

const GOOD_TOKENS = {
  accessToken: "tok.tok.tok",
  refreshRaw: "raw-refresh",
  refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  userId: "user-1",
  tenantId: "tenant01",
  roleId: "role-admin",
};

// Default withTenant stub: resolves role name + executes INSERT
function makeWithTenantStub() {
  vi.mocked(withTenant).mockImplementation((_tid, fn) =>
    fn({
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ name: "Admin" }]),
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    } as never),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  makeWithTenantStub();
  mockFindUnique.mockResolvedValue(null); // default: user not found
});

// ── POST /api/auth/login — successful login emission ─────────────────────────

describe("POST /api/auth/login — audit emission", () => {
  it("calls withTenant (emitLoginAudit) after successful login", async () => {
    vi.mocked(authService.login).mockResolvedValue(GOOD_TOKENS);

    const res = await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "a@b.com", password: "pw" });

    expect(res.status).toBe(200);
    // emitLoginAudit calls withTenant to resolve role name + insert
    expect(vi.mocked(withTenant)).toHaveBeenCalledWith("tenant01", expect.any(Function));
  });

  it("passes 'login' type and 'success' outcome to withTenant INSERT", async () => {
    vi.mocked(authService.login).mockResolvedValue(GOOD_TOKENS);

    let capturedSql = "";
    let capturedParams: unknown[] = [];
    vi.mocked(withTenant).mockImplementation((_tid, fn) =>
      fn({
        $queryRawUnsafe: vi.fn().mockResolvedValue([{ name: "Admin" }]),
        $executeRawUnsafe: vi.fn().mockImplementation((sql: string, ...args: unknown[]) => {
          capturedSql = sql;
          capturedParams = args;
          return Promise.resolve(0);
        }),
      } as never),
    );

    await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "a@b.com", password: "pw" });

    expect(capturedSql).toContain("INSERT INTO audit_events");
    expect(capturedParams).toContain("login");
    expect(capturedParams).toContain("success");
    expect(capturedParams).toContain("tenant01");
    expect(capturedParams).toContain("user-1");
  });
});

// ── POST /api/auth/login — login_failed emission ──────────────────────────────

describe("POST /api/auth/login — login_failed emission", () => {
  it("calls withTenant (emitLoginAudit) on AUTH error with known user (auditContext set)", async () => {
    const authErr = Object.assign(new Error("Invalid credentials"), {
      code: "AUTH",
      auditContext: { userId: "user-1", tenantId: "tenant01", roleId: null },
    });
    vi.mocked(authService.login).mockRejectedValue(authErr);

    const res = await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "alice@example.com", password: "wrong" });

    expect(res.status).toBe(401);
    // emitLoginAudit fires for known-user failure
    expect(vi.mocked(withTenant)).toHaveBeenCalledWith("tenant01", expect.any(Function));
  });

  it("calls mockFindUnique on AUTH error when auditContext is null (unknown email)", async () => {
    const authErr = Object.assign(new Error("Invalid credentials"), {
      code: "AUTH",
      auditContext: null,
    });
    vi.mocked(authService.login).mockRejectedValue(authErr);
    // mockFindUnique already defaults to null (user not found)

    const res = await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "unknown@example.com", password: "wrong" });

    expect(res.status).toBe(401);
    // emitLoginFailedForEmail calls getPrisma().user.findUnique
    await vi.waitFor(() => {
      expect(mockFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: "unknown@example.com" } }),
      );
    });
  });

  it("emits login_failed via withTenant when unknown-email user is found in DB", async () => {
    const authErr = Object.assign(new Error("Invalid credentials"), {
      code: "AUTH",
      auditContext: null,
    });
    vi.mocked(authService.login).mockRejectedValue(authErr);
    mockFindUnique.mockResolvedValue({
      id: "user-2",
      tenantId: "tenantXY",
      roleId: "role-viewer",
    });

    await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "found@example.com", password: "wrong" });

    await vi.waitFor(() => {
      expect(vi.mocked(withTenant)).toHaveBeenCalledWith("tenantXY", expect.any(Function));
    });
  });
});
