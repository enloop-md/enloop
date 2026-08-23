import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  agentCommandRequestSchema,
  caseContextSchema,
  agentCommandStatusSchema,
  agentQuestionAckSchema,
  agentQuestionFileSchema,
  agentWatcherSchema,
  compareVersionIds,
  parseCaseDocument,
  runFileSchema,
  versionIdFromFileName,
  type AgentCommandRequest,
  type AgentCommandStatus,
  type AgentQuestionAck,
  type AgentQuestionFile,
  type AgentWatcher,
  type CaseContext,
  type RunFile,
  type TestCaseVersion,
} from "@tcm/shared";
import type { ZodType } from "zod";

/**
 * The daemon's half of `FsaDataStore`: the same on-disk layout, read
 * through `node:fs` instead of the File System Access API. Everything is
 * synchronous — one poll tick touches a handful of small files, and a
 * daemon with no reentrancy is a daemon with no reentrancy bugs.
 */

function readJson<T>(file: string, schema: ZodType<T, any, any>): T | null {
  try {
    return schema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

export function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function mtimeSecondsAgo(file: string): number | null {
  try {
    return (Date.now() - statSync(file).mtimeMs) / 1000;
  } catch {
    return null;
  }
}

function dirs(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// ---- questions ----------------------------------------------------------

export interface QuestionDir {
  dir: string;
  question: AgentQuestionFile;
  ack: AgentQuestionAck | null;
  answered: boolean;
}

export function listQuestions(dataDir: string): QuestionDir[] {
  const root = path.join(dataDir, "agent", "questions");
  const out: QuestionDir[] = [];
  for (const name of dirs(root)) {
    const dir = path.join(root, name);
    const question = readJson(path.join(dir, "question.json"), agentQuestionFileSchema);
    if (!question) continue;
    out.push({
      dir,
      question,
      ack: readJson(path.join(dir, "ack.json"), agentQuestionAckSchema),
      answered: existsSync(path.join(dir, "answer.json")),
    });
  }
  return out.sort((a, b) => a.question.id.localeCompare(b.question.id));
}

export function readAck(qDir: string): AgentQuestionAck | null {
  return readJson(path.join(qDir, "ack.json"), agentQuestionAckSchema);
}

export function isAnswered(qDir: string): boolean {
  return existsSync(path.join(qDir, "answer.json"));
}

export function writeAck(qDir: string, questionId: string, watcherId: string): void {
  writeJson(path.join(qDir, "ack.json"), {
    id: questionId,
    pickedUpAt: new Date().toISOString(),
    by: { id: watcherId, kind: "daemon" },
  });
}

export function writeAnswer(
  qDir: string,
  questionId: string,
  markdown: string,
  proposedVersion: string | null,
  summary: string,
): void {
  // answer.md first, answer.json second — the envelope is the completion
  // marker every reader trusts.
  writeFileSync(path.join(qDir, "answer.md"), markdown, "utf8");
  writeJson(path.join(qDir, "answer.json"), {
    id: questionId,
    answeredAt: new Date().toISOString(),
    summary,
    proposedVersion,
  });
}

// ---- commands -----------------------------------------------------------

export interface CommandDir {
  dir: string;
  request: AgentCommandRequest;
  status: AgentCommandStatus | null;
  exited: boolean;
  killRequested: boolean;
}

export function listCommands(dataDir: string): CommandDir[] {
  const root = path.join(dataDir, "agent", "commands");
  const out: CommandDir[] = [];
  for (const name of dirs(root)) {
    const dir = path.join(root, name);
    const request = readJson(path.join(dir, "request.json"), agentCommandRequestSchema);
    if (!request) continue;
    out.push({
      dir,
      request,
      status: readJson(path.join(dir, "status.json"), agentCommandStatusSchema),
      exited: existsSync(path.join(dir, "exit-code")),
      killRequested: existsSync(path.join(dir, "kill")),
    });
  }
  return out.sort((a, b) => a.request.id.localeCompare(b.request.id));
}

export function readStatus(cmdDir: string): AgentCommandStatus | null {
  return readJson(path.join(cmdDir, "status.json"), agentCommandStatusSchema);
}

export function writeStatus(cmdDir: string, status: AgentCommandStatus): void {
  writeJson(path.join(cmdDir, "status.json"), status);
}

export function readExitCode(cmdDir: string): number | null {
  try {
    const n = Number.parseInt(readFileSync(path.join(cmdDir, "exit-code"), "utf8").trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function statusAgeSeconds(cmdDir: string): number | null {
  return mtimeSecondsAgo(path.join(cmdDir, "status.json"));
}

// ---- presence and liveness ----------------------------------------------

export function touchWatcher(dataDir: string, id: string, host: string): void {
  const agentDir = path.join(dataDir, "agent");
  // Presence belongs to a channel in use; never create agent/ ourselves.
  if (!existsSync(agentDir)) return;
  writeJson(path.join(agentDir, "watchers", `${id}.json`), {
    id,
    kind: "daemon",
    host,
    lastSeenAt: new Date().toISOString(),
  } satisfies AgentWatcher);
}

/** Is a claude-code loop provably alive on this folder? Freshness by file
 * mtime — cheap, and immune to a wrong clock inside the file. */
export function freshClaudeCodeWatcher(dataDir: string, maxAgeSeconds: number): boolean {
  const root = path.join(dataDir, "agent", "watchers");
  for (const name of (() => {
    try {
      return readdirSync(root);
    } catch {
      return [];
    }
  })()) {
    const file = path.join(root, name);
    const watcher = readJson(file, agentWatcherSchema);
    if (watcher?.kind !== "claude-code") continue;
    const age = mtimeSecondsAgo(file);
    if (age !== null && age <= maxAgeSeconds) return true;
  }
  return false;
}

/** Seconds since the panel last touched the heartbeat; null = never. */
export function heartbeatAgeSeconds(dataDir: string): number | null {
  return mtimeSecondsAgo(path.join(dataDir, "agent", "heartbeat.json"));
}

// ---- cases and runs ------------------------------------------------------

export function runDir(dataDir: string, testCaseId: string, runId: string): string {
  return path.join(dataDir, "runs", testCaseId, runId);
}

export function readRunFile(dataDir: string, testCaseId: string, runId: string): RunFile | null {
  return readJson(path.join(runDir(dataDir, testCaseId, runId), "run.json"), runFileSchema);
}

export function readFrozenCase(
  dataDir: string,
  testCaseId: string,
  runId: string,
  version: string,
): { raw: string; doc: TestCaseVersion } | null {
  try {
    const raw = readFileSync(path.join(runDir(dataDir, testCaseId, runId), "case.md"), "utf8");
    return { raw, doc: parseCaseDocument(raw, { version, createdAt: new Date().toISOString() }) };
  } catch {
    return null;
  }
}

/** Standalone case dir or one suite level down — `FsaDataStore.findCaseDir`
 * in three lines of `node:fs`. */
export function findCaseDir(dataDir: string, testCaseId: string): string | null {
  const casesRoot = path.join(dataDir, "test-cases");
  const direct = path.join(casesRoot, testCaseId);
  if (existsSync(path.join(direct, "versions"))) return direct;
  for (const name of dirs(casesRoot)) {
    const nested = path.join(casesRoot, name, testCaseId);
    if (existsSync(path.join(nested, "versions"))) return nested;
  }
  return null;
}

export function listVersionIds(caseDir: string): string[] {
  try {
    return readdirSync(path.join(caseDir, "versions"))
      .map((f) => versionIdFromFileName(f))
      .filter((id): id is string => id !== null)
      .sort(compareVersionIds);
  } catch {
    return [];
  }
}

/** Authoring provenance the guard hook stamps beside a case's versions —
 * which session landed the latest one, from which repo, on which machine. */
export function readCaseContext(dataDir: string, testCaseId: string): CaseContext | null {
  const caseDir = findCaseDir(dataDir, testCaseId);
  if (!caseDir) return null;
  return readJson(path.join(caseDir, "context.json"), caseContextSchema);
}

export function latestVersionFile(caseDir: string): { id: string; file: string } | null {
  const ids = listVersionIds(caseDir);
  if (ids.length === 0) return null;
  const id = ids[ids.length - 1];
  return { id, file: path.join(caseDir, "versions", `v${id}.md`) };
}
