import { z } from "zod";

// NOTE: schemas intentionally avoid zod's `.default()` — in the installed
// zod version it makes the *output* type optional too (z.infer<> ends up
// with `field?: T | undefined` even though parsing always fills the
// default), which fights every consumer that expects a fully-populated
// object. Every writer in this codebase supplies fields explicitly.
//
// The exception is a field ADDED to an already-written on-disk shape, where
// no default means every existing file fails to parse. `.default()` is the
// migration tool there and only there — verified in zod 3.23.8 that the
// z.infer output of `z.string().default("")` is a plain `string`.

export const stepTypeSchema = z.enum(["manual", "automated"]);

export const VARIABLE_GENERATORS = [
  "timestamp",
  "page-url",
  "page-domain",
  "random-number",
  "random-string",
] as const;

export const variableGeneratorSchema = z.enum(VARIABLE_GENERATORS);

/** One entry from a case document's `# Variables` section — a named
 * placeholder (`%NAME%`) a run prompts for before its steps start. */
export const testCaseVariableSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  defaultValue: z.string().optional(),
  generator: variableGeneratorSchema.optional(),
  /** Generator-specific argument, e.g. length for random-string, "min-max" for random-number. */
  generatorArg: z.string().optional(),
});

/** A step as parsed from a case document's `## Steps` section (one `### `). */
export const stepSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  type: stepTypeSchema,
  instructions: z.string().optional(),
  expected: z.string().optional(),
  script: z.string().optional(),
  /** CSS selectors for the element this step is about, in the order they were
   * written (`Selector: #login-button`, repeated for fallbacks). Highlight
   * tries each until one matches, so a step survives a dynamic container or a
   * generated class name by naming a looser alternative after the exact one.
   * Empty when the step declares none. */
  selectors: z.array(z.string()),
  /** Marked `Kind: quick` — part of the core happy path. A quick run
   * executes only these; a full run executes every step. Authored once, in
   * full, so the quick subset costs nothing extra to maintain. */
  quick: z.boolean(),
  /** Where the tester should be standing before doing this step — a route,
   * screen name, or other surface, e.g. `Where: /admin/sync-console`.
   * Keeps "which app/tab am I in?" out of the instructions prose. */
  where: z.string().optional(),
  /** Background a tester may want but must not have to read to judge
   * pass/fail — rationale, regression history, caveats. Parsed from a
   * `### Note` subsection so `expected` can stay purely the pass criteria. */
  note: z.string().optional(),
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
  /** Format version of the grammar this document was parsed with, e.g.
   * `@version 0.0.1`. Not the same as `version` above. */
  formatVersion: z.string(),
  /** Free-text `@author` line, settable per version like `changeNote`. */
  author: z.string(),
  /** Free-text `@project` line — the app under test this case belongs to.
   * One data folder usually serves several repos, so this is what tells a
   * reader (and a reviewer of the raw Markdown) which product the routes and
   * selectors below refer to. Empty when the document declares none. */
  project: z.string(),
  changeNote: z.string(),
  title: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()),
  variables: z.array(testCaseVariableSchema),
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
  /** `@project` from the current version — which app under test this case
   * covers. Empty when the document declares none. */
  project: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  currentVersion: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archived: z.boolean(),
  /** Set when this case lives inside a suite folder rather than standalone. */
  suiteId: z.string().optional(),
});

export const NOTE_TYPES = ["note", "feature", "bug", "docs"] as const;
export const noteTypeSchema = z.enum(NOTE_TYPES);

/** One typed feedback note on a run step. Legacy run.json files stored
 * plain strings; the union below upgrades those to type "note" on read,
 * and the next write persists the normalized shape. */
export const runNoteSchema = z.object({
  id: z.string(),
  type: noteTypeSchema,
  text: z.string(),
});

const runNoteOrLegacySchema = z.union([
  runNoteSchema,
  z.string().transform(
    (text): z.infer<typeof runNoteSchema> => ({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      type: "note",
      text,
    }),
  ),
]);

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
  notes: z.array(runNoteOrLegacySchema),
  tasks: z.array(runTaskSchema),
  automatedResult: automatedResultSchema.nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const runStatusSchema = z.enum(["in_progress", "passed", "failed", "aborted"]);

/** How much of the case a run covers. `quick` executes only the steps
 * marked `Kind: quick`; `full` executes all of them. Recorded on the run
 * because "it passed" means different things for each. */
export const runTierSchema = z.enum(["quick", "full"]);

/** On-disk shape of `run.json` — run-level status plus per-step state only.
 * `testCaseTitle` is a denormalized convenience copy for cheap listing;
 * `case.md` next to it remains the source of truth for step definitions. */
export const runFileSchema = z.object({
  id: z.string(),
  testCaseId: z.string(),
  testCaseVersion: z.number().int().positive(),
  testCaseTitle: z.string(),
  status: runStatusSchema,
  /** Free text about the run as a whole, not any one step — "ran against an
   * old build", "felt slow throughout". Defaulted so runs written before
   * this field existed still parse. */
  comment: z.string().default(""),
  /** Defaulted to `full`: every run recorded before tiers existed executed
   * the whole case, so that is the truthful value for them. */
  tier: runTierSchema.default("full"),
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
  notes: z.array(runNoteOrLegacySchema),
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
  comment: z.string(),
  tier: runTierSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** From the frozen `case.md`, so a tester can see what had to be true
   * before step 1 — a service started, a fixture seeded — without leaving
   * the run to go read the case. Composed, not stored: `run.json` holds
   * execution state only. */
  dependencies: z.array(z.string()),
  prerequisites: z.array(z.string()),
  steps: z.array(runStepSchema),
});

/** On-disk `free-run.json` — metadata only; the captured text lives in
 * `notes.md` next to it. `finishedAt: null` means the session is still open. */
export const freeRunFileSchema = z.object({
  id: z.string(),
  title: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

/** All fields optional by design — a partial update applied to one run step. */
export const stepPatchSchema = z.object({
  status: runStepStatusSchema.optional(),
  comment: z.string().optional(),
  notes: z.array(runNoteSchema).optional(),
  tasks: z.array(runTaskSchema).optional(),
  automatedResult: automatedResultSchema.nullable().optional(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
});
