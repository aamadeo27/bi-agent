// TODO: instantiate the correct LlmProvider from LLM_PROVIDER env var
import type { LlmProvider } from "./port.js";

export function createLlmProvider(): LlmProvider {
  throw new Error("LlmProvider factory not yet implemented — see T1.x");
}
