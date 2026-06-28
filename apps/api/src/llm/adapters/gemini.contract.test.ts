/**
 * Contract test: validates GeminiProvider parsing logic against recorded fixtures.
 * The @google/genai SDK is mocked — no real network calls occur in CI.
 *
 * The "recorded fixture" is the expected JSON shape that Gemini returns for a
 * generateQuery call.  If Gemini changes its response format, this test fails
 * and alerts us before pipeline tests break.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryProposal } from "../port.js";

// --- Recorded fixture: shape of a real Gemini generateQuery response ---
const RECORDED_QUERY_PROPOSAL_FIXTURE: QueryProposal = {
  queryType: "sql",
  query:
    "SELECT region, SUM(amount) AS total_sales " +
    "FROM sales " +
    "WHERE sale_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 QUARTER) " +
    "GROUP BY region " +
    "ORDER BY total_sales DESC",
  referencedResources: ["sales"],
};

// Hoisted mocks so they are available before module imports
const mockGenerateContent = vi.hoisted(() => vi.fn());
const mockGenerateContentStream = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
    },
  })),
}));

import { GeminiProvider, parseQueryProposal } from "./gemini.js";

describe("GeminiProvider — contract (fixture-based, no network)", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContentStream.mockReset();
  });

  // ---- parseQueryProposal unit tests (pure, no mock needed) ----

  describe("parseQueryProposal (internal parser)", () => {
    it("accepts valid SQL fixture", () => {
      const result = parseQueryProposal(JSON.stringify(RECORDED_QUERY_PROPOSAL_FIXTURE));
      expect(result).toEqual(RECORDED_QUERY_PROPOSAL_FIXTURE);
    });

    it("accepts valid rest proposal", () => {
      const raw = JSON.stringify({
        queryType: "rest",
        query: "/api/metrics?period=Q1",
        referencedResources: ["/api/metrics"],
      });
      const result = parseQueryProposal(raw);
      expect(result.queryType).toBe("rest");
    });

    it("accepts empty referencedResources", () => {
      const raw = JSON.stringify({ queryType: "sql", query: "SELECT 1", referencedResources: [] });
      expect(parseQueryProposal(raw).referencedResources).toHaveLength(0);
    });

    it("throws on non-JSON input", () => {
      expect(() => parseQueryProposal("Sorry, I cannot do that.")).toThrow("non-JSON");
    });

    it("throws when queryType field is missing", () => {
      const raw = JSON.stringify({ query: "SELECT 1", referencedResources: [] });
      expect(() => parseQueryProposal(raw)).toThrow("missing required fields");
    });

    it("throws when query field is missing", () => {
      const raw = JSON.stringify({ queryType: "sql", referencedResources: [] });
      expect(() => parseQueryProposal(raw)).toThrow("missing required fields");
    });

    it("throws when referencedResources field is missing", () => {
      const raw = JSON.stringify({ queryType: "sql", query: "SELECT 1" });
      expect(() => parseQueryProposal(raw)).toThrow("missing required fields");
    });

    it("throws on invalid queryType value", () => {
      const raw = JSON.stringify({ queryType: "graphql", query: "{ users }", referencedResources: [] });
      expect(() => parseQueryProposal(raw)).toThrow(/invalid queryType/i);
    });

    it("throws when query is not a string", () => {
      const raw = JSON.stringify({ queryType: "sql", query: 42, referencedResources: [] });
      expect(() => parseQueryProposal(raw)).toThrow("query must be a string");
    });

    it("throws when referencedResources is not an array", () => {
      const raw = JSON.stringify({ queryType: "sql", query: "SELECT 1", referencedResources: "sales" });
      expect(() => parseQueryProposal(raw)).toThrow("referencedResources must be an array");
    });

    it("throws when referencedResources contains non-string elements", () => {
      const raw = JSON.stringify({ queryType: "sql", query: "SELECT 1", referencedResources: [1, "sales"] });
      expect(() => parseQueryProposal(raw)).toThrow(/referencedResources\[0\] is not a string/);
    });

    it("throws when referencedResources contains only non-string elements", () => {
      const raw = JSON.stringify({ queryType: "sql", query: "SELECT 1", referencedResources: [42] });
      expect(() => parseQueryProposal(raw)).toThrow("is not a string");
    });

    it("accepts referencedResources with multiple valid strings", () => {
      const raw = JSON.stringify({
        queryType: "sql",
        query: "SELECT * FROM orders JOIN customers",
        referencedResources: ["orders", "customers"],
      });
      const result = parseQueryProposal(raw);
      expect(result.referencedResources).toEqual(["orders", "customers"]);
    });
  });

  // ---- GeminiProvider.generateQuery (mocked SDK) ----

  describe("GeminiProvider.generateQuery", () => {
    it("parses recorded fixture correctly", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(RECORDED_QUERY_PROPOSAL_FIXTURE),
      });

      const provider = new GeminiProvider({ model: "gemini-2.0-flash", apiKey: "test" });
      const result = await provider.generateQuery({
        userMessage: "Show me sales by region last quarter",
      });

      expect(result).toEqual(RECORDED_QUERY_PROPOSAL_FIXTURE);
      expect(result.queryType).toMatch(/^(sql|rest)$/);
      expect(typeof result.query).toBe("string");
      expect(result.query.length).toBeGreaterThan(0);
      expect(Array.isArray(result.referencedResources)).toBe(true);
    });

    it("passes model id to SDK", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(RECORDED_QUERY_PROPOSAL_FIXTURE),
      });

      const provider = new GeminiProvider({ model: "gemini-1.5-pro", apiKey: "test" });
      await provider.generateQuery({ userMessage: "x" });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gemini-1.5-pro" }),
      );
    });

    it("requests JSON mime type from SDK", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(RECORDED_QUERY_PROPOSAL_FIXTURE),
      });

      const provider = new GeminiProvider({ model: "gemini-2.0-flash", apiKey: "test" });
      await provider.generateQuery({ userMessage: "x" });

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ responseMimeType: "application/json" }),
        }),
      );
    });

    it("throws on empty response", async () => {
      mockGenerateContent.mockResolvedValue({ text: "" });

      const provider = new GeminiProvider({ model: "gemini-2.0-flash", apiKey: "test" });
      await expect(provider.generateQuery({ userMessage: "?" })).rejects.toThrow(
        "empty response",
      );
    });

    it("throws on non-JSON response", async () => {
      mockGenerateContent.mockResolvedValue({ text: "Sorry, I cannot answer that." });

      const provider = new GeminiProvider({ model: "gemini-2.0-flash", apiKey: "test" });
      await expect(provider.generateQuery({ userMessage: "?" })).rejects.toThrow("non-JSON");
    });

    it("propagates history as Gemini contents", async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(RECORDED_QUERY_PROPOSAL_FIXTURE),
      });

      const provider = new GeminiProvider({ model: "gemini-2.0-flash", apiKey: "test" });
      await provider.generateQuery({
        userMessage: "And last year?",
        history: [
          { role: "user", content: "Show me sales" },
          { role: "assistant", content: "Here are the sales." },
        ],
      });

      const call = mockGenerateContent.mock.calls[0][0];
      expect(call.contents).toHaveLength(3);
      expect(call.contents[0]).toEqual({ role: "user", parts: [{ text: "Show me sales" }] });
      expect(call.contents[1]).toEqual({ role: "model", parts: [{ text: "Here are the sales." }] });
      expect(call.contents[2]).toEqual({ role: "user", parts: [{ text: "And last year?" }] });
    });
  });

  // ---- GeminiProvider.streamText (mocked SDK) ----

  describe("GeminiProvider.streamText", () => {
    it("yields tokens from streamed response", async () => {
      async function* fakeStream() {
        yield { text: "Sales" };
        yield { text: " by" };
        yield { text: " region" };
      }
      mockGenerateContentStream.mockResolvedValue(fakeStream());

      const provider = new GeminiProvider({ model: "gemini-2.0-flash", apiKey: "test" });
      const tokens: string[] = [];
      for await (const tok of provider.streamText({
        userMessage: "Show me sales by region",
      })) {
        tokens.push(tok);
      }
      expect(tokens).toEqual(["Sales", " by", " region"]);
    });

    it("skips chunks with no text", async () => {
      async function* fakeStream() {
        yield { text: "Hello" };
        yield { text: "" };       // empty — should be skipped
        yield { text: " world" };
      }
      mockGenerateContentStream.mockResolvedValue(fakeStream());

      const provider = new GeminiProvider({ model: "gemini-2.0-flash", apiKey: "test" });
      const tokens: string[] = [];
      for await (const tok of provider.streamText({ userMessage: "hi" })) {
        tokens.push(tok);
      }
      expect(tokens).toEqual(["Hello", " world"]);
    });

    it("passes systemPrompt via config.systemInstruction", async () => {
      async function* empty() { /* no yields */ }
      mockGenerateContentStream.mockResolvedValue(empty());

      const provider = new GeminiProvider({ model: "gemini-2.0-flash", apiKey: "test" });
      for await (const _ of provider.streamText({
        userMessage: "hi",
        systemPrompt: "You are a BI assistant.",
      })) { /* drain */ }

      expect(mockGenerateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ systemInstruction: "You are a BI assistant." }),
        }),
      );
    });
  });

  // ---- Provider metadata ----

  describe("GeminiProvider metadata", () => {
    it("id is 'gemini'", () => {
      const p = new GeminiProvider({ model: "gemini-2.0-flash", apiKey: "k" });
      expect(p.id).toBe("gemini");
    });

    it("model reflects constructor config", () => {
      const p = new GeminiProvider({ model: "gemini-1.5-pro", apiKey: "k" });
      expect(p.model).toBe("gemini-1.5-pro");
    });
  });
});
