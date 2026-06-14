# System Design — BI Result Presenter

Multi-tenant SaaS. Non-technical and technical users ask BI questions in natural
language; a permission-aware LLM agent translates them to SQL/REST, enforces
schema/table/column access **before** execution, restricts the data-source
credential to the user's role (defense-in-depth), auto-selects a chart, and
streams the answer.

---

## 1. Component map

```
                        ┌───────────────────────────────────────────────┐
                        │                 Browser (SPA)                  │
                        │  React app: Chat Workspace, Admin, Charts      │
                        │  - SSE/stream client   - client-side result    │
                        │    cache (toggle/export)                       │
                        └───────────────┬───────────────────────────────┘
                                        │ HTTPS (JSON + SSE stream)
                                        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                            API service (Node/TS)                            │
│                                                                             │
│  Edge:   auth middleware → tenant-scope middleware → RBAC capability check  │
│                                                                             │
│  Modules (bounded contexts):                                                │
│   ┌──────────────┐  ┌───────────────┐  ┌───────────────────────────────┐   │
│   │ Auth/Identity │  │  RBAC/Admin   │  │      Ask pipeline (agent)     │   │
│   │ - login/SSO   │  │ - roles       │  │  1 build context (schema+scope)│   │
│   │ - invites     │  │ - permissions │  │  2 LLM provider → SQL/REST    │   │
│   │ - sessions    │  │   (s/t/c)     │  │  3 PERMISSION GATE (pre-exec) │   │
│   └──────────────┘  │ - user↔role   │  │  4 query validation/guard     │   │
│                     │ - data sources│  │  5 exec via restricted cred   │   │
│   ┌──────────────┐  └───────────────┘  │  6 stream text + result env   │   │
│   │ Conversations│                      │  7 chart-type selection       │   │
│   │ - history    │   ┌──────────────┐   └───────────────────────────────┘   │
│   └──────────────┘   │  Audit log   │            │            │             │
│                      └──────────────┘            │            │             │
│   ┌───────────────────────────────────┐         │            │             │
│   │  LLM Provider Abstraction (port)  │◀────────┘            │             │
│   │   default adapter: Gemini         │                      │             │
│   └───────────────────────────────────┘                      │             │
│   ┌───────────────────────────────────┐                      │             │
│   │  Data-Source Connector + Query    │◀─────────────────────┘             │
│   │  Proxy (cred vault + policy)      │                                    │
│   │   adapters: pg / mysql / bq / rest│                                    │
│   └───────────────────────────────────┘                                    │
└───────────────────────────────────────────────────────────────────────────┘
        │ control plane                         │ data plane (per-source restricted cred)
        ▼                                       ▼
┌──────────────────────────┐        ┌──────────────────────────────────────┐
│ Control-plane Postgres   │        │ Tenant data sources (external)       │
│ schema-per-tenant:       │        │ Postgres / MySQL / BigQuery / REST   │
│ users, roles, perms,     │        │ (owned/configured by tenant admin)   │
│ conversations, audit,    │        └──────────────────────────────────────┘
│ data-source registry,    │
│ encrypted cred vault     │
└──────────────────────────┘
```

**Responsibilities**

- **SPA** — chat UI, streaming render, chart auto-render + chart↔table toggle (client cache), admin screens, client-side export. Never the security boundary.
- **API service** — single deployable; all modules in-process for v1 (modular monolith). Holds the only trust boundary. Resolves tenant + role on every request.
- **Ask pipeline** — orchestrates the 7-step flow below. Owns the permission gate.
- **LLM Provider Abstraction** — port + adapters; Gemini is default. Swappable by config.
- **Data-Source Connector + Query Proxy** — dialect adapters; selects the role-restricted credential; executes; normalizes results.
- **Control-plane Postgres** — all tenant-scoped metadata, schema-per-tenant.

---

## 2. Ask-question pipeline (Action A, the critical path)

Maps requirements §5 Action A timing. Each numbered step is enforced server-side.

1. **Resolve identity** — auth middleware validates token → `{ userId, tenantId, roleId }`. Tenant-scope middleware sets the search_path / tenant context. Cross-tenant ids in the request body are ignored (NFR-MT-1).
2. **Build LLM context** — load permitted schema metadata for the role (only granted schema/table/column names + types), conversation history (windowed), data-source descriptors. **No row data, no actual values** are placed in the prompt (GAP-18, PII guard).
3. **Generate** — provider abstraction → SQL or REST request. Model returns a *structured* query proposal (query text + referenced tables/columns it intends to touch), parsed deterministically.
4. **PERMISSION GATE (FR-AC-5, NFR-SEC-2)** — parse the generated SQL/REST to extract every referenced schema.table.column. Diff against the role's grant set. **If any referenced resource is not granted → BLOCK the whole query** and return a structured block payload listing missing resources (GAP-12 block+explain). No execution, no partial subsetting.
5. **Query validation / injection guard (FR-LLM-2, NFR-SEC-3)** — verify syntactic validity against dialect; enforce allow-list (only SELECT / read REST verbs); reject multi-statement, DDL, DML; enforce a row LIMIT cap; parameterize literals where applicable.
6. **Execute via restricted credential (NFR-SEC-1, GAP-5)** — Query Proxy selects the credential bound to `(tenantId, roleId, dataSourceId)`. That credential is itself scoped at the data source to the role's grants (defense-in-depth: even a gate bug cannot exceed the credential's reach). Apply timeout.
7. **Stream + present** — stream the LLM natural-language text to the client (SSE). Wrap the result rows in the **result envelope** (see contracts). Run **chart-type selection** (server-side, per UI/UX §9 mapping) and include the chosen type in the envelope. Append to conversation history. Emit audit event.

**Follow-up (Action E)** re-runs the full pipeline incl. the gate (step 4) every time — references resolved against history in step 2, never trusting a prior authorization.

---

## 3. Permission gate + credential restriction (GAP-5, defense-in-depth)

Two independent layers must both pass:

| Layer | Where | Mechanism | Failure mode |
|-------|-------|-----------|--------------|
| **L1 — Permission gate** | API, pre-execution (step 4) | Parse generated query → resource set → diff vs role grants. Block+explain on any gap. | Blocks query; nothing runs. |
| **L2 — Restricted credential** | Data source, at execution (step 6) | Per-`(tenant,role,source)` credential whose data-source-level grants mirror the role's schema/table/column grants. Executed on **raw drivers, not Prisma.** | DB/API rejects the query even if L1 were bypassed. |

**Chosen credential model: per-(tenant,role) credential mapping + query proxy.**
- The control plane stores, per data source, a set of credentials keyed by role (or a credential template the proxy parameterizes). Credentials live **encrypted in the cred vault**; only the Query Proxy decrypts them at execution, in memory.
- For SQL sources this is realized as **least-privilege DB roles/users** provisioned per app-role (e.g. a Postgres role with `GRANT SELECT` only on the granted tables/columns). The Query Proxy connects as that role **using a raw driver (`pg`/`mysql2`/`@google-cloud/bigquery`)**.
- For REST sources, the restricted "credential" is an API token plus a proxy-enforced endpoint/field allow-list mirroring the grants.
- **Why this over alternatives:** per-user DB roles explode in count and lifecycle cost; session-scoped `SET ROLE` requires the base login to already hold superset privileges (weaker backstop); a pure policy proxy with one fat credential makes the proxy a single point of total compromise. Per-**role** credentials keep cardinality bounded (roles ≪ users) while preserving a real infra backstop. The proxy composes L1+L2 and is the only component that touches data-source credentials.
- **Prisma boundary (critical):** Prisma is used **only** for the control plane (tenants/roles/users/grants/conversations/audit). The Query Proxy **never** uses Prisma; if it did, it would execute on Prisma's pooled control-plane connection and bypass the restricted per-(tenant,role) credential entirely — defeating L2. Data-plane execution stays on raw, least-privilege connections. See tech-stack §"Prisma + the credential model".

> Row-level is out of scope, so L2 grants stop at column granularity — no row predicates are provisioned.

---

## 4. Tenant isolation model (GAP-6)

**Chosen: schema-per-tenant in a shared control-plane Postgres.**

- Each tenant gets a dedicated Postgres schema (`tenant_<id>`) holding its users, roles, permissions, conversations, audit, data-source registry, and cred-vault references. A small shared `public`/`platform` schema holds the tenant registry and global config.
- Tenant context is resolved from the authenticated token (not client-supplied) and applied as the connection `search_path` for the request. Cross-tenant access is impossible by construction: a request scoped to `tenant_A` cannot name `tenant_B`'s objects.
- **With Prisma (control plane):** the `search_path` is pinned **per request inside a Prisma interactive transaction** via `SET LOCAL search_path TO "tenant_<id>", platform`. `SET LOCAL` is transaction-scoped, so Postgres resets it at commit/rollback and the setting cannot leak to the next request that borrows the pooled connection. A single PrismaClient (one pool) is shared across tenants safely. (Tenant *data sources* are external and isolated independently — see §3.)
- **Why not shared+tenant-column:** with row-level permissions out of scope, the project deliberately has *no* row-predicate machinery. Shared tables would force re-introducing exactly that machinery (a tenant predicate on every query) just to stay safe — fragile and against the locked decision. Schema-per-tenant enforces isolation at the schema boundary with no per-row predicate.
- **Why not DB-per-tenant:** stronger isolation but heavier ops (migrations × N databases, connection-pool fan-out) than v1 needs. Schema-per-tenant is the middle ground; migrating a hot tenant to its own DB later is possible without app changes.
- **Tenant data sources are external** and inherently tenant-owned, so the data plane is isolated independently of this choice.

---

## 5. LLM provider abstraction (FR-LLM-6, GAP-18)

- A **port** `LlmProvider` defines the contract the Ask pipeline depends on (see patterns.md `provider-abstraction`). Adapters implement it: `GeminiProvider` (default), and the interface is shaped so OpenAI/Anthropic/etc. adapters drop in later.
- Selection is **config-driven** (`LLM_PROVIDER`, `LLM_MODEL`, key from env/secret store). No pipeline code changes to switch.
- **Data-residency / PII (GAP-18 residual):** the prompt context contains **only schema metadata** (object names + types) and conversation text — never queried row data or sample values. A redaction/guard step strips literal values before they could be echoed back into a follow-up prompt. Configurable per-tenant "do not send schema externally" flag is reserved (future), but v1 sends schema metadata only.

---

## 6. Deployment topology

- **Single API deployable** (modular monolith) + **static SPA** behind a CDN. Containerized; runs on any container host. One control-plane Postgres (managed). Secrets/cred-vault keys in a managed secret store (KMS-backed).
- Stateless API instances behind a load balancer; SSE streaming supported per-instance (sticky not required if streams are per-request). Horizontal scale by instance count.
- Data sources are external to the deployment; only the Query Proxy egresses to them.

---

## 7. Monitoring direction (summary; full doc: monitoring-direction.md)

Must be observable: **permission-gate decisions** (allow/block + missing-resource reason), **query latency** (p50/p95 end-to-end and data-source exec time), **LLM cost/tokens** (per request, per tenant), **error states** (gate block vs validation reject vs data-source error vs LLM error), **throughput / error rate**. Level: basic for v1, upgradeable. Tool family: OpenTelemetry traces/metrics + structured logs. The `monitor` agent defines exact queries/alerts/dashboards.

---

## 8. Resolved decisions (previously flagged — now confirmed)

All items below are **user-confirmed**; no longer pending sign-off.

| Gap | Confirmed decision for v1 |
|-----|---------------------------|
| **GAP-2** super-admin | **No** platform super-admin UI in v1. Tenants provisioned by an out-of-band ops script/seed. |
| **GAP-4** history retention | History **persisted durably**, **auto-purged after a 365-day default retention** (purge job runs on schedule), **plus manual per-user delete** at any time; per-tenant, per-user scoped. The 365-day default is configurable later but fixed for v1. |
| **GAP-8** perf/scale targets | Result cap **10,000 rows** per query; chart downgrade to table **>2,000 rows**; LLM token budget per request **~8k context**; target **p95 < 6s** end-to-end excluding slow data sources. |
| **GAP-9** persisted audit log | Audit events **are persisted** (control plane), powering Admin Audit Log (S8). Audit retention follows the GAP-4 365-day default. |
| **GAP-14** export size | Client-side export for results **≤ row cap**; if a future need exceeds it, server-streamed CSV. v1 **warns the user above 5,000 rows**. |
| **GAP-17** permission propagation | Changes take effect **on next token refresh** (short-lived access tokens, ~15 min) — effectively near-session. Not mid-request. |
| **GAP-20** dashboards/saved queries | **Out of scope** for v1. Design avoids blocking them later. |
| **GAP-1** default visibility | "View query" governed by per-role capability flag (locked); **default off**; seeded so Admin role has it on. |
| **single role per user** | One role per user in v1 (matches UI/UX S6). The grant model resolves the effective set from the user's single `roleId`; nothing assumes multi-role. |

---

## 9. Requirement → component traceability (high level)

- FR-AC-1..3, FR-AC-7 → RBAC/Admin module + control-plane schema.
- FR-AC-4..6, NFR-SEC-1..4 → Permission gate + Query Proxy + tenant middleware.
- FR-LLM-1..6, NFR-SEC-3 → Ask pipeline + provider abstraction + query guard.
- FR-VIZ-1..6 → chart-type selection (server) + SPA chart components + export.
- FR-UI-1..3 → SPA chat + Conversations module.
- NFR-SEC-5 → Auth/Identity module.
- NFR-AUD-1..2 → Audit module + Query Inspect.
- NFR-A11Y-1 → SPA (chart↔table fallback, ARIA).
