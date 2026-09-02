import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { z } from "zod";


export type BackendKind = "api" | "claude-code" | "codex";

/** Flags > `enloopd.json` in the working directory > defaults. The config
 * file never holds a secret — keys live in the environment, the `ant`
 * profile store, or the CLIs' own auth stores. */
const configFileSchema = z.object({
  dataDirs: z.array(z.string()).optional(),
  /** `@project` name → app repo root; `"*"` is the fallback for cases whose
   * project has no entry (and for cases that declare none). */
  repos: z.record(z.string(), z.string()).optional(),
  backend: z.enum(["auto", "api", "claude-code", "codex"]).optional(),
  model: z.string().optional(),
  deferSeconds: z.number().int().positive().optional(),
  pollSeconds: z.number().int().positive().optional(),
  commandsOnly: z.boolean().optional(),
  noCommands: z.boolean().optional(),
  noPatch: z.boolean().optional(),
  /** Off for synced/shared folders, where the panel heartbeat arrives late
   * and would kill healthy servers. */
  heartbeatKill: z.boolean().optional(),
  /** Answer by resuming the authoring session recorded in the case's
   * context.json (claude -p --resume --fork-session) when the host
   * matches. The context a looping serve session used to exist for,
   * recovered per question. */
  resumeAuthorSession: z.boolean().optional(),
  /** Extra argv for the CLI backends, e.g. permission flags for
   * `claude -p`. */
  cliArgs: z.object({ claude: z.array(z.string()).optional(), codex: z.array(z.string()).optional() }).optional(),
  /** Data folder → that project's CLAUDE_CONFIG_DIR, for fresh claude-code
   * runs on cases without a context stamp. Resumes carry their own config
   * dir from context.json and never need this. */
  claudeConfigDirs: z.record(z.string(), z.string()).optional(),
});

export interface DaemonConfig {
  dataDirs: string[];
  repos: Record<string, string>;
  backend: "auto" | BackendKind;
  model: string;
  deferSeconds: number;
  pollSeconds: number;
  commandsOnly: boolean;
  noCommands: boolean;
  noPatch: boolean;
  heartbeatKill: boolean;
  resumeAuthorSession: boolean;
  once: boolean;
  cliArgs: { claude: string[]; codex: string[] };
  claudeConfigDirs: Record<string, string>;
  /** This host's watcher identity — stable across restarts (see below). */
  watcherId: string;
  host: string;
}

export const CONFIG_FILE = "enloopd.json";
/** Keep in step with daemon/package.json — baked in, since the bundle
 * runs far from its package.json. */
export const DAEMON_VERSION = "0.1.0";
/** A claude-code watcher seen within this window is alive; see PLAN-DAEMON §3. */
export const FRESH_WATCHER_SECONDS = 180;
export const HEARTBEAT_STALE_SECONDS = 300;
/** How long the daemon re-checks its own ack/claim before trusting it. */
export const RACE_RECHECK_MS = 2000;
export const ORPHAN_OWNER_STALE_SECONDS = 600;

export function loadConfig(argv: string[]): DaemonConfig {
  const fileRaw = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, "utf8") : null;
  const file = fileRaw ? configFileSchema.parse(JSON.parse(fileRaw)) : {};

  const dataDirs = [...(file.dataDirs ?? [])];
  const repos: Record<string, string> = { ...(file.repos ?? {}) };
  let backend = file.backend ?? "auto";
  let model = file.model ?? "claude-opus-5";
  let deferSeconds = file.deferSeconds ?? 150;
  let pollSeconds = file.pollSeconds ?? 5;
  let commandsOnly = file.commandsOnly ?? false;
  let noCommands = file.noCommands ?? false;
  let noPatch = file.noPatch ?? false;
  let heartbeatKill = file.heartbeatKill ?? true;
  let resumeAuthorSession = file.resumeAuthorSession ?? true;
  let once = false;

  const take = (i: number): string => {
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`${argv[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--data":
        dataDirs.push(path.resolve(take(i++)));
        break;
      case "--repo": {
        // `--repo <path>` (the fallback repo) or `--repo <project>=<path>`.
        const v = take(i++);
        const eq = v.indexOf("=");
        if (eq === -1) repos["*"] = path.resolve(v);
        else repos[v.slice(0, eq)] = path.resolve(v.slice(eq + 1));
        break;
      }
      case "--backend":
        backend = z.enum(["auto", "api", "claude-code", "codex"]).parse(take(i++));
        break;
      case "--model":
        model = take(i++);
        break;
      case "--defer-seconds":
        deferSeconds = Number(take(i++));
        break;
      case "--poll-seconds":
        pollSeconds = Number(take(i++));
        break;
      case "--commands-only":
        commandsOnly = true;
        break;
      case "--no-commands":
        noCommands = true;
        break;
      case "--no-patch":
        noPatch = true;
        break;
      case "--no-heartbeat-kill":
        heartbeatKill = false;
        break;
      case "--no-resume":
        resumeAuthorSession = false;
        break;
      case "--once":
        once = true;
        break;
      default:
        throw new Error(`Unknown flag ${argv[i]} — see enloopd --help`);
    }
  }

  if (dataDirs.length === 0) {
    throw new Error("No data folder. Pass --data <folder>, or run `enloopd setup`.");
  }
  const host = hostname();
  return {
    dataDirs: dataDirs.map((d) => path.resolve(d)),
    repos,
    backend,
    model,
    deferSeconds,
    pollSeconds,
    commandsOnly,
    noCommands,
    noPatch,
    heartbeatKill,
    resumeAuthorSession,
    once,
    cliArgs: { claude: file.cliArgs?.claude ?? [], codex: file.cliArgs?.codex ?? [] },
    claudeConfigDirs: Object.fromEntries(
      Object.entries(file.claudeConfigDirs ?? {}).map(([k, v]) => [path.resolve(k), v]),
    ),
    // Stable per host, deliberately not per process: command ownership must
    // survive a daemon restart (and `--once` under cron is nothing but
    // restarts), or nobody ever reaps what the previous run spawned.
    watcherId: `enloopd-${host}`,
    host,
  };
}

export const HELP = `enloopd — answers the Enloop extension's mid-run questions and runs its
commands, with no active session to keep open. The answering is still an
LLM's — the Claude API, or an installed Claude Code / Codex driven
headlessly — and when a case carries authoring provenance (context.json,
stamped by the plugin's guard hook), questions are answered by resuming
the very session that wrote the case, forked so that session stays clean.
A manual /enloop:serve pass in Claude Code still works alongside; while
one is fresh this daemon defers to it.

Usage:
  enloopd setup                      interactive backend + auth + config wizard
  enloopd --data <folder> --repo <path> [flags]

Flags:
  --data <folder>          data folder the extension is connected to (repeatable)
  --repo <path>            app repo answers come from; --repo <project>=<path>
                           maps a case's @project to its repo (repeatable)
  --backend <kind>         auto | api | claude-code | codex   (default auto)
  --model <id>             model for the api backend (default claude-opus-5)
  --defer-seconds <n>      how long to leave questions to a live Claude Code
                           loop before taking them (default 150)
  --poll-seconds <n>       folder poll interval (default 5)
  --commands-only          run commands, never answer questions (no key needed)
  --no-commands            answer questions, never run commands
  --no-patch               answer, but never land patch versions
  --no-heartbeat-kill      for synced folders: never kill on a stale heartbeat
  --no-resume              never resume the authoring session recorded in a
                           case's context.json; always use the backend fresh
  --once                   one pass instead of a loop (cron-friendly)

Config: enloopd.json in the working directory holds the same options
(written by \`enloopd setup\`); flags override it. No secrets are stored —
the api backend resolves ANTHROPIC_API_KEY or an \`ant auth login\` profile,
and the CLI backends use claude's / codex's own auth.
`;
