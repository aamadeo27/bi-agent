import { Router } from "express";
import type { Router as ExpressRouter, Request, Response } from "express";
import { InviteUserRequestSchema } from "@bi/contracts";
import type { ApiErrorResponse } from "@bi/contracts";
import { createInvite } from "../auth/invite-service.js";
import { consoleMailer } from "../mailer/console-adapter.js";
import { getPrisma } from "../db/client.js";
import { logger } from "../observability/logger.js";

export const adminUsersRouter: ExpressRouter = Router();

/**
 * POST /api/admin/users/invite
 *
 * Creates an `invited` user and dispatches a signed, expiring invite token.
 * Caller must be authenticated (authMiddleware) with a non-null roleId.
 *
 * TODO(T3.x): replace roleId-presence check with a proper canAdmin capability
 * once the RBAC admin layer is in place.
 */
adminUsersRouter.post("/invite", async (req: Request, res: Response) => {
  if (!req.auth) {
    const body: ApiErrorResponse = { code: "AUTH", message: "Not authenticated" };
    res.status(401).json(body);
    return;
  }

  // Minimal admin guard — user must have an assigned role.
  // Full capability-based check will be added in T3.x.
  if (!req.auth.roleId) {
    const body: ApiErrorResponse = {
      code: "AUTH",
      message: "Admin role required",
    };
    res.status(403).json(body);
    return;
  }

  const parsed = InviteUserRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const body: ApiErrorResponse = {
      code: "VALIDATION",
      message: "email and displayName are required",
    };
    res.status(400).json(body);
    return;
  }

  try {
    const result = await createInvite(
      {
        tenantId: req.auth.tenantId,
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        roleId: parsed.data.roleId,
        invitedByUserId: req.auth.userId,
      },
      getPrisma(),
      consoleMailer
    );
    res.status(201).json(result);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "VALIDATION") {
      const body: ApiErrorResponse = {
        code: "VALIDATION",
        message: (err as Error).message,
      };
      res.status(409).json(body);
      return;
    }
    logger.error(err, "invite error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Invite failed" };
    res.status(500).json(body);
  }
});
