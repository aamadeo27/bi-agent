import { useNavigate, useSearchParams } from "react-router-dom";
import { clearAccessToken } from "../lib/auth-store";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ErrorVariant = "not-found" | "forbidden" | "tenant-boundary" | "session-expired";

interface VariantConfig {
  heading: string;
  body: string;
  ctaLabel: string;
  onCta: (navigate: ReturnType<typeof useNavigate>) => void;
}

// ─── Variant config ───────────────────────────────────────────────────────────

const VARIANTS: Record<ErrorVariant, VariantConfig> = {
  "not-found": {
    heading: "Page Not Found",
    body: "This page doesn't exist.",
    ctaLabel: "Return to chat",
    onCta: (nav) => nav("/chat", { replace: true }),
  },
  forbidden: {
    heading: "Access Forbidden",
    body: "You don't have permission to view this page.",
    ctaLabel: "Return to chat",
    onCta: (nav) => nav("/chat", { replace: true }),
  },
  "tenant-boundary": {
    heading: "Workspace Access Denied",
    body: "You are not authorized to access this workspace.",
    ctaLabel: "Sign out",
    onCta: (nav) => { clearAccessToken(); nav("/login", { replace: true }); },
  },
  "session-expired": {
    heading: "Session Expired",
    body: "Your session has expired. Please sign in again.",
    ctaLabel: "Sign in",
    onCta: (nav) => { clearAccessToken(); nav("/login", { replace: true }); },
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface ErrorPageProps {
  /** When provided, overrides the ?type query param. Used for testing/explicit rendering. */
  variant?: ErrorVariant | undefined;
}

export function ErrorPage({ variant: propVariant }: ErrorPageProps = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const typeParam = searchParams.get("type") as ErrorVariant | null;
  const variant: ErrorVariant =
    propVariant ??
    (typeParam && typeParam in VARIANTS ? typeParam : "not-found");

  const config = VARIANTS[variant];

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center bg-primary-50 px-4 text-center"
      aria-labelledby="error-heading"
    >
      {/* Icon */}
      <div aria-hidden="true" className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary-200">
        {variant === "not-found" && <NotFoundIcon className="h-8 w-8 text-primary-700" />}
        {variant === "forbidden" && <ForbiddenIcon className="h-8 w-8 text-semantic-error" />}
        {variant === "tenant-boundary" && <TenantIcon className="h-8 w-8 text-semantic-warning" />}
        {variant === "session-expired" && <SessionIcon className="h-8 w-8 text-primary-700" />}
      </div>

      <h1
        id="error-heading"
        className="mb-2 text-heading-1 text-neutral-900"
      >
        {config.heading}
      </h1>

      <p className="mb-8 max-w-sm text-body text-neutral-500">{config.body}</p>

      <button
        type="button"
        onClick={() => config.onCta(navigate)}
        className="rounded-md bg-primary-700 px-6 py-2.5 text-body font-semibold text-white
          transition-colors hover:bg-primary-800
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
      >
        {config.ctaLabel}
      </button>
    </main>
  );
}

// ─── Inline icons ─────────────────────────────────────────────────────────────

function NotFoundIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ForbiddenIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  );
}

function TenantIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function SessionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
