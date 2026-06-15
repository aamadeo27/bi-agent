// @google/genai import is ONLY permitted in this file (see ESLint rule no-llm-sdk-outside-adapters)
// TODO: implement Gemini adapter — see docs/kb/patterns.md §provider-abstraction
import type { LlmProvider } from "../port.js";

export class GeminiAdapter implements LlmProvider {
  async generateSql(_prompt: string): Promise<string> {
    throw new Error("GeminiAdapter not yet implemented");
  }
}
