import type { CapturedEntry } from "./capture.js";
import type { EnvironmentsFile } from "./environments.js";
import type { CompatResult } from "./run-compat.js";
import type {
  AgentCommand,
  AgentCommandSourceField,
  AgentPresence,
  AgentQuestion,
  CaseContext,
  FreeRun,
  FreeRunFile,
  Run,
  RunScreenshot,
  RunStatus,
  RunSummary,
  ScreenshotOp,
  RunTier,
  StepPatch,
  SuiteSummary,
  TestCaseMeta,
  TestCaseSummary,
  TestCaseVersion,
  VersionSummary,
} from "./types.js";

/**
 * Everything that reads/writes test case definitions and their version
 * history. One implementation talks to disk via the File System Access
 * API; a later implementation can call a remote HTTP API against the same
 * folder layout without any caller needing to change.
 *
 * `bodyMarkdown` in create/createVersion is the raw Markdown a human, an
 * editor textarea, or a tool like Claude Code wrote — see shared/markdown.ts
 * for the grammar. It's stored close to verbatim; version number and
 * created-at are derived from the filename/mtime, not embedded in the text.
 */
export interface TestCaseStore {
  listTestCases(): Promise<TestCaseSummary[]>;
  getTestCase(id: string): Promise<TestCaseMeta>;
  listVersions(id: string): Promise<VersionSummary[]>;
  getVersion(id: string, version: string): Promise<TestCaseVersion>;
  /** Raw Markdown text of a version, exactly as stored — for editing. */
  getVersionSource(id: string, version: string): Promise<string>;
  createTestCase(bodyMarkdown: string, suiteId?: string): Promise<TestCaseMeta>;
  createVersion(id: string, bodyMarkdown: string): Promise<TestCaseVersion>;
  archiveTestCase(id: string, archived: boolean): Promise<void>;

  listSuites(): Promise<SuiteSummary[]>;
  getSuite(id: string): Promise<{ doc: TestCaseVersion; cases: TestCaseSummary[]; archived: boolean }>;
  getSuiteSource(id: string): Promise<string>;
  createSuite(bodyMarkdown: string): Promise<SuiteSummary>;
  /** Overwrites suite.md in place — suites are not versioned in v1. */
  saveSuite(id: string, bodyMarkdown: string): Promise<void>;
  archiveSuite(id: string, archived: boolean): Promise<void>;
  /** Raw Markdown a run should freeze: the case's own version merged with
   * its suite's prep steps/variables (see `buildRunSource`), or just the
   * case's own version text when it isn't in a suite. */
  getRunSource(testCaseId: string, version: string, tier?: RunTier): Promise<string>;
  /**
   * The case's `context.json` — which repo, host and session authored it —
   * or `null` when no agent has stamped one (a hand-written case, a case
   * dropped in from elsewhere). Read-only from the panel: the plugin's guard
   * hook is the only writer. What a fix prompt uses to say *which* project
   * the fix belongs in.
   */
  getCaseContext(testCaseId: string): Promise<CaseContext | null>;
}

/** Everything that reads/writes runs. Same swap-later story as TestCaseStore. */
export interface RunStore {
  listRuns(testCaseId?: string): Promise<RunSummary[]>;
  getRun(testCaseId: string, runId: string): Promise<Run>;
  /**
   * `variableValues` supplies a value per declared `# Variables` entry
   * (keyed by name); anything omitted falls back to that variable's
   * generator or default — see `resolveVariableValues`. The version's raw
   * Markdown has every `%NAME%` placeholder substituted with the resolved
   * value *before* being frozen as the run's `case.md`.
   *
   * `tier` defaults to `full`. A `quick` run freezes only the steps marked
   * `Kind: quick` (plus any suite prep steps, which are never filtered), so
   * the frozen `case.md` is exactly what was executed.
   */
  createRun(
    testCaseId: string,
    version: string,
    variableValues?: Record<string, string>,
    tier?: RunTier,
    /** Display name of the environment that pre-filled the values, recorded
     * on the run so the report can say where it ran. Absent = no
     * environment; the values were manual, generated, or defaulted. */
    environment?: string,
  ): Promise<Run>;
  updateStep(testCaseId: string, runId: string, stepId: string, patch: StepPatch): Promise<Run>;
  /** Run-level fields that are not step state — the tester's comment on the
   * run as a whole, their decision about attaching captured output to the
   * report, and their star rating of the case. Saved as they are made rather
   * than handed to `finishRun`, so closing the panel mid-sentence does not
   * lose any of them. `rating: null` clears a rating; leaving it out keeps
   * the one there. */
  updateRun(
    testCaseId: string,
    runId: string,
    patch: { comment?: string; consoleInReport?: boolean; rating?: number | null },
  ): Promise<Run>;
  /**
   * Appends what the page printed while the run was in progress — see
   * `shared/src/capture.ts` for the entry shape and the two artifacts.
   *
   * Deliberately not part of `updateStep`: entries arrive in batches, on a
   * timer, at a volume the page decides, and `run.json` is rewritten on every
   * step patch. Per-step counts are derived from these when the run finishes.
   */
  appendConsole(testCaseId: string, runId: string, entries: CapturedEntry[]): Promise<void>;
  /**
   * Everything `appendConsole` has recorded for this run so far, in order,
   * stamped with the step each entry arrived in. Read while the run is
   * still open — a fix prompt written from the step that just failed wants
   * the errors of the last minute, not the digest a finished run leaves in
   * `report.md`. Empty when capture was off.
   */
  readRunConsole(testCaseId: string, runId: string): Promise<CapturedEntry[]>;
  finishRun(testCaseId: string, runId: string, status: RunStatus): Promise<Run>;
  /**
   * The `feedback.md` a finished run left behind, verbatim, or `null` when
   * the run had nothing to hand on (or has not finished yet). Exists so a
   * tester with no agent watching the folder — a QA engineer on a machine
   * with no Claude Code — can still copy or save the handoff and pass it to
   * whoever has one.
   */
  getRunFeedback(testCaseId: string, runId: string): Promise<string | null>;
  /**
   * Attaches a capture to the run. Writes `screenshots/<seq>.source.png`
   * (the bytes as captured) and `<seq>.png` (`renderedPng`, or the same
   * bytes when null), then the record — the record is the ready marker, so
   * a crash between the two leaves an orphan file and no dangling entry.
   * With a non-null `slot`, any earlier screenshot of the same step and
   * slot is removed first (that is Retake). Refused on a finished run.
   */
  addScreenshot(testCaseId: string, runId: string, input: ScreenshotInput): Promise<{ run: Run; screenshot: RunScreenshot }>;
  /**
   * Caption, step, slot, or a new operation list. When `ops` is given,
   * `renderedPng` must be too — the store never renders (there is no canvas
   * on the daemon side) — and `<seq>.png` is overwritten. Moving to another
   * step clears the slot unless the patch sets one. Allowed after finish:
   * a caption typo found later is fixable.
   */
  updateScreenshot(testCaseId: string, runId: string, id: string, patch: ScreenshotPatch): Promise<Run>;
  /** Removes the record and both files. */
  removeScreenshot(testCaseId: string, runId: string, id: string): Promise<Run>;
  readScreenshot(testCaseId: string, runId: string, id: string, which: ScreenshotVariant): Promise<Uint8Array>;
}

export type ScreenshotVariant = "rendered" | "source";

export interface ScreenshotInput {
  stepId: string | null;
  slot: number | null;
  pageUrl: string;
  width: number;
  height: number;
  sourcePng: Uint8Array;
  ops: ScreenshotOp[];
  /** Null = identical to the source. */
  renderedPng: Uint8Array | null;
  missing: string[];
  caption: string;
}

export interface ScreenshotPatch {
  caption?: string;
  stepId?: string | null;
  slot?: number | null;
  ops?: ScreenshotOp[];
  renderedPng?: Uint8Array;
}

/** Everything that reads/writes free runs — unscripted verification
 * sessions with no test case or steps. Same swap-later story as TestCaseStore. */
export interface FreeRunStore {
  listFreeRuns(): Promise<FreeRunFile[]>;
  getFreeRun(id: string): Promise<FreeRun>;
  createFreeRun(title: string): Promise<FreeRun>;
  updateFreeRun(id: string, patch: { title?: string; notes?: string }): Promise<FreeRun>;
  /** Same stream as `appendConsole`, attached to the session rather than to a
   * step. An unscripted session is exactly where an unexplained console error
   * is worth having, and there is no step for it to hang off. */
  appendFreeRunConsole(id: string, entries: CapturedEntry[]): Promise<void>;
  finishFreeRun(id: string): Promise<FreeRun>;
  /** The run store's four screenshot methods, against
   * `free-runs/<id>/screenshots/`. `stepId` and `slot` are ignored and
   * stored as null. Adding is refused once the session is finished. */
  addFreeRunScreenshot(id: string, input: ScreenshotInput): Promise<{ freeRun: FreeRun; screenshot: RunScreenshot }>;
  updateFreeRunScreenshot(id: string, shotId: string, patch: ScreenshotPatch): Promise<FreeRun>;
  removeFreeRunScreenshot(id: string, shotId: string): Promise<FreeRun>;
  readFreeRunScreenshot(id: string, shotId: string, which: ScreenshotVariant): Promise<Uint8Array>;
}

/**
 * Per-project environments — named value sets a run can pre-fill its
 * variables from (see `shared/src/environments.ts`). In local mode the
 * project is the connected folder and the file is `environments.json` at
 * its root.
 */
export interface EnvironmentStore {
  getEnvironments(): Promise<EnvironmentsFile>;
  saveEnvironments(file: EnvironmentsFile): Promise<void>;
  /** The environments of the storage holding this case — identical to
   * `getEnvironments()` for a single-folder store; a multi-storage wrapper
   * routes on the id, so the run-setup screen never has to know which
   * folder a case came from. */
  getEnvironmentsForCase(testCaseId: string): Promise<EnvironmentsFile>;
}

/**
 * The live channel between the panel and a looping agent session — see the
 * `agent/` section of schemas.ts for the on-disk protocol. Everything here
 * is run-scoped (routed by `testCaseId` in a multi-storage wrapper) except
 * `touchHeartbeat`, which fans out: liveness is per folder, not per case.
 */
export interface AgentChannelStore {
  askQuestion(
    testCaseId: string,
    runId: string,
    draft: {
      stepId: string;
      question: string;
      selection: string;
      /** Where the tester was standing, "" when no scriptable tab. */
      pageUrl: string;
      /** PNG of the visible tab, null when not captured — saved beside the
       * question as `screenshot.png`. */
      screenshotPng: Uint8Array | null;
      /** Sanitized DOM snapshot, null when not captured — saved as
       * `page.html`, the file selectors get verified against. */
      pageHtml: string | null;
    },
  ): Promise<AgentQuestion>;
  listQuestions(testCaseId: string, runId: string): Promise<AgentQuestion[]>;
  /** Takes a question back: writes the `withdrawn` flag. A server that has
   * not claimed it never will; one mid-answer stops at its next look. The
   * panel shows it withdrawn from this moment, whatever lands later. */
  withdrawQuestion(testCaseId: string, questionId: string): Promise<void>;
  requestCommand(
    testCaseId: string,
    runId: string,
    draft: { command: string; stepId: string | null; sourceField: AgentCommandSourceField },
  ): Promise<AgentCommand>;
  listCommands(testCaseId: string, runId: string): Promise<AgentCommand[]>;
  /** Requests a stop; the watching session does the killing, so the command
   * shows `stopping` until its next tick honors the flag. */
  killCommand(testCaseId: string, commandId: string): Promise<void>;
  /** The dry half of `swapRunVersion`: composes the candidate exactly as the
   * swap would and reports the verdict without writing anything, so the
   * panel can label the offer before the tester commits. `questionId` names
   * the question whose answer proposed the patch — its step is exempt from
   * freezing even when already judged. */
  previewSwap(
    testCaseId: string,
    runId: string,
    toVersion: string,
    questionId: string | null,
  ): Promise<CompatResult>;
  /** Repoints an in-flight run at `toVersion`: rewrites the frozen `case.md`
   * with the identically-composed candidate and records the swap. Throws
   * when the candidate is incompatible (see `checkRunCompat`) — statuses
   * must keep describing the text they were recorded against. The one
   * exception is the asked step: if its text changed, its result resets to
   * undone, which keeps the same invariant the other way around. */
  swapRunVersion(
    testCaseId: string,
    runId: string,
    toVersion: string,
    questionId: string | null,
  ): Promise<Run>;
  /** Who, if anyone, is serving this case's folder right now: a fresh
   * watcher file (seen within ~3 minutes) from a Claude Code pass or the
   * enloopd daemon. `claude-code` wins the label when both are fresh —
   * that is who answers questions first. Null = nobody is watching, and
   * the panel should show how to connect a server. */
  agentPresence(testCaseId: string): Promise<AgentPresence | null>;
  /** Marks the panel alive in every connected folder that has an `agent/`
   * dir (never creates one). The watching session kills the scripts it
   * spawned once this goes stale. */
  touchHeartbeat(): Promise<void>;
}

export interface DataStore
  extends TestCaseStore, RunStore, FreeRunStore, EnvironmentStore, AgentChannelStore {}
