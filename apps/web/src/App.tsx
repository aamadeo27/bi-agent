import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { LoginPage } from "./screens/login-page";
import { AccountPage as AccountPageScreen } from "./screens/account-page";
import { ErrorPage as ErrorPageScreen } from "./screens/error-page";
import { AdminLayout } from "./screens/admin/admin-layout";
import { RolesPage } from "./screens/admin/roles-page";
import { PermissionEditorPage } from "./screens/admin/permission-editor-page";

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

// S1 is now the real LoginPage (imported from screens/login-page)
export { LoginPage };

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

// S4 — Admin: Role Management (real implementation)
export { RolesPage as AdminRolesPage };

// S5 — Admin: Permission Editor (real implementation)
export { PermissionEditorPage as AdminPermissionEditorPage };

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

// S10 — Account / Profile (real implementation in screens/account-page.tsx)
export { AccountPageScreen as AccountPage };

// S11 — Error / 404 / Tenant Boundary (real implementation in screens/error-page.tsx)
export { ErrorPageScreen as ErrorPage };

export function App() {
  const navigate = useNavigate();

  // Redirect to login on session-expired event dispatched by api-client
  useEffect(() => {
    function handleSessionExpired() {
      navigate("/login?reason=session_expired", { replace: true });
    }
    window.addEventListener("auth:session-expired", handleSessionExpired);
    return () => window.removeEventListener("auth:session-expired", handleSessionExpired);
  }, [navigate]);

  return (
    <Routes>
      {/* Default: redirect to login (auth guard will later redirect to /chat when authenticated) */}
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* S1 — Login / Auth */}
      <Route path="/login" element={<LoginPage />} />

      {/* S2 — Chat Workspace; :conversationId is optional */}
      <Route path="/chat" element={<ChatWorkspacePage />} />
      <Route path="/chat/:conversationId" element={<ChatWorkspacePage />} />

      {/* Admin section — layout route with admin guard */}
      <Route path="/admin" element={<AdminLayout />}>
        {/* /admin → /admin/roles */}
        <Route index element={<Navigate to="/admin/roles" replace />} />
        {/* S4 — Role Management */}
        <Route path="roles" element={<RolesPage />} />
        {/* S5 — Permission Editor */}
        <Route path="roles/:roleId/permissions" element={<PermissionEditorPage />} />
        {/* S6 — User Management */}
        <Route path="users" element={<AdminUsersPage />} />
        {/* S7 — Data Sources */}
        <Route path="data-sources" element={<AdminDataSourcesPage />} />
        {/* S8 — Audit Log */}
        <Route path="audit" element={<AdminAuditLogPage />} />
      </Route>

      {/* S10 — Account / Profile */}
      <Route path="/account" element={<AccountPageScreen />} />

      {/* S11 — Catch-all: 404 / forbidden / tenant boundary */}
      <Route path="*" element={<ErrorPageScreen />} />
    </Routes>
  );
}
