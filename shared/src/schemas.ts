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
  "page-origin",
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
  /** Glob a page-derived value must satisfy (`Match: *.example.test`),
   * checked against the page's host — so opening the panel on an unrelated
   * site yields nothing rather than that site's address. `*` matches any
   * run of characters; a pattern containing `/` is checked against the
   * whole value. Meaningless without a page-* generator. */
  match: z.string().optional(),
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

/**
 * Who a comment on a step is addressed to.
 *
 * A tester who has just seen something wrong knows *who needs to hear it* long
 * before they could classify it. "The developer should see this" is a judgement
 * they can make in the moment; "is this a bug or a feature request" is one they
 * stall on, which is how a run ends with an empty comment box and the finding
 * in nobody's head but theirs.
 *
 * So the axis is audience, not category, and it is a set rather than a choice:
 * one observation is regularly for two people at once — the app is wrong *and*
 * the case never said what to expect. An empty set is meaningful and common:
 * context for whoever reads the run, addressed to nobody, and never an action
 * item.
 */
export const COMMENT_AUDIENCES = ["developer", "product", "test-writer", "docs", "ops"] as const;
export const commentAudienceSchema = z.enum(COMMENT_AUDIENCES);

/** One comment a tester left on a step, and who they left it for. */
export const runCommentSchema = z.object({
  id: z.string(),
  text: z.string(),
  audiences: z.array(commentAudienceSchema),
});

/**
 * The comment being written right now — what is in the box before Add is
 * pressed.
 *
 * It is stored, not held in the panel, because a side panel is destroyed
 * every time the tester clicks into the page they are testing, which during a
 * run is constantly. An unsubmitted draft that lived in component state was
 * therefore not "unfinished", it was gone — and it went without a trace, since
 * the tester had already written the thing they wanted to say.
 *
 * Everything that reads a run treats a non-empty draft as a comment. Pressing
 * Add is how you start writing the *next* one, not how you save this one.
 */
export const runCommentDraftSchema = z.object({
  text: z.string(),
  audiences: z.array(commentAudienceSchema),
});

// ---- what these replaced, still on disk in every run recorded before now ----

/** Note types as they were: a single choice from a list that mixed a category
 * (`bug`, `feature`) with a severity-free catch-all (`note`). Mapped to the
 * audience that type was always a proxy for. */
const LEGACY_NOTE_AUDIENCES: Record<string, Array<z.infer<typeof commentAudienceSchema>>> = {
  bug: ["developer"],
  feature: ["product"],
  docs: ["docs"],
  note: [],
};

const legacyNoteSchema = z.union([
  z.object({
    id: z.string().optional(),
    type: z.string().optional(),
    text: z.string(),
  }),
  // Older still: a bare string.
  z.string().transform((text) => ({ id: undefined, type: undefined, text })),
]);

const legacyTaskSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  done: z.boolean().default(false),
});

function commentId(): string {
  return `comment-${crypto.randomUUID().slice(0, 8)}`;
}

export const runStepStatusSchema = z.enum([
  "pending",
  "running",
  "success",
  "failed",
  "warning",
  "skipped",
]);

export const automatedResultSchema = z.object({
  status: z.enum(["success", "failed", "warning"]),
  warnings: z.array(z.string()),
  error: z.string().optional(),
  stack: z.string().optional(),
});

/** Pure execution state for one step, as stored in `run.json`. No step
 * definition fields (title/type/script/...) live here — those only ever
 * live in the frozen `case.md`, and are joined in by stepId at read time. */
export const runStepStateSchema = z
  .object({
    stepId: z.string(),
    status: runStepStatusSchema,
    comments: z.array(runCommentSchema).default([]),
    /** Written through as the tester types; promoted to a comment when they
     * press Add, and again when the run finishes. Null when the box is
     * empty. */
    draft: runCommentDraftSchema.nullable().default(null),
    /** Legacy: the single free-text box each step used to have, alongside a
     * list of typed notes and a list of tasks. All three said the same thing
     * in three places, and a tester could not tell which one their sentence
     * belonged in. They fold into `comments` on read, and the next write
     * persists only the new shape — nothing is lost and nothing is migrated
     * in place. */
    comment: z.string().optional(),
    notes: z.array(legacyNoteSchema).optional(),
    tasks: z.array(legacyTaskSchema).optional(),
    automatedResult: automatedResultSchema.nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    /** What the page printed while this step was running — see
     * `shared/src/capture.ts`. Counts only: the entries themselves live in
     * `console.jsonl`/`console.md`, because console volume is unbounded and
     * `run.json` is rewritten on every step patch. Written when the run
     * finishes, and `.default(0)` so every run recorded before capture existed
     * still parses. */
    consoleErrors: z.number().int().nonnegative().default(0),
    consoleWarnings: z.number().int().nonnegative().default(0),
    networkFailures: z.number().int().nonnegative().default(0),
    /** Every request seen during this step, failures included — nonzero only
     * when the tester asked for the whole trace rather than the failures. */
    requests: z.number().int().nonnegative().default(0),
  })
  .transform(({ comment, notes, tasks, comments, ...rest }) => {
    const migrated = [
      // The step comment carried no audience by definition — it was the box
      // for "anything else", which is exactly what an untagged comment is.
      ...(comment?.trim() ? [{ id: commentId(), text: comment.trim(), audiences: [] }] : []),
      ...(notes ?? []).map((note) => ({
        id: note.id ?? commentId(),
        text: note.text,
        audiences: LEGACY_NOTE_AUDIENCES[note.type ?? "note"] ?? [],
      })),
      // A task was a reminder to somebody unnamed. Its state is kept in the
      // text because there is nowhere else for it to go, and a half-finished
      // checklist that silently loses its ticks is worse than a wordy one.
      ...(tasks ?? []).map((task) => ({
        id: task.id ?? commentId(),
        text: `${task.done ? "[done]" : "[to do]"} ${task.text}`,
        audiences: [],
      })),
    ];
    return { ...rest, comments: [...migrated, ...comments] };
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
  /** Name of the environment whose values pre-filled this run, or "" when
   * the tester ran without one. Denormalized on purpose — the run must
   * still say where it ran after the environment is renamed or deleted
   * ("failed on staging" and "failed on local" are different findings).
   * Defaulted so runs recorded before environments existed still parse. */
  environment: z.string().default(""),
  /** The tester's decision, at finish, about whether the captured console and
   * network output may be summarized into `report.md` — which is the file an
   * agent reads. Recorded on disk rather than acted on and forgotten, so
   * `/enloop:check` sees the decision instead of re-making it. Defaulted for
   * runs written before capture existed. */
  consoleInReport: z.boolean().default(false),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  steps: z.array(runStepStateSchema),
});

/** Step definition (from case.md) merged with its execution state (from
 * run.json) — the shape callers/UI actually work with. */
export const runStepSchema = stepSchema.omit({ id: true }).extend({
  stepId: z.string(),
  status: runStepStatusSchema,
  comments: z.array(runCommentSchema),
  draft: runCommentDraftSchema.nullable(),
  automatedResult: automatedResultSchema.nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  consoleErrors: z.number().int().nonnegative(),
  consoleWarnings: z.number().int().nonnegative(),
  networkFailures: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
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
  environment: z.string(),
  consoleInReport: z.boolean(),
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
  comments: z.array(runCommentSchema).optional(),
  draft: runCommentDraftSchema.nullable().optional(),
  automatedResult: automatedResultSchema.nullable().optional(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
});
