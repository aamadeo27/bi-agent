## request-validation

Express does **no schema validation** by itself. Every route validates with a Zod
middleware sourced from `packages/contracts` (single source of truth).

```ts
const validate = (schema: ZodSchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const r = schema.safeParse({ body: req.body, params: req.params, query: req.query });
    if (!r.success) return next(new AppError('VALIDATION', r.error.flatten()));
    req.valid = r.data;        // typed, validated input
    next();
  };
```

- Validate `body`, `params`, and `query` against the contract Zod schema before the
  handler runs; handlers read `req.valid`, never raw `req.body`.
- A validation failure maps to the `VALIDATION` error code (error-handling pattern).
- This middleware is the Express replacement for Fastify's built-in JSON-schema
  validation — apply it on every non-trivial route, including the SSE message route.
