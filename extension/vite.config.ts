import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.js";

export default defineConfig({
  // The manifest version only changes when someone remembers to bump it, so
  // on its own it cannot answer "did my reload pick up this build?" — which
  // is the actual question. This stamp changes every build and answers it
  // outright.
  //
  // Deliberately no git commit alongside it: reading one needs `node:*`
  // typings, and this config is typechecked with the browser tsconfig, so it
  // would cost @types/node plus a second tsconfig to report something the
  // timestamp already settles.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react(), tailwindcss(), crx({ manifest })],
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
});
