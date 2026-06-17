import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
  ConversationSummary,
  GeneratedQueryView,
} from "@bi/contracts";
import { ApiErrorResponseSchema } from "@bi/contracts";

const BASE = "/api";

/**
 * Generic fetch wrapper. Throws a parsed `ApiErrorResponse` on non-2xx,
 * or a raw `{ code: "INTERNAL", message }` if the body is not JSON.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

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

/** GET /api/me → current user + capabilities. */
export async function getMe(): Promise<MeResponse> {
  return request<MeResponse>("/me");
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
