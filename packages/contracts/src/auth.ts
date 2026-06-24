import { z } from "zod";

/** Claims embedded in the short-lived JWT access token (~15m). */
export const JwtClaimsSchema = z.object({
  sub: z.string(),
  tenantId: z.string(),
  roleId: z.string().nullable(),
  exp: z.number().int(),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** POST /api/auth/login response — refresh token is set as httpOnly cookie. */
export const LoginResponseSchema = z.object({
  accessToken: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/** POST /api/auth/invite/accept */
export const InviteAcceptRequestSchema = z
  .object({
    token: z.string(),
    /** Password-based activation — set a new password for the invited account. */
    password: z.string().min(8).optional(),
    /**
     * SSO-based activation — the verified OIDC `sub` claim from a completed IdP flow.
     * Activates the user without a password, recording auth_methods=['sso'].
     */
    ssoSubject: z.string().optional(),
  })
  .refine((d) => Boolean(d.password) || Boolean(d.ssoSubject), {
    message: "Either password or ssoSubject is required",
    path: ["password"],
  });
export type InviteAcceptRequest = z.infer<typeof InviteAcceptRequestSchema>;

/** POST /api/admin/users/invite — tenant-admin sends an invite. */
export const InviteUserRequestSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(256),
  roleId: z.string().optional(),
});
export type InviteUserRequest = z.infer<typeof InviteUserRequestSchema>;

export const InviteUserResponseSchema = z.object({
  userId: z.string(),
});
export type InviteUserResponse = z.infer<typeof InviteUserResponseSchema>;

/** GET /api/me — full profile needed by the SPA shell (S10). */
export const MeResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    displayName: z.string(),
    status: z.enum(["invited", "active", "suspended"]),
    authMethods: z.array(z.enum(["password", "sso"])),
  }),
  role: z.object({ id: z.string(), name: z.string() }).nullable(),
  capabilities: z.object({
    canInspectQuery: z.boolean(),
    isAdmin: z.boolean(),
  }),
  tenant: z.object({ id: z.string(), displayName: z.string() }),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** PATCH /api/me — update editable profile fields. */
export const UpdateMeRequestSchema = z.object({
  displayName: z.string().min(1).max(256),
});
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

/** POST /api/me/password — change password (password-auth users only). */
export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;
