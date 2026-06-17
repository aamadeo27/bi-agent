## permission-gate-middleware

The gate is a pure, testable function placed **between** generation and execution
in the Ask pipeline (step 4). It is the security boundary — see common-pitfalls.

```ts
function evaluateGate(args: {
  query: GeneratedQuery;           // SQL/REST proposal
  grants: ResourceGrantSet;        // role's schema/table/column grants
  dialect: Dialect;
}): GateResult; // { allow: true } | { allow: false; missing: ResourceRef[] }
```

- Extract referenced resources by **parsing the query AST** (`node-sql-parser`),
  not by regex and not from the LLM's self-report.
- Resolve unqualified columns against referenced tables; if a column cannot be
  resolved to a granted resource → treat as missing (fail closed).
- On any missing resource → `allow:false` with the full `missing[]` list →
  pipeline returns the **block+explain** payload (no execution). Never subset.
- The gate runs again on every follow-up (no cached authorization).
