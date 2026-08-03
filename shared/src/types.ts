import type { z } from "zod";
import type {
  stepTypeSchema,
  stepSchema,
  variableGeneratorSchema,
  testCaseVariableSchema,
  testCaseVersionSchema,
  caseBookkeepingSchema,
  testCaseMetaSchema,
  noteTypeSchema,
  runNoteSchema,
  runStepStatusSchema,
  runTaskSchema,
  automatedResultSchema,
  runStepStateSchema,
  runFileSchema,
  runStepSchema,
  runStatusSchema,
  runSchema,
  stepPatchSchema,
  freeRunFileSchema,
} from "./schemas.js";

export type StepType = z.infer<typeof stepTypeSchema>;
/** One step, parsed out of a case document's `## Steps` section. */
export type Step = z.infer<typeof stepSchema>;

export type VariableGenerator = z.infer<typeof variableGeneratorSchema>;
/** One variable, parsed out of a case document's `# Variables` section. */
export type TestCaseVariable = z.infer<typeof testCaseVariableSchema>;

/**
 * A fully self-contained version of a test case, parsed from one Markdown
 * file (`versions/vN.md`, or a verbatim copy of one as a run's frozen
 * `case.md`). `version`/`createdAt` are derived from the filename and the
 * file's mtime, not stored in the text; `changeNote` is an optional
 * `Change note: ...` line a human/tool may leave under the title.
 */
export type TestCaseVersion = z.infer<typeof testCaseVersionSchema>;

/** On-disk `meta.json` — pure extension bookkeeping, not test content. */
export type CaseBookkeeping = z.infer<typeof caseBookkeepingSchema>;

/** Composed view: bookkeeping + the current version's parsed content. */
export type TestCaseMeta = z.infer<typeof testCaseMetaSchema>;

export type NoteType = z.infer<typeof noteTypeSchema>;
/** One typed feedback note on a run step. */
export type RunNote = z.infer<typeof runNoteSchema>;

export type RunStepStatus = z.infer<typeof runStepStatusSchema>;
export type RunTask = z.infer<typeof runTaskSchema>;
export type AutomatedResult = z.infer<typeof automatedResultSchema>;
/** On-disk per-step state inside `run.json` — no step-definition fields. */
export type RunStepState = z.infer<typeof runStepStateSchema>;
/** On-disk `run.json` shape. */
export type RunFile = z.infer<typeof runFileSchema>;
/** Composed step: definition (from case.md) + state (from run.json). */
export type RunStep = z.infer<typeof runStepSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
/** Composed run: case.md + run.json merged — what store callers see. */
export type Run = z.infer<typeof runSchema>;
export type StepPatch = z.infer<typeof stepPatchSchema>;

/** On-disk `free-run.json` shape — metadata for an unscripted verification session. */
export type FreeRunFile = z.infer<typeof freeRunFileSchema>;
/** Composed free run: metadata + the raw textarea content from `notes.md`. */
export interface FreeRun extends FreeRunFile {
  notes: string;
}

export interface TestCaseSummary {
  id: string;
  title: string;
  /** `@project` from the current version — the app under test. Empty when
   * the document declares none. */
  project: string;
  description: string;
  tags: string[];
  currentVersion: number;
  updatedAt: string;
  archived: boolean;
  /** Set when this case lives inside a suite folder rather than standalone. */
  suiteId?: string;
}

/** A suite: a physical folder holding a `suite.md` (shared prep steps,
 * variables, dependencies, prerequisites) plus its case subfolders. */
export interface SuiteSummary {
  id: string;
  title: string;
  /** `@project` from `suite.md` — the app under test. */
  project: string;
  description: string;
  tags: string[];
  caseCount: number;
  archived: boolean;
}

export interface VersionSummary {
  version: number;
  changeNote: string;
  createdAt: string;
  stepCount: number;
}

export interface RunSummary {
  id: string;
  testCaseId: string;
  testCaseVersion: number;
  testCaseTitle: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  stepCount: number;
  passCount: number;
  failCount: number;
}
