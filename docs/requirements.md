# Requirements: BI Result Presenter Webapp

> Status: Draft v1 (greenfield) — for review.
> Owner: Requirement Engineer (`gf_requirement-engineer`).
> Source seed: `bi_result_presenter_requirements.md`.
> This document is **implementation-agnostic**. No technology stack is decided here; stack selection is deferred to the Architect.

---

## 1. Goal

The BI Result Presenter is a multi-tenant SaaS webapp that lets non-technical and technical users ask business-intelligence questions in natural language and receive answers as live, interactive visualizations inside a conversational chat. A permission-aware LLM agent translates each question into a structured query (SQL or REST) against the tenant's data sources, enforces fine-grained access control **before** any query runs, automatically picks the most appropriate chart type for the returned data, and streams the response back in real time. The product serves external customers (self-service analytics), internal business analysts (deeper exploration), and data/admin teams (who manage roles and permissions), with security and tenant data isolation as first-class, non-negotiable properties.

### Success criteria

- A user can go from a plain-language question to a correct, rendered chart/table without writing SQL.
- No user can ever retrieve data outside the bounds of their role — enforced both in the permission layer and at the data-source credential layer (defense in depth).
- The system reliably auto-selects a sensible chart type for common data shapes, and the user can toggle to a table when preferred.
- Tenants are isolated; one tenant's users, roles, data, and conversations are never visible to another.
- LLM responses stream with low perceived latency; the generated query is inspectable for audit.
- Admins can fully manage custom roles and **schema/table/column-level** permissions through a UI. *(Row-level permissions are out of scope for v1 — user decision, see §7 Resolved.)*

---

## 2. User Roles / Personas

| Role | Description | Core needs |
|------|-------------|------------|
| **External Customer (tenant end-user)** | A customer of a tenant org using the product as SaaS. Typically non-technical. | Ask NL questions; get charts/tables inline in chat; toggle chart/table; export results; follow-up questions with history. Only ever sees data their role permits, within their tenant. |
| **Internal Business Analyst** | Analyst (could be tenant-side or platform-side, see GAP-1) doing deeper investigation. | Everything the customer can do, plus: inspect generated SQL/REST query for trust/debugging; richer exploration via follow-ups. |
| **Data / Admin team** | Manages access control. | Create/modify/delete custom roles; assign data-access permissions at **schema/table/column** granularity (row-level out of scope for v1); assign roles to users; manage data-source connections; review audit information. |

> Notes on personas:
> - All three operate **within a tenant boundary**. A separate platform-operator/super-admin role (managing tenants themselves) is implied by multi-tenancy but **not specified in the seed** — see GAP-2.
> - "Business analyst" vs "external customer" differ mainly in query-inspection rights and exploration depth. Exact permission delta needs confirmation — see GAP-1.

---

## 3. Functional Requirements (prioritized)

Priority scheme: **P0** = must-have for v1 (MVP cannot ship without it), **P1** = should-have for v1, **P2** = nice-to-have / stretch within v1. "Future Work" items from the seed are explicitly **Out of Scope for v1** (see Section 6).

### 3.1 Access Control & Security

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-AC-1 | **P0** | Support Role-Based Access Control (RBAC) with **customizable, user-defined roles** (not just fixed built-in roles). |
| FR-AC-2 | **P0** | Provide an administration interface for admins to **create, modify, and delete roles**. |
| FR-AC-3 | **P0** | Admins can assign data-access permissions to roles at **schema, table, and column** level. *(Row-level permissions deferred — user decision, see §7 Resolved.)* |
| FR-AC-4 | **P0** | Restrict the LLM agent's data-retrieval capability to **only the data sources and subsets permitted by the active user's role**. |
| FR-AC-5 | **P0** | **Evaluate permissions before executing** any generated SQL query or REST request, so unauthorized data is never exposed (no "filter after fetch"). |
| FR-AC-6 | **P0** | Enforce **multi-tenant isolation**: every query, role, conversation, and data source is scoped to a tenant; cross-tenant access is impossible by construction. |
| FR-AC-7 | **P0** | Assign roles to users within a tenant (role membership management). *(Implied by RBAC; not explicit in seed — see GAP-3.)* |

### 3.2 LLM Agent & BI Integration

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-LLM-1 | **P0** | Translate natural-language queries into **structured SQL or REST API requests**, depending on the target data source. |
| FR-LLM-2 | **P0** | Validate generated queries against the **BI system schema and permission constraints before execution** (prevent syntax errors and security violations). |
| FR-LLM-3 | **P0** | Provide an explicit **error state or clarification request** when a query is ambiguous, missing parameters, or references data outside the available schema. |
| FR-LLM-4 | **P0** | **Stream** the LLM's text response to the user in real time. |
| FR-LLM-5 | **P1** | On user request, **display the underlying generated query** (executed SQL or API endpoint) for auditing/trust. **Visibility is a per-role capability toggle** set by admins (resolved GAP-1); default off. |
| FR-LLM-6 | **P0** | The agent must run behind a **provider-abstraction layer**. Default LLM provider is **Google Gemini** (user decision), but the provider/model must be **swappable via configuration** without code changes to the agent pipeline. *(See §7 Resolved GAP-18.)* |

### 3.3 Data Visualization & Charting

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-VIZ-1 | **P0** | **Automatically determine the most appropriate chart type** from the structure/dimensions of the returned data. |
| FR-VIZ-2 | **P0** | Support these primary chart types in v1: **Bar (periodic & categorical)**, **Line**, **Pie/Donut** (low-cardinality only), and **Data Table** (with sorting and pagination). |
| FR-VIZ-3 | **P0** | Let the user **toggle** between graphical chart view and raw data-table view for any result. |
| FR-VIZ-4 | **P0** | Render **interactive charts inline** within the chat timeline as responses. |
| FR-VIZ-5 | **P1** | Support **tooltips on hover** over chart elements (bars, lines, slices) showing precise data-point values. |
| FR-VIZ-6 | **P1** | **Export** results: charts as image files (**PNG/JPEG**) and data as **CSV/JSON**. |

### 3.4 User Interface & Interaction

| ID | Priority | Requirement |
|----|----------|-------------|
| FR-UI-1 | **P0** | Persistent **conversational chat interface** for entering questions. |
| FR-UI-2 | **P0** | Maintain **conversation history/context** to support follow-up questions (e.g. "filter the previous result by region X"). |
| FR-UI-3 | **P1** | Persist conversation history across sessions (durable history, not just in-memory). *(Seed says "maintain context"; durability across sessions is an extrapolation — see GAP-4.)* |

---

## 4. Non-Functional Requirements

### 4.1 Security (critical)

- **NFR-SEC-1 (P0) — Infra-level credential restriction.** The database user or API token the webapp uses to reach a data source **must be restricted at the infrastructure level to strictly match the permissions of the logged-in user.** This is defense-in-depth so that even an unexpected/malicious LLM output cannot retrieve or expose data beyond the user's role. *(Directly from the seed doc's implementation note — treated as a hard requirement, not advice.)* Implementation pattern (per-user/per-role credential mapping vs. credential vault vs. session-scoped DB roles) is a GAP — see GAP-5.
- **NFR-SEC-2 (P0) — Permission evaluation precedes execution.** Reinforces FR-AC-5; permission checks are an enforced gate, never advisory.
- **NFR-SEC-3 (P0) — Injection resistance.** Schema metadata is passed to the LLM as context; generated queries must be guarded against SQL/REST injection and broad-data-exposure from unexpected LLM output (parameterization, allow-listing, query validation).
- **NFR-SEC-4 (P0) — Tenant data isolation.** Multi-tenancy must guarantee no data, credential, role, or conversation leakage across tenants. Isolation model (separate DB/schema/row-level) is a GAP — see GAP-6.
- **NFR-SEC-5 (P0) — Authentication & session management.** Users authenticate before any access. **Mechanism (resolved): email+password baseline + optional per-tenant SSO/OIDC**, with tenant-admin email-invite provisioning (see §7.0 / GAP-3/7).

### 4.2 Multi-Tenancy

- **NFR-MT-1 (P0).** The system is multi-tenant SaaS. Every domain object is tenant-scoped. Tenant context must be resolved on every request and enforced server-side (never trusting client-supplied tenant identifiers alone).
- **NFR-MT-2 (P1).** Per-tenant configuration: each tenant manages its own roles, users, and data-source connections independently.

### 4.3 Performance & Streaming

- **NFR-PERF-1 (P0).** LLM text responses stream incrementally with low perceived latency (first token / first content visible quickly).
- **NFR-PERF-2 (P1).** Chart rendering and table pagination remain responsive on typical result sets. Concrete targets (max rows, p95 latency, concurrent users) are unspecified — see GAP-8.

### 4.4 Auditability

- **NFR-AUD-1 (P1).** The generated query (SQL/REST endpoint) is inspectable by permitted users (ties to FR-LLM-5).
- **NFR-AUD-2 (P1).** Security-relevant events (query execution, permission decisions, exports, role changes) should be auditable. Whether a **persisted audit log** is required for v1 — vs. only on-screen display — is a GAP; the seed only mentions display. See GAP-9.

### 4.5 Accessibility

- **NFR-A11Y-1 (P1).** UI should meet a recognized accessibility standard (target: WCAG 2.1 AA). Charts must have accessible alternatives (the chart/table toggle in FR-VIZ-3 supports this; tabular data is the accessible fallback for visualizations). Exact conformance target to confirm — see GAP-10.

### 4.6 Other

- **NFR-OBS-1 (P2).** Operational observability (logging/metrics/tracing) for the agent and query pipeline — deferred to Architect/DevOps; not user-facing.
- **NFR-I18N-1 (P2).** Internationalization/localization — not specified; flag only. See GAP-11.

---

## 5. Per-Action Detail (data / timing / behavior / result)

This section maps each primary user action through its full path. Items marked **[gap]** are open questions consolidated in Section 7.

### Action A — Ask a natural-language question
- **Trigger:** User types a question into the persistent chat input and submits.
- **Preconditions:** User authenticated; tenant resolved; user has an assigned role; at least one data source is connected and within role scope.
- **Input data:** NL text; active conversation history (for context); user's role/permission set; tenant's schema metadata; data-source descriptors.
- **Timing / order:** (1) resolve user+tenant+role → (2) build LLM context (schema metadata + permitted scope + history) → (3) LLM generates SQL/REST → (4) **permission evaluation gate** (FR-AC-5) → (5) query validation (FR-LLM-2) → (6) execute against a **credential restricted to the user's permissions** (NFR-SEC-1) → (7) stream text response (FR-LLM-4) → (8) auto-select chart type → (9) render inline chart/table.
- **Behavior:** Agent answers in natural language and produces a visualization. If ambiguous/out-of-scope, it asks for clarification or returns an explicit error instead of guessing (FR-LLM-3).
- **Result:** Inline streamed answer + interactive chart (or table) appended to the chat timeline; generated query available on request.
- **Edge cases:** Empty result set; result too large to chart (fallback to table/pagination); query references unpermitted columns (blocked pre-execution); LLM produces invalid query (caught by validation); data-source timeout/error; ambiguous question (clarification prompt). **Resolved (GAP-12):** on partial-permission queries the system **blocks the whole query and tells the user which tables/columns they would need access to** (block + explain) — it does not silently return a subset.

### Action B — Toggle chart / table view
- **Trigger:** User clicks a toggle on a result.
- **Input:** The already-returned result set (no re-query expected). **[gap]** does toggle re-run the query or reuse cached data? See GAP-13.
- **Behavior:** Switches the same result between auto-selected chart and raw table (sortable, paginated).
- **Result:** Same data, alternate presentation; state remembered for that message.

### Action C — Export a result
- **Trigger:** User chooses export on a result.
- **Input:** The result set + current chart rendering.
- **Behavior:** Produce PNG/JPEG (image of chart) or CSV/JSON (data payload).
- **Result:** File downloaded/delivered to user.
- **Edge cases:** Export must respect permissions (cannot export data the user couldn't see); very large CSV/JSON handling. **[gap]** export delivery (client-side download vs. server-generated link) and size limits — see GAP-14.

### Action D — Inspect generated query (audit)
- **Trigger:** User requests to see the underlying query for a result.
- **Behavior:** Display executed SQL or REST endpoint/logic.
- **Result:** Read-only query/logic shown.
- **[gap]** is this available to all users or only analysts/admins? See GAP-1.

### Action E — Follow-up question (contextual)
- **Trigger:** User asks a question that references prior turns ("filter previous result by region X").
- **Input:** New NL text + conversation history.
- **Behavior:** Agent resolves references against history, regenerates a query, then runs the full Action A pipeline (including the permission gate again).
- **Result:** New inline result reflecting the refinement.
- **Edge cases:** Reference resolution failure → clarification; history length/context-window limits. **[gap]** history retention scope/duration — see GAP-4.

### Action F — Manage roles & permissions (Admin)
- **Trigger:** Admin opens the administration interface.
- **Input:** Role definitions; schema/table/row/column selections; user-to-role assignments.
- **Behavior:** CRUD on roles; assign granular permissions; assign roles to users; (manage data-source connections — implied). Changes take effect for subsequent queries.
- **Result:** Updated RBAC state enforced on next query.
- **Edge cases:** Removing a permission while a user is mid-session; conflicting permissions; **Resolved (GAP-15):** row-level permissions are **out of scope for v1**; granularity stops at schema/table/column. No row-predicate mechanism is built in v1. **[gap]** data-source connection management ownership (admin vs. platform) — see GAP-16. **[gap]** do permission changes apply mid-session or next login — see GAP-17.

---

## 6. Out of Scope for v1 (Future Work)

The following are explicitly **deferred** (carried over from the seed doc's "Future Work"). Downstream agents must not build these in v1, but should avoid design choices that make them impossible later:

- **Scatter plots** (correlation analysis).
- **Stacked area charts** (composition over time).
- **Geospatial heatmaps** (regional data analysis).
- **Manual chart manipulation** via interactive UI controls (e.g. dropdowns to manually switch chart type or change color palettes). *(Note: v1 auto-selects chart type and offers only chart↔table toggle; manual chart-type switching is out of scope.)*

- **Row-level data permissions** (per user decision — v1 stops at schema/table/column granularity).

Also flagged as **not in v1 scope unless confirmed otherwise:**
- Platform-level super-admin / tenant-provisioning console (see GAP-2).
- Persisted long-term audit log (vs. on-demand query display) (see GAP-9).
- Internationalization (see GAP-11).
- Scheduled reports, dashboards, alerting (not mentioned in seed; flag only).
- **Infrastructure automation (epic 008): deferred post-v1** (user decision 2026-06-14). v1 deploys manually per `docs/DEPLOYMENT.md`; IaC + automated tenant provisioning come later.
- **Full observability provisioning: deferred post-v1** (user decision). v1 ships audit persistence + OTel/pino instrumentation + only the P1 gate-bypass alert (A1); alerts A2–A12 and dashboards are runbook-only (`docs/kb/monitoring.md`).

---

## 7. Gaps / Open Questions

These are ambiguities or under-specifications that **must be resolved** by the user, UI/UX Designer, or Architect before/while building. They are not silently assumed.

### 7.0 Resolved by user (2026-06-14)

- **GAP-12 → RESOLVED:** Partial-permission queries are **blocked entirely, with an explanation of which tables/columns access is missing** (block + explain).
- **GAP-15 → RESOLVED:** **Row-level permissions are out of scope for v1.** Permission granularity is **schema / table / column** only. (Drops the seed's row-level requirement; downstream RBAC design must not assume row predicates.)
- **GAP-18 → RESOLVED:** LLM provider defaults to **Google Gemini**, behind a **swappable provider-abstraction layer** (config-driven, no code change to switch). See FR-LLM-6. *(Data-residency/PII handling of schema sent to Gemini still needs an Architect decision.)*
- **GAP-1 → RESOLVED:** Query inspection (FR-LLM-5) visibility is a **per-role toggle** — admins decide, per role, whether members can see the generated SQL/REST. The Permission Editor must expose a "can inspect generated query" capability flag per role. Default off for new roles.
- **GAP-3 / GAP-7 → RESOLVED:** Authentication is **email+password baseline with optional per-tenant SSO (OIDC)**. Users are provisioned via **tenant-admin email invite**; a tenant may additionally configure its own SSO/IdP. Both paths must be supported.
- **GAP-10 → RESOLVED:** Accessibility target is **WCAG 2.1 AA** for v1 (no 508/AAA commitment).

| ID | Area | Question / gap | Who should resolve |
|----|------|----------------|--------------------|
| ~~GAP-1~~ | Personas | **RESOLVED** → query inspection is a **per-role capability toggle** set by admins (see §7.0). | ✅ User |
| **GAP-2** | Multi-tenancy | Is there a platform-level super-admin role to provision/manage tenants? Out of scope for v1 unless confirmed. | User / Architect |
| ~~GAP-3~~ | RBAC | **RESOLVED** → tenant-admin email invite; optional per-tenant SSO provisioning (see §7.0). | ✅ User |
| **GAP-4** | History | Is conversation history persisted across sessions/devices, and for how long? Per-user retention/privacy rules? | User |
| **GAP-5** | Security | Concrete model for per-user/per-role data-source credential restriction (per-user DB roles vs. credential vault vs. session-scoped roles vs. proxy). NFR-SEC-1 is mandatory; the mechanism is open. | Architect |
| **GAP-6** | Multi-tenancy | Tenant isolation model: separate database per tenant, shared DB with per-tenant schema, or shared schema with row-level scoping? | Architect |
| ~~GAP-7~~ | Security | **RESOLVED** → email+password baseline + optional per-tenant SSO/OIDC (see §7.0). | ✅ User |
| **GAP-8** | Performance | Concrete performance/scale targets: max result rows, p95 latency, concurrent users per tenant, LLM token/cost budget. | User / Architect |
| **GAP-9** | Audit | Is a **persisted** audit log required for v1, or only on-screen query display? What events must be logged and retained? | User |
| ~~GAP-10~~ | Accessibility | **RESOLVED** → WCAG 2.1 AA for v1 (see §7.0). | ✅ User |
| **GAP-11** | i18n | Is multi-language UI/data required? Assumed no for v1. | User |
| ~~GAP-12~~ | Permissions | **RESOLVED** → block entirely + explain missing access (see §7.0). | ✅ User |
| **GAP-13** | Viz | Does chart/table toggle reuse the fetched result (preferred) or re-run the query? Confirms client-side caching of results. | UX / Architect |
| **GAP-14** | Export | Export delivery mechanism (client-side vs. server-generated) and max export size limits. | UX / Architect |
| ~~GAP-15~~ | RBAC | **RESOLVED** → row-level out of scope for v1; schema/table/column only (see §7.0). | ✅ User |
| **GAP-16** | Data sources | Who manages data-source connections (tenant admin vs. platform), and which source types must v1 support (which SQL dialects, which REST APIs)? | User / Architect |
| **GAP-17** | RBAC | Do permission/role changes take effect mid-session or only on next login? | User |
| ~~GAP-18~~ | LLM | **RESOLVED (provider)** → Gemini default, swappable abstraction (FR-LLM-6, §7.0). *Data-residency/PII handling of schema sent to provider still open → Architect.* | ✅ User / ⏳ Architect |
| **GAP-19** | Viz | Auto chart-selection rules: explicit mapping of data shapes → chart types, and tie-breaking/override behavior. | UX |
| **GAP-20** | Scope | Are dashboards, saved queries, scheduled reports, or sharing of results between users expected later? (Not in seed.) | User |

---

## 8. Traceability to Seed Document

Every line item in `bi_result_presenter_requirements.md` is folded in:
- Access Control & Security → FR-AC-1..7, NFR-SEC-1..4.
- Data Visualization & Charting → FR-VIZ-1..6 (Future Work → Section 6).
- LLM Agent & BI Integration → FR-LLM-1..5.
- User Interface & Interaction → FR-UI-1..3.
- Seed "Note" (infra-level credential restriction) → **NFR-SEC-1 (P0, critical)**.
