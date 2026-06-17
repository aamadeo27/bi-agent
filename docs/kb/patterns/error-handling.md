## error-handling

- Typed error taxonomy surfaced to the client as a discriminated union:
  `GATE_BLOCK` (with `missing[]`), `CLARIFICATION` (LLM needs info), `VALIDATION`,
  `DATA_SOURCE`, `LLM_ERROR`, `AUTH`, `TENANT`, `NOT_FOUND`, `INTERNAL`.
- Each maps to a specific UI state (UI/UX §11): block message, clarification
  message, generic error bubble, etc.
- Never leak credentials, raw stack traces, or another tenant's identifiers in
  error payloads.
