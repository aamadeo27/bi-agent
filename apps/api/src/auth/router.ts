import { Router } from "express";
import type { Router as ExpressRouter, Request, Response } from "express";
import { getPrisma } from "../db/client.js";
import { login, refresh, logout } from "./auth-service.js";
import { acceptInvite } from "./invite-service.js";
import { REFRESH_COOKIE_NAME } from "./token-service.js";
import {
  loadSsoConfig,
  buildSsoStartUrl,
  handleSsoCallback,
  verifySsoState,
  SSO_STATE_COOKIE,
} from "./sso-service.js";
import { LoginRequestSchema, InviteAcceptRequestSchema } from "@bi/contracts";
import type { ApiErrorResponse } from "@bi/contracts";
import { logger } from "../observability/logger.js";

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
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "AUTH") {
      const body: ApiErrorResponse = {
        code: "AUTH",
        message: "Invalid credentials",
      };
      res.status(401).json(body);
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

// ── SSO / OIDC ────────────────────────────────────────────────────────────────

/**
 * Cookie options for the short-lived SSO state cookie.
 * sameSite must be "lax" (not "strict") so the browser sends it on the
 * IdP → callback redirect.
 */
const SSO_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: "lax" as const,
  path: "/api/auth",
  maxAge: 5 * 60 * 1000, // 5 minutes — matches SSO_STATE_TTL in sso-service
};

authRouter.get(
  "/sso/:tenant/start",
  async (req: Request<{ tenant: string }>, res: Response) => {
    const { tenant } = req.params;
    try {
      const config = await loadSsoConfig(tenant, getPrisma());
      const { authUrl, stateCookie } = await buildSsoStartUrl(config, tenant);

      res.cookie(SSO_STATE_COOKIE, stateCookie, SSO_STATE_COOKIE_OPTIONS);
      res.redirect(302, authUrl);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "NOT_FOUND") {
        const body: ApiErrorResponse = {
          code: "NOT_FOUND",
          message: "Tenant or SSO configuration not found",
        };
        res.status(404).json(body);
        return;
      }
      logger.error(err, "sso start error");
      const body: ApiErrorResponse = {
        code: "INTERNAL",
        message: "SSO initiation failed",
      };
      res.status(500).json(body);
    }
  }
);

authRouter.get(
  "/sso/:tenant/callback",
  async (req: Request<{ tenant: string }>, res: Response) => {
    const { tenant } = req.params;
    const rawCode = req.query["code"];
    const code = typeof rawCode === "string" ? rawCode : undefined;
    const rawState = req.query["state"];
    const stateParam = typeof rawState === "string" ? rawState : undefined;
    const stateCookieToken = (
      req.cookies as Record<string, string | undefined>
    )[SSO_STATE_COOKIE];

    if (!code || !stateParam || !stateCookieToken) {
      const body: ApiErrorResponse = {
        code: "VALIDATION",
        message: "Missing OAuth callback parameters",
      };
      res.status(400).json(body);
      return;
    }

    try {
      const ssoState = await verifySsoState(stateCookieToken);

      if (ssoState.tenantSlug !== tenant) {
        const body: ApiErrorResponse = {
          code: "AUTH",
          message: "SSO state tenant mismatch",
        };
        res.status(401).json(body);
        return;
      }

      const config = await loadSsoConfig(tenant, getPrisma());
      const tokens = await handleSsoCallback(
        code,
        stateParam,
        ssoState,
        config,
        getPrisma()
      );

      // Clear SSO state cookie — single-use.
      res.clearCookie(SSO_STATE_COOKIE, { path: "/api/auth" });

      res.cookie(REFRESH_COOKIE_NAME, tokens.refreshRaw, {
        ...COOKIE_BASE,
        maxAge: tokens.refreshExpiresAt.getTime() - Date.now(),
      });
      res.status(200).json({ accessToken: tokens.accessToken });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "AUTH") {
        const body: ApiErrorResponse = {
          code: "AUTH",
          message: "SSO authentication failed",
        };
        res.status(401).json(body);
        return;
      }
      if (code === "NOT_FOUND") {
        const body: ApiErrorResponse = {
          code: "NOT_FOUND",
          message: "Tenant or SSO configuration not found",
        };
        res.status(404).json(body);
        return;
      }
      logger.error(err, "sso callback error");
      const body: ApiErrorResponse = {
        code: "INTERNAL",
        message: "SSO callback failed",
      };
      res.status(500).json(body);
    }
  }
);
