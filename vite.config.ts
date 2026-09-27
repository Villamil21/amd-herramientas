/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const unused = fileURLToPath(new URL("./src/utils/unused-optional-dep.ts", import.meta.url));

// Configuración pensada para Tauri en macOS: puerto fijo y sin abrir navegador.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { html2canvas: unused, canvg: unused, dompurify: unused },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // WKWebView de macOS 11+ soporta Safari 14+.
    target: "safari14",
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
