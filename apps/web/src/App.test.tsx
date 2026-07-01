import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
// Mock api-client to prevent real network calls in App-level tests
vi.mock("./lib/api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./lib/api-client")>();
  return {
    ...mod,
    getTenantSsoConfig: vi.fn().mockResolvedValue({ ssoEnabled: false }),
    // AccountPage (S10) and AdminLayout call getMe — stub to keep tests deterministic
    getMe: vi.fn().mockResolvedValue({
      user: { id: "u1", email: "alice@example.com", displayName: "Alice", status: "active", authMethods: ["password"] },
      role: { id: "role1", name: "Admin" },
      capabilities: { canInspectQuery: false, isAdmin: true },
      tenant: { id: "t1", displayName: "Acme Corp" },
    }),
    // ChatPage (S2) conversations
    listConversations: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn().mockResolvedValue({ id: "c-new", title: "", updatedAt: new Date().toISOString() }),
    deleteConversation: vi.fn().mockResolvedValue(undefined),
    // Admin role CRUD
    listRoles: vi.fn().mockResolvedValue([]),
    listAdminUsers: vi.fn().mockResolvedValue([]),
    listRoleGrants: vi.fn().mockResolvedValue([]),
    putRoleGrants: vi.fn().mockResolvedValue(undefined),
    // S5 Permission Editor
    listDataSources: vi.fn().mockResolvedValue([]),
    getSchemaTree: vi.fn().mockResolvedValue({ dataSourceId: "ds-1", schemas: [] }),
  };
});

// Mock tenant resolution so no subdomain SSO query fires in unit tests
vi.mock("./lib/tenant", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./lib/tenant")>();
  return { ...mod, getTenantSlug: vi.fn().mockReturnValue(null) };
});

import {
  App,
  LoginPage,
  ChatWorkspacePage,
  AdminRolesPage,
  AdminPermissionEditorPage,
  AdminUsersPage,
  AdminDataSourcesPage,
  AdminAuditLogPage,
  AccountPage,
  ErrorPage,
} from "./App";

function renderApp(initialPath = "/login") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPage(element: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        {element}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("App routing", () => {
  it("redirects / to /login", () => {
    renderApp("/");
    expect(screen.getByText("Sign In")).toBeInTheDocument();
  });

  it("renders S1 Login on /login", () => {
    renderApp("/login");
    expect(screen.getByText("Sign In")).toBeInTheDocument();
  });

  it("renders S2 Chat Workspace on /chat", () => {
    renderApp("/chat");
    expect(screen.getByText("Chat Workspace")).toBeInTheDocument();
  });

  it("renders S2 Chat Workspace on /chat/:conversationId", () => {
    renderApp("/chat/conv-123");
    expect(screen.getByText("Chat Workspace")).toBeInTheDocument();
  });

  it("redirects /admin to /admin/roles (S4)", async () => {
    renderApp("/admin");
    await waitFor(() => expect(screen.getByText("Role Management")).toBeInTheDocument());
  });

  it("renders S4 Admin Roles on /admin/roles", async () => {
    renderApp("/admin/roles");
    await waitFor(() => expect(screen.getByText("Role Management")).toBeInTheDocument());
  });

  it("renders S5 Permission Editor on /admin/roles/:roleId/permissions", async () => {
    renderApp("/admin/roles/role-1/permissions");
    // Page renders role + "Permissions" breadcrumb and Save/Cancel actions
    await waitFor(() => expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument());
  });

  it("renders S6 User Management on /admin/users", async () => {
    renderApp("/admin/users");
    await waitFor(() => expect(screen.getByText("User Management")).toBeInTheDocument());
  });

  it("renders S7 Data Sources on /admin/data-sources", async () => {
    renderApp("/admin/data-sources");
    await waitFor(() => expect(screen.getByText("Data Sources")).toBeInTheDocument());
  });

  it("renders S8 Audit Log on /admin/audit", async () => {
    renderApp("/admin/audit");
    await waitFor(() => expect(screen.getByText("Audit Log")).toBeInTheDocument());
  });

  it("renders S10 Account on /account", () => {
    renderApp("/account");
    expect(screen.getByText("Account & Profile")).toBeInTheDocument();
  });

  it("renders S11 Error page on unknown route", () => {
    renderApp("/does-not-exist");
    expect(screen.getByText("Page Not Found")).toBeInTheDocument();
  });
});

// axe-core smoke check — baseline accessibility validation on the app shell
describe("Accessibility smoke check", () => {
  const pages: Array<[string, () => React.ReactElement]> = [
    ["S1 LoginPage", () => <LoginPage />],
    ["S2 ChatWorkspacePage", () => <ChatWorkspacePage />],
    ["S4 AdminRolesPage", () => <AdminRolesPage />],
    ["S5 AdminPermissionEditorPage", () => <AdminPermissionEditorPage />],
    ["S6 AdminUsersPage", () => <AdminUsersPage />],
    ["S7 AdminDataSourcesPage", () => <AdminDataSourcesPage />],
    ["S8 AdminAuditLogPage", () => <AdminAuditLogPage />],
    ["S10 AccountPage", () => <AccountPage />],
    ["S11 ErrorPage", () => <ErrorPage />],
  ];

  for (const [label, factory] of pages) {
    it(`${label} has no critical accessibility violations`, async () => {
      const { container } = renderPage(factory());
      const results = await axe.run(container);
      const critical = results.violations.filter((v) => v.impact === "critical");
      expect(critical, `Critical a11y violations on ${label}`).toHaveLength(0);
    });
  }
});
