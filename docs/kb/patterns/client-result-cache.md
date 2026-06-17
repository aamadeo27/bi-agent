## client-result-cache (GAP-13)

- The SPA caches each message's full result envelope (TanStack Query) keyed by
  message id. Chart↔table toggle and export read this cache — **no re-query**.
- Cap cached rows in memory at the row cap (GAP-8); above it, table view paginates
  from the cached set; export streams from cache. Toggle state is per-message.
