import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Design tokens — see docs/ui-ux-spec.md
        primary: {
          DEFAULT: "#1E3A6E", // navy
          50: "#eef2f9",
          100: "#d5e0f0",
          200: "#abc1e1",
          300: "#82a2d2",
          400: "#5883c3",
          500: "#1E3A6E",
          600: "#1a3361",
          700: "#162c54",
          800: "#112547",
          900: "#0d1e3a",
        },
        accent: {
          DEFAULT: "#0EA5A0", // teal
          50: "#e6f8f8",
          100: "#ccf1f0",
          200: "#99e3e1",
          300: "#66d5d2",
          400: "#33c7c3",
          500: "#0EA5A0",
          600: "#0c9490",
          700: "#0a8380",
          800: "#087270",
          900: "#066160",
        },
      },
    },
  },
  plugins: [],
};

export default config;
