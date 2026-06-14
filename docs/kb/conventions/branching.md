# Branching & PR Pattern

> This convention is consumed by the DevTeam task-feature and epic-execution
> workflows. Keep it in sync with `.devteam/cicd.json` once that file exists.

---

## Integration branch

`main` — the single integration branch. All feature / fix / chore branches are
cut from `main` and merged back to `main` via PR.

---

## Branch naming

```
<type>/<task-id>-<short-slug>
```

The `<task-id>` is the globally-unique Task stem `T<epic>.<task>` (e.g. `T1.5`), which
already encodes the epic — so no separate epic segment is needed.

| Type prefix | When to use |
|-------------|-------------|
| `feat/` | New feature work (a Task from an epic) |
| `fix/` | Bug fix |
| `chore/` | Tooling, CI, config, dependency update |
| `test/` | Adding or fixing tests only |
| `docs/` | Documentation only |
| `security/` | Security-critical fix (gets expedited review) |

Examples:
```
feat/T1.5-ci-pipeline
fix/T3.2-rbac-grant-query
chore/T1.1-monorepo-scaffold
security/T4.3-query-proxy-cred-scope
```

Rules:
- Branch names are lowercase kebab-case.
- The `<task-id>` portion must match a real Task file `docs/epics/**/<task-id>.md`.
- Never commit directly to `main`; all changes go through a PR.

---

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/) format, extended with
a **Task footer** required by the DevTeam process.

```
<type>(<scope>): <short description>

[optional body — the "why", not the "what"]

Task: <task-id>
```

> `<task-id>` is the Task's globally-unique stem `T<epic>.<task>` (e.g. `T5.3`) — no
> epic prefix, no slash. The commit-msg hook enforces this exact shape, and the
> post-merge hook resolves `docs/epics/**/<task-id>.md` from it.

**Types:** `feat`, `fix`, `chore`, `test`, `docs`, `refactor`, `perf`, `security`.

**Scope** (optional but recommended): the module or workspace package, e.g.
`ask`, `rbac`, `tenant`, `web`, `contracts`, `ci`.

**Task footer** — required on every commit that closes or progresses a Task:
```
Task: T1.5
```

Examples:
```
feat(ask): implement permission gate with block+explain payload

Gate parses generated SQL AST and diffs referenced resources against the
role's grant set. Any gap blocks the whole query and returns a structured
block payload (FR-AC-5, NFR-SEC-2).

Task: T5.3
```

```
chore(ci): add GitHub Actions CI workflow with Turborepo cache

Task: T1.5
```

```
fix(tenant): use SET LOCAL for search_path to prevent pool leakage

Task: T2.3
```

---

## PR flow

1. Cut branch from `main`.
2. Push; open a PR targeting `main` as soon as the first commit is pushed
   (draft is fine while in progress).
3. PR title format:
   ```
   <type>(<scope>): <short description> [<task-id>]
   ```
   Example: `feat(ask): permission gate with block+explain [T5.3]`
4. PR description must include:
   - **Task link** — reference to `docs/epics/<epic-slug>/<task-id>.md`.
   - **What changed** — brief bullets.
   - **Why / acceptance criteria met** — map to the Task's acceptance criteria.
   - **Testing** — what was run (unit / integration / manual).
   - **Checklist** (see below).
5. All required CI checks must be green (see devops.md §2.5).
6. At least **1 approving review** required before merge.
7. Merge strategy: **squash merge** to `main`. The squash commit message uses the
   PR title + Task footer.
8. Delete the branch after merge.

### PR checklist (add to PR description)

```markdown
- [ ] Acceptance criteria from Task doc are met
- [ ] Unit + integration tests added / updated
- [ ] Security-critical modules (gate, validator, proxy, tenant middleware) have
      adversarial tests if changed
- [ ] No secrets committed (no `.env` values, keys, or credentials in diff)
- [ ] Migration is additive only (or expand-contract pattern documented)
- [ ] Per-tenant schema migration loops all `tenant_*` schemas if DDL changed
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass locally
- [ ] `Task: <task-id>` footer (e.g. `Task: T5.3`) on all commits
```

---

## Required checks (branch protection)

All must pass before merge is allowed:

- `CI / lint`
- `CI / typecheck`
- `CI / unit`
- `CI / integration`
- `CI / build`
- `CI / security-tests`

E2E (`CI / e2e`) runs post-merge on staging and gates the prod deploy, not the PR
merge.

---

## One Task → one branch → one PR

The DevTeam process assigns exactly one Task per branch. If a fix spans multiple
Tasks, open separate PRs. If a Task is too large to ship in one PR, split it with
the tech lead before starting.
