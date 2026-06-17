## generated-query-view

Returned by `GET /api/messages/:id/query` (Action D / FR-LLM-5).
```ts
interface GeneratedQueryView {
  messageId: string;
  queryType: "sql" | "rest";
  queryText: string;           // SQL text or REST endpoint+payload (read-only)
  dataSourceName: string;
  executedAt: string;
  rowCount: number;
}
```
