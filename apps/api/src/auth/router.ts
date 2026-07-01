import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Router as ExpressRouter, Request, Response } from "express";
import { getPrisma } from "../db/client.js";
import { login, refresh, logout } from "./auth-service.js";
import type { AuthFailContext } from "./auth-service.js";
import { acceptInvite } from "./invite-service.js";
import { REFRESH_COOKIE_NAME } from "./token-service.js";
import { LoginRequestSchema, InviteAcceptRequestSchema } from "@bi/contracts";
import type { ApiErrorResponse } from "@bi/contracts";
import { logger } from "../observability/logger.js";
import { withTenant } from "../db/with-tenant.js";

export const authRouter: ExpressRouter = Router();

const IS_PROD = process.env["NODE_ENV"] === "production";

/** Shared cookie options for the httpOnly refresh token cookie. */
const COOKIE_BASE = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "strict" as const,
  path: "/api/auth",
};

authRouter.post("/login", async (req: Request, res: Response) => {
  const parsed = LoginRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiErrorResponse = {
      code: "VALIDATION",
      message: "email and password are required",
    };
    res.status(400).json(body);
    return;
  }

  try {
    const result = await login(parsed.data.email, parsed.data.password, getPrisma());
    res.cookie(REFRESH_COOKIE_NAME, result.refreshRaw, {
      ...COOKIE_BASE,
      maxAge: result.refreshExpiresAt.getTime() - Date.now(),
    });
    res.status(200).json({ accessToken: result.accessToken });
    // Emit login audit fire-and-forget (after response sent)
    emitLoginAudit(result.tenantId, result.userId, result.roleId, "login", "success", req.ip).catch(
      () => {},
    );
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "AUTH") {
      const body: ApiErrorResponse = {
        code: "AUTH",
        message: "Invalid credentials",
      };
      res.status(401).json(body);
      // Emit login_failed if we know the tenant (user exists but creds wrong)
      const ctx = (err as Partial<AuthFailContext>).auditContext;
      if (ctx?.tenantId) {
        emitLoginAudit(ctx.tenantId, ctx.userId, ctx.roleId, "login_failed", "error", req.ip).catch(
          () => {},
        );
      }
      return;
    }
    logger.error(err, "login error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Login failed" };
    res.status(500).json(body);
  }
});

authRouter.post("/refresh", async (req: Request, res: Response) => {
  const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE_NAME];
  if (!raw) {
    const body: ApiErrorResponse = {
      code: "AUTH",
      message: "Missing refresh token",
    };
    res.status(401).json(body);
    return;
  }

  try {
    const result = await refresh(raw, getPrisma());
    res.cookie(REFRESH_COOKIE_NAME, result.refreshRaw, {
      ...COOKIE_BASE,
      maxAge: result.refreshExpiresAt.getTime() - Date.now(),
    });
    res.status(200).json({ accessToken: result.accessToken });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "AUTH") {
      const body: ApiErrorResponse = {
        code: "AUTH",
        message: "Invalid or expired refresh token",
      };
      res.status(401).json(body);
      return;
    }
    logger.error(err, "refresh error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Token refresh failed" };
    res.status(500).json(body);
  }
});

authRouter.post("/invite/accept", async (req: Request, res: Response) => {
  const parsed = InviteAcceptRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiErrorResponse = {
      code: "VALIDATION",
      message: "token is required",
    };
    res.status(400).json(body);
    return;
  }

  try {
    const result = await acceptInvite(parsed.data, getPrisma());
    res.cookie(REFRESH_COOKIE_NAME, result.refreshRaw, {
      ...COOKIE_BASE,
      maxAge: result.refreshExpiresAt.getTime() - Date.now(),
    });
    res.status(200).json({ accessToken: result.accessToken });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "AUTH") {
      const body: ApiErrorResponse = {
        code: "AUTH",
        message: "Invalid, expired, or already-used invite token",
      };
      res.status(401).json(body);
      return;
    }
    if (code === "VALIDATION") {
      const body: ApiErrorResponse = {
        code: "VALIDATION",
        message: (err as Error).message,
      };
      res.status(400).json(body);
      return;
    }
    logger.error(err, "invite accept error");
    const body: ApiErrorResponse = {
      code: "INTERNAL",
      message: "Invite accept failed",
    };
    res.status(500).json(body);
  }
});

authRouter.post("/logout", async (req: Request, res: Response) => {
  const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE_NAME];
  if (raw) {
    try {
      await logout(raw, getPrisma());
    } catch {
      // Best-effort — still clear cookie and return 204.
    }
  }
  res.clearCookie(REFRESH_COOKIE_NAME, COOKIE_BASE);
  res.status(204).send();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Emit a login or login_failed audit event.
 * Resolves the role name from the tenant schema; never throws.
 */
async function emitLoginAudit(
  tenantId: string,
  userId: string,
  roleId: string | null,
  type: "login" | "login_failed",
  outcome: "success" | "error",
  ip: string | undefined,
): Promise<void> {
  if (!tenantId) return;
  try {
    await withTenant(tenantId, async (tx) => {
      let roleName = "none";
      if (roleId) {
        const rows = await tx.$queryRawUnsafe<Array<{ name: string }>>(
          `SELECT name FROM roles WHERE id = $1`,
          roleId,
        );
        roleName = rows[0]?.name ?? "unknown";
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO audit_events
           (id, tenant_id, at, actor_user_id, role_name_at_event, type, outcome, data_source_id, detail, ip)
         VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        randomUUID(),
        tenantId,
        new Date().toISOString(),
        userId,
        roleName,
        type,
        outcome,
        null,
        JSON.stringify({}),
        ip ?? null,
      );
    });
  } catch (err) {
    logger.error({ err }, `emitLoginAudit(${type}): failed`);
  }
}

