# Bootstrap Scaffold — Review Findings

Reviewer: basic-reviewer | Pass: initial | Iteration: 1
Files reviewed: 73 (2670 lines, lockfile excluded)
Reference: docs/kb/bootstrap-plan.md, docs/kb/common-pitfalls.md

---

## Pass 1 — Scope Findings

### CRIT / HIGH

None identified.

### MED

**SCOPE-M1** — `@axe-core/react` missing from `apps/web` devDependencies
- Location: `apps/web/package.json`
- The bootstrap-plan.md §1 explicitly lists `@axe-core/react` in the `apps/web` devDeps column. It is absent from the diff. The plan defines this as a scaffold-time dependency (axe smoke test is part of T1.4), not a feature-implementation dep. All other listed web devDeps are present.

**SCOPE-M2** — `test:e2e` turbo task missing `^build` or `build` dependency
- Location: `turbo.json:57`
- The bootstrap-plan.md §3 notes that `test:e2e` runs Playwright against `vite preview`, which requires a prior `vite build`. The turbo.json wires `"dependsOn": ["typecheck"]` for `test:e2e`, meaning turbo will not guarantee the `build` task has run before `test:e2e`. When `test:e2e` runs in isolation (`pnpm turbo run test:e2e`) without a prior build, `vite preview` will serve stale or missing dist output. The bootstrap-plan.md table omits this dependency for `test:e2e` but `playwright.config.ts` clearly requires the build. One of these must align.

### LOW

**SCOPE-L1** — `scripts/provision-tenant.ts` contains no export and no module declaration
- Location: `scripts/provision-tenant.ts:1-3`
- The file is a three-line comment-only placeholder. The bootstrap-plan.md §1 lists it as a deferred T8.1 item, which is correct. However, the file has no `export {}` or default export, making it a script file with no module body. TypeScript in strict ESM mode (`"type": "module"`) may warn or error when `tsconfig` sees it with `"moduleResolution": "NodeNext"`. Low risk for a deferred placeholder but worth a defensive `export {};` addition.

**SCOPE-L2** — `apps/api/package.json` missing `@types/supertest` split — test vs. unit config overlap
- Location: `apps/api/vitest.config.ts:4`, `apps/api/vitest.integration.config.ts`
- The unit config (`vitest.config.ts`) excludes `*.integration.test.ts` but `health.test.ts` also uses `supertest` (a real HTTP server call). Strictly speaking this is an integration test masquerading as a unit test. The bootstrap-plan.md test taxonomy defines unit = no external deps. This is a minor label inconsistency, not a functional gap.

---

## Pass 2 — Code Quality Findings

### CRIT / HIGH

None identified.

### MED

**QUAL-M1** — `playwright.config.ts` reporter ternary is dead code
- Location: `apps/web/playwright.config.ts:24`
- `reporter: process.env["CI"] ? "list" : "list"` — both branches return the same value. The intent was presumably `"html"` or `"list"` for the non-CI branch. This is harmless but makes the conditional meaningless and is likely a copy-paste error.

**QUAL-M2** — `vite.config.ts` proxy does not strip `/api` prefix
- Location: `apps/web/vite.config.ts:9-12`
- The proxy maps `/api` paths to `VITE_API_URL` without a `rewrite` rule to strip the `/api` prefix. If API routes are `/health`, `/auth/...`, etc. (not prefixed with `/api`), the proxy will forward `/api/health` → `http://localhost:3000/api/health`, which will 404. The dev proxy config needs either (a) a `rewrite: (path) => path.replace(/^\/api/, "")` rule, or (b) the API to mount all routes under `/api`. At scaffold stage with only `/health` no proxy call is made yet, but this is a correctness trap for all feature tasks.

**QUAL-M3** — `tsconfig.base.json` sets `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` as defaults, but web and contracts override with `"module": "ESNext"` / `"moduleResolution": "Bundler"`
- Location: `tsconfig.base.json:5-6`, `apps/web/tsconfig.json:4-5`, `packages/contracts/tsconfig.json:4-5`
- This is a documented coder decision (DevTeam.log entry at 02:01:00). The override pattern works correctly. The only risk is that future packages forget to override and silently get NodeNext resolution in a Vite/bundler context. Consider adding a comment in `tsconfig.base.json` noting the intended override pattern. Low impact but worth tracking.

### LOW

**QUAL-L1** — `logger.ts` mixes quoted and unquoted string styles in `REDACT_PATHS`
- Location: `apps/api/src/observability/logger.ts:40-43`
- Most entries use bare strings (`"password"`, `"*.token"`), but the authorization/cookie/set-cookie entries use single-quoted strings (`'req.headers.authorization'`). In JS/TS this is cosmetically inconsistent. Prettier should normalize it; if it does not, the .prettierrc uses `"singleQuote": false` which would normalize to double quotes — yet these escaped strings persist. Indicates the file may not have been Prettier-formatted.

**QUAL-L2** — `apps/api/src/health.test.ts` and `apps/api/src/health.integration.test.ts` both test the same `/health` endpoint with nearly identical assertions
- Location: `apps/api/src/health.test.ts`, `apps/api/src/health.integration.test.ts`
- The unit test (`health.test.ts`) uses Supertest directly against the Express app — this is indistinguishable from the integration test in `health.integration.test.ts`. The difference in label ("unit" vs "integration") is not reflected in technical isolation. Since the integration test is now the authoritative one and includes proper JSDoc explaining the no-DB rationale, the unit test file (`health.test.ts`) could be removed or replaced with a true unit test (e.g., testing route registration without Supertest). This is low-severity duplication.

**QUAL-L3** — `apps/api/Dockerfile` copies `dist` from `/build/apps/api/dist` but the runtime stage `WORKDIR` is `/app` with no package.json in scope
- Location: `apps/api/Dockerfile:44-46`
- The runtime stage copies `node_modules` from the deploy output and `dist` separately. The `pnpm deploy` output at `/prod/api` should include `package.json` (pnpm deploy writes it), but the runtime stage does not copy `/prod/api/package.json`. If `dist/index.js` references `process.env` startup-only behavior this is fine, but any runtime `require`/`import` resolution that falls back to package.json `"main"` or `"exports"` will fail silently. Recommend adding `COPY --from=builder /prod/api/package.json ./package.json` to the runtime stage.

**QUAL-L4** — `eslint.config.js` uses deprecated `context.getFilename()` API
- Location: `eslint.config.js:69`
- The custom `no-llm-sdk-outside-adapters` rule calls `context.getFilename()`. In ESLint v9 (flat config era), the recommended API is `context.filename` (a property, not a method). `getFilename()` still works in v9 for backward compatibility but is marked for deprecation. Should be changed to `context.filename` for forward compatibility.

---

## Summary

| Category | CRIT | HIGH | MED | LOW |
|----------|------|------|-----|-----|
| Scope    | 0    | 0    | 2   | 2   |
| Quality  | 0    | 0    | 3   | 4   |
| **Total**| **0**| **0**| **5**| **6**|

**Merge-blocking (CRIT/HIGH):** None. Scaffold is structurally sound.

**Should-fix this iteration (MED):**
- SCOPE-M1: Add `@axe-core/react` to `apps/web` devDependencies (plan compliance)
- SCOPE-M2: Align `turbo.json` `test:e2e` dependsOn with the build prerequisite reality
- QUAL-M1: Fix dead-code ternary in `playwright.config.ts` reporter
- QUAL-M2: Add proxy rewrite rule in `vite.config.ts` or document API route prefix convention
- QUAL-M3: Add comment to `tsconfig.base.json` about NodeNext override pattern

**Discretionary (LOW):**
- SCOPE-L1: Add `export {};` to `scripts/provision-tenant.ts`
- SCOPE-L2: Rename `health.test.ts` to reflect its actual integration nature
- QUAL-L1: Normalize quote style in `logger.ts` REDACT_PATHS
- QUAL-L2: Remove or differentiate `health.test.ts` from `health.integration.test.ts`
- QUAL-L3: Add `package.json` copy to API Dockerfile runtime stage
- QUAL-L4: Replace `context.getFilename()` with `context.filename` in `eslint.config.js`

## Re-review plan (iteration 1)
No CRIT/HIGH — loop exit condition already met. Dispatching one polish fix-pass for all MED+LOW (cheap, high-value traps). Re-review plan: [basic-reviewer @ Haiku] on the fix diff to confirm no regressions, then exit.
