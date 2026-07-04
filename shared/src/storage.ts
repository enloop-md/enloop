import type {
  FreeRun,
  FreeRunFile,
  Run,
  RunStatus,
  RunSummary,
  StepPatch,
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
  createTestCase(bodyMarkdown: string): Promise<TestCaseMeta>;
  createVersion(id: string, bodyMarkdown: string): Promise<TestCaseVersion>;
  archiveTestCase(id: string, archived: boolean): Promise<void>;
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
   */
  createRun(testCaseId: string, version: number, variableValues?: Record<string, string>): Promise<Run>;
  updateStep(testCaseId: string, runId: string, stepId: string, patch: StepPatch): Promise<Run>;
  finishRun(testCaseId: string, runId: string, status: RunStatus): Promise<Run>;
}

/** Everything that reads/writes free runs — unscripted verification
 * sessions with no test case or steps. Same swap-later story as TestCaseStore. */
export interface FreeRunStore {
  listFreeRuns(): Promise<FreeRunFile[]>;
  getFreeRun(id: string): Promise<FreeRun>;
  createFreeRun(title: string): Promise<FreeRun>;
  updateFreeRun(id: string, patch: { title?: string; notes?: string }): Promise<FreeRun>;
  finishFreeRun(id: string): Promise<FreeRun>;
}

export interface DataStore extends TestCaseStore, RunStore, FreeRunStore {}
