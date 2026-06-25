import { Navigate, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getMe } from "../../lib/api-client";
import { AdminSidebar } from "./admin-sidebar";

/**
 * Wraps all /admin/* routes. Performs a client-side admin guard:
 * if the resolved user has capabilities.isAdmin = false, redirect to /chat.
 * The server also enforces this on every /api/admin/* request.
 */
export function AdminLayout() {
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // After load: gate non-admins
  if (meQuery.isSuccess && !meQuery.data.capabilities.isAdmin) {
    return <Navigate to="/chat" replace />;
  }

  // Auth error: redirect to login
  if (
    meQuery.isError &&
    meQuery.error &&
    typeof meQuery.error === "object" &&
    "code" in meQuery.error &&
    (meQuery.error as { code: string }).code === "AUTH"
  ) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <AdminSidebar />
      <main id="admin-main" className="flex-1 overflow-auto p-6">
        {meQuery.isPending ? (
          <p className="text-body text-neutral-500" aria-live="polite" role="status">
            Loading…
          </p>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
