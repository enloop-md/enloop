import { defineConfig } from "vite";

/**
 * One self-contained ESM file, same story as the plugin's `lib.mjs`:
 * `@tcm/shared` ships as TypeScript source, so anything that wants to run
 * under plain `node` has to bundle it. The Anthropic SDK stays external —
 * it is a real runtime dependency of the `api` backend, installed next to
 * the daemon; the CLI backends and `--commands-only` never load it.
 */
export default defineConfig({
  build: {
    ssr: true,
    target: "node20",
    outDir: "dist",
    minify: false,
    rollupOptions: {
      input: "src/cli.ts",
      output: {
        entryFileNames: "enloopd.mjs",
        banner: "#!/usr/bin/env node",
      },
      external: [/^node:/, "@anthropic-ai/sdk", /^@anthropic-ai\/sdk\//],
    },
  },
  ssr: {
    noExternal: ["@tcm/shared", "zod"],
  },
});
