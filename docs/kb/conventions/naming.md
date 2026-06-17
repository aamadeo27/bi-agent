# Naming

- **Files:** kebab-case (`permission-gate.ts`, `chart-card.tsx`).
- **Types/interfaces/React components:** PascalCase (`ResultEnvelope`, `ChartCard`).
- **Functions/vars:** camelCase. **Constants:** UPPER_SNAKE for true consts.
- **DB tables/columns:** snake_case; tenant schemas `tenant_<ulid>`.
- **API routes:** kebab path segments, plural nouns (`/api/data-sources`).
- **Env vars:** UPPER_SNAKE (`LLM_PROVIDER`, `LLM_MODEL`, `DATABASE_URL`).
- **Test files:** `*.test.ts` (unit/integration), `*.spec.ts` (Playwright E2E).
