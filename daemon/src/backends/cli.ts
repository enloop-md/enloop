import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BackendResult } from "./api.js";

const execFileP = promisify(execFile);

/**
 * Headless CLI backends: drive an installed Claude Code or Codex per
 * question. Read-only by design — the brief tells the model its stdout IS
 * the answer, the daemon writes the files, and no patch is landed (that
 * needs the api backend's validated tool, or a real serve loop). Whatever
 * auth the CLI already has is the auth; no key ever touches the daemon.
 */
export async function answerViaCli(opts: {
  kind: "claude-code" | "codex";
  brief: string;
  repo: string;
  extraArgs: string[];
  timeoutMs?: number;
}): Promise<BackendResult> {
  const [bin, args] =
    opts.kind === "claude-code"
      ? ["claude", ["-p", ...opts.extraArgs, opts.brief]]
      : ["codex", ["exec", ...opts.extraArgs, opts.brief]];
  const { stdout } = await execFileP(bin, args, {
    cwd: opts.repo,
    timeout: opts.timeoutMs ?? 10 * 60 * 1000,
    maxBuffer: 8_000_000,
  });
  const markdown = stdout.trim();
  if (!markdown) throw new Error(`${bin} produced no output`);
  return { markdown, proposedVersion: null };
}
