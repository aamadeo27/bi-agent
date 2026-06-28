/**
 * Tests for the `no-llm-sdk-outside-adapters` ESLint custom rule (AC3).
 *
 * Uses the real ESLint API (`ESLint.lintText`) which loads the project's
 * actual `eslint.config.js` — so these tests exercise the real rule, not
 * a hand-rolled copy.  If the rule is removed or reconfigured in the config,
 * these tests break.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../../../");

const RULE_ID = "local-rules/no-llm-sdk-outside-adapters";

// Helper — run the real ESLint config against a code snippet at a virtual filePath.
async function lint(code: string, virtualPath: string) {
  const eslint = new ESLint({ cwd: PROJECT_ROOT });
  const [result] = await eslint.lintText(code, {
    filePath: join(PROJECT_ROOT, virtualPath),
  });
  return result.messages;
}

describe("no-llm-sdk-outside-adapters — real ESLint enforcement (AC3)", () => {
  it("flags @google/genai import outside adapters/", async () => {
    const messages = await lint(
      `import { GoogleGenAI } from "@google/genai";\n`,
      "apps/api/src/ask/pipeline.ts",
    );
    const violation = messages.find((m) => m.ruleId === RULE_ID);
    expect(violation, "Expected rule to report an error but found none").toBeDefined();
    expect(violation?.severity).toBe(2); // 2 = error
  });

  it("flags @google/genai sub-path import outside adapters/", async () => {
    const messages = await lint(
      `import something from "@google/genai/lite";\n`,
      "apps/api/src/some-module.ts",
    );
    const violation = messages.find((m) => m.ruleId === RULE_ID);
    expect(violation).toBeDefined();
  });

  it("allows @google/genai import inside adapters/", async () => {
    const messages = await lint(
      `import { GoogleGenAI } from "@google/genai";\n`,
      "apps/api/src/llm/adapters/gemini.ts",
    );
    const violations = messages.filter((m) => m.ruleId === RULE_ID);
    expect(violations).toHaveLength(0);
  });

  it("does not flag other packages outside adapters/", async () => {
    const messages = await lint(
      `import { z } from "zod";\nimport express from "express";\n`,
      "apps/api/src/ask/pipeline.ts",
    );
    const violations = messages.filter((m) => m.ruleId === RULE_ID);
    expect(violations).toHaveLength(0);
  });
});

describe("no-llm-sdk-outside-adapters — wired in eslint.config.js (AC3)", () => {
  it("rule is registered at 'error' severity for all api .ts files", () => {
    const configSrc = readFileSync(
      join(PROJECT_ROOT, "eslint.config.js"),
      "utf8",
    );
    expect(configSrc).toContain("no-llm-sdk-outside-adapters");
    // Tightened: assert the exact rule-name + severity pair, not loose string presence.
    expect(configSrc).toMatch(
      /"local-rules\/no-llm-sdk-outside-adapters":\s*"error"/,
    );
  });

  it("only files under llm/adapters/ contain a @google/genai import statement", () => {
    let grepOutput = "";
    try {
      // grep exits 1 when no matches — treat stderr as empty output
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
