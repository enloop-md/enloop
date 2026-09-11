import { z } from "zod";
import { ratingSchema } from "./rating.js";
import { VERSION_ID_RE } from "./version-id.js";

/**
 * A case version id — `"3"` (authored major) or `"3.1"` (mid-run patch
 * minor); see version-id.ts. Every file written before minors existed
 * stored versions as bare JSON numbers, so numbers are accepted and
 * normalized to strings on read.
 */
export const caseVersionIdSchema = z
  .union([z.number().int().positive(), z.string().regex(VERSION_ID_RE)])
  .transform(String);

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

/** One entry from a case document's `# Domains` section — a deployment the
 * case touches, referenced as `%NAME%/route`. The first declared domain is
 * the **main** one: bare routes resolve against it. A domain has no
 * generator; its value comes from the environment picked for the run, the
 * open tab when no environment is picked, or its `Default:` — see
 * `resolveDomainValues`. */
export const testCaseDomainSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  /** The origin a cold run uses — `https://staging.example.test`. */
  defaultValue: z.string().optional(),
  /** Glob an open tab's host must satisfy for the tab to count as this
   * domain (`Match: admin.*.example.test`). With several domains it is what
   * lets the panel tell which one the tester has open. */
  match: z.string().optional(),
  /** Not declared in the text: the parser synthesizes this entry when the
   * document uses `%DOMAIN%` (or the legacy `%BASE_URL%`) without a
   * `# Domains` section naming it. It is the deployment under test, empty
   * until a run reads the open tab — see `IMPLICIT_DOMAIN_NAMES`. Never
   * written back out by `renderCaseMarkdown`. */
  implicit: z.boolean().optional(),
});

/**
 * A group of steps that serve one goal — `# Steps: Test login` in the
 * document, with the goal as the prose under the heading. Groups are how a
 * case that covers a broad change ("the email refactoring") is read as a
 * handful of concerns rather than a flat list of twenty verdicts: each group
 * says what, in the big picture, its steps prove. Steps carry their group's
 * title in `group`; a step under a plain `# Steps` belongs to none.
 */
export const stepGroupSchema = z.object({
  title: z.string().min(1),
  /** What the group's steps establish together, in a sentence or two. The
   * linter requires it — a group without a goal is only a heading. */
  goal: z.string(),
});

export const PHOTO_TAKE = ["before", "after", "manual"] as const;
export const PHOTO_MODE = ["auto", "confirm"] as const;

/** The palette a photo spec's `Color:` and the editor's swatches share —
 * red first, since it is the default. */
export const SHOT_COLORS = [
  "#E5484D",
  "#F76B15",
  "#30A46C",
  "#0090FF",
  "#8E4EC6",
  "#1C2024",
  "#FFFFFF",
] as const;
export const DEFAULT_SHOT_COLOR = SHOT_COLORS[0];
export const DEFAULT_PHOTO_PAD = 24;

/**
 * A `### Photo` block of a step — what the runner should capture, and how
 * to mark it up, without the tester doing anything. Every selector is
 * resolved on the page at capture time; one that matches nothing is skipped
 * and listed in the screenshot record's `missing`. The n-th block of a step
 * fills the `%PHOTO_n%` placeholder in that step's prose on export.
 */
export const photoSpecSchema = z.object({
  /** Selector of the container to crop to; empty = the whole viewport. */
  crop: z.string(),
  /** CSS px of padding around `crop`. */
  pad: z.number().int().nonnegative(),
  /** Rectangles around these. */
  marks: z.array(z.string()),
  /** Arrows pointing at these. */
  points: z.array(z.string()),
  /** Numbered discs beside these, in order; `text` is the legend line
   * printed under the figure on export (may be empty). */
  callouts: z.array(z.object({ selector: z.string(), text: z.string() })),
  /** Pixelated. */
  blurs: z.array(z.string()),
  /** `before`: when the step becomes current. `after`: when the verdict is
   * given (or the script finishes). `manual`: a preloaded button. */
  take: z.enum(PHOTO_TAKE),
  /** `auto` keeps the photo silently; `confirm` shows Keep / Retake /
   * Edit / Discard. Ignored for `manual`. */
  mode: z.enum(PHOTO_MODE),
  /** One of `SHOT_COLORS`. */
  color: z.string(),
  caption: z.string(),
});

/** A step as parsed from a case document's `# Steps` section (one `## `). */
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
  /** Marked `Kind: extra` — a side-check worth having in the case but not
   * worth demanding of every run: a conditional, a nice-to-verify, a check
   * that needs data not every tester has. Shown in the list with a minor
   * number (2.1, 2.2) under the preceding ordinary step, starts a run
   * already `skipped`, and the tester opts in rather than out. Mutually
   * exclusive with `quick` — a step has one `Kind:`. */
  extra: z.boolean(),
  /** Where the tester should be standing before doing this step — a route,
   * screen name, or other surface, e.g. `Where: /admin/sync-console`.
   * Keeps "which app/tab am I in?" out of the instructions prose. */
  where: z.string().optional(),
  /** How the page in `where` is reached through the app's own UI —
   * `Via: Settings → Users → the row` — so the address is never the only
   * way to find it: a link may point at another environment, or be
   * incomplete, and a tester must still be able to get there. Required by
   * the linter whenever a step moves to a new page; `Via: link only`
   * states explicitly that the UI offers no path (a deep link, an emailed
   * link, a redirect target). */
  via: z.string().optional(),
  /** Background a tester may want but must not have to read to judge
   * pass/fail — rationale, regression history, caveats. Parsed from a
   * `### Note` subsection so `expected` can stay purely the pass criteria. */
  note: z.string().optional(),
  /** Title of the `# Steps: <group>` section this step was written under,
   * matching an entry in the document's `groups`. Absent for a step under a
   * plain `# Steps`. */
  group: z.string().optional(),
  /** `### Photo` blocks in document order — see `photoSpecSchema`. */
  photos: z.array(photoSpecSchema),
});

export const CASE_KINDS = ["case", "guide"] as const;

/**
 * A fully self-contained version of a test case. Parsed from the Markdown
 * text of `versions/vN.md` (or a verbatim copy of one, frozen as a run's
 * `case.md`) — `version` comes from the filename, `createdAt` from the
 * file's mtime; everything else comes from the document body.
 */
export const testCaseVersionSchema = z.object({
  version: caseVersionIdSchema,
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
  /** `@kind guide` — a user guide: the same grammar and the same run,
   * written for an end user rather than a tester, exported with its
   * screenshots by `export-guide`. Absent line = `case`. A guide's run
   * labels verdicts Done / Could not and Expected "You should see"; the
   * linter drops the quick-mark warnings. Nothing else differs. */
  kind: z.enum(CASE_KINDS),
  title: z.string().min(1),
  /** `Goal:` — one plain line saying what the case proves, for someone who
   * has never seen the app. Pinned on screen for the whole run. Empty in
   * documents written before it existed; the linter requires it. */
  goal: z.string(),
  /** `You will:` — one line on the shape of the work ahead: "log in and
   * out several times, change the primary email". Read before Start so
   * nothing mid-run is a surprise. */
  youWill: z.string(),
  /** `# You will need` — what must be in the tester's hands before step 1:
   * a mailbox that receives codes, a second browser, a phone. Distinct
   * from `# Prerequisites` (where the run begins, who the tester is, what
   * to start), and rendered open above Start, never collapsed. */
  youWillNeed: z.array(z.string()),
  description: z.string(),
  tags: z.array(z.string()),
  /** `@locations: localhost:8080, *.acme.com` — host globs naming where
   * this case is meant to run. Never gates anything: an address a run
   * builds is shown green when its host fits one of these and red when it
   * fits none, so a tester on the wrong tab sees it before clicking. The
   * first entry with no wildcard is also what a run with no page behind it
   * (the viewer, a downloaded copy) uses for `%DOMAIN%`. Empty when the
   * document declares none. */
  locations: z.array(z.string()),
  /** `# Domains`, in declaration order — the first is the main domain.
   * Includes the implicit `DOMAIN` entry when the text uses it undeclared. */
  domains: z.array(testCaseDomainSchema),
  variables: z.array(testCaseVariableSchema),
  dependencies: z.array(z.string()),
  prerequisites: z.array(z.string()),
  /** `# Steps: <title>` sections in document order — empty for a case whose
   * steps all sit under a plain `# Steps`. */
  groups: z.array(stepGroupSchema),
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
  currentVersion: caseVersionIdSchema,
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
    /** The tester's opinion of the step as a piece of test writing, one to
     * five stars, null for the ordinary step nobody rated. Independent of
     * the verdict: a step can fail and still be written excellently, and
     * pass while being a chore. See `shared/src/rating.ts`. */
    rating: ratingSchema.nullable().default(null),
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

/** One mid-run version hot-swap: the tester loaded an agent-patched
 * version into an in-flight run. Recorded so the run says which text each
 * step actually executed against, and so the panel can tell an offer it
 * already took from one still open. */
export const runSwapSchema = z.object({
  fromVersion: caseVersionIdSchema,
  toVersion: caseVersionIdSchema,
  at: z.string(),
  /** The question whose answer proposed the patch, null for a swap that
   * arrives some other way. */
  questionId: z.string().nullable(),
});

export const runStatusSchema = z.enum(["in_progress", "passed", "failed", "aborted"]);

/** How much of the case a run covers. `quick` executes only the steps
 * marked `Kind: quick`; `full` executes all of them. Recorded on the run
 * because "it passed" means different things for each. */
export const runTierSchema = z.enum(["quick", "full"]);

/** One drawn operation on a screenshot, in the source PNG's pixel space
 * (device pixels, as Chrome captured them). Render order is blurs, then
 * the other shapes in list order, then the crop — so a callout over a
 * blurred field stays crisp, and shapes are addressed against the uncropped
 * capture and survive the crop being changed. There is at most one crop.
 * Geometry lives in the extension's `lib/screenshot-render.ts`. */
export const screenshotOpSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("crop"), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  z.object({ tool: z.literal("blur"), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  z.object({ tool: z.literal("line"), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), color: z.string() }),
  z.object({ tool: z.literal("arrow"), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), color: z.string() }),
  z.object({ tool: z.literal("rect"), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(), color: z.string() }),
  z.object({ tool: z.literal("callout"), x: z.number(), y: z.number(), n: z.number().int().positive(), color: z.string() }),
]);

/** One screenshot taken during a run or a free run. The bytes are
 * `screenshots/<seq>.png` (rendered with `ops`) and
 * `screenshots/<seq>.source.png` (exactly as captured, never modified)
 * beside `run.json` / `free-run.json`; this record is what the JSON
 * carries. */
export const runScreenshotSchema = z.object({
  id: z.string(),
  /** 1-based capture order; the file stem, zero-padded to two digits.
   * Never reused within a run. */
  seq: z.number().int().positive(),
  /** The step it illustrates, or null for the run as a whole (always null
   * in a free run). */
  stepId: z.string().nullable(),
  /** Which `### Photo` of that step it fills (1-based), null when taken by
   * hand. One screenshot per slot; retaking replaces. Moving to another
   * step clears it. */
  slot: z.number().int().positive().nullable(),
  takenAt: z.string(),
  /** Bumped on every edit; the panel keys its thumbnail cache on it. */
  updatedAt: z.string(),
  pageUrl: z.string(),
  caption: z.string(),
  /** Source PNG dimensions. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  ops: z.array(screenshotOpSchema),
  /** Spec selectors that matched nothing when the runner took it. */
  missing: z.array(z.string()),
});

/** On-disk shape of `run.json` — run-level status plus per-step state only.
 * `testCaseTitle` is a denormalized convenience copy for cheap listing;
 * `case.md` next to it remains the source of truth for step definitions. */
export const runFileSchema = z.object({
  id: z.string(),
  testCaseId: z.string(),
  testCaseVersion: caseVersionIdSchema,
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
  /** The tester's opinion of the case as a whole, one to five stars, null
   * when they gave none — which is the ordinary run. Feeds the per-project
   * ratings the authoring skills read; see `shared/src/rating.ts`. */
  rating: ratingSchema.nullable().default(null),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** The resolved variable values this run was frozen with. `case.md` keeps
   * the substituted text, not the values, so composing a candidate version
   * identically during a hot-swap is impossible without this snapshot.
   * Defaulted for runs recorded before hot-swap existed — an empty map on a
   * case that declares variables simply makes the swap unavailable. */
  variables: z.record(z.string()).default({}),
  /** Audit trail of mid-run hot-swaps, oldest first. Empty for the common
   * run that finishes on the version it started with. */
  swaps: z.array(runSwapSchema).default([]),
  /** Every screenshot of the run, in capture order — see
   * `runScreenshotSchema`. Defaulted so runs recorded before screenshots
   * existed still parse. */
  screenshots: z.array(runScreenshotSchema).default([]),
  /** The highest `seq` ever handed out, so a removed or retaken screenshot's
   * number (and file stem) is never reused — a stale `%PHOTO_n%` must not
   * quietly point at a different picture. Defaulted for older files. */
  screenshotSeq: z.number().int().nonnegative().default(0),
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
  rating: ratingSchema.nullable(),
});

/** Composed, in-memory view of a run — case.md + run.json merged. This is
 * what TestCaseStore/RunStore callers see; the on-disk split is an
 * implementation detail of the store. */
export const runSchema = z.object({
  id: z.string(),
  testCaseId: z.string(),
  testCaseVersion: caseVersionIdSchema,
  testCaseTitle: z.string(),
  status: runStatusSchema,
  comment: z.string(),
  tier: runTierSchema,
  environment: z.string(),
  consoleInReport: z.boolean(),
  rating: ratingSchema.nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** From the frozen `case.md`, so a tester can see what had to be true
   * before step 1 — a service started, a fixture seeded — without leaving
   * the run to go read the case. Composed, not stored: `run.json` holds
   * execution state only. */
  dependencies: z.array(z.string()),
  prerequisites: z.array(z.string()),
  /** The frozen `case.md`'s goal, shape of the work, and needs — pinned in
   * the run header and shown before the first step. Composed. */
  goal: z.string(),
  youWill: z.string(),
  youWillNeed: z.array(z.string()),
  /** The frozen `case.md`'s step groups, so the panel can head each group's
   * steps with its goal. Composed, like the two lists above. */
  groups: z.array(stepGroupSchema),
  /** The frozen `case.md`'s `@locations` globs, so the run screen can colour
   * every address it shows by whether the host fits. Composed. */
  locations: z.array(z.string()),
  /** The address the run's main domain resolved to — what a bare-route
   * `Where:` opens against. Composed from the frozen `case.md`'s first
   * domain and `run.json`'s value snapshot; "" when the case declares no
   * domain (a legacy `BASE_URL` variable counts as one). */
  mainOrigin: z.string(),
  /** From `run.json` — the panel needs it to tell a patch offer it already
   * loaded from one still open. */
  swaps: z.array(runSwapSchema),
  /** From `run.json`; the panel groups them by `stepId`. */
  screenshots: z.array(runScreenshotSchema),
  /** The frozen `case.md`'s kind — a guide's run words its verdicts
   * differently. Composed. */
  kind: z.enum(CASE_KINDS),
  steps: z.array(runStepSchema),
});

/** On-disk `free-run.json` — metadata only; the captured text lives in
 * `notes.md` next to it. `finishedAt: null` means the session is still open. */
export const freeRunFileSchema = z.object({
  id: z.string(),
  title: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** Screenshots taken during the session, `stepId` and `slot` always
   * null; `notes.md` places them with `%PHOTO_<seq>%`. Defaulted so free
   * runs from before screenshots existed still parse. */
  screenshots: z.array(runScreenshotSchema).default([]),
  /** See `runFileSchema.screenshotSeq`. */
  screenshotSeq: z.number().int().nonnegative().default(0),
});

/** All fields optional by design — a partial update applied to one run step. */
export const stepPatchSchema = z.object({
  status: runStepStatusSchema.optional(),
  comments: z.array(runCommentSchema).optional(),
  draft: runCommentDraftSchema.nullable().optional(),
  automatedResult: automatedResultSchema.nullable().optional(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  rating: ratingSchema.nullable().optional(),
});

// ---- the agent channel: `agent/` in the data folder ---------------------
//
// Three separately-shipped parts speak this protocol — the extension (Web
// Store), the plugin's serve skill (marketplace), and the enloopd daemon
// (repo build). Each declares AGENT_PROTOCOL_VERSION in the files it
// writes (heartbeat for the extension, watcher files for servers), and
// each warns when a counterpart disagrees. Bump ONLY on a change an older
// counterpart would misread — additive optional fields never bump it.
//
// The panel and a looping agent session (`/enloop:serve`) share nothing but
// the data folder, so every request and reply below is a file, and state is
// derived from file presence — the panel document does not survive a click
// into the page under test, and the agent only exists for one tick at a
// time. Layout: `agent/questions/<id>/` (question.json, ack.json,
// progress.json, answer.md, answer.json) and `agent/commands/<id>/`
// (request.json, run.sh, pid, status.json, output.log, exit-code, kill),
// plus `agent/heartbeat.json`.

/** On-disk `agent/questions/<id>/question.json` — one question a tester
 * asked from a run step. Carries enough context (run, version, step) for a
 * session that has never seen this run to answer without asking back. */
export const agentQuestionFileSchema = z.object({
  id: z.string(),
  testCaseId: z.string(),
  runId: z.string(),
  testCaseVersion: caseVersionIdSchema,
  stepId: z.string(),
  stepTitle: z.string(),
  /** What the tester had selected in the step when they asked — the "this"
   * their question points at. Empty when nothing was selected. */
  selection: z.string(),
  question: z.string(),
  environment: z.string(),
  /** URL of the page in front of the tester when they asked — where "here"
   * was. Empty when no scriptable tab was there. */
  pageUrl: z.string().default(""),
  /** Files saved next to question.json: `screenshot.png` (the visible tab)
   * and/or `page.html` (a sanitized DOM snapshot — scripts and styles
   * stripped, structure and attributes kept, so selectors can be verified
   * against it). Defaulted so questions from before attachments existed
   * still parse. */
  attachments: z.array(z.string()).default([]),
  askedAt: z.string(),
});

/** On-disk `test-cases/<id>/context.json` — authoring provenance, stamped
 * automatically by the plugin's guard hook every time a version lands:
 * which session wrote it, from which repo, on which machine. The daemon
 * answers questions about the case by resuming that session headlessly
 * when the host matches; machine-local by nature, so the extension keeps
 * it out of version control via the folder's .gitignore. */
export const caseContextSchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  host: z.string(),
  /** The authoring session's CLAUDE_CONFIG_DIR, when it had one — login
   * and session store both live there, so isolated per-project config
   * dirs stay isolated: the daemon resumes with this exact dir set. */
  claudeConfigDir: z.string().optional(),
  updatedAt: z.string(),
});

/** See the header note above: the wire version of `agent/`, declared by
 * every participant, compared at every meeting point. */
export const AGENT_PROTOCOL_VERSION = 1;

/** On-disk `agent/heartbeat.json` — the panel's liveness signal. Servers
 * read the mtime for staleness; the body says who the panel is, so a
 * server can flag a protocol mismatch. Absent fields = a pre-versioning
 * extension = protocol 1. */
export const agentHeartbeatSchema = z.object({
  touchedAt: z.string(),
  protocol: z.number().int().optional(),
  extension: z.string().optional(),
});

/** Who a channel server is: an interactive Claude Code serve loop, or the
 * standalone enloopd daemon. */
export const agentWatcherKindSchema = z.enum(["claude-code", "daemon"]);

/** On-disk `agent/watchers/<id>.json` — a server announcing itself once
 * per pass/tick. Freshness is what arbitration reads: the daemon defers to
 * a Claude Code loop that has been seen recently, because that session
 * likely holds the context of the task being tested. Nobody deletes
 * another watcher's file; stale ones are just ignored. */
export const agentWatcherSchema = z.object({
  id: z.string(),
  kind: agentWatcherKindSchema,
  host: z.string(),
  lastSeenAt: z.string(),
  /** Wire version this server speaks; absent = pre-versioning = 1. */
  protocol: z.number().int().optional(),
  /** The server's own release, for humans in mismatch messages. */
  serverVersion: z.string().optional(),
});

/** On-disk `ack.json`, written by the agent the moment a pass sees the
 * question — before reading a single source file — so the panel can turn
 * "waiting for an agent" into "working on the answer" instead of leaving
 * the tester staring at the first for the whole think time. `by` says
 * which server claimed it (absent in acks from older skill versions); on
 * an ack race the daemon always yields to Claude Code. */
export const agentQuestionAckSchema = z.object({
  id: z.string(),
  pickedUpAt: z.string(),
  by: z.object({ id: z.string(), kind: agentWatcherKindSchema }).optional(),
});

/** On-disk `progress.json`, rewritten by the server while it works on an
 * acked question: one short line, in the server's own words, saying what
 * it is doing right now — "Reading the reset form in ResetForm.tsx",
 * "Found the field — writing the answer". Optional and additive (protocol
 * 1): an old server never writes it and the panel falls back to the
 * generic "working on the answer". It exists because the think time on a
 * real question is a minute or more, and a line that has not changed in a
 * minute reads as a server that died. `at` is when the line was written,
 * so the panel can say how long ago that was. */
export const agentQuestionProgressSchema = z.object({
  id: z.string(),
  at: z.string(),
  text: z.string(),
});

/** On-disk `answer.json`, written by the agent after `answer.md` — its
 * presence is the completion marker, so a half-written answer is never
 * shown. */
export const agentAnswerMetaSchema = z.object({
  id: z.string(),
  answeredAt: z.string(),
  /** One line for collapsed views; the full answer is `answer.md`. */
  summary: z.string(),
  /** Version the agent landed as a candidate patch, null when the answer
   * needed no case change. A claim, not a promise: the panel re-verifies
   * compatibility itself before offering to load it. */
  proposedVersion: caseVersionIdSchema.nullable(),
});

export const AGENT_COMMAND_SOURCE_FIELDS = [
  "dependencies",
  "prerequisites",
  "instructions",
  "note",
] as const;
/** Which part of the case the command was quoted from — `stepId` is null
 * exactly when this is a run-level field. */
export const agentCommandSourceFieldSchema = z.enum(AGENT_COMMAND_SOURCE_FIELDS);

/** On-disk `agent/commands/<id>/request.json` — a case-authored shell
 * command the tester asked the watching session to run. The agent refuses a
 * command it cannot find verbatim in the case (provenance), so this is a
 * pointer to authored text, not a way to run arbitrary strings. */
export const agentCommandRequestSchema = z.object({
  id: z.string(),
  testCaseId: z.string(),
  runId: z.string(),
  stepId: z.string().nullable(),
  sourceField: agentCommandSourceFieldSchema,
  command: z.string(),
  /** Hard cap on the process's life; 0 = uncapped, though the heartbeat
   * still bounds it. */
  timeoutSeconds: z.number().int().nonnegative(),
  requestedAt: z.string(),
});

/** On-disk `status.json`, agent-written. For completion the wrapper-written
 * `exit-code` file outranks it — the agent only ticks once a minute, so
 * this can honestly say `running` after the process died. */
export const agentCommandStatusSchema = z.object({
  state: z.enum(["running", "exited", "killed", "refused"]),
  pid: z.number().int().nullable(),
  startedAt: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  endedAt: z.string().nullable(),
  reason: z.enum(["user", "heartbeat", "timeout", "provenance", "orphaned"]).nullable(),
  /** Watcher id of the server that spawned the process. The pid means
   * nothing on any other machine, so only the owner kills, reaps, or
   * heartbeat-sweeps it. Absent in statuses from older skill versions. */
  owner: z.string().optional(),
});
