// @google/genai import is ONLY permitted in this file (see ESLint rule no-llm-sdk-outside-adapters)
import { GoogleGenAI } from "@google/genai";
import type { LlmProvider, LlmRequest, QueryProposal } from "../port.js";

const QUERY_PROPOSAL_SYSTEM = `You are a BI query generator. Given the user question and schema context, return ONLY valid JSON with no markdown or explanation:
{"queryType":"sql"|"rest","query":"<the query string>","referencedResources":["<table or endpoint>"]}`;

export interface GeminiConfig {
  model: string;
  apiKey: string;
}

export class GeminiProvider implements LlmProvider {
  readonly id = "gemini";
  readonly model: string;
  private readonly client: GoogleGenAI;

  constructor(config: GeminiConfig) {
    this.model = config.model;
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
  }

  async *streamText(input: LlmRequest): AsyncIterable<string> {
    const contents = buildContents(input);
    const stream = await this.client.models.generateContentStream({
      model: this.model,
      contents,
      ...(input.systemPrompt
        ? { config: { systemInstruction: input.systemPrompt } }
        : {}),
    });
    for await (const chunk of stream) {
      if (chunk.text) yield chunk.text;
    }
  }

  async generateQuery(input: LlmRequest): Promise<QueryProposal> {
    const contents = buildContents(input);
    const response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config: {
        systemInstruction: QUERY_PROPOSAL_SYSTEM,
        responseMimeType: "application/json",
      },
    });
    const text = response.text;
    if (!text) {
      throw new Error("GeminiProvider: empty response for generateQuery");
    }
    return parseQueryProposal(text);
  }
}

type GeminiRole = "user" | "model";

function buildContents(
  input: LlmRequest,
): Array<{ role: GeminiRole; parts: Array<{ text: string }> }> {
  const history = (input.history ?? []).map((h) => ({
    role: (h.role === "assistant" ? "model" : "user") as GeminiRole,
    parts: [{ text: h.content }],
  }));
  return [
    ...history,
    { role: "user" as const, parts: [{ text: input.userMessage }] },
  ];
}

export function parseQueryProposal(raw: string): QueryProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `GeminiProvider: generateQuery returned non-JSON: ${raw.slice(0, 200)}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("queryType" in parsed) ||
    !("query" in parsed) ||
    !("referencedResources" in parsed)
  ) {
    throw new Error(
      "GeminiProvider: generateQuery response missing required fields",
    );
  }
  const p = parsed as Record<string, unknown>;
  if (p.queryType !== "sql" && p.queryType !== "rest") {
    throw new Error(`GeminiProvider: invalid queryType "${String(p.queryType)}"`);
  }
  if (typeof p.query !== "string") {
    throw new Error("GeminiProvider: query must be a string");
  }
  if (!Array.isArray(p.referencedResources)) {
    throw new Error("GeminiProvider: referencedResources must be an array");
  }
  return {
    queryType: p.queryType,
    query: p.query,
    referencedResources: p.referencedResources as string[],
  };
}
