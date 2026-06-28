import { describe, it, expect } from "vitest";
import type { LlmProvider, LlmRequest, QueryProposal } from "./port.js";

// Type-level contract tests: ensure the interface is structurally sound.
// Real adapter behaviour is tested in adapters/gemini.contract.test.ts.

describe("LlmProvider port — type contracts", () => {
  it("QueryProposal has required fields (sql)", () => {
    const proposal: QueryProposal = {
      queryType: "sql",
      query: "SELECT region, SUM(amount) FROM sales GROUP BY region",
      referencedResources: ["sales"],
    };
    expect(proposal.queryType).toBe("sql");
    expect(typeof proposal.query).toBe("string");
    expect(Array.isArray(proposal.referencedResources)).toBe(true);
  });

  it("QueryProposal accepts rest queryType", () => {
    const proposal: QueryProposal = {
      queryType: "rest",
      query: "/api/metrics?from=2024-01-01",
      referencedResources: ["/api/metrics"],
    };
    expect(proposal.queryType).toBe("rest");
  });

  it("QueryProposal referencedResources can be empty", () => {
    const proposal: QueryProposal = {
      queryType: "sql",
      query: "SELECT 1",
      referencedResources: [],
    };
    expect(proposal.referencedResources).toHaveLength(0);
  });

  it("LlmRequest accepts minimal input (no history, no systemPrompt)", () => {
    const req: LlmRequest = { userMessage: "Show me sales by region" };
    expect(req.userMessage).toBeTruthy();
    expect(req.history).toBeUndefined();
    expect(req.systemPrompt).toBeUndefined();
  });

  it("LlmRequest accepts full input with history and systemPrompt", () => {
    const req: LlmRequest = {
      userMessage: "And last year?",
      history: [
        { role: "user", content: "Show me sales" },
        { role: "assistant", content: "Here are the sales figures." },
      ],
      systemPrompt: "You are a BI assistant.",
    };
    expect(req.history).toHaveLength(2);
    expect(req.history?.[1].role).toBe("assistant");
    expect(req.systemPrompt).toBeTruthy();
  });

  it("LlmProvider interface is assignable from a conforming object", () => {
    const provider: LlmProvider = {
      id: "test",
      model: "test-model",
      async *streamText(_input: LlmRequest): AsyncIterable<string> {
        yield "token";
      },
      async generateQuery(_input: LlmRequest): Promise<QueryProposal> {
        return { queryType: "sql", query: "SELECT 1", referencedResources: [] };
      },
    };
    expect(provider.id).toBe("test");
    expect(provider.model).toBe("test-model");
    expect(typeof provider.streamText).toBe("function");
    expect(typeof provider.generateQuery).toBe("function");
  });

  it("streamText is an async generator (AsyncIterable<string>)", async () => {
    const provider: LlmProvider = {
      id: "gen",
      model: "gen-model",
      async *streamText(_input: LlmRequest) {
        yield "a";
        yield "b";
      },
      async generateQuery(_input: LlmRequest): Promise<QueryProposal> {
        return { queryType: "sql", query: "SELECT 1", referencedResources: [] };
      },
    };
    const tokens: string[] = [];
    for await (const tok of provider.streamText({ userMessage: "hi" })) {
      tokens.push(tok);
    }
    expect(tokens).toEqual(["a", "b"]);
  });
});
