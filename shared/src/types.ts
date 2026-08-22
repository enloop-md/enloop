import type { z } from "zod";
import type {
  stepTypeSchema,
  stepSchema,
  variableGeneratorSchema,
  testCaseVariableSchema,
  testCaseVersionSchema,
  caseBookkeepingSchema,
  testCaseMetaSchema,
  commentAudienceSchema,
  runCommentSchema,
  runCommentDraftSchema,
  runStepStatusSchema,
  automatedResultSchema,
  runStepStateSchema,
  runFileSchema,
  runStepSchema,
  runStatusSchema,
  runTierSchema,
  runSchema,
  stepPatchSchema,
  freeRunFileSchema,
  runSwapSchema,
  agentQuestionFileSchema,
  agentAnswerMetaSchema,
  agentCommandSourceFieldSchema,
  agentCommandRequestSchema,
  agentCommandStatusSchema,
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

/** Who a comment is addressed to — see `commentAudienceSchema`. */
export type CommentAudience = z.infer<typeof commentAudienceSchema>;
/** One comment a tester left on a step, and who for. */
export type RunComment = z.infer<typeof runCommentSchema>;
/** The comment being typed — stored, and counted as a comment everywhere. */
export type RunCommentDraft = z.infer<typeof runCommentDraftSchema>;

export type RunStepStatus = z.infer<typeof runStepStatusSchema>;
export type AutomatedResult = z.infer<typeof automatedResultSchema>;
/** On-disk per-step state inside `run.json` — no step-definition fields. */
export type RunStepState = z.infer<typeof runStepStateSchema>;
/** On-disk `run.json` shape. */
export type RunFile = z.infer<typeof runFileSchema>;
/** Composed step: definition (from case.md) + state (from run.json). */
export type RunStep = z.infer<typeof runStepSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
/** How much of a case a run covers — see `runTierSchema`. */
export type RunTier = z.infer<typeof runTierSchema>;
/** Composed run: case.md + run.json merged — what store callers see. */
export type Run = z.infer<typeof runSchema>;
export type StepPatch = z.infer<typeof stepPatchSchema>;

/** One mid-run version hot-swap recorded on the run. */
export type RunSwap = z.infer<typeof runSwapSchema>;

/** On-disk `agent/questions/<id>/question.json`. */
export type AgentQuestionFile = z.infer<typeof agentQuestionFileSchema>;
/** On-disk `answer.json` — presence marks the question answered. */
export type AgentAnswerMeta = z.infer<typeof agentAnswerMetaSchema>;
/** Which part of the case an agent command was quoted from. */
export type AgentCommandSourceField = z.infer<typeof agentCommandSourceFieldSchema>;
/** On-disk `agent/commands/<id>/request.json`. */
export type AgentCommandRequest = z.infer<typeof agentCommandRequestSchema>;
/** On-disk `status.json` for an agent command. */
export type AgentCommandStatus = z.infer<typeof agentCommandStatusSchema>;

/** Composed question: the envelope plus the answer files when present. */
export interface AgentQuestion extends AgentQuestionFile {
  answer: { markdown: string; meta: AgentAnswerMeta } | null;
}

/** What the panel shows for a command. `queued` = no `status.json` yet (no
 * agent session has picked it up); `stopping` = a kill was requested and
 * the agent has not yet honored it. */
export type AgentCommandDisplay = "queued" | "running" | "stopping" | "exited" | "killed" | "refused";

/** Composed command: request + state derived across the agent-written
 * `status.json` and the wrapper-written `exit-code` (which outranks it for
 * completion — see `agentCommandStatusSchema`). */
export interface AgentCommand extends AgentCommandRequest {
  display: AgentCommandDisplay;
  exitCode: number | null;
  reason: string | null;
  /** Tail of `output.log`, capped by the store; "" before any output. */
  logTail: string;
}

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
  /** Quick and full runs are different evidence; a history that cannot tell
   * them apart reads a quick pass as a full one. */
  tier: RunTier;
  startedAt: string;
  finishedAt: string | null;
  stepCount: number;
  passCount: number;
  failCount: number;
  /** Steps the tester marked as a warning: passed, but with something worth
   * saying. Counted here so a summary can show the whole verdict without
   * loading the run — a run with warnings is not the same as a clean one. */
  warnCount: number;
  /** Steps that finished the run skipped — extra steps left at their default,
   * and ordinary steps the tester declined. Counted so a summary can tell
   * "5/5 passed, 2 skipped" apart from a run that was abandoned midway. */
  skipCount: number;
}
