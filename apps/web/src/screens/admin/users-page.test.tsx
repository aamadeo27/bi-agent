import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import type { User, Role } from "@bi/contracts";
import {
  listAdminUsers,
  listRoles,
  patchAdminUser,
  inviteUser,
} from "../../lib/api-client";
import { UsersPage } from "./users-page";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../lib/api-client", () => ({
  listAdminUsers: vi.fn(),
  listRoles: vi.fn(),
  patchAdminUser: vi.fn(),
  inviteUser: vi.fn(),
}));

const mockListAdminUsers = vi.mocked(listAdminUsers);
const mockListRoles = vi.mocked(listRoles);
const mockPatchAdminUser = vi.mocked(patchAdminUser);
const mockInviteUser = vi.mocked(inviteUser);

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

const userAlice: User = {
  id: "u1",
  email: "alice@example.com",
  displayName: "Alice",
  status: "active",
  roleId: "role-1",
  authMethods: ["password"],
  createdAt: "2024-01-01T00:00:00.000Z",
};

const userBob: User = {
  id: "u2",
  email: "bob@example.com",
  displayName: "Bob",
  status: "invited",
  roleId: null,
  authMethods: [],
  createdAt: "2024-01-02T00:00:00.000Z",
};

const userCarol: User = {
  id: "u3",
  email: "carol@example.com",
  displayName: "Carol",
  status: "suspended",
  roleId: "role-2",
  authMethods: ["sso"],
  createdAt: "2024-01-03T00:00:00.000Z",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderUsersPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { container };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockListRoles.mockResolvedValue([roleAnalyst, roleAdmin]);
});

describe("UsersPage — table rendering", () => {
  it("shows loading state initially", async () => {
    mockListAdminUsers.mockReturnValue(new Promise(() => {})); // never resolves
    renderUsersPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading users…");
  });

  it("renders users table with name, email, role, status columns", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice, userBob, userCarol]);
    renderUsersPage();

    // Wait for table to appear
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    // Check column headers
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Email" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Role" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();

    // Check user data
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Analyst")).toBeInTheDocument();

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();

    expect(screen.getByText("Carol")).toBeInTheDocument();
    expect(screen.getByText("carol@example.com")).toBeInTheDocument();
  });

  it("shows correct status badges", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice, userBob, userCarol]);
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Invited")).toBeInTheDocument();
    expect(screen.getByText("Suspended")).toBeInTheDocument();
  });

  it("shows 'No role' for users without a role", async () => {
    mockListAdminUsers.mockResolvedValue([userBob]);
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    expect(screen.getByText("No role")).toBeInTheDocument();
  });

  it("renders empty state when no users exist", async () => {
    mockListAdminUsers.mockResolvedValue([]);
    renderUsersPage();

    await waitFor(() =>
      expect(screen.getByText("No users yet.")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Invite your first team member/)).toBeInTheDocument();
  });

  it("shows error state when fetch fails", async () => {
    mockListAdminUsers.mockRejectedValue(new Error("Network error"));
    renderUsersPage();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Failed to load users",
      ),
    );
  });
});

describe("UsersPage — suspend / reinstate", () => {
  it("shows Suspend button for active users, Reinstate for suspended", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice, userCarol]);
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));

    // Alice is active → should see Suspend
    expect(screen.getAllByRole("button", { name: "Suspend" })[0]).toBeInTheDocument();
    // Carol is suspended → should see Reinstate
    expect(screen.getByRole("button", { name: "Reinstate" })).toBeInTheDocument();
  });

  it("calls patchAdminUser with suspended status on Suspend click", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice]);
    mockPatchAdminUser.mockResolvedValue({ ...userAlice, status: "suspended" });
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Suspend" }));

    expect(mockPatchAdminUser).toHaveBeenCalledWith("u1", { status: "suspended" });
  });

  it("calls patchAdminUser with active status on Reinstate click", async () => {
    mockListAdminUsers.mockResolvedValue([userCarol]);
    mockPatchAdminUser.mockResolvedValue({ ...userCarol, status: "active" });
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Reinstate" }));

    expect(mockPatchAdminUser).toHaveBeenCalledWith("u3", { status: "active" });
  });
});

describe("UsersPage — inline role editor", () => {
  it("shows inline role selector after clicking Edit role", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice]);
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Edit role" }));

    expect(
      screen.getByRole("combobox", { name: /Select role for Alice/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("Save button is disabled when no change made", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice]);
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Edit role" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("calls patchAdminUser with new roleId on save", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice]);
    mockPatchAdminUser.mockResolvedValue({ ...userAlice, roleId: "role-2" });
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Edit role" }));

    const select = screen.getByRole("combobox", { name: /Select role for Alice/i });
    await user.selectOptions(select, "role-2");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mockPatchAdminUser).toHaveBeenCalledWith("u1", { roleId: "role-2" });
  });

  it("calls patchAdminUser with null roleId when selecting No role", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice]); // has roleId = "role-1"
    mockPatchAdminUser.mockResolvedValue({ ...userAlice, roleId: null });
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Edit role" }));

    const select = screen.getByRole("combobox", { name: /Select role for Alice/i });
    await user.selectOptions(select, "");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mockPatchAdminUser).toHaveBeenCalledWith("u1", { roleId: null });
  });

  it("shows GAP-17 warning banner after saving a role change", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice]);
    mockPatchAdminUser.mockResolvedValue({ ...userAlice, roleId: "role-2" });
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Edit role" }));

    const select = screen.getByRole("combobox", { name: /Select role for Alice/i });
    await user.selectOptions(select, "role-2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Changes will take effect on the user.s next login or session refresh/,
      ),
    );
  });

  it("dismisses GAP-17 banner via dismiss button", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice]);
    mockPatchAdminUser.mockResolvedValue({ ...userAlice, roleId: "role-2" });
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Edit role" }));

    const select = screen.getByRole("combobox", { name: /Select role for Alice/i });
    await user.selectOptions(select, "role-2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => screen.getByRole("alert"));
    await user.click(screen.getByRole("button", { name: "Dismiss warning" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("dismisses inline editor on Cancel click", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice]);
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Edit role" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByRole("combobox", { name: /Select role for Alice/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit role" })).toBeInTheDocument();
  });
});

describe("UsersPage — invite flow", () => {
  beforeEach(() => {
    mockListAdminUsers.mockResolvedValue([userAlice]);
  });

  it("opens invite modal on 'Invite user' click", async () => {
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Invite user" }));

    expect(screen.getByRole("dialog", { name: "Invite user" })).toBeInTheDocument();
  });

  it("calls inviteUser with email and displayName on submit", async () => {
    mockInviteUser.mockResolvedValue({ userId: "new-user" });
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Invite user" }));

    const dialog = screen.getByRole("dialog", { name: "Invite user" });
    await user.type(within(dialog).getByLabelText(/Email address/), "dave@example.com");
    await user.type(within(dialog).getByLabelText(/Display name/), "Dave");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));

    expect(mockInviteUser).toHaveBeenCalledWith({
      email: "dave@example.com",
      displayName: "Dave",
    });
  });

  it("passes roleId to inviteUser when role selected", async () => {
    mockInviteUser.mockResolvedValue({ userId: "new-user" });
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Invite user" }));

    const dialog = screen.getByRole("dialog", { name: "Invite user" });
    await user.type(within(dialog).getByLabelText(/Email address/), "eve@example.com");
    await user.type(within(dialog).getByLabelText(/Display name/), "Eve");
    await user.selectOptions(within(dialog).getByLabelText(/Role/), "role-1");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));

    expect(mockInviteUser).toHaveBeenCalledWith({
      email: "eve@example.com",
      displayName: "Eve",
      roleId: "role-1",
    });
  });

  it("Send invite button is disabled when fields empty", async () => {
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Invite user" }));

    const dialog = screen.getByRole("dialog", { name: "Invite user" });
    expect(within(dialog).getByRole("button", { name: "Send invite" })).toBeDisabled();
  });

  it("closes modal and shows success toast after successful invite", async () => {
    mockInviteUser.mockResolvedValue({ userId: "new-user" });
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Invite user" }));

    const dialog = screen.getByRole("dialog", { name: "Invite user" });
    await user.type(within(dialog).getByLabelText(/Email address/), "frank@example.com");
    await user.type(within(dialog).getByLabelText(/Display name/), "Frank");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Invite user" })).not.toBeInTheDocument(),
    );
  });

  it("shows error message in modal when invite fails", async () => {
    mockInviteUser.mockRejectedValue({ code: "VALIDATION", message: "Email already exists" });
    const user = userEvent.setup();
    renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Invite user" }));

    const dialog = screen.getByRole("dialog", { name: "Invite user" });
    await user.type(within(dialog).getByLabelText(/Email address/), "alice@example.com");
    await user.type(within(dialog).getByLabelText(/Display name/), "Alice Dupe");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));

    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("Email already exists"),
    );
  });
});

describe("UsersPage — accessibility (axe)", () => {
  it("table view passes axe", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice, userBob, userCarol]);
    const { container } = renderUsersPage();

    await waitFor(() => screen.getByRole("table"));

    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });

  it("empty state passes axe", async () => {
    mockListAdminUsers.mockResolvedValue([]);
    const { container } = renderUsersPage();

    await waitFor(() => screen.getByText("No users yet."));

    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });

  it("inline role editor passes axe", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice]);
    const user = userEvent.setup();
    const { container } = renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Edit role" }));

    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });

  it("invite modal passes axe", async () => {
    mockListAdminUsers.mockResolvedValue([userAlice]);
    const user = userEvent.setup();
    const { container } = renderUsersPage();

    await waitFor(() => screen.getByRole("table"));
    await user.click(screen.getByRole("button", { name: "Invite user" }));

    await waitFor(() => screen.getByRole("dialog", { name: "Invite user" }));
    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });
});
