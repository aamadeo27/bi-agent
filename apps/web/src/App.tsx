import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { LoginPage } from "./screens/login-page";
import { AccountPage as AccountPageScreen } from "./screens/account-page";
import { ErrorPage as ErrorPageScreen } from "./screens/error-page";
import { AdminLayout } from "./screens/admin/admin-layout";
import { RolesPage } from "./screens/admin/roles-page";
import { PermissionEditorPage } from "./screens/admin/permission-editor-page";
import { UsersPage } from "./screens/admin/users-page";
import { DataSourcesPage } from "./screens/admin/data-sources-page";
import { AuditLogPage } from "./screens/admin/audit-log-page";
import { ChatPage } from "./screens/chat/chat-page";

// S1 is now the real LoginPage (imported from screens/login-page)
export { LoginPage };

// S2 — Chat Workspace (real implementation)
export { ChatPage as ChatWorkspacePage };

// S4 — Admin: Role Management (real implementation)
export { RolesPage as AdminRolesPage };

// S5 — Admin: Permission Editor (real implementation)
export { PermissionEditorPage as AdminPermissionEditorPage };

// S6 — Admin: User Management (real implementation)
export { UsersPage as AdminUsersPage };

// S7 — Admin: Data Sources (real implementation)
export { DataSourcesPage as AdminDataSourcesPage };

// S8 — Admin: Audit Log (P1)
export { AuditLogPage as AdminAuditLogPage };

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
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/chat/:conversationId" element={<ChatPage />} />

      {/* Admin section — layout route with admin guard */}
      <Route path="/admin" element={<AdminLayout />}>
        {/* /admin → /admin/roles */}
        <Route index element={<Navigate to="/admin/roles" replace />} />
        {/* S4 — Role Management */}
        <Route path="roles" element={<RolesPage />} />
        {/* S5 — Permission Editor */}
        <Route path="roles/:roleId/permissions" element={<PermissionEditorPage />} />
        {/* S6 — User Management */}
        <Route path="users" element={<UsersPage />} />
        {/* S7 — Data Sources */}
        <Route path="data-sources" element={<DataSourcesPage />} />
        {/* S8 — Audit Log */}
        <Route path="audit" element={<AuditLogPage />} />
      </Route>

      {/* S10 — Account / Profile */}
      <Route path="/account" element={<AccountPageScreen />} />

      {/* S11 — Catch-all: 404 / forbidden / tenant boundary */}
      <Route path="*" element={<ErrorPageScreen />} />
    </Routes>
  );
}
