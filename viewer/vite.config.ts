import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the same build works at the root of a domain,
  // at /enloop/ on GitHub Pages, and from a file:// path when someone wants
  // to check a build before it ships.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
