import { z } from "zod";

// NOTE: schemas intentionally avoid zod's `.default()` — in the installed
// zod version it makes the *output* type optional too (z.infer<> ends up
// with `field?: T | undefined` even though parsing always fills the
// default), which fights every consumer that expects a fully-populated
// object. Every writer in this codebase supplies fields explicitly.

export const stepTypeSchema = z.enum(["manual", "automated"]);

/** A step as parsed from a case document's `## Steps` section (one `### `). */
export const stepSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  type: stepTypeSchema,
  instructions: z.string().optional(),
  expected: z.string().optional(),
  script: z.string().optional(),
  /** CSS selector for the element this step is about, e.g. `Selector: #login-button`.
   * Used to scroll it into view and flash it in the page when the step is focused. */
  selector: z.string().optional(),
});

/**
 * A fully self-contained version of a test case. Parsed from the Markdown
 * text of `versions/vN.md` (or a verbatim copy of one, frozen as a run's
 * `case.md`) — `version` comes from the filename, `createdAt` from the
 * file's mtime; everything else comes from the document body.
 */
export const testCaseVersionSchema = z.object({
  version: z.number().int().positive(),
  createdAt: z.string(),
  changeNote: z.string(),
  title: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()),
  dependencies: z.array(z.string()),
  prerequisites: z.array(z.string()),
  steps: z.array(stepSchema),
});

/** On-disk `meta.json` — pure extension bookkeeping, not test content. */
export const caseBookkeepingSchema = z.object({
  archived: z.boolean(),
});

/** Composed view returned to callers: bookkeeping + parsed current-version content. */
export const testCaseMetaSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()),
  currentVersion: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archived: z.boolean(),
});

export const runStepStatusSchema = z.enum([
  "pending",
  "running",
  "success",
  "failed",
  "warning",
  "skipped",
]);

export const runTaskSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
});

export const automatedResultSchema = z.object({
  status: z.enum(["success", "failed", "warning"]),
  warnings: z.array(z.string()),
  error: z.string().optional(),
  stack: z.string().optional(),
});

/** Pure execution state for one step, as stored in `run.json`. No step
 * definition fields (title/type/script/...) live here — those only ever
 * live in the frozen `case.md`, and are joined in by stepId at read time. */
export const runStepStateSchema = z.object({
  stepId: z.string(),
  status: runStepStatusSchema,
  comment: z.string(),
  notes: z.array(z.string()),
  tasks: z.array(runTaskSchema),
  automatedResult: automatedResultSchema.nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const runStatusSchema = z.enum(["in_progress", "passed", "failed", "aborted"]);

/** On-disk shape of `run.json` — run-level status plus per-step state only.
 * `testCaseTitle` is a denormalized convenience copy for cheap listing;
 * `case.md` next to it remains the source of truth for step definitions. */
export const runFileSchema = z.object({
  id: z.string(),
  testCaseId: z.string(),
  testCaseVersion: z.number().int().positive(),
  testCaseTitle: z.string(),
  status: runStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  steps: z.array(runStepStateSchema),
});

/** Step definition (from case.md) merged with its execution state (from
 * run.json) — the shape callers/UI actually work with. */
export const runStepSchema = stepSchema.omit({ id: true }).extend({
  stepId: z.string(),
  status: runStepStatusSchema,
  comment: z.string(),
  notes: z.array(z.string()),
  tasks: z.array(runTaskSchema),
  automatedResult: automatedResultSchema.nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

/** Composed, in-memory view of a run — case.md + run.json merged. This is
 * what TestCaseStore/RunStore callers see; the on-disk split is an
 * implementation detail of the store. */
export const runSchema = z.object({
  id: z.string(),
  testCaseId: z.string(),
  testCaseVersion: z.number().int().positive(),
  testCaseTitle: z.string(),
  status: runStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  steps: z.array(runStepSchema),
});

/** All fields optional by design — a partial update applied to one run step. */
export const stepPatchSchema = z.object({
  status: runStepStatusSchema.optional(),
  comment: z.string().optional(),
  notes: z.array(z.string()).optional(),
  tasks: z.array(runTaskSchema).optional(),
  automatedResult: automatedResultSchema.nullable().optional(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
});
