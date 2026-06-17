## error-codes

Discriminated union shared FE/BE:
`GATE_BLOCK | CLARIFICATION | VALIDATION | DATA_SOURCE | LLM_ERROR | AUTH | TENANT | NOT_FOUND | RATE_LIMIT | INTERNAL`.
Each maps to a UI/UX §11 state. `GATE_BLOCK` carries `PermissionBlock`;
`CLARIFICATION` carries the streamed clarification text.
