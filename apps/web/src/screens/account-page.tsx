import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMe, updateMe, changePassword, logout } from "../lib/api-client";
import { clearAccessToken } from "../lib/auth-store";
import type { MeResponse } from "@bi/contracts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function apiErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "An unexpected error occurred. Please try again.";
}

// ─── Field component ─────────────────────────────────────────────────────────

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  required?: boolean;
  isInvalid?: boolean;
  "aria-describedby"?: string | undefined;
}

function Field({
  id,
  label,
  type = "text",
  value,
  onChange,
  readOnly,
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
        readOnly={readOnly}
        disabled={disabled}
        required={required}
        aria-invalid={isInvalid ?? false}
        aria-describedby={ariaDescribedBy}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900 placeholder-neutral-500
          transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
          disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500
          read-only:cursor-default read-only:bg-neutral-100 read-only:text-neutral-500
          aria-invalid:border-semantic-error aria-invalid:ring-semantic-error"
      />
    </div>
  );
}

// ─── Profile section ─────────────────────────────────────────────────────────

function ProfileSection({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(me.user.displayName);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const updateMutation = useMutation({
    mutationFn: () => updateMe({ displayName }),
    onSuccess: () => {
      // Invalidate /me so next access reflects the change
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const isLoading = updateMutation.isPending;
  const isError = updateMutation.isError;
  const isSuccess = updateMutation.isSuccess;
  const errorMsg = isError ? apiErrorMessage(updateMutation.error) : null;

  useEffect(() => {
    if (isError && errorRef.current) errorRef.current.focus();
  }, [isError, updateMutation.error]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLoading) return;
    updateMutation.mutate();
  }

  return (
    <section aria-labelledby="profile-heading" className="rounded-lg border border-neutral-300 bg-white p-6">
      <h2 id="profile-heading" className="mb-4 text-heading-2 text-neutral-900">
        Profile
      </h2>

      {isError && errorMsg && (
        <p
          ref={errorRef}
          id="profile-error"
          role="alert"
          tabIndex={-1}
          className="mb-4 rounded-md border border-semantic-error/30 bg-semantic-error/10 px-3 py-2 text-body text-semantic-error outline-none"
        >
          {errorMsg}
        </p>
      )}

      {isSuccess && (
        <p
          role="status"
          aria-live="polite"
          className="mb-4 rounded-md border border-semantic-success/30 bg-semantic-success/10 px-3 py-2 text-body text-semantic-success"
        >
          Display name updated.
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate aria-label="Update profile" className="flex flex-col gap-4">
        <Field
          id="displayName"
          label="Display name"
          value={displayName}
          onChange={setDisplayName}
          disabled={isLoading}
          required
          isInvalid={isError}
          aria-describedby={isError ? "profile-error" : undefined}
        />
        <Field id="email" label="Email" value={me.user.email} readOnly />
        <Field id="role" label="Active role" value={me.role?.name ?? "No role assigned"} readOnly />
        <Field id="tenant" label="Workspace" value={me.tenant.displayName} readOnly />

        <div>
          <button
            type="submit"
            disabled={isLoading || displayName === me.user.displayName}
            aria-disabled={isLoading}
            className="rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white
              transition-colors hover:bg-primary-800
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
              disabled:cursor-not-allowed disabled:bg-primary-200 disabled:text-primary-500"
          >
            {isLoading ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ─── Password section ─────────────────────────────────────────────────────────

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const changeMutation = useMutation({
    mutationFn: () => changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMismatch(false);
    },
  });

  const isLoading = changeMutation.isPending;
  const isError = changeMutation.isError;
  const isSuccess = changeMutation.isSuccess;
  const errorMsg = isError ? apiErrorMessage(changeMutation.error) : null;

  useEffect(() => {
    if (isError && errorRef.current) errorRef.current.focus();
  }, [isError, changeMutation.error]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isLoading) return;
    if (newPassword !== confirmPassword) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    changeMutation.mutate();
  }

  return (
    <section aria-labelledby="password-heading" className="rounded-lg border border-neutral-300 bg-white p-6">
      <h2 id="password-heading" className="mb-4 text-heading-2 text-neutral-900">
        Change password
      </h2>

      {isError && errorMsg && (
        <p
          ref={errorRef}
          id="password-error"
          role="alert"
          tabIndex={-1}
          className="mb-4 rounded-md border border-semantic-error/30 bg-semantic-error/10 px-3 py-2 text-body text-semantic-error outline-none"
        >
          {errorMsg}
        </p>
      )}

      {mismatch && (
        <p
          id="password-mismatch"
          role="alert"
          className="mb-4 rounded-md border border-semantic-error/30 bg-semantic-error/10 px-3 py-2 text-body text-semantic-error"
        >
          Passwords do not match.
        </p>
      )}

      {isSuccess && (
        <p
          role="status"
          aria-live="polite"
          className="mb-4 rounded-md border border-semantic-success/30 bg-semantic-success/10 px-3 py-2 text-body text-semantic-success"
        >
          Password changed successfully.
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate aria-label="Change password" className="flex flex-col gap-4">
        <Field
          id="currentPassword"
          label="Current password"
          type="password"
          value={currentPassword}
          onChange={setCurrentPassword}
          disabled={isLoading}
          required
          isInvalid={isError}
          aria-describedby={isError ? "password-error" : undefined}
        />
        <Field
          id="newPassword"
          label="New password"
          type="password"
          value={newPassword}
          onChange={setNewPassword}
          disabled={isLoading}
          required
          isInvalid={mismatch}
          aria-describedby={mismatch ? "password-mismatch" : undefined}
        />
        <Field
          id="confirmPassword"
          label="Confirm new password"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          disabled={isLoading}
          required
          isInvalid={mismatch}
          aria-describedby={mismatch ? "password-mismatch" : undefined}
        />

        <div>
          <button
            type="submit"
            disabled={isLoading || !currentPassword || !newPassword || !confirmPassword}
            aria-disabled={isLoading}
            className="rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white
              transition-colors hover:bg-primary-800
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
              disabled:cursor-not-allowed disabled:bg-primary-200 disabled:text-primary-500"
          >
            {isLoading ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ─── Danger zone ─────────────────────────────────────────────────────────────

function DangerZone() {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => {
      clearAccessToken();
      navigate("/login", { replace: true });
    },
    onError: () => {
      // Even on error, clear local token and redirect — best-effort signout
      clearAccessToken();
      navigate("/login", { replace: true });
    },
  });

  function handleSignOutAll() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    logoutMutation.mutate();
  }

  return (
    <section
      aria-labelledby="danger-heading"
      className="rounded-lg border border-semantic-error/30 bg-white p-6"
    >
      <h2 id="danger-heading" className="mb-1 text-heading-2 text-semantic-error">
        Danger zone
      </h2>
      <p className="mb-4 text-body text-neutral-500">
        Sign out of all active sessions. You will need to sign in again.
      </p>

      {confirming && (
        <p role="alert" className="mb-3 text-body text-semantic-error">
          This will end all your sessions. Click again to confirm.
        </p>
      )}

      <button
        type="button"
        onClick={handleSignOutAll}
        disabled={logoutMutation.isPending}
        className="rounded-md border border-semantic-error px-4 py-2 text-body font-semibold text-semantic-error
          transition-colors hover:bg-semantic-error hover:text-white
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error focus-visible:ring-offset-2
          disabled:cursor-not-allowed disabled:opacity-50"
      >
        {logoutMutation.isPending ? "Signing out…" : confirming ? "Confirm sign out" : "Sign out of all sessions"}
      </button>
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AccountPage() {
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
  });

  if (meQuery.isPending) {
    return (
      <main className="min-h-screen bg-primary-50 px-4 py-8" aria-labelledby="account-heading">
        <div className="mx-auto max-w-2xl">
          <h1 id="account-heading" className="mb-6 text-display text-neutral-900">
            Account &amp; Profile
          </h1>
          <p className="text-body text-neutral-500" aria-live="polite">
            Loading…
          </p>
        </div>
      </main>
    );
  }

  if (meQuery.isError || !meQuery.data) {
    return (
      <main className="min-h-screen bg-primary-50 px-4 py-8" aria-labelledby="account-heading">
        <div className="mx-auto max-w-2xl">
          <h1 id="account-heading" className="mb-4 text-display text-neutral-900">
            Account &amp; Profile
          </h1>
          <p role="alert" className="text-body text-semantic-error">
            Failed to load profile. Please refresh the page.
          </p>
        </div>
      </main>
    );
  }

  const me = meQuery.data;
  const hasPasswordAuth = me.user.authMethods.includes("password");

  return (
    <main
      className="min-h-screen bg-primary-50 px-4 py-8"
      aria-labelledby="account-heading"
    >
      <div className="mx-auto max-w-2xl">
        <h1 id="account-heading" className="mb-6 text-display text-neutral-900">
          Account &amp; Profile
        </h1>

        <div className="flex flex-col gap-6">
          <ProfileSection me={me} />
          {hasPasswordAuth && <PasswordSection />}
          <DangerZone />
        </div>
      </div>
    </main>
  );
}
