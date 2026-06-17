import { Routes, Route, Navigate } from "react-router-dom";

function PlaceholderPage({
  screenId,
  title,
  note,
}: {
  screenId: string;
  title: string;
  note?: string;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-primary-50 px-4">
      <span className="mb-2 rounded-full bg-primary-200 px-3 py-1 text-label font-semibold uppercase tracking-wider text-primary-700">
        {screenId}
      </span>
      <h1 className="text-heading-1 text-primary-700">{title}</h1>
      {note && <p className="mt-2 text-body text-neutral-500">{note}</p>}
    </main>
  );
}

// S1 — Login / Auth
export function LoginPage() {
  return (
    <PlaceholderPage
      screenId="S1"
      title="Sign In"
      note="Login / Auth — placeholder for T2.x auth implementation"
    />
  );
}

// S2 — Chat Workspace
// S3 (Query Inspect Drawer) and S9 (Permission Block) are overlay components
// rendered inside this screen, not standalone routes.
export function ChatWorkspacePage() {
  return (
    <PlaceholderPage
      screenId="S2"
      title="Chat Workspace"
      note="S3 Query Inspect Drawer and S9 Permission Block are overlays rendered here"
    />
  );
}

// S4 — Admin: Role Management
export function AdminRolesPage() {
  return <PlaceholderPage screenId="S4" title="Role Management" note="Admin — Role Management" />;
}

// S5 — Admin: Permission Editor
export function AdminPermissionEditorPage() {
  return (
    <PlaceholderPage
      screenId="S5"
      title="Permission Editor"
      note="Admin — Permission Editor for a specific role"
    />
  );
}

// S6 — Admin: User Management
export function AdminUsersPage() {
  return <PlaceholderPage screenId="S6" title="User Management" note="Admin — User Management" />;
}

// S7 — Admin: Data Sources
export function AdminDataSourcesPage() {
  return <PlaceholderPage screenId="S7" title="Data Sources" note="Admin — Data Sources" />;
}

// S8 — Admin: Audit Log (P1)
export function AdminAuditLogPage() {
  return (
    <PlaceholderPage screenId="S8" title="Audit Log" note="Admin — Audit Log (P1 priority)" />
  );
}

// S10 — Account / Profile
export function AccountPage() {
  return <PlaceholderPage screenId="S10" title="Account & Profile" />;
}

// S11 — Error / 404 / Tenant Boundary
export function ErrorPage() {
  return (
    <PlaceholderPage
      screenId="S11"
      title="Page Not Found"
      note="Error / 404 / Tenant Boundary — use navigation to return to the app"
    />
  );
}

export function App() {
  return (
    <Routes>
      {/* Default: redirect to login (auth guard will later redirect to /chat when authenticated) */}
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* S1 — Login / Auth */}
      <Route path="/login" element={<LoginPage />} />

      {/* S2 — Chat Workspace; :conversationId is optional */}
      <Route path="/chat" element={<ChatWorkspacePage />} />
      <Route path="/chat/:conversationId" element={<ChatWorkspacePage />} />

      {/* Admin section — redirect /admin to roles list */}
      <Route path="/admin" element={<Navigate to="/admin/roles" replace />} />

      {/* S4 — Role Management */}
      <Route path="/admin/roles" element={<AdminRolesPage />} />

      {/* S5 — Permission Editor */}
      <Route path="/admin/roles/:roleId/permissions" element={<AdminPermissionEditorPage />} />

      {/* S6 — User Management */}
      <Route path="/admin/users" element={<AdminUsersPage />} />

      {/* S7 — Data Sources */}
      <Route path="/admin/data-sources" element={<AdminDataSourcesPage />} />

      {/* S8 — Audit Log */}
      <Route path="/admin/audit" element={<AdminAuditLogPage />} />

      {/* S10 — Account / Profile */}
      <Route path="/account" element={<AccountPage />} />

      {/* S11 — Catch-all: 404 / forbidden / tenant boundary */}
      <Route path="*" element={<ErrorPage />} />
    </Routes>
  );
}
