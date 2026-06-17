## query-validation-injection-guard

After the gate, before execution (step 5). Defends NFR-SEC-3.

- Allow-list verbs: `SELECT` only (SQL) / declared read endpoints (REST).
- Reject: multiple statements, comments hiding statements, DDL/DML, `;` chains,
  `INTO OUTFILE`/`COPY`, set-returning functions not allow-listed.
- Parameterize literals; cap returned rows; cap query length.
- For REST: validate path + query params against the connector's declared schema.
