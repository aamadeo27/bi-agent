import express, { type Express, Router } from "express";
import cookieParser from "cookie-parser";
import { logger } from "./observability/logger.js";
import { httpLogger } from "./observability/http-logger.js";
import { errorHandler } from "./observability/error-middleware.js";
import { initErrorSink } from "./observability/error-sink.js";
import { authMiddleware, initAuth } from "./middleware/auth.js";
import { tenantScopeMiddleware } from "./middleware/tenant-scope.js";
import { meRouter } from "./me/index.js";
import { authRouter } from "./auth/router.js";
import { adminUsersRouter } from "./admin/users-router.js";
import { rolesRouter, requireAdminCapability, schemaRouter, dataSourcesRouter } from "./admin/index.js";
import { conversationsRouter } from "./conversations/router.js";
import { messagesRouter } from "./messages/router.js";
import { startRetentionScheduler } from "./conversations/retention-scheduler.js";

// Initialize the dev-only error-tracking sink. No-ops gracefully when
// SENTRY_DSN is unset (the default in dev/bootstrap) — see error-sink.ts.
initErrorSink();

const app: Express = express();

// HTTP request logging: method/path/status/latency, no bodies/secrets (see http-logger.ts).
app.use(httpLogger);

app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  // TODO: add control-plane DB ping (Prisma) before v1 launch
  res.json({ status: "ok" });
});

// Public auth routes (no JWT required — login, refresh, logout).
app.use("/api/auth", authRouter);

// Protected API router — all routes mounted here require a valid JWT and
// a tenant-clean request body. Handlers obtain a scoped DB client via
// withTenant(req.auth.tenantId, async (tx) => { ... }).
const protectedRouter = Router();
protectedRouter.use(authMiddleware);
protectedRouter.use(tenantScopeMiddleware);

protectedRouter.use("/me", meRouter);
protectedRouter.use("/admin/users", adminUsersRouter);
protectedRouter.use("/admin/roles", requireAdminCapability, rolesRouter);
protectedRouter.use("/admin/schema", requireAdminCapability, schemaRouter);
protectedRouter.use("/admin/data-sources", requireAdminCapability, dataSourcesRouter);
protectedRouter.use("/conversations", conversationsRouter);
protectedRouter.use("/messages", messagesRouter);

app.use("/api", protectedRouter);

// Error-handling middleware MUST be registered last (after all routes).
app.use(errorHandler);

const port = Number(process.env["PORT"] ?? 3000);

if (process.env["NODE_ENV"] !== "test") {
  // Validate JWT_SECRET at startup — fail fast instead of 401-ing every request.
  initAuth();
  // Start daily retention purge — safe to run concurrently, unref'd timer.
  startRetentionScheduler();
  app.listen(port, () => {
    logger.info({ port }, "API listening");
  });
}

export { app };
