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
export const InviteAcceptRequestSchema = z.object({
  token: z.string(),
  password: z.string().min(8).optional(),
});
export type InviteAcceptRequest = z.infer<typeof InviteAcceptRequestSchema>;

/** GET /api/me */
export const MeResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    displayName: z.string(),
    status: z.enum(["invited", "active", "suspended"]),
  }),
  roleId: z.string().nullable(),
  capabilities: z.object({
    canInspectQuery: z.boolean(),
  }),
  tenantId: z.string(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
