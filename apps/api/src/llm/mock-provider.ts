import type { LlmProvider, LlmRequest, QueryProposal } from "./port.js";

/**
 * Deterministic mock for use in pipeline tests — never calls Gemini.
 * Configure responses via the public fields before calling provider methods.
 */
export class MockLlmProvider implements LlmProvider {
  readonly id = "mock";
  readonly model = "mock-model";

  /** Chunks emitted by streamText, in order. */
  textChunks: string[] = ["Mock", " answer"];
  /** Return value of generateQuery. */
  queryProposal: QueryProposal = {
    queryType: "sql",
    query: "SELECT 1",
    referencedResources: [],
  };
  /** If set, streamText throws this error. */
  streamError: Error | null = null;
  /** If set, generateQuery throws this error. */
  queryError: Error | null = null;

  /** Append-only call log — one entry per method invocation. */
  calls: Array<{ method: "streamText" | "generateQuery"; input: LlmRequest }> =
    [];

  async *streamText(input: LlmRequest): AsyncIterable<string> {
    this.calls.push({ method: "streamText", input });
    if (this.streamError) throw this.streamError;
    for (const chunk of this.textChunks) {
      yield chunk;
    }
  }

  async generateQuery(input: LlmRequest): Promise<QueryProposal> {
    this.calls.push({ method: "generateQuery", input });
    if (this.queryError) throw this.queryError;
    return { ...this.queryProposal, referencedResources: [...this.queryProposal.referencedResources] };
  }

  /** Reset all mutable state between tests. */
  reset(): void {
    this.textChunks = ["Mock", " answer"];
    this.queryProposal = {
      queryType: "sql",
      query: "SELECT 1",
      referencedResources: [],
    };
    this.streamError = null;
    this.queryError = null;
    this.calls = [];
  }
}
