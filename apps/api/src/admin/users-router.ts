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
 *
 * SECURITY RISK (known, tracked as T3.x): the current admin guard only checks
 * that the caller has *any* role assigned (roleId !== null). Any authenticated
 * user with a role can therefore invite new users. This is intentionally
 * over-permissive until the T3.x RBAC admin layer defines a `canAdmin`
 * capability and gates this endpoint on it. Do not promote this pattern to
 * other sensitive write endpoints.
 */
adminUsersRouter.post("/invite", async (req: Request, res: Response) => {
  // req.auth is guaranteed non-null here — protectedRouter runs authMiddleware
  // before any handler under /api, so this branch is only reached with a valid JWT.
  const auth = req.auth!;

  // Temporary admin gate: any user with an assigned role may invite.
  // Replace with capability check once T3.x ships.
  if (!auth.roleId) {
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
        tenantId: auth.tenantId,
        email: parsed.data.email,
        displayName: parsed.data.displayName,
        roleId: parsed.data.roleId,
        invitedByUserId: auth.userId,
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
      res.status(400).json(body);
      return;
    }
    logger.error(err, "invite error");
    const body: ApiErrorResponse = { code: "INTERNAL", message: "Invite failed" };
    res.status(500).json(body);
  }
});
