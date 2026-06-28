export interface LlmRequest {
  userMessage: string;
  /** Prior turns, oldest first */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Injected schema / context string for the model */
  systemPrompt?: string;
}

/**
 * Structured output from generateQuery.
 *
 * NOTE: `referencedResources` is the model's self-report — the permission gate
 * re-derives resources from the query text and NEVER trusts this field.
 */
export interface QueryProposal {
  queryType: "sql" | "rest";
  query: string;
  referencedResources: string[];
}

export interface LlmProvider {
  /** Stream natural-language tokens for the user-facing answer. */
  streamText(input: LlmRequest): AsyncIterable<string>;
  /** Produce a structured query proposal (deterministic to parse). */
  generateQuery(input: LlmRequest): Promise<QueryProposal>;
  readonly id: string;    // e.g. "gemini"
  readonly model: string; // configured model id
}
