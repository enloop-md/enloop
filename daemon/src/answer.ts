import { spawnSync } from "node:child_process";
import { buildBrief } from "./brief.js";
import {
  FRESH_WATCHER_SECONDS,
  RACE_RECHECK_MS,
  type BackendKind,
  type DaemonConfig,
} from "./config.js";
import { log, warn } from "./log.js";
import { answerViaApi, type BackendResult } from "./backends/api.js";
import { answerViaCli } from "./backends/cli.js";
import {
  freshClaudeCodeWatcher,
  isAnswered,
  isWithdrawn,
  listQuestions,
  readAck,
  readCaseContext,
  readFrozenCase,
  readRunFile,
  runDir,
  writeAck,
  writeAnswer,
  writeProgress,
  type QuestionDir,
} from "./store.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How often an answer in flight looks for the tester's `withdrawn` flag.
 * A few seconds of extra thinking after a withdrawal cost nothing; the
 * flag is what makes a wrong paste a two-second mistake instead of a
 * ten-minute one. */
const WITHDRAWN_POLL_MS = 2000;

function binExists(bin: string): boolean {
  return spawnSync("which", [bin], { stdio: "ignore" }).status === 0;
}

export function resolveBackend(cfg: DaemonConfig): BackendKind | null {
  if (cfg.backend !== "auto") return cfg.backend;
  // An installed Claude Code usually means a subscription already paid for,
  // so it outranks a raw API key; codex is the fallback.
  if (binExists("claude")) return "claude-code";
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "api";
  if (binExists("codex")) return "codex";
  return null;
}

/**
 * §3 of PLAN-DAEMON, verbatim: defer while a Claude Code loop is provably
 * alive (with a fallback clock so a wedged loop cannot starve a tester),
 * always yield on an ack race, and never write over a finished answer.
 */
function shouldDefer(dataDir: string, q: QuestionDir, cfg: DaemonConfig): boolean {
  if (!freshClaudeCodeWatcher(dataDir, FRESH_WATCHER_SECONDS)) return false;
  const ageSeconds = (Date.now() - Date.parse(q.question.askedAt)) / 1000;
  return ageSeconds < cfg.deferSeconds;
}

async function answerOne(
  dataDir: string,
  q: QuestionDir,
  backend: BackendKind,
  cfg: DaemonConfig,
): Promise<void> {
  const { question } = q;

  // Claim: ack, then re-read — on a race the daemon always yields.
  writeAck(q.dir, question.id, cfg.watcherId);
  await sleep(RACE_RECHECK_MS);
  const ack = readAck(q.dir);
  if (ack?.by?.id !== cfg.watcherId) {
    log(`question ${question.id}: yielded to ${ack?.by?.id ?? "another server"}`);
    return;
  }

  // From here until the answer lands the tester sees whatever was last
  // written here. Each backend keeps it moving; this first line covers
  // the seconds before one starts.
  const onProgress = (text: string) => {
    if (readAck(q.dir)?.by?.id !== cfg.watcherId) return; // not ours to narrate
    writeProgress(q.dir, question.id, text);
  };
  onProgress("Reading the question, the case as run, and where the run stands");

  // The tester can take the question back at any point — the flag is
  // polled for the whole answer, and every backend stops on the signal:
  // the CLI child is killed, the API tool loop abandons its next call.
  const withdrawal = new AbortController();
  const withdrawnPoll = setInterval(() => {
    if (isWithdrawn(q.dir)) withdrawal.abort();
  }, WITHDRAWN_POLL_MS);
  try {
    await answerClaimed(dataDir, q, backend, cfg, onProgress, withdrawal.signal);
  } finally {
    clearInterval(withdrawnPoll);
  }
}

async function answerClaimed(
  dataDir: string,
  q: QuestionDir,
  backend: BackendKind,
  cfg: DaemonConfig,
  onProgress: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const { question } = q;

  const runFile = readRunFile(dataDir, question.testCaseId, question.runId);
  const frozen = readFrozenCase(
    dataDir,
    question.testCaseId,
    question.runId,
    runFile?.testCaseVersion ?? question.testCaseVersion,
  );
  const project = frozen?.doc.project || "*";
  const repo = cfg.repos[project] ?? cfg.repos["*"] ?? Object.values(cfg.repos)[0];
  if (!repo) {
    warn(`question ${question.id}: no repo configured (--repo); cannot answer`);
    return;
  }

  const canPatch = backend === "api" && !cfg.noPatch;
  const brief = buildBrief({
    question,
    qDir: q.dir,
    runDirPath: runDir(dataDir, question.testCaseId, question.runId),
    repo,
    doc: frozen?.doc ?? null,
    runFile,
    canPatch,
    // The api backend hands the model a `progress` tool; a CLI backend's
    // model has only its files, so it is told which file to write.
    progress: backend === "api" ? "tool" : "file",
  });

  // The attempt chain: the authoring session first — context.json names
  // the session that wrote the case, and resuming it (forked, so the real
  // session stays clean) recovers exactly the context a looping serve
  // session used to exist for — then the configured backend fresh.
  const attempts: Array<{ label: string; run: () => Promise<BackendResult> }> = [];
  const context = cfg.resumeAuthorSession ? readCaseContext(dataDir, question.testCaseId) : null;
  if (context && context.host === cfg.host && binExists("claude")) {
    attempts.push({
      label: `resume ${context.sessionId.slice(0, 8)}…`,
      run: () =>
        answerViaCli({
          kind: "claude-code",
          brief,
          repo: context.cwd || repo,
          extraArgs: ["--resume", context.sessionId, "--fork-session", ...cfg.cliArgs.claude],
          onProgress,
          signal,
          // The session lives in (and logs in from) its own config dir —
          // essential when several isolated CLAUDE_CONFIG_DIRs share one
          // machine and one daemon.
          env: context.claudeConfigDir ? { CLAUDE_CONFIG_DIR: context.claudeConfigDir } : undefined,
        }),
    });
  }
  attempts.push({
    label: backend,
    run: () =>
      backend === "api"
        ? answerViaApi({
            brief,
            qDir: q.dir,
            repo,
            dataDir,
            testCaseId: question.testCaseId,
            model: cfg.model,
            canPatch,
            onProgress,
            signal,
          })
        : answerViaCli({
            kind: backend,
            brief,
            repo,
            extraArgs: backend === "claude-code" ? cfg.cliArgs.claude : cfg.cliArgs.codex,
            onProgress,
            signal,
            env:
              backend === "claude-code" && cfg.claudeConfigDirs[dataDir]
                ? { CLAUDE_CONFIG_DIR: cfg.claudeConfigDirs[dataDir] }
                : undefined,
          }),
  });

  let result: BackendResult | null = null;
  for (const attempt of attempts) {
    if (signal.aborted) break;
    log(`question ${question.id}: answering via ${attempt.label} (repo ${repo})`);
    onProgress("Looking through the app's source for the answer");
    try {
      result = await attempt.run();
      break;
    } catch (e) {
      if (signal.aborted) break;
      warn(`question ${question.id}: ${attempt.label} failed — ${e instanceof Error ? e.message : e}`);
    }
  }
  // Withdrawn: the tester no longer wants this answered, so nothing is
  // written — not even a late result — and the ack stays as the record
  // of who had it. The tick skips withdrawn questions, so no retry.
  if (signal.aborted || isWithdrawn(q.dir)) {
    log(`question ${question.id}: withdrawn by the tester; stopped`);
    return;
  }
  if (result === null) return; // The ack stands; the next pass retries.

  // Terminality: a complete answer is never overwritten, and a stolen ack
  // means the thief is answering — discard ours.
  if (isAnswered(q.dir)) {
    log(`question ${question.id}: another server answered first; discarding`);
    return;
  }
  if (readAck(q.dir)?.by?.id !== cfg.watcherId) {
    log(`question ${question.id}: ack taken over; discarding`);
    return;
  }
  const summary = result.markdown.split("\n")[0].slice(0, 200);
  onProgress("Writing the answer");
  writeAnswer(q.dir, question.id, result.markdown, result.proposedVersion, summary);
  log(
    `question ${question.id}: answered` +
      (result.proposedVersion ? ` (proposed v${result.proposedVersion})` : ""),
  );
}

export async function questionsTick(
  dataDir: string,
  backend: BackendKind | null,
  cfg: DaemonConfig,
): Promise<void> {
  for (const q of listQuestions(dataDir)) {
    if (q.answered || q.withdrawn) continue;
    if (q.ack) {
      // Claimed. Ours with no answer means a previous pass died mid-answer —
      // retry only once the ack has clearly gone cold, and never touch a
      // question a serve loop is holding.
      if (q.ack.by?.id !== cfg.watcherId) continue;
      const ackAge = (Date.now() - Date.parse(q.ack.pickedUpAt)) / 1000;
      if (ackAge < 15 * 60) continue;
    }
    if (backend === null) continue; // commands-only / nothing viable
    if (!q.ack && shouldDefer(dataDir, q, cfg)) continue;
    await answerOne(dataDir, q, backend, cfg);
  }
}
