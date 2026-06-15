// TODO: LlmProvider interface — full definition in docs/kb/patterns.md §provider-abstraction
export interface LlmProvider {
  // Placeholder — to be expanded when LLM pipeline is implemented
  generateSql(prompt: string): Promise<string>;
}
