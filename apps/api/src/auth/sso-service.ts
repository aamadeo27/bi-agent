/**
 * Per-tenant SSO / OIDC — auth-code flow with PKCE.
 *
 * State lifecycle:
 *   /start    → generate PKCE verifier + OIDC state/nonce → sign into short-lived
 *               httpOnly cookie → redirect to IdP.
 *   /callback → verify cookie signature + expiry → exchange code for tokens →
 *               extract OIDC subject → find/bind tenant user → issue JWT + refresh.
 *
 * Matching strategy (invite-first, subject-bound):
 *   1. Primary lookup by ssoSubject (already bound on a prior login).
 *   2. First-login fallback: find by email (case-insensitive, null ssoSubject) →
 *      bind the subject and continue.
 *   3. No match → AUTH error; user must be invited first.
 *
 * This ensures each OIDC subject is cryptographically bound to exactly one
 * platform user after first login, and subsequent logins are subject-only.
 *
 * NOTE: clientSecret is stored as plaintext; encrypt at rest via vault before v1.
 */
import { Issuer, generators } from "openid-client";
import type { PrismaClient } from "@prisma/client";
import { SignJWT, jwtVerify } from "jose";
import { signAccessToken, createRefreshToken } from "./token-service.js";
import type { AuthTokens } from "./auth-service.js";

// ── SSO state cookie ──────────────────────────────────────────────────────────

export const SSO_STATE_COOKIE = "sso_state";
const SSO_STATE_TTL = "5m";

export interface SsoStatePayload {
  oidcState: string;
  nonce: string;
  codeVerifier: string;
  tenantSlug: string;
}

function getSecretKey(): Uint8Array {
  const s = process.env["JWT_SECRET"];
  if (!s) throw new Error("JWT_SECRET env var is required");
  return new TextEncoder().encode(s);
}

/**
 * Sign the OIDC flow parameters into a short-lived (5m) httpOnly cookie.
 * The signature prevents CSRF and state-tampering across the IdP round-trip.
 */
export async function signSsoState(payload: SsoStatePayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(SSO_STATE_TTL)
    .sign(getSecretKey());
}

/**
 * Verify and decode the SSO state cookie.
 * Throws { code: "AUTH" } if the token is expired, tampered, or missing fields.
 * Throws { code: "INTERNAL" } if JWT_SECRET is not configured (config error, not
 * an auth failure — must not be swallowed as AUTH).
 */
export async function verifySsoState(token: string): Promise<SsoStatePayload> {
  // Resolve the key BEFORE the try-catch so a missing JWT_SECRET propagates as
  // an INTERNAL config error rather than being caught and re-thrown as AUTH.
  const key = getSecretKey();
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    const { oidcState, nonce, codeVerifier, tenantSlug } =
      payload as Record<string, unknown>;
    if (
      typeof oidcState !== "string" ||
      typeof nonce !== "string" ||
      typeof codeVerifier !== "string" ||
      typeof tenantSlug !== "string"
    ) {
      throw new Error("Missing required SSO state fields");
    }
    return { oidcState, nonce, codeVerifier, tenantSlug };
  } catch {
    throw Object.assign(new Error("Invalid or expired SSO state"), {
      code: "AUTH",
    });
  }
}

// ── Config loading ────────────────────────────────────────────────────────────

export interface ResolvedSsoConfig {
  tenantId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

/**
 * Resolve tenant slug → tenant row → SSO config row.
 * Throws NOT_FOUND if the tenant is missing or has no SSO config.
 */
export async function loadSsoConfig(
  tenantSlug: string,
  db: PrismaClient
): Promise<ResolvedSsoConfig> {
  const tenant = await db.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    throw Object.assign(new Error("Tenant not found"), { code: "NOT_FOUND" });
  }

  const cfg = await db.tenantSsoConfig.findUnique({
    where: { tenantId: tenant.id },
  });
  if (!cfg) {
    throw Object.assign(new Error("SSO not configured for this tenant"), {
      code: "NOT_FOUND",
    });
  }

  return {
    tenantId: tenant.id,
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    callbackUrl: cfg.callbackUrl,
  };
}

// ── Start ─────────────────────────────────────────────────────────────────────

/**
 * Build the IdP authorization URL and sign the PKCE/state values into a cookie.
 * The caller should redirect 302 to authUrl and set the SSO state cookie.
 */
export async function buildSsoStartUrl(
  config: ResolvedSsoConfig,
  tenantSlug: string
): Promise<{ authUrl: string; stateCookie: string }> {
  const oidcIssuer = await Issuer.discover(config.issuer);
  const client = new oidcIssuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.callbackUrl],
    response_types: ["code"],
  });

  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const oidcState = generators.state();
  const nonce = generators.nonce();

  const authUrl = client.authorizationUrl({
    scope: "openid email profile",
    state: oidcState,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const stateCookie = await signSsoState({
    oidcState,
    nonce,
    codeVerifier,
    tenantSlug,
  });

  return { authUrl, stateCookie };
}

// ── Callback ──────────────────────────────────────────────────────────────────

/**
 * Exchange the authorization code and map the OIDC subject to a platform user.
 *
 * Subject-binding (invite-first model):
 *   1. Look up user by ssoSubject (already bound on a prior SSO login).
 *   2. First-login: look up by email (lowercase) with null ssoSubject → bind
 *      the subject so subsequent logins use subject lookup directly.
 *   3. No match → AUTH; user must be invited before SSO can be used.
 *
 * Rejects with AUTH when:
 *   - OIDC state param does not match the signed cookie.
 *   - No matching invited/active tenant user exists.
 *   - User already has a different ssoSubject bound (prevents subject swapping).
 * Throws INTERNAL when tenantId is unexpectedly null (data invariant violation).
 */
export async function handleSsoCallback(
  code: string,
  oidcStateParam: string,
  ssoState: SsoStatePayload,
  config: ResolvedSsoConfig,
  db: PrismaClient
): Promise<AuthTokens> {
  if (oidcStateParam !== ssoState.oidcState) {
    throw Object.assign(new Error("OIDC state mismatch"), { code: "AUTH" });
  }

  const oidcIssuer = await Issuer.discover(config.issuer);
  const client = new oidcIssuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.callbackUrl],
    response_types: ["code"],
  });

  const tokenSet = await client.callback(
    config.callbackUrl,
    { code, state: oidcStateParam },
    {
      code_verifier: ssoState.codeVerifier,
      state: ssoState.oidcState,
      nonce: ssoState.nonce,
    }
  );

  const claims = tokenSet.claims();
  // `sub` is guaranteed present in all OIDC id_tokens.
  const sub = claims.sub;
  // Normalize email to lowercase to match invite-stored emails.
  const email = (claims.email as string | undefined)?.toLowerCase();

  // ── Phase 1: primary lookup by bound subject ────────────────────────────────
  let user = await db.user.findUnique({ where: { ssoSubject: sub } });

  if (user) {
    // Subject already bound — verify it belongs to this tenant and is eligible.
    if (
      user.tenantId !== config.tenantId ||
      (user.status !== "invited" && user.status !== "active")
    ) {
      throw Object.assign(
        new Error("SSO subject not authorised for this tenant"),
        { code: "AUTH" }
      );
    }
  } else {
    // ── Phase 2: first-login binding via email ────────────────────────────────
    if (!email) {
      throw Object.assign(
        new Error(
          "OIDC id_token missing email claim; cannot resolve unbound subject"
        ),
        { code: "AUTH" }
      );
    }

    const byEmail = await db.user.findUnique({ where: { email } });

    if (
      !byEmail ||
      byEmail.tenantId !== config.tenantId ||
      (byEmail.status !== "invited" && byEmail.status !== "active") ||
      byEmail.ssoSubject !== null // already bound to a different subject
    ) {
      throw Object.assign(
        new Error(
          "OIDC subject not linked to an invited/active tenant user — invite required"
        ),
        { code: "AUTH" }
      );
    }

    // Bind the OIDC subject to this user record (idempotent on retry because
    // subsequent logins hit Phase 1 via the unique ssoSubject index).
    user = await db.user.update({
      where: { id: byEmail.id },
      data: { ssoSubject: sub },
    });
  }

  // ── Activate invited user on first successful SSO login ─────────────────────
  const effectiveUser =
    user.status === "invited"
      ? await db.user.update({
          where: { id: user.id },
          data: { status: "active" },
        })
      : user;

  // tenantId must be set — it is verified above, so null here is a data invariant
  // violation that should never happen in practice.
  if (!effectiveUser.tenantId) {
    throw Object.assign(
      new Error("User tenantId is null after tenant verification — data invariant violated"),
      { code: "INTERNAL" }
    );
  }

  const accessToken = await signAccessToken({
    sub: effectiveUser.id,
    tenantId: effectiveUser.tenantId,
    roleId: effectiveUser.roleId ?? null,
  });

  const { raw: refreshRaw, expiresAt: refreshExpiresAt } =
    await createRefreshToken(effectiveUser.id, db);

  return { accessToken, refreshRaw, refreshExpiresAt };
}
