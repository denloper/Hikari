import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  publicDir: "public",
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared")
    }
  },
  build: {
    outDir: "out/renderer",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
