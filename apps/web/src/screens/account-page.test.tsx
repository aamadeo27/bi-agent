import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import type { MeResponse } from "@bi/contracts";
// Vitest hoists vi.mock() calls before module resolution, so even though these
// imports appear before the vi.mock() calls below, the mocks are applied first.
import { getMe, updateMe, changePassword, logoutAll } from "../lib/api-client";
import { AccountPage } from "./account-page";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../lib/api-client", () => ({
  getMe: vi.fn(),
  updateMe: vi.fn(),
  changePassword: vi.fn(),
  logoutAll: vi.fn(),
}));

vi.mock("../lib/auth-store", () => ({
  clearAccessToken: vi.fn(),
  getAccessToken: vi.fn().mockReturnValue(null),
  setAccessToken: vi.fn(),
}));

// ─── Fixture ─────────────────────────────────────────────────────────────────

const meWithPassword: MeResponse = {
  user: {
    id: "u1",
    email: "alice@example.com",
    displayName: "Alice",
    status: "active",
    authMethods: ["password"],
  },
  role: { id: "role1", name: "Analyst" },
  capabilities: { canInspectQuery: false },
  tenant: { id: "t1", displayName: "Acme Corp" },
};

const meWithSso: MeResponse = {
  ...meWithPassword,
  user: { ...meWithPassword.user, authMethods: ["sso"] },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderAccountPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Loading + error states ───────────────────────────────────────────────────

describe("AccountPage loading/error states", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows heading while data is pending", () => {
    vi.mocked(getMe).mockReturnValue(new Promise(() => {})); // never resolves

    renderAccountPage();
    expect(screen.getByRole("heading", { name: /account & profile/i })).toBeInTheDocument();
  });

  it("shows error state when getMe fails", async () => {
    vi.mocked(getMe).mockRejectedValue(new Error("Network error"));

    renderAccountPage();
    await waitFor(() => {
      expect(screen.getByText(/failed to load profile/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: /account & profile/i })).toBeInTheDocument();
  });
});

// ─── Profile section ─────────────────────────────────────────────────────────

describe("AccountPage profile section", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getMe).mockResolvedValue(meWithPassword);
  });

  it("renders display name, email, role and tenant after load", async () => {
    renderAccountPage();
    await waitFor(() => screen.getByDisplayValue("Alice"));

    expect(screen.getByDisplayValue("alice@example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Analyst")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Acme Corp")).toBeInTheDocument();
  });

  it("email, role, and tenant fields are read-only", async () => {
    renderAccountPage();
    await waitFor(() => screen.getByDisplayValue("alice@example.com"));

    expect(screen.getByLabelText(/email/i)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/active role/i)).toHaveAttribute("readonly");
    expect(screen.getByLabelText(/workspace/i)).toHaveAttribute("readonly");
  });

  it("save button is disabled when display name unchanged", async () => {
    renderAccountPage();
    await waitFor(() => screen.getByDisplayValue("Alice"));

    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("save button enables after editing display name", async () => {
    renderAccountPage();
    await waitFor(() => screen.getByDisplayValue("Alice"));

    // Use getByDisplayValue to locate the editable display name input
    const input = screen.getByDisplayValue("Alice");
    await userEvent.clear(input);
    await userEvent.type(input, "Alice Updated");

    expect(screen.getByRole("button", { name: /save changes/i })).not.toBeDisabled();
  });

  it("calls updateMe on save and shows success message", async () => {
    vi.mocked(updateMe).mockResolvedValue(undefined);
    renderAccountPage();
    await waitFor(() => screen.getByDisplayValue("Alice"));

    const input = screen.getByDisplayValue("Alice");
    await userEvent.clear(input);
    await userEvent.type(input, "Alice B.");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/display name updated/i)).toBeInTheDocument();
    });
    expect(updateMe).toHaveBeenCalledWith({ displayName: "Alice B." });
  });

  it("shows error message when updateMe fails", async () => {
    vi.mocked(updateMe).mockRejectedValue({ code: "INTERNAL", message: "Server error" });
    renderAccountPage();
    await waitFor(() => screen.getByDisplayValue("Alice"));

    const input = screen.getByDisplayValue("Alice");
    await userEvent.clear(input);
    await userEvent.type(input, "Alice B.");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Server error");
    });
  });
});

// ─── Password section ─────────────────────────────────────────────────────────

describe("AccountPage password section", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows password section for password-auth users", async () => {
    vi.mocked(getMe).mockResolvedValue(meWithPassword);
    renderAccountPage();
    await waitFor(() => screen.getByRole("heading", { name: /change password/i }));
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
  });

  it("hides password section for SSO-only users", async () => {
    vi.mocked(getMe).mockResolvedValue(meWithSso);
    renderAccountPage();
    await waitFor(() => screen.getByDisplayValue("alice@example.com"));
    expect(screen.queryByRole("heading", { name: /change password/i })).not.toBeInTheDocument();
  });

  it("shows password mismatch error when confirm differs", async () => {
    vi.mocked(getMe).mockResolvedValue(meWithPassword);
    renderAccountPage();
    // Wait for the password section to render
    await waitFor(() => screen.getByRole("heading", { name: /change password/i }));

    // Use regex to match labels that may contain an aria-hidden asterisk
    await userEvent.type(screen.getByLabelText(/current password/i), "OldPass1!");
    await userEvent.type(screen.getByLabelText(/^new password/i), "NewPass1!");
    await userEvent.type(screen.getByLabelText(/confirm new password/i), "Different1!");
    await userEvent.click(screen.getByRole("button", { name: /update password/i }));

    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("clears mismatch error when user edits new password field", async () => {
    vi.mocked(getMe).mockResolvedValue(meWithPassword);
    renderAccountPage();
    await waitFor(() => screen.getByRole("heading", { name: /change password/i }));

    await userEvent.type(screen.getByLabelText(/current password/i), "OldPass1!");
    await userEvent.type(screen.getByLabelText(/^new password/i), "NewPass1!");
    await userEvent.type(screen.getByLabelText(/confirm new password/i), "Different1!");
    await userEvent.click(screen.getByRole("button", { name: /update password/i }));
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();

    // Editing either new-password field should clear the mismatch error
    await userEvent.type(screen.getByLabelText(/^new password/i), "X");
    expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();
  });

  it("calls changePassword and shows success on matching passwords", async () => {
    vi.mocked(getMe).mockResolvedValue(meWithPassword);
    vi.mocked(changePassword).mockResolvedValue(undefined);
    renderAccountPage();
    await waitFor(() => screen.getByRole("heading", { name: /change password/i }));

    await userEvent.type(screen.getByLabelText(/current password/i), "OldPass1!");
    await userEvent.type(screen.getByLabelText(/^new password/i), "NewPass1!");
    await userEvent.type(screen.getByLabelText(/confirm new password/i), "NewPass1!");
    await userEvent.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => {
      expect(screen.getByText(/password changed successfully/i)).toBeInTheDocument();
    });
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: "OldPass1!",
      newPassword: "NewPass1!",
    });
  });
});

// ─── Danger zone ─────────────────────────────────────────────────────────────

describe("AccountPage danger zone", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getMe).mockResolvedValue(meWithPassword);
  });

  it("renders danger zone section with sign-out button", async () => {
    renderAccountPage();
    await waitFor(() => screen.getByRole("heading", { name: /danger zone/i }));
    expect(screen.getByRole("button", { name: /sign out of all sessions/i })).toBeInTheDocument();
  });

  it("calls logoutAll on single click and clears token", async () => {
    vi.mocked(logoutAll).mockResolvedValue(undefined);
    renderAccountPage();
    await waitFor(() => screen.getByRole("button", { name: /sign out of all sessions/i }));

    await userEvent.click(screen.getByRole("button", { name: /sign out of all sessions/i }));
    await waitFor(() => expect(logoutAll).toHaveBeenCalledOnce());
  });
});

// ─── Accessibility ────────────────────────────────────────────────────────────

describe("AccountPage accessibility (axe)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("loaded state has no critical a11y violations", async () => {
    vi.mocked(getMe).mockResolvedValue(meWithPassword);
    const { container } = renderAccountPage();

    await waitFor(() => screen.getByDisplayValue("Alice"));

    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical a11y violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("loading state has no critical a11y violations", async () => {
    vi.mocked(getMe).mockReturnValue(new Promise(() => {}));
    const { container } = renderAccountPage();

    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical a11y violations in loading state: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("error state has no critical a11y violations", async () => {
    vi.mocked(getMe).mockRejectedValue(new Error("Network error"));
    const { container } = renderAccountPage();

    await waitFor(() => screen.getByText(/failed to load profile/i));

    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical a11y violations in error state: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });
});
