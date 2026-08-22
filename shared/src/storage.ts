import type { CapturedEntry } from "./capture.js";
import type { EnvironmentsFile } from "./environments.js";
import type { CompatResult } from "./run-compat.js";
import type {
  AgentCommand,
  AgentCommandSourceField,
  AgentQuestion,
  FreeRun,
  FreeRunFile,
  Run,
  RunStatus,
  RunSummary,
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
  getVersion(id: string, version: number): Promise<TestCaseVersion>;
  /** Raw Markdown text of a version, exactly as stored — for editing. */
  getVersionSource(id: string, version: number): Promise<string>;
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
  getRunSource(testCaseId: string, version: number, tier?: RunTier): Promise<string>;
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
    version: number,
    variableValues?: Record<string, string>,
    tier?: RunTier,
    /** Display name of the environment that pre-filled the values, recorded
     * on the run so the report can say where it ran. Absent = no
     * environment; the values were manual, generated, or defaulted. */
    environment?: string,
  ): Promise<Run>;
  updateStep(testCaseId: string, runId: string, stepId: string, patch: StepPatch): Promise<Run>;
  /** Run-level fields that are not step state — the tester's comment on the
   * run as a whole, and their decision about attaching captured output to the
   * report. Saved as they are made rather than handed to `finishRun`, so
   * closing the panel mid-sentence does not lose either. */
  updateRun(
    testCaseId: string,
    runId: string,
    patch: { comment?: string; consoleInReport?: boolean },
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
  finishRun(testCaseId: string, runId: string, status: RunStatus): Promise<Run>;
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
   * panel can label the offer before the tester commits. */
  previewSwap(testCaseId: string, runId: string, toVersion: number): Promise<CompatResult>;
  /** Repoints an in-flight run at `toVersion`: rewrites the frozen `case.md`
   * with the identically-composed candidate and records the swap. Throws
   * when the candidate is incompatible (see `checkRunCompat`) — statuses
   * must keep describing the text they were recorded against. */
  swapRunVersion(
    testCaseId: string,
    runId: string,
    toVersion: number,
    questionId: string | null,
  ): Promise<Run>;
  /** Marks the panel alive in every connected folder that has an `agent/`
   * dir (never creates one). The watching session kills the scripts it
   * spawned once this goes stale. */
  touchHeartbeat(): Promise<void>;
}

export interface DataStore
  extends TestCaseStore, RunStore, FreeRunStore, EnvironmentStore, AgentChannelStore {}
