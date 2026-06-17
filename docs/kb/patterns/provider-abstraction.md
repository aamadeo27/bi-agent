## provider-abstraction

The Ask pipeline depends on a **port**, never on a concrete LLM SDK.

```ts
// packages/contracts or apps/api/src/llm/port.ts
export interface LlmProvider {
  /** Stream natural-language tokens for the user-facing answer. */
  streamText(input: LlmRequest): AsyncIterable<string>;
  /** Produce a structured query proposal (deterministic to parse). */
  generateQuery(input: LlmRequest): Promise<QueryProposal>;
  readonly id: string;       // "gemini"
  readonly model: string;    // configured model id
}
```

- Adapters: `GeminiProvider implements LlmProvider` (default, imports `@google/genai`).
- A `createLlmProvider(config)` factory selects the adapter from `LLM_PROVIDER`.
- **Rule:** no file outside `src/llm/adapters/*` may import a provider SDK. Lint-enforced.
- `QueryProposal` includes the query text **and** the model's declared referenced
  resources, but the gate re-derives resources from the query itself (never trusts
  the model's self-report).
