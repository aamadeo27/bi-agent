import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { login, getTenantSsoConfig, getSsoStartUrl } from "../lib/api-client";
import { setAccessToken } from "../lib/auth-store";
import { getTenantSlug } from "../lib/tenant";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  // Raw Error instances (e.g. network failures) → generic user-friendly message
  if (err instanceof Error) {
    return "An unexpected error occurred. Please try again.";
  }
  // Typed API errors carry a message field
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "An unexpected error occurred. Please try again.";
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SessionExpiredBanner() {
  return (
    // role="alert" already implies aria-live="assertive"; no extra aria-live needed.
    <div
      role="alert"
      className="mb-4 rounded-md border border-semantic-warning/40 bg-semantic-warning/10 px-4 py-3 text-body text-neutral-700"
    >
      Your session has expired. Please sign in again.
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  disabled?: boolean;
  required?: boolean;
  isInvalid?: boolean;
  "aria-describedby"?: string;
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  disabled,
  required,
  isInvalid,
  "aria-describedby": ariaDescribedBy,
}: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-body-sm font-semibold text-neutral-700">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-semantic-error">
            *
          </span>
        )}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
        aria-invalid={isInvalid ?? false}
        aria-describedby={ariaDescribedBy}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900 placeholder-neutral-500
          transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
          disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500
          aria-invalid:border-semantic-error aria-invalid:ring-semantic-error"
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get("reason") === "session_expired";

  const tenantSlug = getTenantSlug();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Query SSO config only when a tenant subdomain is present
  const ssoQuery = useQuery({
    queryKey: ["sso-config", tenantSlug],
    queryFn: () => getTenantSsoConfig(tenantSlug!),
    enabled: tenantSlug !== null,
    retry: false,
    // If SSO config check fails, treat as not available (hide button)
  });

  const ssoEnabled = ssoQuery.data?.ssoEnabled ?? false;

  const loginMutation = useMutation({
    mutationFn: () => login({ email, password }),
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      navigate("/chat", { replace: true });
    },
  });

  // Derive all form display state directly from mutation — no manual sync needed.
  const isLoading = loginMutation.isPending;
  const isError = loginMutation.isError;
  const formError = isError ? errorMessage(loginMutation.error) : null;

  // Focus error message when it first appears (WCAG 2.1 §3.3.1)
  useEffect(() => {
    if (isError && errorRef.current) {
      errorRef.current.focus();
    }
  }, [isError, loginMutation.error]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLoading) return;
    loginMutation.mutate();
  }

  function handleSso() {
    if (!tenantSlug) return;
    window.location.href = getSsoStartUrl(tenantSlug);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-primary-50 px-4">
      <div
        className="w-full max-w-sm rounded-xl bg-white px-8 py-10 shadow-md"
        aria-label="Sign in to your account"
      >
        {/* Logo / App name */}
        <div className="mb-6 text-center">
          <span className="text-display text-primary-700">BI Agent</span>
          {tenantSlug && (
            <p className="mt-1 text-body-sm text-neutral-500">
              Signing in to{" "}
              <strong className="font-semibold text-neutral-700">{tenantSlug}</strong>
            </p>
          )}
        </div>

        {/* Session-expired banner */}
        {sessionExpired && <SessionExpiredBanner />}

        <h1 className="mb-6 text-heading-1 text-neutral-900">Sign In</h1>

        {/* Error message */}
        {isError && formError && (
          <p
            ref={errorRef}
            id="login-error"
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
            className="mb-4 rounded-md border border-semantic-error/30 bg-semantic-error/10 px-3 py-2 text-body text-semantic-error outline-none"
          >
            {formError}
          </p>
        )}

        {/* Email + Password form */}
        <form onSubmit={handleSubmit} noValidate aria-label="Email and password sign in">
          <div className="flex flex-col gap-4">
            <Field
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              disabled={isLoading}
              required
              isInvalid={isError}
              aria-describedby={isError ? "login-error" : undefined}
            />
            <Field
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              disabled={isLoading}
              required
              isInvalid={isError}
              aria-describedby={isError ? "login-error" : undefined}
            />
          </div>

          {/* Forgot password */}
          <div className="mt-2 text-right">
            <a
              href="/forgot-password"
              className="text-body-sm text-primary-600 underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              Forgot password?
            </a>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            aria-disabled={isLoading}
            className="mt-6 w-full rounded-md bg-primary-700 px-4 py-2.5 text-body font-semibold text-white
              transition-colors
              hover:bg-primary-800
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
              disabled:cursor-not-allowed disabled:bg-primary-200 disabled:text-primary-500"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2" aria-label="Signing in…">
                <SpinnerIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
                Signing in…
              </span>
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        {/* SSO button — conditional on tenant OIDC */}
        {ssoEnabled && (
          <>
            <div className="my-4 flex items-center gap-2" aria-hidden="true">
              <div className="h-px flex-1 bg-neutral-300" />
              <span className="text-body-sm text-neutral-500">or</span>
              <div className="h-px flex-1 bg-neutral-300" />
            </div>
            <button
              type="button"
              onClick={handleSso}
              disabled={isLoading}
              className="w-full rounded-md border border-neutral-300 bg-white px-4 py-2.5 text-body font-semibold text-neutral-700
                transition-colors
                hover:bg-neutral-50
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                disabled:cursor-not-allowed disabled:text-neutral-400"
            >
              Continue with SSO
            </button>
          </>
        )}
      </div>
    </main>
  );
}

// ─── Inline spinner icon (no external dep) ───────────────────────────────────

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
