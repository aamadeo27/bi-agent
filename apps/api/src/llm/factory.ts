import type { LlmProvider } from "./port.js";
import { GeminiProvider } from "./adapters/gemini.js";

export interface LlmConfig {
  /** Value of LLM_PROVIDER env var */
  provider: string;
  /** Value of LLM_MODEL env var */
  model: string;
  /** Provider API key (e.g. GEMINI_API_KEY) */
  apiKey: string;
}

export function createLlmProvider(config: LlmConfig): LlmProvider {
  switch (config.provider.toLowerCase()) {
    case "gemini":
      return new GeminiProvider({ model: config.model, apiKey: config.apiKey });
    default:
      throw new Error(
        `Unknown LLM_PROVIDER: "${config.provider}". Supported: gemini`,
      );
  }
}
