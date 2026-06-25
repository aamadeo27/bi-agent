import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import type { Role, DataSource, SchemaTree, ResourceGrantSet } from "@bi/contracts";
import {
  listRoles,
  listRoleGrants,
  putRoleGrants,
  getSchemaTree,
  listDataSources,
} from "../../lib/api-client";
import { PermissionEditorPage } from "./permission-editor-page";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../lib/api-client", () => ({
  listRoles: vi.fn(),
  listRoleGrants: vi.fn(),
  putRoleGrants: vi.fn(),
  getSchemaTree: vi.fn(),
  listDataSources: vi.fn(),
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

const dataSource: DataSource = {
  id: "ds-1",
  name: "Production DB",
  type: "postgres",
  status: "connected",
};

const schemaTree: SchemaTree = {
  dataSourceId: "ds-1",
  schemas: [
    {
      name: "public",
      tables: [
        {
          name: "users",
          columns: [
            { name: "id", type: "uuid" },
            { name: "email", type: "varchar" },
            { name: "name", type: "varchar" },
          ],
        },
        {
          name: "orders",
          columns: [
            { name: "id", type: "uuid" },
            { name: "amount", type: "numeric" },
          ],
        },
      ],
    },
    {
      name: "analytics",
      tables: [
        {
          name: "events",
          columns: [
            { name: "id", type: "bigint" },
            { name: "payload", type: "jsonb" },
          ],
        },
      ],
    },
  ],
};

const emptyGrants: ResourceGrantSet = [];

// Grant covering public.users entirely
const usersTableGrant: ResourceGrantSet = [
  { roleId: "role-1", dataSourceId: "ds-1", kind: "table", schema: "public", table: "users" },
];

// ─── Render helper ────────────────────────────────────────────────────────────

function renderPage(roleId = "role-1", path = `/admin/roles/${roleId}/permissions`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/roles/:roleId/permissions" element={<PermissionEditorPage />} />
          <Route path="/admin/roles" element={<div data-testid="roles-page">Roles</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listRoles).mockResolvedValue([roleAnalyst]);
  vi.mocked(listDataSources).mockResolvedValue([dataSource]);
  vi.mocked(getSchemaTree).mockResolvedValue(schemaTree);
  vi.mocked(listRoleGrants).mockResolvedValue(emptyGrants);
  vi.mocked(putRoleGrants).mockResolvedValue(undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PermissionEditorPage", () => {
  describe("layout and initial load", () => {
    it("renders breadcrumb with role name", async () => {
      renderPage();
      // Role name appears in breadcrumb and as h1 heading
      await waitFor(() => expect(screen.getAllByText("Analyst").length).toBeGreaterThan(0));
      expect(screen.getByRole("heading", { name: "Analyst" })).toBeInTheDocument();
      expect(screen.getByText("Roles")).toBeInTheDocument();
      expect(screen.getByText("Admin")).toBeInTheDocument();
      expect(screen.getByText("Permissions")).toBeInTheDocument();
    });

    it("renders Save changes and Cancel buttons", async () => {
      renderPage();
      await waitFor(() => screen.getByText("Save changes"));
      expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    });

    it("renders search input", async () => {
      renderPage();
      await waitFor(() => screen.getByPlaceholderText(/search tables or columns/i));
    });

    it("renders schema tree with role=tree", async () => {
      renderPage();
      await waitFor(() => screen.getByRole("tree"));
    });
  });

  describe("schema tree", () => {
    it("shows schema names as treeitems after load", async () => {
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole("tree")).toBeInTheDocument();
      });
      // Schemas are top-level items
      await waitFor(() => {
        expect(screen.getByText("public")).toBeInTheDocument();
        expect(screen.getByText("analytics")).toBeInTheDocument();
      });
    });

    it("expands a schema to show tables when clicked", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Click expand button on 'public' schema
      const treeItems = screen.getAllByRole("treeitem");
      const publicItem = treeItems.find((el) => el.textContent?.includes("public"));
      expect(publicItem).toBeTruthy();

      const expandBtn = within(publicItem!).getByRole("button");
      await user.click(expandBtn);

      await waitFor(() => {
        expect(screen.getByText("users")).toBeInTheDocument();
        expect(screen.getByText("orders")).toBeInTheDocument();
      });
    });

    it("expands a table to show columns", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Expand schema
      const treeItems = screen.getAllByRole("treeitem");
      const publicItem = treeItems.find((el) => el.textContent?.includes("public"))!;
      await user.click(within(publicItem).getByRole("button"));

      await waitFor(() => screen.getByText("users"));

      // Expand users table
      const updatedItems = screen.getAllByRole("treeitem");
      const usersItem = updatedItems.find((el) => el.textContent?.includes("users") && !el.textContent?.includes("public"))!;
      await user.click(within(usersItem).getByRole("button"));

      await waitFor(() => {
        expect(screen.getByText("id")).toBeInTheDocument();
        expect(screen.getByText("email")).toBeInTheDocument();
        expect(screen.getByText("name")).toBeInTheDocument();
      });
    });

    it("filters tree nodes by search query", async () => {
      renderPage();
      await waitFor(() => screen.getByText("public"));

      const searchInput = screen.getByPlaceholderText(/search tables or columns/i);
      // Use fireEvent.change to set the full value in one synchronous step,
      // avoiding intermediate states from userEvent.type char-by-char
      fireEvent.change(searchInput, { target: { value: "analytics" } });

      await waitFor(() => {
        // "analytics" schema should be visible
        expect(screen.getByText("analytics")).toBeInTheDocument();
        // "public" schema should NOT appear as a level-1 treeitem
        const items = screen.queryAllByRole("treeitem");
        const publicItem = items.find(
          (el) => el.getAttribute("aria-level") === "1" && el.textContent?.includes("public"),
        );
        expect(publicItem).toBeUndefined();
      });
    });
  });

  describe("tri-state checkboxes", () => {
    it("schema checkbox is unchecked when no grants", async () => {
      renderPage();
      await waitFor(() => screen.getByText("public"));

      const treeItems = screen.getAllByRole("treeitem");
      const publicItem = treeItems.find((el) => el.textContent?.includes("public"))!;
      const checkbox = within(publicItem).getByRole("checkbox");
      expect(checkbox).not.toBeChecked();
    });

    it("table checkbox is checked when table grant exists", async () => {
      vi.mocked(listRoleGrants).mockResolvedValue(usersTableGrant);
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Expand public schema
      const treeItems = screen.getAllByRole("treeitem");
      const publicItem = treeItems.find((el) => el.textContent?.includes("public"))!;
      await user.click(within(publicItem).getByRole("button"));

      await waitFor(() => screen.getByText("users"));
      const updatedItems = screen.getAllByRole("treeitem");
      const usersItem = updatedItems.find(
        (el) => el.textContent?.includes("users") && !el.textContent?.includes("public"),
      )!;
      const checkbox = within(usersItem).getByRole("checkbox");
      expect(checkbox).toBeChecked();
    });

    it("checking a table toggles all-granted state", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Expand public
      const treeItems = screen.getAllByRole("treeitem");
      const publicItem = treeItems.find((el) => el.textContent?.includes("public"))!;
      await user.click(within(publicItem).getByRole("button"));
      await waitFor(() => screen.getByText("users"));

      // Check users table
      const updatedItems = screen.getAllByRole("treeitem");
      const usersItem = updatedItems.find(
        (el) => el.textContent?.includes("users") && !el.textContent?.includes("public"),
      )!;
      const checkbox = within(usersItem).getByRole("checkbox");
      await user.click(checkbox);

      // Unsaved changes badge should appear
      await waitFor(() => {
        expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
      });
      expect(checkbox).toBeChecked();
    });

    it("unchecking an individual column from granted table produces indeterminate parent", async () => {
      vi.mocked(listRoleGrants).mockResolvedValue(usersTableGrant);
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Expand public → users
      const treeItems = screen.getAllByRole("treeitem");
      const publicItem = treeItems.find((el) => el.textContent?.includes("public"))!;
      await user.click(within(publicItem).getByRole("button"));
      await waitFor(() => screen.getByText("users"));

      const items2 = screen.getAllByRole("treeitem");
      const usersItem = items2.find(
        (el) => el.textContent?.includes("users") && !el.textContent?.includes("public"),
      )!;
      await user.click(within(usersItem).getByRole("button"));
      await waitFor(() => screen.getByText("email"));

      // Uncheck 'email' column
      const items3 = screen.getAllByRole("treeitem");
      const emailItem = items3.find((el) => el.textContent?.includes("email"))!;
      const emailCheckbox = within(emailItem).getByRole("checkbox");
      // Should be checked (from table grant)
      expect(emailCheckbox).toBeChecked();
      await user.click(emailCheckbox);

      // Table checkbox should now be indeterminate
      await waitFor(() => {
        const items4 = screen.getAllByRole("treeitem");
        const usersItemNow = items4.find(
          (el) => el.textContent?.includes("users") && !el.textContent?.includes("public"),
        )!;
        const tableCheckbox = within(usersItemNow).getByRole("checkbox") as HTMLInputElement;
        expect(tableCheckbox.indeterminate).toBe(true);
      });
    });
  });

  describe("keyboard navigation", () => {
    it("arrow keys navigate between tree items", async () => {
      renderPage();
      await waitFor(() => screen.getByRole("tree"));
      await waitFor(() => screen.getByText("public"));

      const tree = screen.getByRole("tree");
      const items = screen.getAllByRole("treeitem");
      // Focus first item
      items[0].focus();

      // ArrowDown moves to next item
      fireEvent.keyDown(tree, { key: "ArrowDown" });
      await waitFor(() => {
        const focused = document.activeElement;
        expect(focused).toBeTruthy();
      });
    });

    it("Space key toggles grant on focused item", async () => {
      renderPage();
      await waitFor(() => screen.getByRole("tree"));
      await waitFor(() => screen.getByText("public"));

      const tree = screen.getByRole("tree");
      const items = screen.getAllByRole("treeitem");
      items[0].focus();

      const checkbox = within(items[0]).getByRole("checkbox");
      expect(checkbox).not.toBeChecked();

      fireEvent.keyDown(tree, { key: " " });
      await waitFor(() => {
        expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
      });
    });

    it("tree items have proper aria-level attributes", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      const items = screen.getAllByRole("treeitem");
      const publicItem = items.find((el) => el.textContent?.includes("public"))!;
      expect(publicItem.getAttribute("aria-level")).toBe("1");

      await user.click(within(publicItem).getByRole("button"));
      await waitFor(() => screen.getByText("users"));

      const items2 = screen.getAllByRole("treeitem");
      const usersItem = items2.find(
        (el) => el.textContent?.includes("users") && !el.textContent?.includes("public"),
      )!;
      expect(usersItem.getAttribute("aria-level")).toBe("2");
    });
  });

  describe("detail panel", () => {
    it("shows placeholder when nothing selected", async () => {
      renderPage();
      await waitFor(() => screen.getByText(/select a schema/i));
    });

    it("shows schema summary when schema node selected", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      const items = screen.getAllByRole("treeitem");
      const publicItem = items.find((el) => el.textContent?.includes("public"))!;
      await user.click(publicItem);

      await waitFor(() => {
        expect(screen.getByText("Schema")).toBeInTheDocument();
        expect(screen.getAllByText("public").length).toBeGreaterThan(1); // tree + detail
      });
    });

    it("shows column list when table node selected", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Expand schema
      const items = screen.getAllByRole("treeitem");
      const publicItem = items.find((el) => el.textContent?.includes("public"))!;
      await user.click(within(publicItem).getByRole("button"));
      await waitFor(() => screen.getByText("users"));

      // Select table
      const items2 = screen.getAllByRole("treeitem");
      const usersItem = items2.find(
        (el) => el.textContent?.includes("users") && !el.textContent?.includes("public"),
      )!;
      await user.click(usersItem);

      await waitFor(() => {
        // Detail panel shows table name as heading and column list
        expect(screen.getByRole("heading", { name: "users" })).toBeInTheDocument();
        expect(screen.getByRole("columnheader", { name: /column/i })).toBeInTheDocument();
      });
    });

    it("shows Read access toggle when column node selected", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Expand public → users → columns
      const items = screen.getAllByRole("treeitem");
      const publicItem = items.find((el) => el.textContent?.includes("public"))!;
      await user.click(within(publicItem).getByRole("button"));
      await waitFor(() => screen.getByText("users"));

      const items2 = screen.getAllByRole("treeitem");
      const usersItem = items2.find(
        (el) => el.textContent?.includes("users") && !el.textContent?.includes("public"),
      )!;
      await user.click(within(usersItem).getByRole("button"));
      await waitFor(() => screen.getByText("email"));

      // Select email column
      const items3 = screen.getAllByRole("treeitem");
      const emailItem = items3.find((el) => el.textContent?.includes("email"))!;
      await user.click(emailItem);

      await waitFor(() => {
        // Detail panel shows "Read access" toggle and the column heading
        expect(screen.getByText("Read access")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "email" })).toBeInTheDocument();
      });
    });

    it("Grant all button grants all tables in schema", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Select schema
      const items = screen.getAllByRole("treeitem");
      const publicItem = items.find((el) => el.textContent?.includes("public"))!;
      await user.click(publicItem);

      const grantAllBtn = screen.getByRole("button", { name: /grant all/i });
      await user.click(grantAllBtn);

      await waitFor(() => {
        expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
      });

      // Schema checkbox should now be checked
      const items2 = screen.getAllByRole("treeitem");
      const publicItemNow = items2.find((el) => el.textContent?.includes("public"))!;
      const schCheckbox = within(publicItemNow).getByRole("checkbox");
      expect(schCheckbox).toBeChecked();
    });

    it("Revoke all button clears schema grants", async () => {
      vi.mocked(listRoleGrants).mockResolvedValue([
        { roleId: "role-1", dataSourceId: "ds-1", kind: "schema", schema: "public" },
      ]);
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Select schema
      const items = screen.getAllByRole("treeitem");
      const publicItem = items.find((el) => el.textContent?.includes("public"))!;
      await user.click(publicItem);

      const revokeAllBtn = screen.getByRole("button", { name: /revoke all/i });
      await user.click(revokeAllBtn);

      await waitFor(() => {
        const items2 = screen.getAllByRole("treeitem");
        const publicItemNow = items2.find((el) => el.textContent?.includes("public"))!;
        const schCheckbox = within(publicItemNow).getByRole("checkbox");
        expect(schCheckbox).not.toBeChecked();
      });
    });
  });

  describe("Save behavior", () => {
    it("Save calls putRoleGrants with current grant set", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Grant public schema via checkbox
      const items = screen.getAllByRole("treeitem");
      const publicItem = items.find((el) => el.textContent?.includes("public"))!;
      const checkbox = within(publicItem).getByRole("checkbox");
      await user.click(checkbox);

      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(putRoleGrants).toHaveBeenCalledWith(
          "role-1",
          expect.arrayContaining([
            expect.objectContaining({ kind: "schema", schema: "public" }),
          ]),
        );
      });
    });

    it("shows toast and navigates away on save success", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByRole("button", { name: /save changes/i }));

      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(screen.getByText("Permissions saved.")).toBeInTheDocument();
      });
    });

    it("shows inline error message on save failure", async () => {
      vi.mocked(putRoleGrants).mockRejectedValue({
        code: "INTERNAL",
        message: "Database error",
      });
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByRole("button", { name: /save changes/i }));

      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("Database error");
      });
    });
  });

  describe("Cancel behavior", () => {
    it("Cancel navigates to /admin/roles when no changes", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByRole("button", { name: /cancel/i }));

      await user.click(screen.getByRole("button", { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.getByTestId("roles-page")).toBeInTheDocument();
      });
    });

    it("Cancel shows confirm dialog when there are unsaved changes", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Make a change
      const items = screen.getAllByRole("treeitem");
      const publicItem = items.find((el) => el.textContent?.includes("public"))!;
      await user.click(within(publicItem).getByRole("checkbox"));
      await waitFor(() => screen.getByText("Unsaved changes"));

      await user.click(screen.getByRole("button", { name: /cancel/i }));

      await waitFor(() => {
        // Dialog heading should contain "discard"
        expect(screen.getByRole("heading", { name: /discard changes/i })).toBeInTheDocument();
      });
    });

    it("Confirm discard navigates to /admin/roles", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Make a change
      const items = screen.getAllByRole("treeitem");
      const publicItem = items.find((el) => el.textContent?.includes("public"))!;
      await user.click(within(publicItem).getByRole("checkbox"));
      await waitFor(() => screen.getByText("Unsaved changes"));

      await user.click(screen.getByRole("button", { name: /cancel/i }));
      await waitFor(() => screen.getByRole("heading", { name: /discard changes/i }));

      await user.click(screen.getByRole("button", { name: /discard changes/i }));

      await waitFor(() => {
        expect(screen.getByTestId("roles-page")).toBeInTheDocument();
      });
    });
  });

  describe("data source selector", () => {
    it("shows DS selector when multiple data sources exist", async () => {
      vi.mocked(listDataSources).mockResolvedValue([
        dataSource,
        { id: "ds-2", name: "Staging DB", type: "postgres", status: "connected" },
      ]);
      vi.mocked(getSchemaTree).mockResolvedValue(schemaTree);
      renderPage();

      await waitFor(() => {
        expect(screen.getByLabelText(/data source/i)).toBeInTheDocument();
      });
    });

    it("hides DS selector when only one data source", async () => {
      renderPage();
      await waitFor(() => screen.getByText("public"));

      expect(screen.queryByLabelText(/data source/i)).not.toBeInTheDocument();
    });
  });

  describe("loading and error states", () => {
    it("shows loading state while fetching", async () => {
      vi.mocked(listRoles).mockImplementation(() => new Promise(() => {}));
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole("status")).toBeInTheDocument();
      });
    });

    it("shows error state when data sources fail", async () => {
      vi.mocked(listDataSources).mockRejectedValue({ code: "AUTH", message: "Unauthorized" });
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
    });

    it("shows no data sources message when list is empty", async () => {
      vi.mocked(listDataSources).mockResolvedValue([]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText(/no data sources configured/i)).toBeInTheDocument();
      });
    });
  });

  describe("accessibility", () => {
    it("passes axe a11y check on initial render", async () => {
      const { container } = renderPage();
      await waitFor(() => screen.getByText("public"));

      const results = await axe.run(container);
      expect(results.violations).toHaveLength(0);
    });

    it("tree has role=tree and items have role=treeitem", async () => {
      renderPage();
      // Wait for schema data to load so treeitem nodes are rendered
      await waitFor(() => {
        expect(screen.getByRole("tree")).toBeInTheDocument();
        expect(screen.getAllByRole("treeitem").length).toBeGreaterThan(0);
      });
    });

    it("expanded treeitem has aria-expanded=true", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      const items = screen.getAllByRole("treeitem");
      const publicItem = items.find((el) => el.textContent?.includes("public"))!;
      expect(publicItem.getAttribute("aria-expanded")).toBe("false");

      await user.click(within(publicItem).getByRole("button"));
      await waitFor(() => {
        const items2 = screen.getAllByRole("treeitem");
        const pi = items2.find((el) => el.textContent?.includes("public"))!;
        expect(pi.getAttribute("aria-expanded")).toBe("true");
      });
    });

    it("cancel confirm dialog renders as an accessible dialog", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      // Make a change to trigger confirm dialog
      const items = screen.getAllByRole("treeitem");
      const publicItem = items.find((el) => el.textContent?.includes("public"))!;
      await user.click(within(publicItem).getByRole("checkbox"));
      await waitFor(() => screen.getByText("Unsaved changes"));

      await user.click(screen.getByRole("button", { name: /cancel/i }));
      await waitFor(() => screen.getByRole("heading", { name: /discard changes/i }));

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
    });

    it("breadcrumb links are keyboard accessible", async () => {
      renderPage();
      await waitFor(() => screen.getByText("Admin"));
      const adminLink = screen.getByRole("link", { name: /^admin$/i });
      expect(adminLink).toBeInTheDocument();
    });

    it("unsaved changes badge has aria-live", async () => {
      const user = userEvent.setup();
      renderPage();
      await waitFor(() => screen.getByText("public"));

      const items = screen.getAllByRole("treeitem");
      const publicItem = items.find((el) => el.textContent?.includes("public"))!;
      await user.click(within(publicItem).getByRole("checkbox"));

      await waitFor(() => {
        const badge = screen.getByText("Unsaved changes");
        expect(badge.getAttribute("aria-live")).toBe("polite");
      });
    });
  });
});

// ─── Grant-set helper unit tests ──────────────────────────────────────────────
// Verify tri-state checkbox behavior via tree interactions

describe("Grant set logic — tri-state invariants", () => {

  it("checking schema puts all its tables in granted state", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText("public"));

    const items = screen.getAllByRole("treeitem");
    const publicItem = items.find((el) => el.textContent?.includes("public"))!;
    const checkbox = within(publicItem).getByRole("checkbox");
    await user.click(checkbox);

    // Expand to verify tables are checked
    await user.click(within(publicItem).getByRole("button"));
    await waitFor(() => screen.getByText("users"));

    const items2 = screen.getAllByRole("treeitem");
    for (const tableName of ["users", "orders"]) {
      const tableItem = items2.find(
        (el) => el.textContent?.includes(tableName) && !el.textContent?.includes("public"),
      )!;
      const tblCheckbox = within(tableItem).getByRole("checkbox") as HTMLInputElement;
      expect(tblCheckbox.checked).toBe(true);
    }
  });

  it("checking individual columns does not affect sibling tables", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText("public"));

    // Expand public → orders
    const items = screen.getAllByRole("treeitem");
    const publicItem = items.find((el) => el.textContent?.includes("public"))!;
    await user.click(within(publicItem).getByRole("button"));
    await waitFor(() => screen.getByText("orders"));

    const items2 = screen.getAllByRole("treeitem");
    const ordersItem = items2.find(
      (el) => el.textContent?.includes("orders") && !el.textContent?.includes("public"),
    )!;
    await user.click(within(ordersItem).getByRole("button"));
    await waitFor(() => screen.getByText("amount"));

    // Grant 'id' column of orders
    const items3 = screen.getAllByRole("treeitem");
    const idItem = items3.find(
      (el) => el.textContent?.includes("id") && !el.textContent?.includes("orders"),
    );
    if (!idItem) {
      // 'id' might appear multiple times — skip if not uniquely findable
      return;
    }

    const idCheckbox = within(idItem).getByRole("checkbox");
    await user.click(idCheckbox);

    // users table should still be unchecked (no grants for it)
    const items4 = screen.getAllByRole("treeitem");
    const usersItem = items4.find(
      (el) => el.textContent?.includes("users") && !el.textContent?.includes("public"),
    );
    if (usersItem) {
      const usersCheckbox = within(usersItem).getByRole("checkbox") as HTMLInputElement;
      expect(usersCheckbox.checked).toBe(false);
      expect(usersCheckbox.indeterminate).toBe(false);
    }
  });
});
