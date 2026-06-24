import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import * as Toast from "@radix-ui/react-toast";
import type { Role } from "@bi/contracts";
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listAdminUsers,
  listRoleGrants,
} from "../../lib/api-client";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function apiErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "An unexpected error occurred. Please try again.";
}

// ─── Toast ────────────────────────────────────────────────────────────────────

interface ToastState {
  open: boolean;
  title: string;
  variant: "success" | "error";
}

// ─── Modal: Create Role ───────────────────────────────────────────────────────

interface CreateRoleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (msg: string) => void;
}

function CreateRoleModal({ open, onOpenChange, onSuccess }: CreateRoleModalProps) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () => createRole({ name: name.trim(), description: description.trim() || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["roles"] });
      onSuccess(`Role "${name.trim()}" created.`);
      onOpenChange(false);
      setName("");
      setDescription("");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || mutation.isPending) return;
    mutation.mutate();
  }

  const errorMsg = mutation.isError ? apiErrorMessage(mutation.error) : null;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!mutation.isPending) { onOpenChange(v); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 animate-in fade-in-0" />
        <Dialog.Content
          aria-describedby="create-role-description"
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none"
          onOpenAutoFocus={(e) => { e.preventDefault(); nameRef.current?.focus(); }}
        >
          <Dialog.Title className="mb-1 text-heading-2 text-neutral-900">
            New role
          </Dialog.Title>
          <Dialog.Description id="create-role-description" className="mb-4 text-body text-neutral-500">
            Create a new role. Assign permissions after creation.
          </Dialog.Description>

          {errorMsg && (
            <p role="alert" className="mb-4 rounded-md border border-semantic-error/30 bg-semantic-error/10 px-3 py-2 text-body text-semantic-error">
              {errorMsg}
            </p>
          )}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="create-name" className="text-body-sm font-semibold text-neutral-700">
                Role name <span aria-hidden="true" className="text-semantic-error">*</span>
              </label>
              <input
                id="create-name"
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                required
                disabled={mutation.isPending}
                aria-required="true"
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                  disabled:cursor-not-allowed disabled:bg-neutral-100"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="create-description" className="text-body-sm font-semibold text-neutral-700">
                Description
              </label>
              <textarea
                id="create-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={256}
                rows={3}
                disabled={mutation.isPending}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                  disabled:cursor-not-allowed disabled:bg-neutral-100"
              />
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
                disabled={!name.trim() || mutation.isPending}
                aria-disabled={mutation.isPending}
                className="rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white
                  transition-colors hover:bg-primary-800
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                  disabled:cursor-not-allowed disabled:bg-primary-200 disabled:text-primary-500"
              >
                {mutation.isPending ? "Creating…" : "Create role"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Modal: Edit Role Details ─────────────────────────────────────────────────

interface EditRoleModalProps {
  role: Role | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

function EditRoleModal({ role, onClose, onSuccess }: EditRoleModalProps) {
  const qc = useQueryClient();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [canInspectQuery, setCanInspectQuery] = useState(
    role?.capabilities.canInspectQuery ?? false,
  );
  const nameRef = useRef<HTMLInputElement>(null);

  // Sync form when role prop changes (modal re-opens for a different role)
  React.useEffect(() => {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setCanInspectQuery(role?.capabilities.canInspectQuery ?? false);
  }, [role]);

  const mutation = useMutation({
    mutationFn: () =>
      updateRole(role!.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        capabilities: { canInspectQuery },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["roles"] });
      onSuccess(`Role "${name.trim()}" updated.`);
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!role || !name.trim() || mutation.isPending) return;
    mutation.mutate();
  }

  const errorMsg = mutation.isError ? apiErrorMessage(mutation.error) : null;

  return (
    <Dialog.Root
      open={!!role}
      onOpenChange={(v) => { if (!v && !mutation.isPending) onClose(); }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          aria-describedby="edit-role-description"
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none"
          onOpenAutoFocus={(e) => { e.preventDefault(); nameRef.current?.focus(); }}
        >
          <Dialog.Title className="mb-1 text-heading-2 text-neutral-900">
            Edit role details
          </Dialog.Title>
          <Dialog.Description id="edit-role-description" className="mb-4 text-body text-neutral-500">
            Update name, description, and capability flags for this role.
          </Dialog.Description>

          {errorMsg && (
            <p role="alert" className="mb-4 rounded-md border border-semantic-error/30 bg-semantic-error/10 px-3 py-2 text-body text-semantic-error">
              {errorMsg}
            </p>
          )}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="edit-name" className="text-body-sm font-semibold text-neutral-700">
                Role name <span aria-hidden="true" className="text-semantic-error">*</span>
              </label>
              <input
                id="edit-name"
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                required
                disabled={mutation.isPending}
                aria-required="true"
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                  disabled:cursor-not-allowed disabled:bg-neutral-100"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="edit-description" className="text-body-sm font-semibold text-neutral-700">
                Description
              </label>
              <textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={256}
                rows={3}
                disabled={mutation.isPending}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                  disabled:cursor-not-allowed disabled:bg-neutral-100"
              />
            </div>

            {/* canInspectQuery capability toggle */}
            <div className="rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="flex flex-col gap-0.5">
                  <span className="text-body font-semibold text-neutral-900">
                    Can inspect query
                  </span>
                  <span className="text-body-sm text-neutral-500">
                    Allows users in this role to view the generated SQL for a response.
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={canInspectQuery}
                  checked={canInspectQuery}
                  onChange={(e) => setCanInspectQuery(e.target.checked)}
                  disabled={mutation.isPending}
                  className="h-4 w-4 cursor-pointer rounded border-neutral-300 text-primary-700
                    focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                    disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
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
                disabled={!name.trim() || mutation.isPending}
                aria-disabled={mutation.isPending}
                className="rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white
                  transition-colors hover:bg-primary-800
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                  disabled:cursor-not-allowed disabled:bg-primary-200 disabled:text-primary-500"
              >
                {mutation.isPending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Modal: Delete Confirm ────────────────────────────────────────────────────

interface DeleteRoleModalProps {
  role: Role | null;
  userCount: number;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

function DeleteRoleModal({ role, userCount, onClose, onSuccess }: DeleteRoleModalProps) {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => deleteRole(role!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["roles"] });
      void qc.invalidateQueries({ queryKey: ["adminUsers"] });
      onSuccess(`Role "${role!.name}" deleted.`);
      onClose();
    },
  });

  const errorMsg = mutation.isError ? apiErrorMessage(mutation.error) : null;

  return (
    <Dialog.Root
      open={!!role}
      onOpenChange={(v) => { if (!v && !mutation.isPending) onClose(); }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          aria-describedby="delete-role-description"
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none"
        >
          <Dialog.Title className="mb-1 text-heading-2 text-semantic-error">
            Delete role
          </Dialog.Title>
          <Dialog.Description id="delete-role-description" className="mb-4 text-body text-neutral-700">
            Deleting &ldquo;{role?.name}&rdquo; will remove access for{" "}
            <strong>{userCount}</strong> {userCount === 1 ? "user" : "users"} assigned this
            role. This cannot be undone.
          </Dialog.Description>

          {errorMsg && (
            <p role="alert" className="mb-4 rounded-md border border-semantic-error/30 bg-semantic-error/10 px-3 py-2 text-body text-semantic-error">
              {errorMsg}
            </p>
          )}

          <div className="flex justify-end gap-3">
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
              type="button"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              aria-disabled={mutation.isPending}
              className="rounded-md bg-semantic-error px-4 py-2 text-body font-semibold text-white
                transition-colors hover:bg-red-700
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error focus-visible:ring-offset-2
                disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? "Deleting…" : "Delete role"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Roles table row ──────────────────────────────────────────────────────────

interface RoleRowProps {
  role: Role;
  userCount: number;
  permissionCount: number | null;
  onEdit: (role: Role) => void;
  onDelete: (role: Role) => void;
}

function RoleTableRow({ role, userCount, permissionCount, onEdit, onDelete }: RoleRowProps) {
  return (
    <tr className="border-b border-neutral-100 hover:bg-neutral-50">
      <td className="px-4 py-3">
        <span className="text-body font-semibold text-neutral-900">{role.name}</span>
      </td>
      <td className="px-4 py-3 text-body text-neutral-500">
        {role.description ?? <span className="italic text-neutral-400">—</span>}
      </td>
      <td className="px-4 py-3 text-right text-body text-neutral-700">{userCount}</td>
      <td className="px-4 py-3 text-right text-body text-neutral-700">
        {permissionCount !== null ? permissionCount : <span className="text-neutral-400">—</span>}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <Link
            to={`/admin/roles/${role.id}/permissions`}
            className="rounded px-2 py-1 text-body-sm font-medium text-primary-600
              hover:bg-primary-50
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
          >
            Edit permissions
          </Link>
          <button
            type="button"
            onClick={() => onEdit(role)}
            className="rounded px-2 py-1 text-body-sm font-medium text-neutral-600
              hover:bg-neutral-100
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
          >
            Edit details
          </button>
          <button
            type="button"
            onClick={() => onDelete(role)}
            className="rounded px-2 py-1 text-body-sm font-medium text-semantic-error
              hover:bg-semantic-error/10
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error focus-visible:ring-offset-1"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function RolesPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<Role | null>(null);
  const [deleteRole_, setDeleteRole] = useState<Role | null>(null);
  const [toast, setToast] = useState<ToastState>({ open: false, title: "", variant: "success" });

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: listRoles,
    retry: false,
  });

  const usersQuery = useQuery({
    queryKey: ["adminUsers"],
    queryFn: listAdminUsers,
    retry: false,
  });

  const roles = rolesQuery.data ?? [];
  const users = usersQuery.data ?? [];

  // Fetch grant counts for all roles in parallel
  const grantQueries = useQueries({
    queries: roles.map((r) => ({
      queryKey: ["roleGrants", r.id] as const,
      queryFn: () => listRoleGrants(r.id),
      retry: false,
      // Non-fatal: permission count is informational only
    })),
  });

  const filtered = search.trim()
    ? roles.filter(
        (r) =>
          r.name.toLowerCase().includes(search.trim().toLowerCase()) ||
          r.description?.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : roles;

  function userCountFor(roleId: string): number {
    return users.filter((u) => u.roleId === roleId).length;
  }

  function permCountFor(roleIndex: number): number | null {
    const q = grantQueries[roleIndex];
    if (!q || q.isPending || q.isError) return null;
    return q.data?.length ?? 0;
  }

  function showToast(title: string, variant: "success" | "error") {
    setToast({ open: true, title, variant });
  }

  function deleteUserCount(): number {
    if (!deleteRole_) return 0;
    return userCountFor(deleteRole_.id);
  }

  const isLoading = rolesQuery.isPending;
  const isError = rolesQuery.isError;

  return (
    <Toast.Provider swipeDirection="right">
      <div>
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-heading-1 text-neutral-900">Role Management</h1>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white
              transition-colors hover:bg-primary-800
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            New role
          </button>
        </div>

        {/* Search/filter */}
        <div className="mb-4">
          <label htmlFor="roles-search" className="sr-only">
            Search roles
          </label>
          <input
            id="roles-search"
            type="search"
            placeholder="Search roles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-sm rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900
              placeholder-neutral-500
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          />
        </div>

        {/* Loading */}
        {isLoading && (
          <p className="py-8 text-center text-body text-neutral-500" aria-live="polite" role="status">
            Loading roles…
          </p>
        )}

        {/* Error */}
        {isError && (
          <p role="alert" className="rounded-md border border-semantic-error/30 bg-semantic-error/10 px-4 py-3 text-body text-semantic-error">
            Failed to load roles. Please refresh the page.
          </p>
        )}

        {/* Empty state */}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-neutral-200 bg-white py-16 text-center">
            {roles.length === 0 ? (
              <>
                <p className="mb-4 text-body-lg font-semibold text-neutral-700">
                  No roles yet.
                </p>
                <p className="mb-6 text-body text-neutral-500">
                  Create your first role to start assigning permissions.
                </p>
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white
                    transition-colors hover:bg-primary-800
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                >
                  New role
                </button>
              </>
            ) : (
              <p className="text-body text-neutral-500">
                No roles match &ldquo;{search}&rdquo;.
              </p>
            )}
          </div>
        )}

        {/* Table */}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <th scope="col" className="px-4 py-3 text-body-sm font-semibold text-neutral-700">
                    Role name
                  </th>
                  <th scope="col" className="px-4 py-3 text-body-sm font-semibold text-neutral-700">
                    Description
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-body-sm font-semibold text-neutral-700">
                    # Users
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-body-sm font-semibold text-neutral-700">
                    # Permissions
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-body-sm font-semibold text-neutral-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((role) => {
                  // Find index in the full (unfiltered) roles array for grantQueries alignment
                  const fullIdx = roles.findIndex((r) => r.id === role.id);
                  return (
                    <RoleTableRow
                      key={role.id}
                      role={role}
                      userCount={userCountFor(role.id)}
                      permissionCount={permCountFor(fullIdx)}
                      onEdit={setEditRole}
                      onDelete={setDeleteRole}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateRoleModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={(msg) => showToast(msg, "success")}
      />

      <EditRoleModal
        role={editRole}
        onClose={() => setEditRole(null)}
        onSuccess={(msg) => showToast(msg, "success")}
      />

      <DeleteRoleModal
        role={deleteRole_}
        userCount={deleteUserCount()}
        onClose={() => setDeleteRole(null)}
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
