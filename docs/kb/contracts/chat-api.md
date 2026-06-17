## chat-api

### POST `/api/conversations/:conversationId/messages` (SSE response)
Submit a question; response is an SSE stream (`Content-Type: text/event-stream`).

Request body:
```jsonc
{ "text": "Show me sales by region last quarter" }
```

SSE events (each `data:` is JSON of the named shape):
```jsonc
// event: meta   — sent once before/with first content
{ "messageId": "...", "queryType": "sql" | "rest" }
// event: token  — repeated; text delta
{ "delta": "..." }
// event: result — sent once when data is ready
{ "envelope": ResultEnvelope }            // see result-envelope
// event: block  — sent instead of result on permission block
{ "block": PermissionBlock }              // see below
// event: error  — terminal error
{ "code": ErrorCode, "message": "..." }
// event: done   — terminal success
{ "messageId": "..." }
```

### Other chat/conversation endpoints
- `GET  /api/conversations` → list (id, title, updatedAt) tenant+user scoped.
- `POST /api/conversations` → create empty conversation.
- `GET  /api/conversations/:id/messages` → history (durable; auto-purged after the
  365-day retention default — GAP-4 resolved).
- `DELETE /api/conversations/:id` → manual user delete (removes the conversation and
  its messages immediately; complements the scheduled auto-purge).
- `GET  /api/messages/:id/query` → inspect generated query (Action D); 403 unless
  the user's role has `canInspectQuery`. Returns `GeneratedQueryView`.

> **Retention (GAP-4 resolved):** conversations + messages carry a `createdAt`
> timestamp; a scheduled purge job hard-deletes any conversation older than the
> **365-day** default retention. Users may also delete a conversation manually at
> any time via `DELETE /api/conversations/:id`. No new API surface is required for
> the purge — it runs server-side on a schedule.
