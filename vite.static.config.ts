import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A plain single-page build of the same dashboard, for hosts that serve files and nothing else.
// It writes alongside the vinext output in dist/client and replaces its index.html, so the desk
// server and Firebase Hosting both get a page that boots on its own.
export default defineConfig({
  root: path.resolve("static"),
  publicDir: path.resolve("public"),
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(".") } },
  css: { postcss: path.resolve(".") },
  build: {
    outDir: path.resolve("dist/client"),
    emptyOutDir: false,
    assetsDir: "assets",
    chunkSizeWarningLimit: 1200,
  },
});
