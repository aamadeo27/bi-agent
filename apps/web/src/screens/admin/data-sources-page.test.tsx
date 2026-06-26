import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import type { DataSource } from "@bi/contracts";
import {
  listDataSources,
  createDataSource,
  updateDataSource,
  deleteDataSource,
  testDataSource,
} from "../../lib/api-client";
import { DataSourcesPage } from "./data-sources-page";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../lib/api-client", () => ({
  listDataSources: vi.fn(),
  createDataSource: vi.fn(),
  updateDataSource: vi.fn(),
  deleteDataSource: vi.fn(),
  testDataSource: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const dsPostgres: DataSource = {
  id: "ds-1",
  name: "Production DB",
  type: "postgres",
  status: "connected",
  lastTestedAt: "2024-06-01T12:00:00.000Z",
};

const dsMySQL: DataSource = {
  id: "ds-2",
  name: "Analytics DB",
  type: "mysql",
  status: "error",
};

const dsBigQuery: DataSource = {
  id: "ds-3",
  name: "BQ Warehouse",
  type: "bigquery",
  status: "unconfigured",
};

const dsRest: DataSource = {
  id: "ds-4",
  name: "External API",
  type: "rest",
  status: "connected",
  lastTestedAt: "2024-06-02T09:00:00.000Z",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DataSourcesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

// ─── Loading / error states ───────────────────────────────────────────────────

describe("DataSourcesPage — loading and error", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows loading indicator while fetching", () => {
    vi.mocked(listDataSources).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent(/loading data sources/i);
  });

  it("shows error alert when listDataSources rejects", async () => {
    vi.mocked(listDataSources).mockRejectedValue(new Error("Network error"));
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/failed to load data sources/i),
    );
  });
});

// ─── Empty state ──────────────────────────────────────────────────────────────

describe("DataSourcesPage — empty state", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listDataSources).mockResolvedValue([]);
  });

  it("shows empty-state message and Add button when no data sources", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/no data sources configured/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/add your first data source/i)).toBeInTheDocument();
  });
});

// ─── Card grid ────────────────────────────────────────────────────────────────

describe("DataSourcesPage — card grid", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders a card for each data source", async () => {
    vi.mocked(listDataSources).mockResolvedValue([dsPostgres, dsMySQL]);
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    expect(screen.getByText("Analytics DB")).toBeInTheDocument();
  });

  it("shows type badge for each type", async () => {
    vi.mocked(listDataSources).mockResolvedValue([dsPostgres, dsMySQL, dsBigQuery, dsRest]);
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    expect(screen.getByText("PostgreSQL")).toBeInTheDocument();
    expect(screen.getByText("MySQL")).toBeInTheDocument();
    expect(screen.getByText("BigQuery")).toBeInTheDocument();
    expect(screen.getByText("REST API")).toBeInTheDocument();
  });

  it("shows status label for each status", async () => {
    vi.mocked(listDataSources).mockResolvedValue([dsPostgres, dsMySQL, dsBigQuery]);
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Unconfigured")).toBeInTheDocument();
  });

  it("shows last tested timestamp when available", async () => {
    vi.mocked(listDataSources).mockResolvedValue([dsPostgres]);
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    expect(screen.getByText(/last tested/i)).toBeInTheDocument();
  });

  it("does not show last tested when not available", async () => {
    vi.mocked(listDataSources).mockResolvedValue([dsMySQL]);
    renderPage();
    await waitFor(() => screen.getByText("Analytics DB"));
    expect(screen.queryByText(/last tested/i)).not.toBeInTheDocument();
  });

  it("each card has Edit, Re-test, Delete actions", async () => {
    vi.mocked(listDataSources).mockResolvedValue([dsPostgres]);
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    expect(screen.getByRole("button", { name: /edit production db/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-test connection for production db/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete production db/i })).toBeInTheDocument();
  });
});

// ─── Add modal ────────────────────────────────────────────────────────────────

describe("DataSourcesPage — add modal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listDataSources).mockResolvedValue([]);
  });

  it("opens add modal when 'Add data source' button is clicked", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /add data source/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /add data source/i })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /add data source/i })).toBeInTheDocument();
  });

  it("closes modal with Escape key", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /add data source/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /add data source/i })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes modal with Cancel button", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /add data source/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /add data source/i })[0]);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("type selector shows all 4 v1 types", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /add data source/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /add data source/i })[0]);
    const typeSelect = screen.getByRole("combobox", { name: /type/i });
    const options = within(typeSelect).getAllByRole("option");
    const optionTexts = options.map((o) => o.textContent);
    expect(optionTexts).toContain("PostgreSQL");
    expect(optionTexts).toContain("MySQL");
    expect(optionTexts).toContain("BigQuery");
    expect(optionTexts).toContain("REST API");
  });

  it("shows postgres connection fields by default", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /add data source/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /add data source/i })[0]);
    expect(screen.getByLabelText(/host/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/database/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Password", { exact: true })).toBeInTheDocument();
  });

  it("switches to REST fields when type changes", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /add data source/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /add data source/i })[0]);
    const typeSelect = screen.getByRole("combobox", { name: /type/i });
    await userEvent.selectOptions(typeSelect, "rest");
    await waitFor(() =>
      expect(screen.getByLabelText(/^Base URL/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("API Key", { exact: true })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Host$/i)).not.toBeInTheDocument();
  });

  it("password field is masked by default (type=password)", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /add data source/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /add data source/i })[0]);
    const passwordInput = screen.getByLabelText("Password", { exact: true });
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("reveal toggle shows password plaintext", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /add data source/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /add data source/i })[0]);
    const passwordInput = screen.getByLabelText("Password", { exact: true });
    expect(passwordInput).toHaveAttribute("type", "password");
    const revealBtn = screen.getByRole("button", { name: /reveal password/i });
    await userEvent.click(revealBtn);
    expect(passwordInput).toHaveAttribute("type", "text");
    // Toggle back
    const hideBtn = screen.getByRole("button", { name: /hide password/i });
    await userEvent.click(hideBtn);
    expect(passwordInput).toHaveAttribute("type", "password");
  });

  it("Test connection button is disabled in add mode", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /add data source/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /add data source/i })[0]);
    const testBtn = screen.getByRole("button", { name: /test connection/i });
    expect(testBtn).toBeDisabled();
  });

  it("Save button is disabled when name is empty", async () => {
    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /add data source/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /add data source/i })[0]);
    // Name is empty — save button inside dialog must be disabled
    const dialog = screen.getByRole("dialog");
    const saveInDialog = within(dialog).getByRole("button", { name: /add data source/i });
    expect(saveInDialog).toBeDisabled();
  });

  it("calls createDataSource with name + type on submit", async () => {
    const newDs: DataSource = {
      id: "ds-new",
      name: "Test Source",
      type: "postgres",
      status: "unconfigured",
    };
    vi.mocked(createDataSource).mockResolvedValue(newDs);
    vi.mocked(listDataSources).mockResolvedValue([newDs]);

    renderPage();
    await waitFor(() => screen.getByRole("button", { name: /add data source/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /add data source/i })[0]);

    const dialog = screen.getByRole("dialog");
    const nameInput = within(dialog).getByRole("textbox", { name: /^name/i });
    await userEvent.type(nameInput, "Test Source");

    const saveBtn = within(dialog).getByRole("button", { name: /add data source/i });
    await userEvent.click(saveBtn);

    await waitFor(() => expect(createDataSource).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Test Source", type: "postgres" }),
    ));
  });
});

// ─── Edit modal ───────────────────────────────────────────────────────────────

describe("DataSourcesPage — edit modal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listDataSources).mockResolvedValue([dsPostgres]);
  });

  it("opens edit modal with existing name pre-filled", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(screen.getByRole("button", { name: /edit production db/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: /^name/i })).toHaveValue("Production DB");
  });

  it("type selector pre-filled to existing type in edit mode", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(screen.getByRole("button", { name: /edit production db/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: /type/i })).toHaveValue("postgres");
  });

  it("credential fields are empty in edit mode (write-only)", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(screen.getByRole("button", { name: /edit production db/i }));
    const dialog = screen.getByRole("dialog");
    const passwordInput = within(dialog).getByLabelText("Password", { exact: true });
    expect(passwordInput).toHaveValue("");
  });

  it("Test connection button is enabled in edit mode", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(screen.getByRole("button", { name: /edit production db/i }));
    const dialog = screen.getByRole("dialog");
    const testBtn = within(dialog).getByRole("button", { name: /test connection/i });
    expect(testBtn).not.toBeDisabled();
  });

  it("shows inline success result after successful test", async () => {
    vi.mocked(testDataSource).mockResolvedValue({
      ok: true,
      testedAt: "2024-06-01T15:00:00.000Z",
    });
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(screen.getByRole("button", { name: /edit production db/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /test connection/i }));
    await waitFor(() =>
      expect(within(dialog).getByText(/connected/i)).toBeInTheDocument(),
    );
  });

  it("shows inline failure result after failed test", async () => {
    vi.mocked(testDataSource).mockResolvedValue({
      ok: false,
      error: "Connection refused",
      testedAt: "2024-06-01T15:00:00.000Z",
    });
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(screen.getByRole("button", { name: /edit production db/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /test connection/i }));
    await waitFor(() =>
      expect(within(dialog).getByText(/failed: connection refused/i)).toBeInTheDocument(),
    );
  });

  it("calls updateDataSource on save", async () => {
    vi.mocked(updateDataSource).mockResolvedValue({ ...dsPostgres, name: "Renamed DB" });
    // First call: initial load with original name; second: after invalidation returns renamed
    vi.mocked(listDataSources)
      .mockResolvedValueOnce([dsPostgres])
      .mockResolvedValue([{ ...dsPostgres, name: "Renamed DB" }]);

    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(screen.getByRole("button", { name: /edit production db/i }));
    const dialog = screen.getByRole("dialog");
    const nameInput = within(dialog).getByRole("textbox", { name: /^name/i });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Renamed DB");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(updateDataSource).toHaveBeenCalledWith(
        "ds-1",
        expect.objectContaining({ name: "Renamed DB" }),
      ),
    );
  });
});

// ─── Delete modal ─────────────────────────────────────────────────────────────

describe("DataSourcesPage — delete modal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listDataSources).mockResolvedValue([dsPostgres]);
  });

  it("opens delete confirm modal with data source name", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(screen.getByRole("button", { name: /delete production db/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/delete data source/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Production DB/)).toBeInTheDocument();
  });

  it("closes delete modal on Cancel", async () => {
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(screen.getByRole("button", { name: /delete production db/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("calls deleteDataSource when confirmed", async () => {
    vi.mocked(deleteDataSource).mockResolvedValue(undefined);
    // First call returns source; after deletion refetch returns empty
    vi.mocked(listDataSources)
      .mockResolvedValueOnce([dsPostgres])
      .mockResolvedValue([]);

    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(screen.getByRole("button", { name: /delete production db/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(deleteDataSource).toHaveBeenCalledWith("ds-1"));
  });
});

// ─── Re-test card action ──────────────────────────────────────────────────────

describe("DataSourcesPage — re-test action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listDataSources).mockResolvedValue([dsPostgres]);
  });

  it("calls testDataSource when Re-test clicked on card", async () => {
    vi.mocked(testDataSource).mockResolvedValue({ ok: true, testedAt: "2024-06-01T12:00:00.000Z" });
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(
      screen.getByRole("button", { name: /re-test connection for production db/i }),
    );
    await waitFor(() => expect(testDataSource).toHaveBeenCalledWith("ds-1"));
  });
});

// ─── Accessibility (axe) ──────────────────────────────────────────────────────

describe("DataSourcesPage — accessibility", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("list page passes axe with data sources", async () => {
    vi.mocked(listDataSources).mockResolvedValue([dsPostgres, dsMySQL]);
    const { container } = renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });

  it("empty state passes axe", async () => {
    vi.mocked(listDataSources).mockResolvedValue([]);
    const { container } = renderPage();
    await waitFor(() => screen.getByText(/no data sources configured/i));
    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });

  it("add modal passes axe when open", async () => {
    vi.mocked(listDataSources).mockResolvedValue([]);
    const { container } = renderPage();
    await waitFor(() => screen.getByRole("button", { name: /add data source/i }));
    await userEvent.click(screen.getAllByRole("button", { name: /add data source/i })[0]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });

  it("delete modal passes axe when open", async () => {
    vi.mocked(listDataSources).mockResolvedValue([dsPostgres]);
    const { container } = renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(screen.getByRole("button", { name: /delete production db/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });
});

// ─── Credential write-only invariants ────────────────────────────────────────

describe("DataSourcesPage — credentials never exposed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("card does not render any credential values", async () => {
    vi.mocked(listDataSources).mockResolvedValue([dsPostgres]);
    const { container } = renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    // Verify no input-type=password or text with credential data is rendered in card
    const passwordInputs = container.querySelectorAll('input[type="password"]');
    expect(passwordInputs).toHaveLength(0);
  });

  it("edit modal does not pre-fill password field", async () => {
    vi.mocked(listDataSources).mockResolvedValue([dsPostgres]);
    renderPage();
    await waitFor(() => screen.getByText("Production DB"));
    await userEvent.click(screen.getByRole("button", { name: /edit production db/i }));
    const dialog = screen.getByRole("dialog");
    const passwordInput = within(dialog).getByLabelText("Password", { exact: true });
    // Must be empty — credentials are write-only
    expect(passwordInput).toHaveValue("");
  });

  it("BigQuery edit modal does not pre-fill service account JSON", async () => {
    vi.mocked(listDataSources).mockResolvedValue([dsBigQuery]);
    renderPage();
    await waitFor(() => screen.getByText("BQ Warehouse"));
    await userEvent.click(screen.getByRole("button", { name: /edit bq warehouse/i }));
    const dialog = screen.getByRole("dialog");
    const credField = within(dialog).getByLabelText(/^service account json$/i);
    expect(credField).toHaveValue("");
  });

  it("REST edit modal does not pre-fill API key", async () => {
    vi.mocked(listDataSources).mockResolvedValue([dsRest]);
    renderPage();
    await waitFor(() => screen.getByText("External API"));
    await userEvent.click(screen.getByRole("button", { name: /edit external api/i }));
    const dialog = screen.getByRole("dialog");
    const apiKeyField = within(dialog).getByLabelText("API Key", { exact: true });
    expect(apiKeyField).toHaveValue("");
  });
});
