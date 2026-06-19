import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";

import { LoginPage } from "./login-page";
import * as apiClient from "../lib/api-client";
import * as authStore from "../lib/auth-store";
import * as tenantLib from "../lib/tenant";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderLogin(initialEntries = ["/login"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Sentinel route so we can assert navigation happened */}
          <Route path="/chat" element={<div data-testid="chat-page">Chat</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../lib/api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return {
    ...mod,
    login: vi.fn(),
    getTenantSsoConfig: vi.fn(),
    getSsoStartUrl: vi.fn(() => "https://sso.example.com/start"),
  };
});

vi.mock("../lib/auth-store", async (importOriginal) => {
  const mod = await importOriginal<typeof authStore>();
  return { ...mod, setAccessToken: vi.fn() };
});

vi.mock("../lib/tenant", async (importOriginal) => {
  const mod = await importOriginal<typeof tenantLib>();
  return { ...mod, getTenantSlug: vi.fn(() => null) };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LoginPage — rendering", () => {
  beforeEach(() => {
    vi.mocked(tenantLib.getTenantSlug).mockReturnValue(null);
    vi.mocked(apiClient.getTenantSsoConfig).mockResolvedValue({ ssoEnabled: false });
  });

  afterEach(() => vi.clearAllMocks());

  it("renders h1 'Sign In'", () => {
    renderLogin();
    expect(screen.getByRole("heading", { name: /sign in/i, level: 1 })).toBeInTheDocument();
  });

  it("renders email field", () => {
    renderLogin();
    expect(screen.getByRole("textbox", { name: /email/i })).toBeInTheDocument();
  });

  it("renders password field", () => {
    renderLogin();
    // password inputs don't have implicit role; query by label text
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
  });

  it("renders Forgot password link", () => {
    renderLogin();
    expect(screen.getByRole("link", { name: /forgot password/i })).toBeInTheDocument();
  });

  it("renders Sign in submit button", () => {
    renderLogin();
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("does NOT render SSO button when no tenant slug", () => {
    renderLogin();
    expect(screen.queryByRole("button", { name: /sso/i })).not.toBeInTheDocument();
  });

  it("shows tenant name when subdomain is present", async () => {
    vi.mocked(tenantLib.getTenantSlug).mockReturnValue("acme");
    vi.mocked(apiClient.getTenantSsoConfig).mockResolvedValue({ ssoEnabled: false });
    renderLogin();
    expect(screen.getByText(/acme/)).toBeInTheDocument();
  });
});

describe("LoginPage — session-expired banner", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows session-expired banner when ?reason=session_expired", () => {
    vi.mocked(tenantLib.getTenantSlug).mockReturnValue(null);
    vi.mocked(apiClient.getTenantSsoConfig).mockResolvedValue({ ssoEnabled: false });
    renderLogin(["/login?reason=session_expired"]);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/session has expired/i)).toBeInTheDocument();
  });

  it("does NOT show banner without reason param", () => {
    vi.mocked(tenantLib.getTenantSlug).mockReturnValue(null);
    vi.mocked(apiClient.getTenantSsoConfig).mockResolvedValue({ ssoEnabled: false });
    renderLogin();
    expect(screen.queryByText(/session has expired/i)).not.toBeInTheDocument();
  });
});

describe("LoginPage — SSO button", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders SSO button when tenant has ssoEnabled=true", async () => {
    vi.mocked(tenantLib.getTenantSlug).mockReturnValue("acme");
    vi.mocked(apiClient.getTenantSsoConfig).mockResolvedValue({ ssoEnabled: true });
    renderLogin();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sso/i })).toBeInTheDocument(),
    );
  });

  it("does NOT render SSO button when ssoEnabled=false", async () => {
    vi.mocked(tenantLib.getTenantSlug).mockReturnValue("acme");
    vi.mocked(apiClient.getTenantSsoConfig).mockResolvedValue({ ssoEnabled: false });
    renderLogin();
    await waitFor(() => expect(apiClient.getTenantSsoConfig).toHaveBeenCalledWith("acme"));
    expect(screen.queryByRole("button", { name: /sso/i })).not.toBeInTheDocument();
  });
});

describe("LoginPage — email+password login", () => {
  beforeEach(() => {
    vi.mocked(tenantLib.getTenantSlug).mockReturnValue(null);
    vi.mocked(apiClient.getTenantSsoConfig).mockResolvedValue({ ssoEnabled: false });
  });

  afterEach(() => vi.clearAllMocks());

  it("shows loading state while submitting", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.login).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ accessToken: "tok" }), 100)),
    );

    renderLogin();
    await user.type(screen.getByRole("textbox", { name: /email/i }), "test@example.com");
    await user.type(screen.getByLabelText(/^password/i), "password123");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    // Spinner appears while pending
    expect(screen.getByLabelText(/signing in/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();
  });

  it("calls login with email + password", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.login).mockResolvedValue({ accessToken: "tok_ok" });

    renderLogin();
    await user.type(screen.getByRole("textbox", { name: /email/i }), "user@example.com");
    await user.type(screen.getByLabelText(/^password/i), "s3cr3t");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() =>
      expect(apiClient.login).toHaveBeenCalledWith({
        email: "user@example.com",
        password: "s3cr3t",
      }),
    );
  });

  it("stores access token and navigates to /chat on success", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.login).mockResolvedValue({ accessToken: "tok_success" });

    renderLogin();
    await user.type(screen.getByRole("textbox", { name: /email/i }), "user@example.com");
    await user.type(screen.getByLabelText(/^password/i), "s3cr3t");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(authStore.setAccessToken).toHaveBeenCalledWith("tok_success"));
    // Router navigates to /chat — sentinel route renders
    await waitFor(() => expect(screen.getByTestId("chat-page")).toBeInTheDocument());
  });

  it("shows error message on AUTH error", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.login).mockRejectedValue({
      code: "AUTH",
      message: "Invalid credentials.",
    });

    renderLogin();
    await user.type(screen.getByRole("textbox", { name: /email/i }), "bad@example.com");
    await user.type(screen.getByLabelText(/^password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid credentials."),
    );
  });

  it("shows generic error on unknown failure", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.login).mockRejectedValue(new Error("Network error"));

    renderLogin();
    await user.type(screen.getByRole("textbox", { name: /email/i }), "a@b.com");
    await user.type(screen.getByLabelText(/^password/i), "pw");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/unexpected error/i),
    );
  });
});

describe("LoginPage — accessibility (axe)", () => {
  afterEach(() => vi.clearAllMocks());

  it("idle state has no critical axe violations", async () => {
    vi.mocked(tenantLib.getTenantSlug).mockReturnValue(null);
    vi.mocked(apiClient.getTenantSsoConfig).mockResolvedValue({ ssoEnabled: false });
    const { container } = renderLogin();
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, "Critical a11y violations").toHaveLength(0);
  });

  it("session-expired banner has no critical axe violations", async () => {
    vi.mocked(tenantLib.getTenantSlug).mockReturnValue(null);
    vi.mocked(apiClient.getTenantSsoConfig).mockResolvedValue({ ssoEnabled: false });
    const { container } = renderLogin(["/login?reason=session_expired"]);
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, "Critical a11y violations (session-expired)").toHaveLength(0);
  });

  it("error state has no critical axe violations", async () => {
    const user = userEvent.setup();
    vi.mocked(tenantLib.getTenantSlug).mockReturnValue(null);
    vi.mocked(apiClient.getTenantSsoConfig).mockResolvedValue({ ssoEnabled: false });
    vi.mocked(apiClient.login).mockRejectedValue({ code: "AUTH", message: "Invalid credentials." });

    const { container } = renderLogin();

    await user.type(screen.getByRole("textbox", { name: /email/i }), "bad@example.com");
    await user.type(screen.getByLabelText(/^password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, "Critical a11y violations (error state)").toHaveLength(0);
  });

  it("SSO variant has no critical axe violations", async () => {
    vi.mocked(tenantLib.getTenantSlug).mockReturnValue("acme");
    vi.mocked(apiClient.getTenantSsoConfig).mockResolvedValue({ ssoEnabled: true });
    const { container } = renderLogin();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sso/i })).toBeInTheDocument(),
    );
    const results = await axe.run(container);
    const critical = results.violations.filter((v) => v.impact === "critical");
    expect(critical, "Critical a11y violations (SSO)").toHaveLength(0);
  });
});
