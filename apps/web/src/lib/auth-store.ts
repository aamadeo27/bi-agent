/**
 * In-memory access token store.
 * Access token lives only in JS heap (never localStorage/sessionStorage).
 * Refresh token is httpOnly cookie managed by the server.
 */

// Module-level singleton — not persisted across page loads (by design).
let _accessToken: string | null = null;

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string): void {
  _accessToken = token;
}

export function clearAccessToken(): void {
  _accessToken = null;
}
