import React, { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import * as Toast from "@radix-ui/react-toast";
import type { DataSource } from "@bi/contracts";
import {
  listDataSources,
  createDataSource,
  updateDataSource,
  deleteDataSource,
  testDataSource,
  type DataSourcePayload,
  type TestDataSourceResult,
} from "../../lib/api-client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function apiErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return "An unexpected error occurred. Please try again.";
}

const TYPE_LABELS: Record<DataSource["type"], string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  bigquery: "BigQuery",
  rest: "REST API",
};

const TYPE_BADGE_CLASS: Record<DataSource["type"], string> = {
  postgres: "bg-blue-100 text-blue-800",
  mysql: "bg-orange-100 text-orange-800",
  bigquery: "bg-yellow-100 text-yellow-800",
  rest: "bg-purple-100 text-purple-800",
};

const STATUS_DOT_CLASS: Record<DataSource["status"], string> = {
  connected: "bg-semantic-success",
  error: "bg-semantic-error",
  unconfigured: "bg-neutral-400",
};

const STATUS_LABEL: Record<DataSource["status"], string> = {
  connected: "Connected",
  error: "Error",
  unconfigured: "Unconfigured",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

interface ToastState {
  open: boolean;
  title: string;
  variant: "success" | "error";
}

// ─── Credential field with reveal toggle ──────────────────────────────────────

interface CredentialFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
}

function CredentialField({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: CredentialFieldProps) {
  const [revealed, setRevealed] = useState(false);

  const inputClass =
    "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 " +
    "disabled:cursor-not-allowed disabled:bg-neutral-100";

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-body-sm font-semibold text-neutral-700">
        {label}
      </label>
      <div className="relative">
        {/* Always type="password" for cross-browser masking (WebkitTextSecurity is WebKit-only). */}
        <input
          id={id}
          type={revealed ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="new-password"
          className={inputClass + " pr-16"}
        />
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          disabled={disabled}
          aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
          className={
            "absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-body-sm font-medium " +
            "text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 " +
            "focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {revealed ? "Hide" : "Reveal"}
        </button>
      </div>
    </div>
  );
}

// ─── Connection fields by type ────────────────────────────────────────────────

interface ConnectionForm {
  // postgres / mysql
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  // bigquery
  projectId: string;
  dataset: string;
  serviceAccountJson: string;
  // rest
  baseUrl: string;
  apiKey: string;
}

function emptyConnectionForm(): ConnectionForm {
  return {
    host: "",
    port: "",
    database: "",
    username: "",
    password: "",
    projectId: "",
    dataset: "",
    serviceAccountJson: "",
    baseUrl: "",
    apiKey: "",
  };
}

interface ConnectionFieldsProps {
  type: DataSource["type"];
  form: ConnectionForm;
  setForm: React.Dispatch<React.SetStateAction<ConnectionForm>>;
  isEdit: boolean;
  disabled?: boolean;
}

function ConnectionFields({ type, form, setForm, isEdit, disabled }: ConnectionFieldsProps) {
  const credPlaceholder = isEdit ? "Leave blank to keep existing" : undefined;

  function field(
    id: keyof ConnectionForm,
    label: string,
    opts: { type?: "text" | "number"; required?: boolean; placeholder?: string } = {},
  ) {
    return (
      <div className="flex flex-col gap-1" key={id}>
        <label htmlFor={`ds-${id}`} className="text-body-sm font-semibold text-neutral-700">
          {label}
          {opts.required && (
            <span aria-hidden="true" className="ml-1 text-semantic-error">
              *
            </span>
          )}
        </label>
        <input
          id={`ds-${id}`}
          type={opts.type ?? "text"}
          value={form[id]}
          onChange={(e) => setForm((f) => ({ ...f, [id]: e.target.value }))}
          placeholder={opts.placeholder}
          disabled={disabled}
          required={opts.required}
          aria-required={opts.required ? "true" : undefined}
          className={
            "rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900 " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 " +
            "disabled:cursor-not-allowed disabled:bg-neutral-100"
          }
        />
      </div>
    );
  }

  if (type === "postgres" || type === "mysql") {
    return (
      <>
        {field("host", "Host", { required: true, placeholder: "db.example.com" })}
        {field("port", "Port", {
          type: "number",
          placeholder: type === "postgres" ? "5432" : "3306",
        })}
        {field("database", "Database", { required: true })}
        {field("username", "Username", { required: true })}
        <CredentialField
          id="ds-password"
          label="Password"
          value={form.password}
          onChange={(v) => setForm((f) => ({ ...f, password: v }))}
          placeholder={credPlaceholder}
          disabled={disabled}
        />
      </>
    );
  }

  if (type === "bigquery") {
    return (
      <>
        {field("projectId", "Project ID", { required: true })}
        {field("dataset", "Dataset", { required: true })}
        <CredentialField
          id="ds-serviceAccountJson"
          label="Service Account JSON"
          value={form.serviceAccountJson}
          onChange={(v) => setForm((f) => ({ ...f, serviceAccountJson: v }))}
          placeholder={
            isEdit ? "Leave blank to keep existing" : '{"type":"service_account","project_id":"…"}'
          }
          disabled={disabled}
        />
      </>
    );
  }

  if (type === "rest") {
    return (
      <>
        {field("baseUrl", "Base URL", { required: true, placeholder: "https://api.example.com" })}
        <CredentialField
          id="ds-apiKey"
          label="API Key"
          value={form.apiKey}
          onChange={(v) => setForm((f) => ({ ...f, apiKey: v }))}
          placeholder={credPlaceholder}
          disabled={disabled}
        />
      </>
    );
  }

  return null;
}

// ─── Build payload from form ──────────────────────────────────────────────────

function buildPayload(
  name: string,
  type: DataSource["type"],
  form: ConnectionForm,
): DataSourcePayload {
  const result: DataSourcePayload = { name: name.trim(), type };

  if (type === "postgres" || type === "mysql") {
    if (form.host.trim()) result.host = form.host.trim();
    if (form.port.trim()) result.port = parseInt(form.port, 10);
    if (form.database.trim()) result.database = form.database.trim();
    if (form.username.trim()) result.username = form.username.trim();
    if (form.password) result.password = form.password;
  } else if (type === "bigquery") {
    if (form.projectId.trim()) result.projectId = form.projectId.trim();
    if (form.dataset.trim()) result.dataset = form.dataset.trim();
    if (form.serviceAccountJson.trim()) result.serviceAccountJson = form.serviceAccountJson.trim();
  } else if (type === "rest") {
    if (form.baseUrl.trim()) result.baseUrl = form.baseUrl.trim();
    if (form.apiKey) result.apiKey = form.apiKey;
  }

  return result;
}

// ─── Test result display ───────────────────────────────────────────────────────

interface TestResultState {
  status: "idle" | "pending" | "success" | "error";
  result?: TestDataSourceResult;
  error?: string;
}

function TestResultBadge({ state }: { state: TestResultState }) {
  if (state.status === "idle") return null;

  if (state.status === "pending") {
    return (
      <span
        role="status"
        aria-live="polite"
        className="flex items-center gap-1.5 text-body-sm text-neutral-500"
      >
        <span
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-primary-600"
          aria-hidden="true"
        />
        Testing connection…
      </span>
    );
  }

  if (state.status === "success" && state.result?.ok) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="flex items-center gap-1.5 text-body-sm text-semantic-success"
      >
        <span aria-hidden="true">✓</span>
        Connected{" "}
        <span className="text-neutral-500">({formatDateTime(state.result.testedAt)})</span>
      </span>
    );
  }

  const errMsg = state.result?.error ?? state.error ?? "Connection failed";
  return (
    <span
      role="alert"
      aria-live="assertive"
      className="flex items-center gap-1.5 text-body-sm text-semantic-error"
    >
      <span aria-hidden="true">✗</span>
      Failed: {errMsg}
    </span>
  );
}

// ─── Add / Edit Modal ─────────────────────────────────────────────────────────

interface DataSourceModalProps {
  /** null = add mode, DataSource = edit mode */
  target: DataSource | null | "new";
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

function DataSourceModal({ target, onClose, onSuccess }: DataSourceModalProps) {
  const isOpen = target !== null;
  const isEdit = target !== null && target !== "new";
  const existing = isEdit ? (target as DataSource) : null;

  const qc = useQueryClient();
  const nameRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState<DataSource["type"]>(existing?.type ?? "postgres");
  const [form, setForm] = useState<ConnectionForm>(emptyConnectionForm());
  const [testState, setTestState] = useState<TestResultState>({ status: "idle" });

  // Sync form when modal opens for a different target
  React.useEffect(() => {
    if (isOpen) {
      setName(existing?.name ?? "");
      setType(existing?.type ?? "postgres");
      setForm(emptyConnectionForm());
      setTestState({ status: "idle" });
    }
  }, [target]); // intentionally excludes existing/isEdit: effect re-syncs only when target identity changes

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = buildPayload(name, type, form);
      return isEdit
        ? updateDataSource(existing!.id, payload as Partial<DataSourcePayload>)
        : createDataSource(payload as DataSourcePayload);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dataSources"] });
      onSuccess(isEdit ? `"${name.trim()}" updated.` : `"${name.trim()}" added.`);
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saveMutation.isPending) return;
    saveMutation.mutate();
  }

  async function handleTest() {
    if (!isEdit || !existing) return;
    setTestState({ status: "pending" });
    try {
      const result = await testDataSource(existing.id);
      setTestState({ status: result.ok ? "success" : "error", result });
      void qc.invalidateQueries({ queryKey: ["dataSources"] });
    } catch (err) {
      setTestState({ status: "error", error: apiErrorMessage(err) });
    }
  }

  const saveError = saveMutation.isError ? apiErrorMessage(saveMutation.error) : null;

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !saveMutation.isPending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 animate-in fade-in-0" />
        <Dialog.Content
          aria-describedby="ds-modal-description"
          className={
            "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 " +
            "rounded-lg bg-white p-6 shadow-xl focus:outline-none overflow-y-auto max-h-[90vh]"
          }
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            nameRef.current?.focus();
          }}
        >
          <Dialog.Title className="mb-1 text-heading-2 text-neutral-900">
            {isEdit ? "Edit data source" : "Add data source"}
          </Dialog.Title>
          <Dialog.Description id="ds-modal-description" className="mb-4 text-body text-neutral-500">
            {isEdit
              ? "Update connection settings. Credential fields are write-only — leave blank to keep existing values."
              : "Configure a new data source connection. Credentials are stored encrypted and never displayed."}
          </Dialog.Description>

          {saveError && (
            <p
              role="alert"
              className="mb-4 rounded-md border border-semantic-error/30 bg-semantic-error/10 px-3 py-2 text-body text-semantic-error"
            >
              {saveError}
            </p>
          )}

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {/* Name */}
            <div className="flex flex-col gap-1">
              <label htmlFor="ds-name" className="text-body-sm font-semibold text-neutral-700">
                Name{" "}
                <span aria-hidden="true" className="text-semantic-error">
                  *
                </span>
              </label>
              <input
                id="ds-name"
                ref={nameRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={saveMutation.isPending}
                aria-required="true"
                placeholder="My PostgreSQL DB"
                className={
                  "rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900 " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 " +
                  "disabled:cursor-not-allowed disabled:bg-neutral-100"
                }
              />
            </div>

            {/* Type */}
            <div className="flex flex-col gap-1">
              <label htmlFor="ds-type" className="text-body-sm font-semibold text-neutral-700">
                Type{" "}
                <span aria-hidden="true" className="text-semantic-error">
                  *
                </span>
              </label>
              <select
                id="ds-type"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as DataSource["type"]);
                  setForm(emptyConnectionForm());
                }}
                disabled={saveMutation.isPending}
                aria-required="true"
                className={
                  "rounded-md border border-neutral-300 bg-white px-3 py-2 text-body text-neutral-900 " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 " +
                  "disabled:cursor-not-allowed disabled:bg-neutral-100"
                }
              >
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
                <option value="bigquery">BigQuery</option>
                <option value="rest">REST API</option>
              </select>
            </div>

            {/* Connection fields — vary by type */}
            <div className="flex flex-col gap-4 rounded-md border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-body-sm font-semibold text-neutral-700">Connection settings</p>
              <ConnectionFields
                type={type}
                form={form}
                setForm={setForm}
                isEdit={isEdit}
                disabled={saveMutation.isPending}
              />
            </div>

            {/* Test connection — only available in edit mode */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={!isEdit || testState.status === "pending" || saveMutation.isPending}
                aria-disabled={!isEdit || testState.status === "pending"}
                title={!isEdit ? "Save the data source first to test the connection" : undefined}
                className={
                  "rounded-md border border-neutral-300 px-3 py-1.5 text-body-sm font-medium text-neutral-700 " +
                  "transition-colors hover:bg-neutral-100 " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 " +
                  "disabled:cursor-not-allowed disabled:opacity-50"
                }
              >
                Test connection
              </button>
              {!isEdit && (
                <span className="text-body-sm text-neutral-400">
                  Save first to enable connection test
                </span>
              )}
              <TestResultBadge state={testState} />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  disabled={saveMutation.isPending}
                  className={
                    "rounded-md border border-neutral-300 px-4 py-2 text-body font-medium text-neutral-700 " +
                    "transition-colors hover:bg-neutral-100 " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 " +
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  }
                >
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={!name.trim() || saveMutation.isPending}
                aria-disabled={saveMutation.isPending}
                className={
                  "rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white " +
                  "transition-colors hover:bg-primary-800 " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 " +
                  "disabled:cursor-not-allowed disabled:bg-primary-200 disabled:text-primary-500"
                }
              >
                {saveMutation.isPending ? "Saving…" : isEdit ? "Save changes" : "Add data source"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Delete Confirm Modal ──────────────────────────────────────────────────────

interface DeleteModalProps {
  target: DataSource | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

function DeleteDataSourceModal({ target, onClose, onSuccess }: DeleteModalProps) {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => deleteDataSource(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dataSources"] });
      onSuccess(`"${target?.name ?? "Data source"}" deleted.`);
      onClose();
    },
  });

  const errorMsg = mutation.isError ? apiErrorMessage(mutation.error) : null;

  return (
    <Dialog.Root
      open={!!target}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          aria-describedby="delete-ds-description"
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl focus:outline-none"
        >
          <Dialog.Title className="mb-1 text-heading-2 text-semantic-error">
            Delete data source
          </Dialog.Title>
          <Dialog.Description id="delete-ds-description" className="mb-4 text-body text-neutral-700">
            Permanently delete &ldquo;{target?.name}&rdquo;? Any roles with grants on this source
            will lose access. This cannot be undone.
          </Dialog.Description>

          {errorMsg && (
            <p
              role="alert"
              className="mb-4 rounded-md border border-semantic-error/30 bg-semantic-error/10 px-3 py-2 text-body text-semantic-error"
            >
              {errorMsg}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={mutation.isPending}
                className={
                  "rounded-md border border-neutral-300 px-4 py-2 text-body font-medium text-neutral-700 " +
                  "transition-colors hover:bg-neutral-100 " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 " +
                  "disabled:cursor-not-allowed disabled:opacity-50"
                }
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => { if (target) mutation.mutate(target.id); }}
              disabled={mutation.isPending}
              aria-disabled={mutation.isPending}
              className={
                "rounded-md bg-semantic-error px-4 py-2 text-body font-semibold text-white " +
                "transition-colors hover:bg-red-700 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error focus-visible:ring-offset-2 " +
                "disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              {mutation.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Re-test button (card action) ─────────────────────────────────────────────

interface RetestButtonProps {
  ds: DataSource;
  /** Called with a toast message on both success and failure outcomes. */
  onMessage: (msg: string) => void;
}

function RetestButton({ ds, onMessage }: RetestButtonProps) {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => testDataSource(ds.id),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["dataSources"] });
      onMessage(
        result.ok
          ? `"${ds.name}" connected successfully.`
          : `"${ds.name}" test failed: ${result.error ?? "unknown error"}`,
      );
    },
    onError: (err) => {
      onMessage(`"${ds.name}" test error: ${apiErrorMessage(err)}`);
    },
  });

  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      aria-label={`Re-test connection for ${ds.name}`}
      className={
        "rounded px-2 py-1 text-body-sm font-medium text-neutral-600 " +
        "hover:bg-neutral-100 " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 " +
        "disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {mutation.isPending ? "Testing…" : "Re-test"}
    </button>
  );
}

// ─── Data Source Card ─────────────────────────────────────────────────────────

interface DataSourceCardProps {
  ds: DataSource;
  onEdit: (ds: DataSource) => void;
  onDelete: (ds: DataSource) => void;
  onRetest: (msg: string) => void;
}

function DataSourceCard({ ds, onEdit, onDelete, onRetest }: DataSourceCardProps) {
  return (
    <article
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
      aria-label={`Data source: ${ds.name}`}
    >
      {/* Header: name + type badge */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-body font-semibold text-neutral-900">{ds.name}</h2>
        <span
          className={
            "shrink-0 rounded-full px-2 py-0.5 text-label font-semibold uppercase tracking-wide " +
            TYPE_BADGE_CLASS[ds.type]
          }
        >
          {TYPE_LABELS[ds.type]}
        </span>
      </div>

      {/* Status row */}
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[ds.status]}`}
          aria-hidden="true"
        />
        <span className="text-body-sm text-neutral-600">{STATUS_LABEL[ds.status]}</span>
        {ds.lastTestedAt && (
          <span className="text-body-sm text-neutral-400">
            · Last tested {formatDateTime(ds.lastTestedAt)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 border-t border-neutral-100 pt-2">
        <button
          type="button"
          onClick={() => onEdit(ds)}
          className={
            "rounded px-2 py-1 text-body-sm font-medium text-neutral-600 " +
            "hover:bg-neutral-100 " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
          }
          aria-label={`Edit ${ds.name}`}
        >
          Edit
        </button>
        <RetestButton ds={ds} onMessage={onRetest} />
        <button
          type="button"
          onClick={() => onDelete(ds)}
          className={
            "rounded px-2 py-1 text-body-sm font-medium text-semantic-error " +
            "hover:bg-semantic-error/10 " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-error focus-visible:ring-offset-1"
          }
          aria-label={`Delete ${ds.name}`}
        >
          Delete
        </button>
      </div>
    </article>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function DataSourcesPage() {
  const [modalTarget, setModalTarget] = useState<DataSource | null | "new">(null);
  const [deleteTarget, setDeleteTarget] = useState<DataSource | null>(null);
  const [toast, setToast] = useState<ToastState>({ open: false, title: "", variant: "success" });

  const query = useQuery({
    queryKey: ["dataSources"],
    queryFn: listDataSources,
    retry: false,
  });

  const sources = query.data ?? [];

  function showToast(title: string, variant: "success" | "error" = "success") {
    setToast({ open: true, title, variant });
  }

  return (
    <Toast.Provider swipeDirection="right">
      <div>
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-heading-1 text-neutral-900">Data Sources</h1>
          <button
            type="button"
            onClick={() => setModalTarget("new")}
            className={
              "rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white " +
              "transition-colors hover:bg-primary-800 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            }
          >
            Add data source
          </button>
        </div>

        {/* Loading */}
        {query.isPending && (
          <p className="py-8 text-center text-body text-neutral-500" aria-live="polite" role="status">
            Loading data sources…
          </p>
        )}

        {/* Error */}
        {query.isError && (
          <p
            role="alert"
            className="rounded-md border border-semantic-error/30 bg-semantic-error/10 px-4 py-3 text-body text-semantic-error"
          >
            Failed to load data sources. Please refresh the page.
          </p>
        )}

        {/* Empty state */}
        {!query.isPending && !query.isError && sources.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-neutral-200 bg-white py-16 text-center">
            <p className="mb-4 text-body-lg font-semibold text-neutral-700">
              No data sources configured.
            </p>
            <p className="mb-6 text-body text-neutral-500">
              Add your first data source to let the LLM agent query your data.
            </p>
            <button
              type="button"
              onClick={() => setModalTarget("new")}
              className={
                "rounded-md bg-primary-700 px-4 py-2 text-body font-semibold text-white " +
                "transition-colors hover:bg-primary-800 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              }
            >
              Add data source
            </button>
          </div>
        )}

        {/* Card grid */}
        {!query.isPending && !query.isError && sources.length > 0 && (
          <ul
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-label="Data sources"
            role="list"
          >
            {sources.map((ds) => (
              <li key={ds.id}>
                <DataSourceCard
                  ds={ds}
                  onEdit={(d) => setModalTarget(d)}
                  onDelete={(d) => setDeleteTarget(d)}
                  onRetest={(msg) => showToast(msg)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add / Edit modal */}
      <DataSourceModal
        target={modalTarget}
        onClose={() => setModalTarget(null)}
        onSuccess={(msg) => showToast(msg)}
      />

      {/* Delete confirm modal */}
      <DeleteDataSourceModal
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onSuccess={(msg) => showToast(msg)}
      />

      {/* Toast */}
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
