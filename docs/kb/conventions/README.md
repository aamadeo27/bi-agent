# Conventions — index

- [testing.md](testing.md) — testing approach, tools, what every Task must test.
- [branching.md](branching.md) — branch naming, PR flow, commit convention + Task footer, required checks.
- [secrets.md](secrets.md) — secrets store per env, required secrets list, local dev story, rotation, hard rules.
- This file — naming, folder layout, code style, commits.

## Repo layout (pnpm workspaces + Turborepo)

```
js/bi-agent/
├── apps/
│   ├── api/          # Express API service (modular monolith)
│   │   └── src/
│   │       ├── auth/        identity, sessions, sso, invites
│   │       ├── rbac/        roles, grants, users, capability flags
│   │       ├── admin/       admin route handlers
│   │       ├── ask/         ask pipeline (gate, validation, orchestration)
│   │       ├── llm/         port + adapters/  (gemini)  + factory
│   │       ├── datasource/  connectors (pg/mysql/bq/rest) + query proxy + vault
│   │       ├── conversations/  history + retention purge job
│   │       ├── audit/       audit log
│   │       ├── tenant/      tenant-scope middleware, search_path (SET LOCAL)
│   │       └── db/          prisma schema + migrations (control plane only)
│   └── web/          # React + Vite SPA
│       └── src/
│           ├── features/    chat/, admin-roles/, admin-perms/, admin-users/,
│           │                admin-datasources/, admin-audit/, auth/, account/
│           ├── components/   shared UI (ChartCard, MessageBubble, ...)
│           ├── charts/       Recharts wrappers + a11y
│           └── lib/          api client, sse client, result cache
└── packages/
    └── contracts/    # Zod schemas + inferred types (the FE/BE seam)
```

## Naming

- **Files:** kebab-case (`permission-gate.ts`, `chart-card.tsx`).
- **Types/interfaces/React components:** PascalCase (`ResultEnvelope`, `ChartCard`).
- **Functions/vars:** camelCase. **Constants:** UPPER_SNAKE for true consts.
- **DB tables/columns:** snake_case; tenant schemas `tenant_<ulid>`.
- **API routes:** kebab path segments, plural nouns (`/api/data-sources`).
- **Env vars:** UPPER_SNAKE (`LLM_PROVIDER`, `LLM_MODEL`, `DATABASE_URL`).
- **Test files:** `*.test.ts` (unit/integration), `*.spec.ts` (Playwright E2E).

## Code style

- ESLint + Prettier; TypeScript `strict: true`; no `any` (use `unknown` + Zod).
- Validate all external input with the `packages/contracts` Zod schemas at the edge.
- Pure security-critical functions (gate, validator) live in their own modules with
  no I/O so they are trivially unit-testable.
- No provider SDK import outside `apps/api/src/llm/adapters/*` (lint rule).
- No data-source credential ever logged or returned in an API response.

## Errors & logging

- Throw typed errors mapped to the `error-codes` union (contracts.md).
- Structured logs (pino): include `tenantId`, `userId`, `requestId`; **never**
  log credentials, tokens, or queried row data.

## Commits / branches

- Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`).
- One Task → one branch → one PR; PR references the Task id (e.g. `T2.1`).
- Full branching/PR/commit-footer convention: [branching.md](branching.md).
- Secrets management, required secrets list, rotation guidance: [secrets.md](secrets.md).
