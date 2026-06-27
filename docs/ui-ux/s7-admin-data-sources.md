# S7: Admin — Data Sources

**Purpose:** Configure and test data source connections used by the LLM agent.
**Layout:** Card grid or table (same admin sidebar).
**Connection card:** Name | Type badge | Status indicator (green dot / red dot / gray dot) | Last tested timestamp | Actions (Edit, Delete, Test).
**Add / Edit modal:**
- Name (required).
- Type: dropdown (PostgreSQL / MySQL / MSSQL / BigQuery / REST API — exact list is GAP-16).
- Connection string or individual fields (host, port, db, username, password — masked by default, reveal toggle).
- "Test connection" button: shows inline spinner → "Connected [timestamp]" or "Failed: [error]".
- Save / Cancel.
**Delete confirm:** standard destructive modal.
**FR coverage:** Implied by FR-LLM-1, NFR-SEC-1 (infra credential binding is an Architect concern; UI shows connection name only, not credentials in display).
