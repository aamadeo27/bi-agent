import { NavLink } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/admin/roles", label: "Roles" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/data-sources", label: "Data Sources" },
  { to: "/admin/audit", label: "Audit Log" },
] as const;

export function AdminSidebar() {
  return (
    <nav
      aria-label="Admin navigation"
      className="flex h-full w-40 flex-shrink-0 flex-col bg-primary-900 px-2 py-4"
    >
      <p className="mb-4 px-3 text-label font-bold uppercase tracking-wider text-neutral-500">
        Admin
      </p>

      <ul role="list" className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ to, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                "block rounded-md px-3 py-2 text-body font-medium transition-colors " +
                (isActive
                  ? "bg-primary-700 text-white"
                  : "text-neutral-300 hover:bg-primary-800 hover:text-white")
              }
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-4 border-t border-primary-800">
        <NavLink
          to="/chat"
          className="block rounded-md px-3 py-2 text-body text-neutral-400 transition-colors hover:bg-primary-800 hover:text-white"
        >
          ← Back to chat
        </NavLink>
      </div>
    </nav>
  );
}
