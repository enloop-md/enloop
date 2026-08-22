import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { CONFIG_FILE } from "./config.js";

/**
 * The one interactive command, safe to re-run. Ends with a working
 * `enloopd.json` and no secret stored by enloopd itself — auth is
 * delegated to each backend's own login and lives where it already lives.
 */

function has(bin: string): boolean {
  return spawnSync("which", [bin], { stdio: "ignore" }).status === 0;
}

function antProfileActive(): boolean {
  if (!has("ant")) return false;
  const r = spawnSync("ant", ["auth", "status"], { encoding: "utf8" });
  return r.status === 0 && !/no active/i.test(r.stdout + r.stderr);
}

export async function runSetup(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q: string, fallback = ""): Promise<string> =>
    ((await rl.question(`${q}${fallback ? ` [${fallback}]` : ""}: `)).trim() || fallback);

  console.log("enloopd setup — pick a backend, point at your folders, done.\n");

  // 1. What the machine has.
  const claude = has("claude");
  const codex = has("codex");
  const apiKey = !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN;
  const antAuth = antProfileActive();
  console.log(`detected:  claude ${claude ? "yes" : "no"} · codex ${codex ? "yes" : "no"} · ` +
    `ANTHROPIC_API_KEY ${apiKey ? "set" : "unset"} · ant profile ${antAuth ? "active" : "none"}\n`);

  // 2. Offer the viable backends, best first.
  const options: Array<{ key: string; label: string; viable: boolean }> = [
    {
      key: "claude-code",
      label: "claude-code — headless `claude -p`; uses Claude Code's own auth (subscription or key)",
      viable: claude,
    },
    { key: "api", label: "api — Claude API directly; needs ANTHROPIC_API_KEY or `ant auth login`", viable: apiKey || antAuth || true },
    { key: "codex", label: "codex — headless `codex exec`; uses Codex's own auth", viable: codex },
    { key: "commands-only", label: "commands-only — run case commands, never answer (no model, no key)", viable: true },
  ];
  console.log("backends:");
  for (const o of options) console.log(`  ${o.viable ? " " : "✗"} ${o.key.padEnd(14)} ${o.label}`);
  const recommended = claude ? "claude-code" : apiKey || antAuth ? "api" : codex ? "codex" : "commands-only";
  const backend = await ask("\nbackend", recommended);

  // 3. Auth, delegated.
  if (backend === "api" && !apiKey && !antAuth) {
    console.log(
      "\nNo Anthropic credential found. Either:\n" +
        "  - run `ant auth login` (stores a profile the SDK reads automatically), or\n" +
        "  - export ANTHROPIC_API_KEY in your shell profile.\n" +
        "Re-run `enloopd setup` after — nothing is stored in enloopd.json.",
    );
  }
  if (backend === "claude-code" && !claude) {
    console.log("\n`claude` is not on PATH — install Claude Code first, then log in with it once.");
  }
  if (backend === "codex" && !codex) {
    console.log("\n`codex` is not on PATH — install Codex first, then `codex login` once.");
  }

  // 4. Folders.
  const data = await ask("data folder (the one the extension is connected to)");
  const repo = await ask("app repo the answers come from");
  const model = backend === "api" ? await ask("model", "claude-opus-5") : "claude-opus-5";

  const config = {
    dataDirs: data ? [path.resolve(data)] : [],
    repos: repo ? { "*": path.resolve(repo) } : {},
    backend: backend === "commands-only" ? "auto" : backend,
    commandsOnly: backend === "commands-only",
    model,
  };
  const existing = existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, "utf8")) : {};
  writeFileSync(CONFIG_FILE, `${JSON.stringify({ ...existing, ...config }, null, 2)}\n`, "utf8");
  console.log(`\nwrote ${CONFIG_FILE} (no secrets in it). Next:\n  enloopd\n`);
  rl.close();
}
