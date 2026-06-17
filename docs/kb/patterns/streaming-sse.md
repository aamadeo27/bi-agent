## streaming-sse

Express has **no SSE helper**, so the response is driven manually.

```ts
// in the route handler
res.status(200).set({
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
});
res.flushHeaders();                          // send headers immediately
const send = (event: string, data: unknown) =>
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
req.on('close', () => abortController.abort()); // client disconnect → cancel upstream
// ... send('token', { delta }) ... ; send('done', { messageId }); res.end();
```

- Disable compression/proxy buffering on this route (`no-transform`); behind nginx
  set `X-Accel-Buffering: no`.
- Events: `meta` (messageId + queryType + chart header), `token` (text delta),
  `result` (envelope), `block` (permission block), `error`, `done`.
- Backpressure: respect the client read rate; if the consumer is slow, buffer with
  a bounded queue and abort the upstream LLM stream on disconnect (avoid leaks).
- Always send a terminal `done`/`error`; client clears the StreamingIndicator on
  first `token` or `block`.
