// @ts-check
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";

/**
 * Custom rule: LLM provider SDK imports are restricted to the adapters directory.
 * Full enforcement: only @google/genai is blocked outside apps/api/src/llm/adapters/.
 */
const noLlmSdkOutsideAdapters = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing @google/genai outside apps/api/src/llm/adapters/",
    },
    schema: [],
    messages: {
      forbidden:
        "Import of '{{pkg}}' is only permitted inside apps/api/src/llm/adapters/. Move provider-specific code there.",
    },
  },
  create(context) {
    const filePath = context.filename.replace(/\\/g, "/");
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (
          typeof source === "string" &&
          source.startsWith("@google/genai") &&
          !filePath.includes("apps/api/src/llm/adapters/")
        ) {
          context.report({
            node,
            messageId: "forbidden",
            data: { pkg: source },
          });
        }
      },
    };
  },
};

const localRulesPlugin = {
  rules: { "no-llm-sdk-outside-adapters": noLlmSdkOutsideAdapters },
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  // Node.js files (API)
  {
    files: ["apps/api/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "local-rules": localRulesPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "local-rules/no-llm-sdk-outside-adapters": "error",
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Browser files (web SPA)
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "local-rules": localRulesPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "local-rules/no-llm-sdk-outside-adapters": "error",
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // Shared packages (both environments)
  {
    files: ["packages/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "local-rules": localRulesPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "local-rules/no-llm-sdk-outside-adapters": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
