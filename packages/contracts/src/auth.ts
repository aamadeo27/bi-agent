// TODO: Full schema definition in contracts.md §auth-api
import { z } from "zod";

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

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

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
