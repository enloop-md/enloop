import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentCommandStatus } from "@tcm/shared";
import {
  FRESH_WATCHER_SECONDS,
  HEARTBEAT_STALE_SECONDS,
  ORPHAN_OWNER_STALE_SECONDS,
  RACE_RECHECK_MS,
  type DaemonConfig,
} from "./config.js";
import { log, warn } from "./log.js";
import {
  findCaseDir,
  freshClaudeCodeWatcher,
  heartbeatAgeSeconds,
  latestVersionFile,
  listCommands,
  readExitCode,
  readStatus,
  runDir,
  statusAgeSeconds,
  writeStatus,
  type CommandDir,
} from "./store.js";

/**
 * The deterministic half of serving: provenance, spawn, kill, timeout,
 * heartbeat sweep. No model is involved — this is why `--commands-only`
 * needs no API key. Mirrors serve SKILL §4/§5; the one Node-ism is that
 * `spawn(..., {detached: true})` *is* the setsid: the child becomes its
 * own process-group leader, so `kill(-pid)` reaches everything it started.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function nowIso(): string {
  return new Date().toISOString();
}

/** The exact command string must exist in the run's frozen case.md or the
 * case's latest stored version — the channel runs authored text only. */
function hasProvenance(dataDir: string, cmd: CommandDir): boolean {
  const { testCaseId, runId, command } = cmd.request;
  try {
    const frozen = readFileSync(path.join(runDir(dataDir, testCaseId, runId), "case.md"), "utf8");
    if (frozen.includes(command)) return true;
  } catch {
    // Fall through to the stored versions.
  }
  const caseDir = findCaseDir(dataDir, testCaseId);
  const latest = caseDir && latestVersionFile(caseDir);
  if (!latest) return false;
  try {
    return readFileSync(latest.file, "utf8").includes(command);
  } catch {
    return false;
  }
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function finish(cmd: CommandDir, patch: Partial<AgentCommandStatus>): void {
  const base: AgentCommandStatus = cmd.status ?? {
    state: "running",
    pid: null,
    startedAt: null,
    exitCode: null,
    endedAt: null,
    reason: null,
  };
  writeStatus(cmd.dir, { ...base, ...patch });
}

async function startCommand(dataDir: string, cmd: CommandDir, cfg: DaemonConfig): Promise<void> {
  const { request } = cmd;

  if (cmd.killRequested) {
    // Cancelled before any server saw it — nothing to spawn.
    finish(cmd, { state: "killed", reason: "user", endedAt: nowIso(), owner: cfg.watcherId });
    log(`command ${request.id}: killed before start (user)`);
    return;
  }
  if (!hasProvenance(dataDir, cmd)) {
    finish(cmd, { state: "refused", reason: "provenance", endedAt: nowIso(), owner: cfg.watcherId });
    log(`command ${request.id}: refused (not found in any stored case)`);
    return;
  }

  // Claim before spawning, then re-read: whoever's status.json survives the
  // race owns the command, and on a tie the daemon yields to Claude Code.
  finish(cmd, { state: "running", startedAt: nowIso(), owner: cfg.watcherId });
  await sleep(RACE_RECHECK_MS);
  const afterClaim = readStatus(cmd.dir);
  if (afterClaim?.owner !== cfg.watcherId) {
    log(`command ${request.id}: yielded to ${afterClaim?.owner ?? "another server"}`);
    return;
  }

  const project = caseProject(dataDir, cmd);
  const repo = cfg.repos[project] ?? cfg.repos["*"] ?? Object.values(cfg.repos)[0];
  if (!repo) {
    finish(cmd, { state: "refused", reason: "provenance", endedAt: nowIso(), owner: cfg.watcherId });
    warn(`command ${request.id}: no repo configured to run in (--repo)`);
    return;
  }

  writeFileSync(path.join(cmd.dir, "run.sh"), `${request.command}\n`, "utf8");
  const wrapper =
    `bash ${JSON.stringify(path.join(cmd.dir, "run.sh"))} </dev/null ` +
    `>> ${JSON.stringify(path.join(cmd.dir, "output.log"))} 2>&1; ` +
    `echo $? > ${JSON.stringify(path.join(cmd.dir, "exit-code"))}`;
  const child = spawn("bash", ["-c", wrapper], {
    cwd: repo,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const pid = child.pid ?? null;
  if (pid !== null) writeFileSync(path.join(cmd.dir, "pid"), `${pid}\n`, "utf8");
  finish(cmd, { state: "running", pid, startedAt: nowIso(), owner: cfg.watcherId });
  log(`command ${request.id}: started (pid ${pid}) in ${repo}: ${request.command}`);
}

function caseProject(dataDir: string, cmd: CommandDir): string {
  // `@project` names the repo the command runs in. Read from the frozen
  // case.md's header line — cheap, and correct even for suite-merged runs.
  try {
    const raw = readFileSync(
      path.join(runDir(dataDir, cmd.request.testCaseId, cmd.request.runId), "case.md"),
      "utf8",
    );
    const m = /^@project (.+)$/m.exec(raw);
    return m ? m[1].trim() : "*";
  } catch {
    return "*";
  }
}

function reapOwned(cmd: CommandDir, cfg: DaemonConfig, heartbeatStale: boolean): void {
  const status = cmd.status;
  if (!status || status.state !== "running") return;
  const { request } = cmd;

  const exitCode = readExitCode(cmd.dir);
  if (exitCode !== null) {
    finish(cmd, { state: "exited", exitCode, endedAt: nowIso() });
    log(`command ${request.id}: exited ${exitCode}`);
    return;
  }
  const pid = status.pid;
  if (cmd.killRequested && pid !== null) {
    killGroup(pid);
    finish(cmd, { state: "killed", reason: "user", endedAt: nowIso() });
    log(`command ${request.id}: killed (user)`);
    return;
  }
  if (heartbeatStale && pid !== null) {
    killGroup(pid);
    finish(cmd, { state: "killed", reason: "heartbeat", endedAt: nowIso() });
    log(`command ${request.id}: killed (panel heartbeat stale)`);
    return;
  }
  const t = request.timeoutSeconds;
  if (t > 0 && status.startedAt && Date.now() - Date.parse(status.startedAt) > t * 1000) {
    if (pid !== null && groupAlive(pid)) killGroup(pid);
    finish(cmd, { state: "killed", reason: "timeout", endedAt: nowIso() });
    log(`command ${request.id}: killed (timeout ${t}s)`);
  }
}

/** A `running` command whose owner has gone silent forever must not leave
 * the panel showing "running" until the end of time. The pid belongs to a
 * machine that may not be this one, so this only relabels — long after the
 * hard timeout has passed. */
function reapOrphan(cmd: CommandDir): void {
  const status = cmd.status;
  if (!status || status.state !== "running") return;
  const age = statusAgeSeconds(cmd.dir);
  const t = cmd.request.timeoutSeconds || 900;
  const started = status.startedAt ? Date.now() - Date.parse(status.startedAt) : Infinity;
  if (age !== null && age > ORPHAN_OWNER_STALE_SECONDS && started > (t + ORPHAN_OWNER_STALE_SECONDS) * 1000) {
    finish(cmd, { state: "killed", reason: "orphaned", endedAt: nowIso() });
    log(`command ${cmd.request.id}: marked orphaned (owner ${status.owner ?? "unknown"} silent)`);
  }
}

export async function commandsTick(dataDir: string, cfg: DaemonConfig): Promise<void> {
  const heartbeatAge = heartbeatAgeSeconds(dataDir);
  const heartbeatStale =
    cfg.heartbeatKill && (heartbeatAge === null || heartbeatAge > HEARTBEAT_STALE_SECONDS);

  for (const cmd of listCommands(dataDir)) {
    if (cmd.status === null) {
      // New request. With a live Claude Code loop, leave it a defer window —
      // it may hold context that matters even for a command.
      const age = (Date.now() - Date.parse(cmd.request.requestedAt)) / 1000;
      if (
        freshClaudeCodeWatcher(dataDir, FRESH_WATCHER_SECONDS) &&
        age < cfg.deferSeconds &&
        !cmd.killRequested
      ) {
        continue;
      }
      await startCommand(dataDir, cmd, cfg);
      continue;
    }
    if (cmd.status.owner === cfg.watcherId) reapOwned(cmd, cfg, heartbeatStale);
    else reapOrphan(cmd);
  }
}
