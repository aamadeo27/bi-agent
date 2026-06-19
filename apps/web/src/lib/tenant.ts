/**
 * Resolves the tenant slug from the current hostname subdomain.
 *
 * Conventions:
 *   acme.app.example.com → "acme"  (first subdomain, if not a reserved label)
 *   app.example.com       → null    (no tenant subdomain)
 *   localhost             → null    (dev: no tenant)
 *   acme.localhost        → "acme"  (dev: explicit tenant subdomain)
 *
 * Reserved labels that are NOT tenant slugs: "www", "app", "api", "localhost".
 */

const RESERVED = new Set(["www", "app", "api", "localhost"]);

export function getTenantSlug(hostname = window.location.hostname): string | null {
  // Strip port if present
  const host = hostname.split(":")[0];
  const parts = host.split(".");

  // Need at least <subdomain>.<something> to have a subdomain
  if (parts.length < 2) return null;

  const first = parts[0];
  if (RESERVED.has(first)) return null;

  return first;
}
