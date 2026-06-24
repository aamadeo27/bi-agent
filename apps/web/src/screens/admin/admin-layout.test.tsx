import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import type { MeResponse } from "@bi/contracts";
import { getMe } from "../../lib/api-client";
import { AdminLayout } from "./admin-layout";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../lib/api-client", () => ({
  getMe: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const adminMe: MeResponse = {
  user: {
    id: "u1",
    email: "admin@example.com",
    displayName: "Admin User",
    status: "active",
    authMethods: ["password"],
  },
  role: { id: "r1", name: "Admin" },
  capabilities: { canInspectQuery: false, isAdmin: true },
  tenant: { id: "t1", displayName: "Acme Corp" },
};

const nonAdminMe: MeResponse = {
  ...adminMe,
  capabilities: { canInspectQuery: false, isAdmin: false },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderAdminLayout() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/roles"]}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="roles" element={<div>Roles content</div>} />
          </Route>
          <Route path="/chat" element={<div>Chat page</div>} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AdminLayout — loading / error states", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("shows loading indicator while fetching /me", () => {
    vi.mocked(getMe).mockReturnValue(new Promise(() => {}));
    renderAdminLayout();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("redirects AUTH error to /login", async () => {
    vi.mocked(getMe).mockRejectedValue({ code: "AUTH", message: "Unauthorized" });
    renderAdminLayout();
    await waitFor(() => expect(screen.getByText("Login page")).toBeInTheDocument());
    expect(screen.queryByText("Roles content")).not.toBeInTheDocument();
  });
});

describe("AdminLayout — access control", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("renders sidebar + outlet for admin users", async () => {
    vi.mocked(getMe).mockResolvedValue(adminMe);
    renderAdminLayout();
    await waitFor(() => expect(screen.getByText("Roles content")).toBeInTheDocument());
    expect(screen.getByRole("navigation", { name: /admin navigation/i })).toBeInTheDocument();
  });

  it("redirects non-admin to /chat", async () => {
    vi.mocked(getMe).mockResolvedValue(nonAdminMe);
    renderAdminLayout();
    await waitFor(() => expect(screen.getByText("Chat page")).toBeInTheDocument());
    expect(screen.queryByText("Roles content")).not.toBeInTheDocument();
  });
});

describe("AdminSidebar nav links", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("contains all admin nav links and back-to-chat", async () => {
    vi.mocked(getMe).mockResolvedValue(adminMe);
    renderAdminLayout();
    await waitFor(() => screen.getByText("Roles content"));

    const nav = screen.getByRole("navigation", { name: /admin navigation/i });
    expect(nav).toHaveTextContent("Roles");
    expect(nav).toHaveTextContent("Users");
    expect(nav).toHaveTextContent("Data Sources");
    expect(nav).toHaveTextContent("Audit Log");
    expect(nav).toHaveTextContent("Back to chat");
  });

  it("Back to chat links to /chat", async () => {
    vi.mocked(getMe).mockResolvedValue(adminMe);
    renderAdminLayout();
    await waitFor(() => screen.getByText("Roles content"));

    const nav = screen.getByRole("navigation", { name: /admin navigation/i });
    const backLink = nav.querySelector("a[href='/chat']");
    expect(backLink).toBeInTheDocument();
  });
});

describe("AdminLayout — accessibility (axe)", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("loaded admin view has no critical a11y violations", async () => {
    vi.mocked(getMe).mockResolvedValue(adminMe);
    const { container } = renderAdminLayout();
    await waitFor(() => screen.getByText("Roles content"));

    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical a11y violations: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });

  it("loading state has no critical a11y violations", async () => {
    vi.mocked(getMe).mockReturnValue(new Promise(() => {}));
    const { container } = renderAdminLayout();

    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(
      critical,
      `Critical a11y violations in loading state: ${JSON.stringify(critical.map((v) => v.id))}`,
    ).toHaveLength(0);
  });
});
