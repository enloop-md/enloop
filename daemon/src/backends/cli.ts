import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { BackendResult } from "./api.js";

const execFileP = promisify(execFile);

/**
 * Headless CLI backends: drive an installed Claude Code or Codex per
 * question. Read-only by design — the brief tells the model its output IS
 * the answer, the daemon writes the files, and no patch is landed (that
 * needs the api backend's validated tool, or a real serve loop). Whatever
 * auth the CLI already has is the auth; no key ever touches the daemon.
 *
 * Claude Code runs with `--output-format stream-json`, so every tool it
 * uses on the way to the answer becomes a progress line for the tester —
 * "Reading ResetForm.tsx", "Searching for \"Send link\"" — and any
 * sentence it says between tools is passed on in its own words. Codex is
 * driven the plain way and reports only that it is working.
 */
export async function answerViaCli(opts: {
  kind: "claude-code" | "codex";
  brief: string;
  repo: string;
  extraArgs: string[];
  /** Extra environment for the spawned CLI — most importantly
   * CLAUDE_CONFIG_DIR, so a resume finds the authoring session in the
   * config dir it actually lives in (and uses that dir's login). */
  env?: Record<string, string>;
  timeoutMs?: number;
  /** One short line whenever the work changes shape; see api.ts. */
  onProgress?: (text: string) => void;
}): Promise<BackendResult> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;

  if (opts.kind === "codex") {
    opts.onProgress?.("Reading the app source with Codex");
    const { stdout } = await execFileP("codex", ["exec", ...opts.extraArgs, opts.brief], {
      cwd: opts.repo,
      env,
      timeout: timeoutMs,
      maxBuffer: 8_000_000,
    });
    const markdown = stdout.trim();
    if (!markdown) throw new Error("codex produced no output");
    return { markdown, proposedVersion: null };
  }

  return new Promise<BackendResult>((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", "--output-format", "stream-json", "--verbose", ...opts.extraArgs, opts.brief],
      { cwd: opts.repo, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let buffered = "";
    let lastAssistantText = "";
    let result: string | null = null;
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    const onLine = (line: string) => {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return; // Not every line is an event; the CLI may print noise.
      }
      if (event?.type === "assistant") {
        for (const block of event.message?.content ?? []) {
          if (block?.type === "tool_use") {
            opts.onProgress?.(describeToolUse(block.name, block.input, opts.repo));
          } else if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
            // Narration between tools is the model's own status; the final
            // answer also passes through here, and is superseded by the
            // answer file within the same second.
            lastAssistantText = block.text.trim();
            opts.onProgress?.(firstSentence(lastAssistantText));
          }
        }
      } else if (event?.type === "result") {
        if (event.is_error) {
          reject(new Error(String(event.result ?? event.error ?? "claude reported an error")));
        } else if (typeof event.result === "string" && event.result.trim()) {
          result = event.result.trim();
        }
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffered += chunk;
      let nl: number;
      while ((nl = buffered.indexOf("\n")) !== -1) {
        onLine(buffered.slice(0, nl));
        buffered = buffered.slice(nl + 1);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buffered.trim()) onLine(buffered);
      const markdown = result ?? lastAssistantText;
      if (code !== 0 && !markdown) {
        reject(new Error(`claude exited with ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
      } else if (!markdown) {
        reject(new Error("claude produced no answer text"));
      } else {
        resolve({ markdown, proposedVersion: null });
      }
    });
  });
}

/** A Claude Code tool call as a line the tester can read: what is being
 * looked at, not which tool is looking. Paths are shown relative to the
 * repo. Unknown tools fall back to their name. */
function describeToolUse(name: string, input: any, repo: string): string {
  const rel = (p: unknown): string => {
    if (typeof p !== "string" || !p) return "a file";
    const abs = path.resolve(repo, p);
    return abs.startsWith(repo + path.sep) ? path.relative(repo, abs) : path.basename(abs);
  };
  const short = (v: unknown, n = 60): string =>
    typeof v === "string" ? v.replace(/\s+/g, " ").slice(0, n) : "";
  switch (name) {
    case "Read":
      return `Reading ${rel(input?.file_path)}`;
    case "Grep":
      return `Searching for "${short(input?.pattern)}"${input?.path ? ` in ${rel(input.path)}` : ""}`;
    case "Glob":
      return `Looking for files matching ${short(input?.pattern)}`;
    case "LS":
    case "ListDir":
      return `Looking through ${rel(input?.path)}`;
    case "Bash":
      return `Running: ${short(input?.command, 70)}`;
    case "Edit":
    case "Write":
    case "MultiEdit":
      return `Editing ${rel(input?.file_path)}`;
    case "WebFetch":
    case "WebSearch":
      return "Looking something up on the web";
    case "Task":
    case "Agent":
      return `Delegating: ${short(input?.description ?? input?.prompt, 60)}`;
    default:
      return `Using ${name}`;
  }
}

/** The first sentence of a passage, trimmed to a status line. */
function firstSentence(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  const cut = line.replace(/^[#>*\-\s]+/, "").split(/(?<=[.!?])\s/)[0];
  return cut.length > 120 ? cut.slice(0, 117) + "…" : cut;
}
