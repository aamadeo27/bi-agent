import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
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
      {element}
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

  it("redirects /admin to /admin/roles (S4)", () => {
    renderApp("/admin");
    expect(screen.getByText("Role Management")).toBeInTheDocument();
  });

  it("renders S4 Admin Roles on /admin/roles", () => {
    renderApp("/admin/roles");
    expect(screen.getByText("Role Management")).toBeInTheDocument();
  });

  it("renders S5 Permission Editor on /admin/roles/:roleId/permissions", () => {
    renderApp("/admin/roles/role-1/permissions");
    expect(screen.getByText("Permission Editor")).toBeInTheDocument();
  });

  it("renders S6 User Management on /admin/users", () => {
    renderApp("/admin/users");
    expect(screen.getByText("User Management")).toBeInTheDocument();
  });

  it("renders S7 Data Sources on /admin/data-sources", () => {
    renderApp("/admin/data-sources");
    expect(screen.getByText("Data Sources")).toBeInTheDocument();
  });

  it("renders S8 Audit Log on /admin/audit", () => {
    renderApp("/admin/audit");
    expect(screen.getByText("Audit Log")).toBeInTheDocument();
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
