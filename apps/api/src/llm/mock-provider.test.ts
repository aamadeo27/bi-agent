import { describe, it, expect, beforeEach } from "vitest";
import { MockLlmProvider } from "./mock-provider.js";
import type { LlmProvider } from "./port.js";

describe("MockLlmProvider", () => {
  let mock: MockLlmProvider;

  beforeEach(() => {
    mock = new MockLlmProvider();
  });

  it("satisfies LlmProvider interface", () => {
    // Type assertion — verifies MockLlmProvider is assignable to LlmProvider at compile time.
    const provider: LlmProvider = mock as LlmProvider;
    expect(provider.id).toBe("mock");
    expect(provider.model).toBe("mock-model");
  });

  it("streamText yields configured chunks", async () => {
    mock.textChunks = ["Hello", " world", "!"];
    const chunks: string[] = [];
    for await (const chunk of mock.streamText({ userMessage: "hi" })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["Hello", " world", "!"]);
  });

  it("streamText yields default chunks", async () => {
    const chunks: string[] = [];
    for await (const chunk of mock.streamText({ userMessage: "hi" })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["Mock", " answer"]);
  });

  it("streamText records call with input", async () => {
    const input = { userMessage: "Show me data" };
    for await (const _ of mock.streamText(input)) { /* drain */ }
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].method).toBe("streamText");
    expect(mock.calls[0].input).toBe(input);
  });

  it("generateQuery returns configured proposal", async () => {
    mock.queryProposal = {
      queryType: "sql",
      query: "SELECT * FROM orders",
      referencedResources: ["orders"],
    };
    const result = await mock.generateQuery({ userMessage: "show orders" });
    expect(result).toEqual({
      queryType: "sql",
      query: "SELECT * FROM orders",
      referencedResources: ["orders"],
    });
  });

  it("generateQuery returns a copy (mutations don't affect internal state)", async () => {
    const result = await mock.generateQuery({ userMessage: "x" });
    result.query = "MUTATED";
    const result2 = await mock.generateQuery({ userMessage: "x" });
    expect(result2.query).toBe("SELECT 1");
  });

  it("generateQuery records call", async () => {
    const input = { userMessage: "test" };
    await mock.generateQuery(input);
    expect(mock.calls[0].method).toBe("generateQuery");
    expect(mock.calls[0].input).toBe(input);
  });

  it("streamText throws configured streamError", async () => {
    mock.streamError = new Error("network failure");
    await expect(async () => {
      for await (const _ of mock.streamText({ userMessage: "x" })) { /* noop */ }
    }).rejects.toThrow("network failure");
  });

  it("generateQuery throws configured queryError", async () => {
    mock.queryError = new Error("model unavailable");
    await expect(mock.generateQuery({ userMessage: "x" })).rejects.toThrow(
      "model unavailable",
    );
  });

  it("reset clears call log", async () => {
    await mock.generateQuery({ userMessage: "a" });
    for await (const _ of mock.streamText({ userMessage: "b" })) { /* noop */ }
    mock.reset();
    expect(mock.calls).toHaveLength(0);
  });

  it("reset restores default textChunks", () => {
    mock.textChunks = ["custom"];
    mock.reset();
    expect(mock.textChunks).toEqual(["Mock", " answer"]);
  });

  it("reset restores default queryProposal", () => {
    mock.queryProposal = { queryType: "rest", query: "/api", referencedResources: [] };
    mock.reset();
    expect(mock.queryProposal).toEqual({
      queryType: "sql",
      query: "SELECT 1",
      referencedResources: [],
    });
  });

  it("reset clears errors", async () => {
    mock.streamError = new Error("bad");
    mock.queryError = new Error("bad");
    mock.reset();
    await expect(mock.generateQuery({ userMessage: "x" })).resolves.toBeDefined();
  });

  it("accumulated calls across multiple invocations", async () => {
    await mock.generateQuery({ userMessage: "a" });
    for await (const _ of mock.streamText({ userMessage: "b" })) { /* noop */ }
    await mock.generateQuery({ userMessage: "c" });
    expect(mock.calls).toHaveLength(3);
    expect(mock.calls.map((c) => c.method)).toEqual([
      "generateQuery",
      "streamText",
      "generateQuery",
    ]);
  });
});
