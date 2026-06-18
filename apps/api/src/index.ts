import express, { type Express, Router } from "express";
import { logger } from "./observability/logger.js";
import { httpLogger } from "./observability/http-logger.js";
import { errorHandler } from "./observability/error-middleware.js";
import { initErrorSink } from "./observability/error-sink.js";
import { authMiddleware } from "./middleware/auth.js";
import { tenantScopeMiddleware } from "./middleware/tenant-scope.js";

// Initialize the dev-only error-tracking sink. No-ops gracefully when
// SENTRY_DSN is unset (the default in dev/bootstrap) — see error-sink.ts.
initErrorSink();

const app: Express = express();

// HTTP request logging: method/path/status/latency, no bodies/secrets (see http-logger.ts).
app.use(httpLogger);

app.use(express.json());

app.get("/health", (_req, res) => {
  // TODO: add control-plane DB ping (Prisma) before v1 launch
  res.json({ status: "ok" });
});

// Protected API router — all routes mounted here require a valid JWT and
// a tenant-clean request body. Handlers obtain a scoped DB client via
// withTenant(req.auth.tenantId, async (tx) => { ... }).
const protectedRouter = Router();
protectedRouter.use(authMiddleware);
protectedRouter.use(tenantScopeMiddleware);

// TODO: mount route modules here as they are implemented, e.g.:
//   protectedRouter.use("/me", meRouter);
//   protectedRouter.use("/conversations", conversationsRouter);

app.use("/api", protectedRouter);

// Error-handling middleware MUST be registered last (after all routes).
app.use(errorHandler);

const port = Number(process.env["PORT"] ?? 3000);

if (process.env["NODE_ENV"] !== "test") {
  app.listen(port, () => {
    logger.info({ port }, "API listening");
  });
}

export { app };
