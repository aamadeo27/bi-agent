import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import type { Role, User } from "@bi/contracts";
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listAdminUsers,
  listRoleGrants,
} from "../../lib/api-client";
import { RolesPage } from "./roles-page";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../lib/api-client", () => ({
  listRoles: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  listAdminUsers: vi.fn(),
  listRoleGrants: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const roleAnalyst: Role = {
  id: "role-1",
  name: "Analyst",
  description: "Data analyst role",
  capabilities: { canInspectQuery: false },
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const roleAdmin: Role = {
  id: "role-2",
  name: "Admin",
  capabilities: { canInspectQuery: true },
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

const usersInAnalyst: User[] = [
  {
    id: "u1",
    email: "alice@example.com",
    displayName: "Alice",
    status: "active",
    roleId: "role-1",
    authMethods: ["password"],
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "u2",
    email: "bob@example.com",
    displayName: "Bob",
    status: "active",
    roleId: "role-1",
    authMethods: ["password"],
    createdAt: "2024-01-01T00:00:00.000Z",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderRolesPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RolesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Loading / error states ───────────────────────────────────────────────────

describe("RolesPage — loading and error", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    vi.mocked(listRoleGrants).mockResolvedValue([]);
  });

  it("shows loading indicator while fetching roles", () => {
    vi.mocked(listRoles).mockReturnValue(new Promise(() => {}));
    renderRolesPage();
    expect(screen.getByText(/loading roles/i)).toBeInTheDocument();
  });

  it("shows error alert when listRoles rejects", async () => {
    vi.mocked(listRoles).mockRejectedValue(new Error("Network error"));
    renderRolesPage();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/failed to load roles/i),
    );
  });
});

// ─── Empty state ──────────────────────────────────────────────────────────────

describe("RolesPage — empty state", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    vi.mocked(listRoleGrants).mockResolvedValue([]);
  });

  it("renders empty-state message and New role button when no roles exist", async () => {
    vi.mocked(listRoles).mockResolvedValue([]);
    renderRolesPage();
    await waitFor(() => expect(screen.getByText(/no roles yet/i)).toBeInTheDocument());
    expect(screen.getByText(/create your first role to start assigning permissions/i)).toBeInTheDocument();
    // Two "New role" buttons: header + empty state CTA
    expect(screen.getAllByRole("button", { name: /new role/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'no roles match' when search has no results", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst]);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    const search = screen.getByRole("searchbox");
    await userEvent.type(search, "zzzzz");
    expect(screen.getByText(/no roles match/i)).toBeInTheDocument();
  });
});

// ─── Roles table ─────────────────────────────────────────────────────────────

describe("RolesPage — roles table", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listRoleGrants).mockResolvedValue([]);
  });

  it("renders role name and description in table", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst, roleAdmin]);
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    expect(screen.getByText("Data analyst role")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("shows correct user count per role", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst]);
    vi.mocked(listAdminUsers).mockResolvedValue(usersInAnalyst);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    // 2 users in Analyst role
    expect(screen.getByRole("cell", { name: "2" })).toBeInTheDocument();
  });

  it("shows permission count after grants load", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst]);
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    vi.mocked(listRoleGrants).mockResolvedValue([
      { roleId: "role-1", dataSourceId: "ds1", kind: "schema", schema: "public" },
      { roleId: "role-1", dataSourceId: "ds1", kind: "table", schema: "public", table: "orders" },
    ]);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    // Grants loaded: count = 2
    await waitFor(() => expect(screen.getByRole("cell", { name: "2" })).toBeInTheDocument());
  });

  it("each row has Edit permissions, Edit details, Delete actions", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst]);
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    expect(screen.getByRole("link", { name: /edit permissions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit details/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });
});

// ─── Search ───────────────────────────────────────────────────────────────────

describe("RolesPage — search/filter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    vi.mocked(listRoleGrants).mockResolvedValue([]);
  });

  it("filters roles by name", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst, roleAdmin]);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));

    const search = screen.getByRole("searchbox");
    await userEvent.type(search, "Analyst");

    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("filters roles by description substring", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst, roleAdmin]);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));

    const search = screen.getByRole("searchbox");
    await userEvent.type(search, "data analyst");

    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });
});

// ─── Create modal ─────────────────────────────────────────────────────────────

describe("RolesPage — create role modal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listRoles).mockResolvedValue([]);
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    vi.mocked(listRoleGrants).mockResolvedValue([]);
  });

  it("opens create modal when New role button is clicked", async () => {
    renderRolesPage();
    await waitFor(() => screen.getByText(/no roles yet/i));
    await userEvent.click(screen.getAllByRole("button", { name: /new role/i })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("New role")).toBeInTheDocument();
  });

  it("create submit button is disabled when name is empty", async () => {
    renderRolesPage();
    await waitFor(() => screen.getByText(/no roles yet/i));
    await userEvent.click(screen.getAllByRole("button", { name: /new role/i })[0]);
    expect(screen.getByRole("button", { name: /create role/i })).toBeDisabled();
  });

  it("calls createRole with trimmed name and optional description", async () => {
    vi.mocked(createRole).mockResolvedValue({ ...roleAnalyst, id: "new-id" });
    renderRolesPage();
    await waitFor(() => screen.getByText(/no roles yet/i));
    await userEvent.click(screen.getAllByRole("button", { name: /new role/i })[0]);

    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/role name/i), "  Sales  ");
    await userEvent.type(within(dialog).getByLabelText(/description/i), "Sales team");
    await userEvent.click(within(dialog).getByRole("button", { name: /create role/i }));

    await waitFor(() =>
      expect(createRole).toHaveBeenCalledWith({ name: "Sales", description: "Sales team" }),
    );
  });

  it("closes modal on Cancel", async () => {
    renderRolesPage();
    await waitFor(() => screen.getByText(/no roles yet/i));
    await userEvent.click(screen.getAllByRole("button", { name: /new role/i })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes modal on Escape key", async () => {
    renderRolesPage();
    await waitFor(() => screen.getByText(/no roles yet/i));
    await userEvent.click(screen.getAllByRole("button", { name: /new role/i })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows error when createRole rejects", async () => {
    vi.mocked(createRole).mockRejectedValue({ code: "VALIDATION", message: "Name already taken" });
    renderRolesPage();
    await waitFor(() => screen.getByText(/no roles yet/i));
    await userEvent.click(screen.getAllByRole("button", { name: /new role/i })[0]);

    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/role name/i), "Analyst");
    await userEvent.click(within(dialog).getByRole("button", { name: /create role/i }));

    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("Name already taken"),
    );
  });
});

// ─── Edit modal ───────────────────────────────────────────────────────────────

describe("RolesPage — edit role modal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    vi.mocked(listRoleGrants).mockResolvedValue([]);
  });

  it("opens edit modal with pre-populated values", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst]);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    await userEvent.click(screen.getByRole("button", { name: /edit details/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByDisplayValue("Analyst")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Data analyst role")).toBeInTheDocument();
  });

  it("canInspectQuery switch reflects role capability and is editable", async () => {
    vi.mocked(listRoles).mockResolvedValue([{ ...roleAnalyst, capabilities: { canInspectQuery: true } }]);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    await userEvent.click(screen.getByRole("button", { name: /edit details/i }));

    const dialog = screen.getByRole("dialog");
    const toggle = within(dialog).getByRole("switch");
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
  });

  it("calls updateRole with updated values and capabilities", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst]);
    vi.mocked(updateRole).mockResolvedValue(roleAnalyst);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    await userEvent.click(screen.getByRole("button", { name: /edit details/i }));

    const dialog = screen.getByRole("dialog");
    const nameInput = within(dialog).getByLabelText(/role name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Senior Analyst");

    const toggle = within(dialog).getByRole("switch");
    await userEvent.click(toggle); // now true

    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(updateRole).toHaveBeenCalledWith("role-1", {
        name: "Senior Analyst",
        description: "Data analyst role",
        capabilities: { canInspectQuery: true },
      }),
    );
  });

  it("canInspectQuery is false by default for roles without it", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst]); // canInspectQuery: false
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    await userEvent.click(screen.getByRole("button", { name: /edit details/i }));

    const toggle = within(screen.getByRole("dialog")).getByRole("switch");
    expect(toggle).not.toBeChecked();
  });
});

// ─── Delete modal ─────────────────────────────────────────────────────────────

describe("RolesPage — delete role modal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listRoleGrants).mockResolvedValue([]);
  });

  it("opens delete modal with role name and user count warning", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst]);
    vi.mocked(listAdminUsers).mockResolvedValue(usersInAnalyst);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Analyst");
    expect(dialog.textContent).toContain("2");
    expect(dialog.textContent).toContain("cannot be undone");
  });

  it("calls deleteRole on confirm and closes modal", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst]);
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    vi.mocked(deleteRole).mockResolvedValue(undefined);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /delete role/i }));

    await waitFor(() => expect(deleteRole).toHaveBeenCalledWith("role-1"));
  });

  it("Cancel closes delete modal without deleting", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst]);
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteRole).not.toHaveBeenCalled();
  });

  it("shows error when deleteRole rejects", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst]);
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    vi.mocked(deleteRole).mockRejectedValue({ code: "VALIDATION", message: "Role has active users" });
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /delete role/i }));

    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("Role has active users"),
    );
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("RolesPage — accessibility (axe)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listAdminUsers).mockResolvedValue([]);
    vi.mocked(listRoleGrants).mockResolvedValue([]);
  });

  it("loaded table state has no critical a11y violations", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst, roleAdmin]);
    vi.mocked(listAdminUsers).mockResolvedValue(usersInAnalyst);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));

    const results = await axe.run(document.body);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical a11y violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("empty state has no critical a11y violations", async () => {
    vi.mocked(listRoles).mockResolvedValue([]);
    renderRolesPage();
    await waitFor(() => screen.getByText(/no roles yet/i));

    const results = await axe.run(document.body);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical a11y violations in empty state: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("create modal open has no critical a11y violations", async () => {
    vi.mocked(listRoles).mockResolvedValue([]);
    renderRolesPage();
    await waitFor(() => screen.getByText(/no roles yet/i));
    await userEvent.click(screen.getAllByRole("button", { name: /new role/i })[0]);
    await waitFor(() => screen.getByRole("dialog"));

    const results = await axe.run(document.body);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical a11y violations with create modal: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("edit modal open has no critical a11y violations", async () => {
    vi.mocked(listRoles).mockResolvedValue([roleAnalyst]);
    renderRolesPage();
    await waitFor(() => screen.getByText("Analyst"));
    await userEvent.click(screen.getByRole("button", { name: /edit details/i }));
    await waitFor(() => screen.getByRole("dialog"));

    const results = await axe.run(document.body);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical a11y violations with edit modal: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });
});
