import type { Config } from "tailwindcss";

// Design tokens from docs/ui-ux-spec.md §1-3
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // §1 Base palette
        primary: {
          DEFAULT: "#1E3A6E",
          50: "#EEF4FD",
          200: "#C2D5F5",
          500: "#3B72CC",
          600: "#2554A0",
          700: "#1E3A6E",
          800: "#172A4E",
          900: "#0F1C35",
        },
        accent: {
          DEFAULT: "#0EA5A0",
          100: "#D0F5F4",
          400: "#14C4BE",
          500: "#0EA5A0",
        },
        neutral: {
          50: "#F9FAFB",
          100: "#F3F4F6",
          300: "#D1D5DB",
          500: "#6B7280",
          700: "#374151",
          900: "#111827",
        },
        semantic: {
          success: "#16A34A",
          warning: "#D97706",
          error: "#DC2626",
          info: "#2563EB",
        },
        // §1 Chart categorical palette (8 series, deuteranopia-safe first 4)
        chart: {
          "cat-1": "#3B72CC",
          "cat-2": "#E07B39",
          "cat-3": "#0EA5A0",
          "cat-4": "#B447B2",
          "cat-5": "#E8C832",
          "cat-6": "#D94F4F",
          "cat-7": "#5DB76E",
          "cat-8": "#7B61A8",
        },
      },
      // §2 Typography scale
      fontFamily: {
        sans: ['"Inter"', '"Segoe UI"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', '"Consolas"', "monospace"],
      },
      fontSize: {
        display: ["1.75rem", { lineHeight: "1.2", fontWeight: "700" }],
        "heading-1": ["1.375rem", { lineHeight: "1.3", fontWeight: "600" }],
        "heading-2": ["1.125rem", { lineHeight: "1.4", fontWeight: "600" }],
        "heading-3": ["0.9375rem", { lineHeight: "1.4", fontWeight: "600" }],
        "body-lg": ["1rem", { lineHeight: "1.6", fontWeight: "400" }],
        body: ["0.875rem", { lineHeight: "1.6", fontWeight: "400" }],
        "body-sm": ["0.8125rem", { lineHeight: "1.5", fontWeight: "400" }],
        mono: ["0.8125rem", { lineHeight: "1.6", fontWeight: "400" }],
        label: ["0.6875rem", { lineHeight: "1.4", fontWeight: "600" }],
      },
      // §3 Border radius tokens
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        full: "9999px",
      },
    },
  },
  plugins: [],
};

export default config;
