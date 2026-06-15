import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env["VITE_API_URL"] ?? "http://localhost:3000",
        changeOrigin: true,
        // API routes have no /api prefix (e.g. /health, /auth/...) — strip it here
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
