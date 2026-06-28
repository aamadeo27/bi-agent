import { describe, it, expect } from "vitest";
import { createLlmProvider, type LlmConfig } from "./factory.js";
import { GeminiProvider } from "./adapters/gemini.js";

describe("createLlmProvider", () => {
  it("throws on unknown provider", () => {
    const config: LlmConfig = { provider: "openai", model: "gpt-4o", apiKey: "key" };
    expect(() => createLlmProvider(config)).toThrow(/Unknown LLM_PROVIDER.*openai/i);
  });

  it("throws including the bad value in the error", () => {
    expect(() =>
      createLlmProvider({ provider: "bedrock", model: "x", apiKey: "x" }),
    ).toThrow("bedrock");
  });

  it("creates GeminiProvider for provider=gemini", () => {
    const config: LlmConfig = {
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKey: "test-key",
    };
    const provider = createLlmProvider(config);
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.id).toBe("gemini");
    expect(provider.model).toBe("gemini-2.0-flash");
  });

  it("provider=GEMINI (uppercase) is accepted", () => {
    const config: LlmConfig = {
      provider: "GEMINI",
      model: "gemini-1.5-pro",
      apiKey: "test-key",
    };
    const provider = createLlmProvider(config);
    expect(provider.id).toBe("gemini");
    expect(provider.model).toBe("gemini-1.5-pro");
  });

  it("returned provider satisfies LlmProvider interface", () => {
    const provider = createLlmProvider({
      provider: "gemini",
      model: "gemini-2.0-flash",
      apiKey: "test-key",
    });
    expect(typeof provider.streamText).toBe("function");
    expect(typeof provider.generateQuery).toBe("function");
    expect(typeof provider.id).toBe("string");
    expect(typeof provider.model).toBe("string");
  });
});
