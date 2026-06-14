# Epic 004 — Data sources & restricted-credential proxy

Data-source registry + connectors (PostgreSQL, MySQL, BigQuery, generic REST), the
encrypted credential vault, and the Query Proxy that executes via the per-(tenant,
role,source) least-privilege credential — the L2 defense-in-depth backstop.

## Motivation
Covers NFR-SEC-1 (GAP-5 credential restriction), GAP-16 (v1 source types), and the
S7 Data Sources admin screen. Provides the execution layer the ask pipeline
(epic 005) calls after the gate.

## Definition of Done
- Admins can add/edit/test/delete data sources (S7) for the v1 types.
- Credentials are stored via envelope encryption (KMS); never logged or returned.
- The Query Proxy resolves and uses the role-scoped credential, applies timeout +
  row cap, and normalizes results into the ResultEnvelope row shape.
- A query exceeding the credential's grants is rejected at the source (L2 verified).

## deps: 001, 002, 003

## Dependency graph & parallelism plan

Wave 1 (parallel): T4.1, T4.5
Wave 2 (parallel): T4.2, T4.3
Wave 3 (serial): T4.4

- T4.1 (registry + vault) and T4.5 (S7 UI) start in parallel.
- T4.2 (SQL connectors pg/mysql/bq) and T4.3 (REST connector) parallel — distinct files.
- T4.4 (Query Proxy + restricted-credential resolution) depends on T01–T4.3 (it wires
  vault + connectors + grant-scoped credential) — serialize last.

## Risks / open questions
- Per-role DB-role provisioning at external sources is operationally heavy;
  document the provisioning expectation. REST "credential" is token + allow-list.
- GAP-16 v1 source set (pg/mysql/bq/rest) flagged for user confirmation.
