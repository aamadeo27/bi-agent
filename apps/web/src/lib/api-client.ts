import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  UpdateMeRequest,
  ChangePasswordRequest,
  ConversationSummary,
  GeneratedQueryView,
  Role,
  User,
  ResourceGrantSet,
  SchemaTree,
  DataSource,
  AuditEvent,
  AuditEventType,
} from "@bi/contracts";
import { ApiErrorResponseSchema } from "@bi/contracts";
import { getAccessToken, setAccessToken, clearAccessToken } from "./auth-store";

const BASE = "/api";

/** Paths that must NOT trigger the auto-refresh loop on 401. */
const NO_REFRESH_PATHS = new Set([
  "/auth/login",
  "/auth/refresh",
  "/auth/logout",
  "/me/logout-all", // signing out — never auto-refresh mid-flight
]);

/**
 * Generic fetch wrapper. Injects Bearer token when available.
 * On 401 (outside auth paths), attempts one silent token refresh.
 * If refresh fails, clears token and redirects to /login?reason=session_expired.
 * Throws a parsed `ApiErrorResponse` on non-2xx.
 */
async function request<T>(
  path: string,
  init?: Parameters<typeof fetch>[1],
  { skipRefresh = false }: { skipRefresh?: boolean } = {},
): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include", // needed so the httpOnly refresh cookie is sent
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  // Auto-refresh on 401 (once, outside auth paths)
  if (res.status === 401 && !skipRefresh && !NO_REFRESH_PATHS.has(path)) {
    try {
      const refreshed = await refreshToken();
      setAccessToken(refreshed.accessToken);
      // Retry original request with new token
      return request<T>(path, init, { skipRefresh: true });
    } catch {
      clearAccessToken();
      // Notify the SPA via event so the router layer decides how to navigate
      // (avoids making a routing architectural decision inside a utility module).
      window.dispatchEvent(new CustomEvent("auth:session-expired"));
      // Throw so callers receive a rejected promise rather than stale undefined data.
      throw { code: "AUTH" as const, message: "Session expired." };
    }
  }

  if (!res.ok) {
    let errBody: unknown;
    try {
      errBody = await res.json();
    } catch {
      errBody = { code: "INTERNAL", message: res.statusText };
    }
    const parsed = ApiErrorResponseSchema.safeParse(errBody);
    throw parsed.success ? parsed.data : { code: "INTERNAL", message: String(errBody) };
  }

  // 204 No Content — nothing to deserialize
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

/** POST /api/auth/login → access token (refresh token set as httpOnly cookie). */
export async function login(req: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/**
 * POST /api/auth/refresh → rotate access + refresh tokens.
 * Called internally by the request wrapper on 401; also exported for explicit use.
 */
export async function refreshToken(): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/refresh", { method: "POST" }, { skipRefresh: true });
}

/** POST /api/auth/logout → revoke refresh token. */
export async function logout(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" }, { skipRefresh: true });
}

/**
 * GET /api/auth/sso/:tenantSlug → whether OIDC is configured for the tenant.
 * This endpoint is the natural prefix of /api/auth/sso/:tenant/start.
 * NOTE: this is an implicit contract extension; see coder_summary concerns.
 */
export async function getTenantSsoConfig(
  tenantSlug: string,
): Promise<{ ssoEnabled: boolean }> {
  return request<{ ssoEnabled: boolean }>(`/auth/sso/${encodeURIComponent(tenantSlug)}`);
}

/**
 * Returns the absolute URL to initiate the OIDC code flow for a tenant.
 * The browser should navigate to this URL (window.location.href = ...).
 */
export function getSsoStartUrl(tenantSlug: string): string {
  return `${BASE}/auth/sso/${encodeURIComponent(tenantSlug)}/start`;
}

/** GET /api/me → current user + capabilities. */
export async function getMe(): Promise<MeResponse> {
  return request<MeResponse>("/me");
}

/** PATCH /api/me → update display name. */
export async function updateMe(data: UpdateMeRequest): Promise<void> {
  return request<void>("/me", { method: "PATCH", body: JSON.stringify(data) });
}

/** POST /api/me/password → change password (password-auth users only). */
export async function changePassword(data: ChangePasswordRequest): Promise<void> {
  return request<void>("/me/password", { method: "POST", body: JSON.stringify(data) });
}

/**
 * POST /api/me/logout-all → invalidates all sessions for the current user.
 * Sets token_invalidated_at in the tenant DB so future token refreshes are
 * rejected. The in-memory access token must be cleared client-side after calling.
 */
export async function logoutAll(): Promise<void> {
  return request<void>("/me/logout-all", { method: "POST" }, { skipRefresh: true });
}

// ─── Conversations ────────────────────────────────────────────────────────────

/** GET /api/conversations → tenant+user scoped list. */
export async function listConversations(): Promise<ConversationSummary[]> {
  return request<ConversationSummary[]>("/conversations");
}

/** POST /api/conversations → create an empty conversation. */
export async function createConversation(): Promise<ConversationSummary> {
  return request<ConversationSummary>("/conversations", { method: "POST" });
}

/** DELETE /api/conversations/:id → remove conversation and all its messages. */
export async function deleteConversation(conversationId: string): Promise<void> {
  return request<void>(`/conversations/${conversationId}`, { method: "DELETE" });
}

// ─── Messages ─────────────────────────────────────────────────────────────────

/** GET /api/messages/:id/query → generated query view (requires canInspectQuery). */
export async function getGeneratedQuery(messageId: string): Promise<GeneratedQueryView> {
  return request<GeneratedQueryView>(`/messages/${messageId}/query`);
}

// ─── Admin: Roles ─────────────────────────────────────────────────────────────

export interface CreateRoleRequest {
  name: string;
  description?: string;
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string;
  capabilities?: { canInspectQuery: boolean };
}

/** GET /api/admin/roles → tenant-scoped role list. */
export async function listRoles(): Promise<Role[]> {
  return request<Role[]>("/admin/roles");
}

/** POST /api/admin/roles → create a new role. */
export async function createRole(data: CreateRoleRequest): Promise<Role> {
  return request<Role>("/admin/roles", { method: "POST", body: JSON.stringify(data) });
}

/** PATCH /api/admin/roles/:id → update role name/description/capabilities. */
export async function updateRole(id: string, data: UpdateRoleRequest): Promise<Role> {
  return request<Role>(`/admin/roles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** DELETE /api/admin/roles/:id → remove role (server rejects if users still assigned). */
export async function deleteRole(id: string): Promise<void> {
  return request<void>(`/admin/roles/${id}`, { method: "DELETE" });
}

/** GET /api/admin/roles/:id/grants → effective grant set for the role. */
export async function listRoleGrants(roleId: string): Promise<ResourceGrantSet> {
  return request<ResourceGrantSet>(`/admin/roles/${roleId}/grants`);
}

/** PUT /api/admin/roles/:id/grants → replace entire grant set for the role (batch save). */
export async function putRoleGrants(roleId: string, grants: ResourceGrantSet): Promise<void> {
  return request<void>(`/admin/roles/${roleId}/grants`, {
    method: "PUT",
    body: JSON.stringify(grants),
  });
}

// ─── Admin: Schema tree ───────────────────────────────────────────────────────

/** GET /api/admin/schema/:dataSourceId → schema tree (schema>table>column) for the permission editor. */
export async function getSchemaTree(dataSourceId: string): Promise<SchemaTree> {
  return request<SchemaTree>(`/admin/schema/${encodeURIComponent(dataSourceId)}`);
}

// ─── Admin: Data Sources ──────────────────────────────────────────────────────

/** GET /api/admin/data-sources → tenant-scoped data source list. */
export async function listDataSources(): Promise<DataSource[]> {
  return request<DataSource[]>("/admin/data-sources");
}

export interface DataSourcePayload {
  name: string;
  type: "postgres" | "mysql" | "bigquery" | "rest";
  // postgres / mysql fields
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  // bigquery fields
  projectId?: string;
  dataset?: string;
  serviceAccountJson?: string;
  // rest fields
  baseUrl?: string;
  apiKey?: string;
}

export interface TestDataSourceResult {
  ok: boolean;
  error?: string;
  testedAt: string;
}

/** POST /api/admin/data-sources → create a new data source. */
export async function createDataSource(data: DataSourcePayload): Promise<DataSource> {
  return request<DataSource>("/admin/data-sources", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** PATCH /api/admin/data-sources/:id → update name, type, or connection fields. */
export async function updateDataSource(
  id: string,
  data: Partial<DataSourcePayload>,
): Promise<DataSource> {
  return request<DataSource>(`/admin/data-sources/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** DELETE /api/admin/data-sources/:id → remove a data source. */
export async function deleteDataSource(id: string): Promise<void> {
  return request<void>(`/admin/data-sources/${id}`, { method: "DELETE" });
}

/** POST /api/admin/data-sources/:id/test → run connectivity check and return result. */
export async function testDataSource(id: string): Promise<TestDataSourceResult> {
  return request<TestDataSourceResult>(`/admin/data-sources/${id}/test`, { method: "POST" });
}

// ─── Admin: Users ─────────────────────────────────────────────────────────────

/** GET /api/admin/users → tenant-scoped user list. */
export async function listAdminUsers(): Promise<User[]> {
  return request<User[]>("/admin/users");
}

export interface PatchUserRequest {
  roleId?: string | null;
  status?: "active" | "suspended";
}

/** PATCH /api/admin/users/:id → assign role or suspend/reinstate. */
export async function patchAdminUser(id: string, data: PatchUserRequest): Promise<User> {
  return request<User>(`/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export interface InviteUserPayload {
  email: string;
  displayName: string;
  roleId?: string;
}

/** POST /api/admin/users/invite → send email invite for a new tenant user. */
export async function inviteUser(data: InviteUserPayload): Promise<{ userId: string }> {
  return request<{ userId: string }>("/admin/users/invite", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ─── Admin: Audit Log ─────────────────────────────────────────────────────────

export interface AuditLogParams {
  from?: string;
  to?: string;
  type?: AuditEventType[];
  userId?: string;
  dataSourceId?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogResponse {
  events: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /api/admin/audit → paginated, filtered audit event list (admin-gated). */
export async function getAuditLog(params: AuditLogParams = {}): Promise<AuditLogResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.type?.length) qs.set("type", params.type.join(","));
  if (params.userId) qs.set("userId", params.userId);
  if (params.dataSourceId) qs.set("dataSourceId", params.dataSourceId);
  if (params.page != null) qs.set("page", String(params.page));
  if (params.pageSize != null) qs.set("pageSize", String(params.pageSize));
  const q = qs.toString();
  return request<AuditLogResponse>(`/admin/audit${q ? `?${q}` : ""}`);
}
