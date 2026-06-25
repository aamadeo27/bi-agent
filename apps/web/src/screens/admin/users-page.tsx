import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import * as Toast from "@radix-ui/react-toast";
import type { User, Role } from "@bi/contracts";
import {
  listAdminUsers,
  listRoles,
  patchAdminUser,
  inviteUser,
} from "../../lib/api-client";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function apiErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "An unexpected error occurred. Please try again.";
}

// ─── GAP-17 propagation warning banner ───────────────────────────────────────

interface Gap17BannerProps {
  onDismiss: () => void;
}

function Gap17Banner({ onDismiss }: Gap17BannerProps) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="mb-4 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-amber-500">⚠</span>
      <p className="flex-1 text-body">
        <strong>Role change saved.</strong> Changes will take effect on the user&rsquo;s next
        login or session refresh.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss warning"
        className="ml-auto shrink-0 rounded p-0.5 text-amber-700 hover:bg-amber-100
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: User["status"] }) {
  const map: Record<User["status"], string> = {
    active: "bg-semantic-success/15 text-semantic-success",
    invited: "bg-primary-100 text-primary-700",
    suspended: "bg-neutral-200 text-neutral-600",
  };
  const labels: Record<User["status"], string> = {
    active: "Active",
    invited: "Invited",
    suspended: "Suspended",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-body-sm font-semibold ${map[status]}`}
    >
      {labels[status]}
    </span>
  );
}

// ─── Inline role editor (row-level) ──────────────────────────────────────────

interface InlineRoleEditorProps {
  user: User;
  roles: Role[];
  onSaved: () => void;
  onCancel: () => void;
}

function InlineRoleEditor({ user, roles, onSaved, onCancel }: InlineRoleEditorProps) {
  const qc = useQueryClient();
  const [selectedRoleId, setSelectedRoleId] = useState<string>(user.roleId ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      patchAdminUser(user.id, { roleId: selectedRoleId === "" ? null : selectedRoleId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["adminUsers"] });
      onSaved();
    },
  });

  const isDirty = selectedRoleId !== (user.roleId ?? "");
  const errorMsg = mutation.isError ? apiErrorMessage(mutation.error) : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor={`role-select-${user.id}`} className="sr-only">
          Select role for {user.displayName}
        </label>
        <select
          id={`role-select-${user.id}`}
          value={selectedRoleId}
          onChange={(e) => setSelectedRoleId(e.target.value)}
          disabled={mutation.isPending}
          className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-body text-neutral-900
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1
            disabled:cursor-not-allowed disabled:bg-neutral-100"
        >
          <option value="">No role</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!isDirty || mutation.isPending}
          aria-disabled={!isDirty || mutation.isPending}
          className="rounded-md bg-primary-700 px-3 py-1 text-body-sm font-semibold text-white
            transition-colors hover:bg-primary-800
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1
            disabled:cursor-not-allowed disabled:bg-primary-200 disabled:text-primary-500"
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={mutation.isPending}
          className="rounded-md border border-neutral-300 px-3 py-1 text-body-sm font-medium text-neutral-700
            transition-colors hover:bg-neutral-100
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1
            disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {errorMsg && (
        <p role="alert" className="text-body-sm text-semantic-error">
          {errorMsg}
        </p>
      )}
    </div>
  );
}

// ─── User table row ───────────────────────────────────────────────────────────

interface UserRowProps {
  user: User;
  roles: Role[];
  isEditingRole: boolean;
  onEditRole: () => void;
  onRoleSaved: () => void;
  onCancelEdit: () => void;
  onStatusChange: (userId: string, newStatus: "active" | "suspended") => void;
  statusChangePending: boolean;
}

function UserTableRow({
  user,
  roles,
  isEditingRole,
  onEditRole,
  onRoleSaved,
  onCancelEdit,
  onStatusChange,
  statusChangePending,
}: UserRowProps) {
  const currentRole = roles.find((r) => r.id === user.roleId);

  return (
    <tr className="border-b border-neutral-100 hover:bg-neutral-50">
      {/* Name */}
      <td className="px-4 py-3">
        <span className="text-body font-semibold text-neutral-900">{user.displayName}</span>
      </td>
      {/* Email */}
      <td className="px-4 py-3 text-body text-neutral-700">{user.email}</td>
      {/* Role */}
      <td className="px-4 py-3">
        {isEditingRole ? (
          <InlineRoleEditor
            user={user}
            roles={roles}
            onSaved={onRoleSaved}
            onCancel={onCancelEdit}
          />
        ) : (
          <span className="text-body text-neutral-700">
            {currentRole ? currentRole.name : <span className="italic text-neutral-400">No role</span>}
          </span>
        )}
      </td>
      {/* Status */}
      <td className="px-4 py-3">
        <StatusBadge status={user.status} />
      </td>
      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          {!isEditingRole && (
            <button
              type="button"
              onClick={onEditRole}
              className="rounded px-2 py-1 text-body-sm font-medium text-primary-600
                hover:bg-primary-50
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
            >
              Edit role
            </button>
          )}
          {user.status !== "suspended" ? (
            <button
              type="button"
              onClick={() => onStatusChange(user.id, "suspended")}
              disabled={statusChangePending}
              aria-disabled={statusChangePending}
              className="rounded px-2 py-1 text-body-sm font-medium text-semantic-error
                hover:bg-semantic-error/10
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error focus-visible:ring-offset-1
                disabled:cursor-not-allowed disabled:opacity-50"
            >
              Suspend
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onStatusChange(user.id, "active")}
              disabled={statusChangePending}
              aria-disabled={statusChangePending}
              className="rounded px-2 py-1 text-body-sm font-medium text-semantic-success
                hover:bg-semantic-success/10
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-success focus-visible:ring-offset-1
                disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reinstate
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Invite modal ─────────────────────────────────────────────────────────────

interface InviteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
  onSuccess: (msg: string) => void;
}

function InviteModal({ open, onOpenChange, roles, onSuccess }: InviteModalProps) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleId, setRoleId] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () =>
      inviteUser({
        email: email.trim(),
        displayName: displayName.trim(),
        ...(roleId ? { roleId } : {}),
      }),
    onSuccess: () => {
      onSuccess(`Invite sent to ${email.trim()}.`);
      onOpenChange(false);
      setEmail("");
      setDisplayName("");
      setRoleId("");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !displayName.trim() || mutation.isPending) return;
    mutation.mutate();
  }

  function handleOpenChange(v: boolean) {
    if (!mutation.isPending) {
      onOpenChange(v);
      if (!v) {
        setEmail("");
        setDisplayName("");
        setRoleId("");
        mutation.reset();
      }
    }
  }

  const errorMsg = mutation.isError ? apiErrorMessage(mutation.error) : null;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 animate-in fade-in-0" />
        <Dialog.Content
          aria-describedby="invite-modal-description"
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            emailRef.current?.focus();
          }}
        >
          <Dialog.Title className="mb-1 text-heading-2 text-neutral-900">
            Invite user
          </Dialog.Title>
          <Dialog.Description id="invite-modal-description" className="mb-4 text-body text-neutral-500">
            Send an invite email. The recipient will set their password on first login.
          </Dialog.Description>

          {errorMsg && (
            <p role="alert" className="mb-4 rounded-md border border-semantic-error/30 bg-semantic-error/10 px-3 py-2 text-body text-semantic-error">
              {errorMsg}
            </p>
          )}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="invite-email" className="text-body-sm font-semibold text-neutral-700">
                Email address <span aria-hidden="true" className="text-semantic-error">*</span>
              </label>
              <input
                id="invite-email"
                ref={emailRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                aria-required="true"
                disabled={mutation.isPending}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                  disabled:cursor-not-allowed disabled:bg-neutral-100"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="invite-name" className="text-body-sm font-semibold text-neutral-700">
                Display name <span aria-hidden="true" className="text-semantic-error">*</span>
              </label>
              <input
                id="invite-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={256}
                required
                aria-required="true"
                disabled={mutation.isPending}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                  disabled:cursor-not-allowed disabled:bg-neutral-100"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="invite-role" className="text-body-sm font-semibold text-neutral-700">
                Role <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <select
                id="invite-role"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                disabled={mutation.isPending}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                  disabled:cursor-not-allowed disabled:bg-neutral-100"
              >
                <option value="">No role</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  disabled={mutation.isPending}
                  className="rounded-md border border-neutral-300 px-4 py-2 text-body font-medium text-neutral-700
                    transition-colors hover:bg-neutral-100
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                    disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={!email.trim() || !displayName.trim() || mutation.isPending}
                aria-disabled={mutation.isPending}
                className="rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white
                  transition-colors hover:bg-primary-800
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                  disabled:cursor-not-allowed disabled:bg-primary-200 disabled:text-primary-500"
              >
                {mutation.isPending ? "Sending…" : "Send invite"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Toast state ──────────────────────────────────────────────────────────────

interface ToastState {
  open: boolean;
  title: string;
  variant: "success" | "error";
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function UsersPage() {
  const qc = useQueryClient();
  const [editingRoleUserId, setEditingRoleUserId] = useState<string | null>(null);
  const [showGap17Banner, setShowGap17Banner] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>({ open: false, title: "", variant: "success" });

  // Track pending status changes per user
  const [statusPendingIds, setStatusPendingIds] = useState<Set<string>>(new Set());

  const usersQuery = useQuery({
    queryKey: ["adminUsers"],
    queryFn: listAdminUsers,
    retry: false,
  });

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: listRoles,
    retry: false,
  });

  const statusMutation = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: "active" | "suspended" }) =>
      patchAdminUser(userId, { status }),
    onMutate: ({ userId }) => {
      setStatusPendingIds((prev) => new Set(prev).add(userId));
    },
    onSuccess: (_, { status }) => {
      void qc.invalidateQueries({ queryKey: ["adminUsers"] });
      showToast(
        status === "suspended" ? "User suspended." : "User reinstated.",
        "success",
      );
    },
    onError: (err) => {
      showToast(apiErrorMessage(err), "error");
    },
    onSettled: (_, __, { userId }) => {
      setStatusPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    },
  });

  const users = usersQuery.data ?? [];
  const roles = rolesQuery.data ?? [];

  function showToast(title: string, variant: "success" | "error") {
    setToast({ open: true, title, variant });
  }

  function handleRoleSaved() {
    setEditingRoleUserId(null);
    setShowGap17Banner(true);
  }

  const isLoading = usersQuery.isPending;
  const isError = usersQuery.isError;

  return (
    <Toast.Provider swipeDirection="right">
      <div>
        {/* Page header */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-heading-1 text-neutral-900">User Management</h1>
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white
              transition-colors hover:bg-primary-800
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            Invite user
          </button>
        </div>

        {/* GAP-17 propagation warning */}
        {showGap17Banner && <Gap17Banner onDismiss={() => setShowGap17Banner(false)} />}

        {/* Loading */}
        {isLoading && (
          <p
            className="py-8 text-center text-body text-neutral-500"
            aria-live="polite"
            role="status"
          >
            Loading users…
          </p>
        )}

        {/* Error */}
        {isError && (
          <p
            role="alert"
            className="rounded-md border border-semantic-error/30 bg-semantic-error/10 px-4 py-3 text-body text-semantic-error"
          >
            Failed to load users. Please refresh the page.
          </p>
        )}

        {/* Empty state */}
        {!isLoading && !isError && users.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-neutral-200 bg-white py-16 text-center">
            <p className="mb-4 text-body-lg font-semibold text-neutral-700">No users yet.</p>
            <p className="mb-6 text-body text-neutral-500">
              Invite your first team member to get started.
            </p>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white
                transition-colors hover:bg-primary-800
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              Invite user
            </button>
          </div>
        )}

        {/* Table */}
        {!isLoading && !isError && users.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th
                    scope="col"
                    className="px-4 py-3 text-body-sm font-semibold text-neutral-700"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-body-sm font-semibold text-neutral-700"
                  >
                    Email
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-body-sm font-semibold text-neutral-700"
                  >
                    Role
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-body-sm font-semibold text-neutral-700"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-body-sm font-semibold text-neutral-700"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserTableRow
                    key={user.id}
                    user={user}
                    roles={roles}
                    isEditingRole={editingRoleUserId === user.id}
                    onEditRole={() => setEditingRoleUserId(user.id)}
                    onRoleSaved={handleRoleSaved}
                    onCancelEdit={() => setEditingRoleUserId(null)}
                    onStatusChange={(userId, status) =>
                      statusMutation.mutate({ userId, status })
                    }
                    statusChangePending={statusPendingIds.has(user.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite modal */}
      <InviteModal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roles}
        onSuccess={(msg) => showToast(msg, "success")}
      />

      {/* Toast notification */}
      <Toast.Root
        open={toast.open}
        onOpenChange={(open) => setToast((t) => ({ ...t, open }))}
        className={
          "pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg " +
          (toast.variant === "success"
            ? "border-semantic-success/30 bg-white text-semantic-success"
            : "border-semantic-error/30 bg-white text-semantic-error")
        }
        duration={3000}
      >
        <Toast.Title className="text-body font-semibold">{toast.title}</Toast.Title>
        <Toast.Close asChild>
          <button
            type="button"
            aria-label="Dismiss notification"
            className="ml-auto rounded p-0.5 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </Toast.Close>
      </Toast.Root>

      <Toast.Viewport className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" />
    </Toast.Provider>
  );
}
