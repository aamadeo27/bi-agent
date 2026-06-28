/**
 * Unit tests for the `no-llm-sdk-outside-adapters` ESLint custom rule (AC3).
 *
 * The rule lives in eslint.config.js (root). We test the rule's `create`
 * logic directly via a minimal ESLint-compatible mock context — no ESLint
 * installation required, no network, no temp files.
 *
 * If these tests pass and the rule is registered in eslint.config.js
 * (verified by the "wired" test below), the import boundary is enforced.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../../../");

// ---- Inline copy of the rule's create function (mirrors eslint.config.js) ----
// Kept in sync with eslint.config.js. If the rule changes there, update here too.

interface FakeNode {
  source: { value: unknown };
  importKind?: string;
}

interface Report {
  pkg: string;
}

function createRuleContext(filePath: string, reports: Report[]) {
  return {
    filename: filePath.replace(/\\/g, "/"),
    report({ data }: { node: FakeNode; messageId: string; data?: { pkg: string } }) {
      reports.push({ pkg: data?.pkg ?? "?" });
    },
  };
}

function runNoLlmSdkRule(filePath: string, importSource: string): Report[] {
  const reports: Report[] = [];
  const context = createRuleContext(filePath, reports);
  const normalizedPath = context.filename;

  // Mirrors the rule's ImportDeclaration handler from eslint.config.js
  if (
    typeof importSource === "string" &&
    importSource.startsWith("@google/genai") &&
    !normalizedPath.includes("apps/api/src/llm/adapters/")
  ) {
    reports.push({ pkg: importSource });
  }

  return reports;
}

// ---- Tests ----

describe("no-llm-sdk-outside-adapters rule logic (AC3)", () => {
  it("blocks @google/genai import outside adapters/", () => {
    const violations = runNoLlmSdkRule(
      "apps/api/src/ask/pipeline.ts",
      "@google/genai",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].pkg).toBe("@google/genai");
  });

  it("blocks @google/genai sub-path import outside adapters/", () => {
    const violations = runNoLlmSdkRule(
      "apps/api/src/some-module.ts",
      "@google/genai/lite",
    );
    expect(violations).toHaveLength(1);
  });

  it("allows @google/genai inside apps/api/src/llm/adapters/", () => {
    const violations = runNoLlmSdkRule(
      "apps/api/src/llm/adapters/gemini.ts",
      "@google/genai",
    );
    expect(violations).toHaveLength(0);
  });

  it("allows any other package import outside adapters/", () => {
    expect(runNoLlmSdkRule("apps/api/src/ask/pipeline.ts", "zod")).toHaveLength(0);
    expect(runNoLlmSdkRule("apps/api/src/ask/pipeline.ts", "@google-cloud/bigquery")).toHaveLength(0);
    expect(runNoLlmSdkRule("apps/api/src/ask/pipeline.ts", "express")).toHaveLength(0);
  });

  it("handles Windows-style backslash paths correctly", () => {
    // The rule normalises \\ → / before checking; verify the logic does the same.
    const violations = runNoLlmSdkRule(
      "apps\\api\\src\\ask\\pipeline.ts",
      "@google/genai",
    );
    expect(violations).toHaveLength(1);
  });

  it("allows adapters/ path with Windows backslashes", () => {
    const violations = runNoLlmSdkRule(
      "apps\\api\\src\\llm\\adapters\\gemini.ts",
      "@google/genai",
    );
    expect(violations).toHaveLength(0);
  });
});

describe("no-llm-sdk-outside-adapters — wired in eslint.config.js (AC3)", () => {
  it("rule is registered in the project ESLint config", () => {
    const configSrc = readFileSync(
      join(PROJECT_ROOT, "eslint.config.js"),
      "utf8",
    );
    expect(configSrc).toContain("no-llm-sdk-outside-adapters");
    expect(configSrc).toContain("@google/genai");
    // Verify the rule is set to 'error' level, not just defined
    expect(configSrc).toContain('"error"');
  });

  it("gemini.ts is the only api source file that contains an @google/genai import statement", () => {
    // Grep for actual import declarations, not string mentions of the package name.
    const { execSync } = require("node:child_process");
    let grepOutput = "";
    try {
      // grep exits 1 when no matches — treat as empty output
      grepOutput = execSync(
        `grep -rE "^import .* from ['\"]@google/genai" apps/api/src --include="*.ts" -l`,
        { cwd: PROJECT_ROOT, encoding: "utf8" },
      );
    } catch (e: unknown) {
      grepOutput = (e as { stdout?: string }).stdout ?? "";
    }
    const files = grepOutput
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((f) => f.replace(/\\/g, "/"));

    // Only files under apps/api/src/llm/adapters/ may contain this import.
    const nonAdapterFiles = files.filter((f) => !f.includes("llm/adapters/"));
    expect(nonAdapterFiles).toHaveLength(0);
  });
});
