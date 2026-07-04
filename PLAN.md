# Plan: human-in-the-loop feedback features

## Purpose and framing

This extension keeps a human in the loop of LLM-driven feature development:
the LLM builds a feature and authors test cases, the human verifies from a
product perspective, and the verdict must flow back to the LLM as files it
can read (`private/test-cases/**/feedback.md`) — without the human acting as
courier. Three features, implemented as **three separate commits, in order**:

- **Part A — Typed step notes + feedback.md handoff.** Even a passing step
  may carry product signal. Notes get types (`note`, `feature`, `bug`,
  `docs`); finishing a run writes a `feedback.md` brief for the LLM.
- **Part B — Free run.** Unscripted verification: demoing to a PM on a
  call, capturing their reactions as one big markdown textarea — no test
  case, no steps. Output is the same `feedback.md` handoff artifact.
- **Part C — Test case suites.** A task often ships several independently
  testable features sharing common setup. A suite is a *physical folder*
  containing case folders plus a `suite.md` with shared preparation steps.
  Cases without a suite remain fully supported. Sharing = copying a folder.

Out of scope (do not build): screenshots, "what changed" context blocks,
needs-verification queue, run scheduling.

## Context — read these files first

- `shared/src/schemas.ts` — zod schemas. Per-step run state
  (`runStepStateSchema`, `runStepSchema`, `stepPatchSchema`) currently has
  `notes: z.array(z.string())`. NOTE the file-top comment: this codebase
  avoids zod `.default()` on purpose; don't introduce it.
- `shared/src/types.ts` — types are `z.infer` re-exports of schemas.
- `shared/src/id.ts` — id helpers (`newTaskId`, `newRunId` are the patterns).
- `shared/src/markdown.ts` — the case-document grammar (doc comment at top
  is the spec), `parseCaseDocument`, `renderRunReport`.
- `shared/src/storage.ts` — `TestCaseStore`/`RunStore` interfaces.
- `extension/src/lib/fsa-store.ts` — `FsaDataStore` (File System Access
  implementation). `finishRun()` writes `report.md`; `composeRun()` merges
  frozen `case.md` with `run.json`; case dirs are found via
  `getDir(testCasesDir, id)`.
- `extension/src/sidepanel/App.tsx` — screen stack; `LibraryScreen.tsx`,
  `RunScreen.tsx`, `RunHistoryScreen.tsx`, `EditorScreen.tsx`,
  `CaseDetailScreen.tsx`, `RunSetupScreen.tsx`.
- Disk layout today:
  - `private/test-cases/test-cases/<caseId>/{meta.json, versions/vN.md}`
  - `private/test-cases/runs/<caseId>/<runId>/{case.md, run.json, report.md}`
  - `private/` is git-ignored local data. Real historical `run.json` files
    exist and **must keep parsing** after Part A.

---

# Part A — Typed step notes + feedback.md

## A1 — shared: schema + types + id

In `shared/src/schemas.ts`:

```ts
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
```

Replace:
- `runStepStateSchema`: `notes: z.array(runNoteOrLegacySchema)`
- `runStepSchema`: same
- `stepPatchSchema`: `notes: z.array(runNoteSchema).optional()` (patches
  come only from new code — keep strict)

`shared/src/types.ts`: re-export `NoteType`, `RunNote` following the
existing pattern. `shared/src/id.ts`: add `newNoteId()` = `note-${shortId()}`
(UI uses it; the inline randomUUID in the transform is fine — legacy notes
getting a fresh id per read is harmless because `updateStep` rewrites
run.json normalized on first write).

## A2 — shared: update `renderRunReport`

Notes are now objects. Render with labels:

```
Notes:
- [feature request] The empty state copy is confusing
```

Add one exported label map (reused by report, feedback, and UI):

```ts
export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  note: "note",
  feature: "feature request",
  bug: "bugfix required",
  docs: "docs update required",
};
```

## A3 — shared: `renderRunFeedback`

New in `shared/src/markdown.ts`:

```ts
export function renderRunFeedback(doc: TestCaseVersion, run: RunFile): string | null
```

Returns `null` when no step has any signal: status `failed`/`warning`, a
non-empty `comment`, any note, or an `automatedResult.error`. Callers skip
writing on `null` — a clean silent pass produces no feedback noise.

Template:

```markdown
# Feedback: <case title> (v<version>, run <runId>)

Human verification run finished <finishedAt> with status **<status>**.
<N> failed, <N> warnings, <N> feedback notes.

This file was written by a human tester reviewing the feature. Address the
action items below. Step-by-step detail follows for context.

## Action items

### Bugfix required
- **<step title>** (step <n>, <status>): <note text>

### Feature requests
- **<step title>** (step <n>): <note text>

### Docs updates
- **<step title>** (step <n>): <note text>

### Failed steps
- **<step title>** (step <n>): <comment and/or automated error inline>

## Step detail

### ❌ 3. <step title> (failed)
Expected: <step.expected, if any>
Comment: <state.comment, if any>
Notes:
- [bugfix required] <text>
Automated error: <automatedResult.error, if any>
```

Rules: action-item sections appear only when non-empty; `bug`/`feature`/
`docs` notes go to their sections regardless of step status (a passing
step's feature request is a first-class action item); "Failed steps" lists
failed steps that have no `bug` note, so a bare Fail click still lands as
an action item; plain `note`s appear only in Step detail; Step detail
includes only steps with signal. Reuse `STATUS_ICON` + `NOTE_TYPE_LABELS`.

## A4 — store: write feedback on finish

In `fsa-store.ts` `finishRun()`, after `report.md`:

```ts
const feedback = renderRunFeedback(doc, updated);
if (feedback) await writeTextFile(runDir, FEEDBACK_FILE, feedback);
```

`const FEEDBACK_FILE = "feedback.md"` next to `REPORT_FILE`.

## A5 — UI: RunScreen note input, badges, delete

In `StepRow`:
- Add-note row: compact `<select>` of the four types (default `note`)
  before the existing input; Add pushes
  `{ id: newNoteId(), type, text }`.
- Notes list: colored type badge + text, matching existing badge idiom:
  `note` slate, `feature` violet (`bg-violet-100 text-violet-700`),
  `bug` red, `docs` sky. Labels from `NOTE_TYPE_LABELS`.
- When `!readOnly`, an `×` per note that filters it out by id (mis-typed
  notes need an undo path now that types exist).

When the run is finished and has signal, show a small banner above the
step list: "Feedback saved to feedback.md in this run's folder — point
Claude Code at it." (Recompute the signal predicate inline from
`run.steps`.)

## A6 — verification

1. `npm run typecheck` and `npm run build` clean; `extension/dist` mtimes moved.
2. Legacy compat, with a scratch shared build
   (`cd shared && npx tsc -p tsconfig.json --noEmit false --outDir dist --declaration false`)
   and a throwaway Node script:
   - parse a real historical run.json, e.g.
     `private/test-cases/runs/the-internet-login-flow-71aaf1b8/run-2026-07-03T01-07-27-846Z-70111c29/run.json` — must pass;
   - parse a synthetic run.json with `notes: ["legacy string"]` — must
     normalize to `{id, type: "note", text}`;
   - `renderRunFeedback`: zero-signal run → `null`; a run with a `feature`
     note on a passed step + a bare failed step + a `docs` note → all three
     land in the right sections.
   Delete `shared/dist` and the script afterward.
3. Live: reload extension, run a case, add one note of each type on a
   passed step, fail one step with a comment, finish — check `feedback.md`
   on disk matches the template and `report.md` shows typed labels.

**Commit 1**: `Typed step notes (note/feature/bug/docs) + feedback.md handoff`

---

# Part B — Free run

An unscripted session: title + one big markdown textarea, saved as
`feedback.md` so the LLM handoff is identical to scripted runs.

## B1 — disk layout and schema

New top-level dir beside `runs/`:

```
private/test-cases/free-runs/<freeRunId>/free-run.json   (metadata only)
private/test-cases/free-runs/<freeRunId>/feedback.md     (the text itself)
```

The markdown text lives **only** in `feedback.md` (single source of truth,
directly shareable); `free-run.json` is metadata:

```ts
export const freeRunFileSchema = z.object({
  id: z.string(),
  title: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),  // null = still open
});
```

Types: `FreeRunFile`; a composed `FreeRun = FreeRunFile & { notes: string }`
(plain interface in types.ts is fine). `shared/src/id.ts`: add
`newFreeRunId()` — same shape as `newRunId()` but `free-` prefix.

`feedback.md` content written to disk = a small header + the raw textarea
text:

```markdown
# Free run feedback: <title>

Session started <startedAt>, captured live (demo/unscripted testing).

<raw textarea markdown>
```

Regenerate the whole file on every save (title changes included). When
reading back for the editor, store the raw text separately — simplest:
keep the raw text in `notes.md` and *derive* `feedback.md` from it on each
save. Two files, but no fragile header-stripping on read:

```
free-runs/<id>/free-run.json   metadata
free-runs/<id>/notes.md        raw textarea content (read+write)
free-runs/<id>/feedback.md     derived handoff artifact (write-only)
```

## B2 — store API

In `shared/src/storage.ts`, new interface merged into `DataStore`:

```ts
export interface FreeRunStore {
  listFreeRuns(): Promise<FreeRunFile[]>;          // newest first
  getFreeRun(id: string): Promise<FreeRun>;
  createFreeRun(title: string): Promise<FreeRun>;
  updateFreeRun(id: string, patch: { title?: string; notes?: string }): Promise<FreeRun>;
  finishFreeRun(id: string): Promise<FreeRun>;
}
```

Implement in `FsaDataStore` following the existing run methods' style
(`getDir`/`readJson`/`writeJson`/`writeTextFile`/`readTextFile`;
`tryReadJson` + skip unparseable dirs in the lister). `finishFreeRun` sets
`finishedAt` and rewrites `feedback.md` one last time.

## B3 — UI

- New `FreeRunScreen.tsx`: title input at top; a full-height monospace
  textarea (like EditorScreen's); autosave via `updateFreeRun` on blur and
  on a ~2s debounce after typing stops; a "Finish" button that calls
  `finishFreeRun` and pops back. Finished free runs open read-only
  (disabled textarea), same convention as RunScreen.
- `App.tsx`: add `{ kind: "freeRun"; freeRunId: string }`.
- `LibraryScreen`: next to "+ New test case", a secondary "Free run"
  button → `createFreeRun("Free run <date>")` then push the screen.
- `RunHistoryScreen`: also fetch `listFreeRuns()`; interleave with regular
  run summaries by `startedAt`, rendering free runs with a `free` badge
  (violet) and title; clicking opens `FreeRunScreen`. Free runs show
  status "in progress"/"finished" from `finishedAt`.

## B4 — verification

1. typecheck + build clean.
2. Live: create a free run from Library, type markdown, blur, check
   `notes.md` + `feedback.md` on disk; Finish; reopen from history —
   read-only; confirm it's listed interleaved with scripted runs.

**Commit 2**: `Free run: unscripted feedback capture with feedback.md handoff`

---

# Part C — Test case suites

A suite is a physical folder under `test-cases/` holding a `suite.md`
(shared description + preparation steps + shared variables) and case
subfolders. Standalone cases stay exactly where they are. **Sharing is
folder-copy**: copy `test-cases/<suiteId>/` → whole suite travels with its
cases; copy one case folder out → standalone case. Ids are globally unique
(slug + random suffix) so drop-ins can't collide.

## C1 — disk layout and discrimination

```
test-cases/
  some-case-1defa223/            # standalone case  (has versions/)
    meta.json
    versions/v1.md
  checkout-flow-ab12cd34/        # suite            (has suite.md)
    suite.md
    meta.json                    # { "archived": false } — reuse caseBookkeepingSchema
    apply-coupon-9f8e7d6c/       # case inside the suite (has versions/)
      meta.json
      versions/v1.md
```

Rule: a dir containing `suite.md` is a suite; a dir containing `versions/`
is a case. Exactly one level of nesting — no suites inside suites. Ignore
dirs that are neither (consistent with the existing skip-unparseable
behavior in `listTestCases`).

## C2 — suite.md grammar

`suite.md` reuses the case grammar verbatim (title, `@version`/`@author`,
`Tags:`, description, `# Variables`, `# Dependencies`, `# Prerequisites`,
`# Steps`) with one relaxation: **steps are optional** — a suite's steps
are its shared preparation steps and a suite may have none.

Parser change in `shared/src/markdown.ts`: add an options param
`parseCaseDocument(raw, fallback, opts?: { requireSteps?: boolean })`,
default `true`; the existing "No steps found" throw becomes conditional.
Update the grammar doc comment to mention suite.md. Add
`starterSuiteTemplate()` next to `starterCaseTemplate()` (title, Tags,
description placeholder, one example prep step under `# Steps`).

Suite.md is **not versioned** in v1 — edits overwrite the file in place.
(Case version history exists because runs freeze against a version; suite
prep steps get frozen *into each run's case.md* — see C4 — so history is
already preserved per-run.)

## C3 — store API and nested lookup

`shared/src/types.ts`:

```ts
export interface SuiteSummary {
  id: string;
  title: string;
  description: string;
  tags: string[];
  caseCount: number;
  archived: boolean;
}
```

`TestCaseSummary` and `TestCaseMeta` gain `suiteId?: string`.

`shared/src/storage.ts` — extend `TestCaseStore`:

```ts
listSuites(): Promise<SuiteSummary[]>;
getSuite(id: string): Promise<{ doc: TestCaseVersion; cases: TestCaseSummary[]; archived: boolean }>;
getSuiteSource(id: string): Promise<string>;
createSuite(bodyMarkdown: string): Promise<SuiteSummary>;
saveSuite(id: string, bodyMarkdown: string): Promise<void>;      // overwrite suite.md
archiveSuite(id: string, archived: boolean): Promise<void>;
// existing method gains an optional arg:
createTestCase(bodyMarkdown: string, suiteId?: string): Promise<TestCaseMeta>;
// merged raw markdown a run should freeze (see C4):
getRunSource(testCaseId: string, version: number): Promise<string>;
```

`FsaDataStore` changes:
- Private helper `findCaseDir(id)`: check `test-cases/<id>` first; if
  absent (or it's a suite dir), scan each suite dir's children. Returns
  `{ dir, suiteId? }`. Switch **all** case-path call sites to it
  (`getTestCase`, `listVersions`, `getVersion`, `getVersionSource`,
  `createVersion`, `archiveTestCase`, `createRun`).
- `listTestCases`: walk root dirs; suite dirs (have `suite.md`) recurse one
  level, stamping `suiteId` on nested summaries.
- Suite ids via the existing `newTestCaseId(title)` generator.
- Parse `suite.md` with `{ requireSteps: false }`, fallback version 1 /
  file mtime, same as versions.
- Runs layout is **unchanged** (`runs/<caseId>/<runId>/`) — case ids are
  globally unique, so nesting doesn't affect run storage or `listRuns`.

## C4 — merging prep steps into runs

The run engine and `case.md` freezing stay untouched; merging happens on
the raw markdown *before* freezing, so prep steps become ordinary tracked
steps of the run.

New shared helper in `shared/src/markdown.ts`:

```ts
export function buildRunSource(caseMarkdown: string, suiteMarkdown: string | null): string
```

When `suiteMarkdown` is null/has nothing to contribute, returns
`caseMarkdown` unchanged. Otherwise, operating on raw section text (add a
small internal `extractSectionRaw(markdown, headingName)` that returns a
top-level section's inner text using the same `# ` splitting logic as
`splitTopSections`):

1. **Steps**: take the suite's `# Steps` inner text, prefix every `## `
   step heading with `Prep: ` (`## Login` → `## Prep: Login`), and insert
   it at the top of the case's `# Steps` section, before the case's own
   steps. (Step ids are assigned by index at parse time of the merged doc,
   so ids/order come out consistent automatically.)
2. **Variables**: append the suite's `## NAME` variable subsections into
   the case's `# Variables` section (create the section if the case lacks
   one), **skipping any suite variable whose name the case already
   declares** (case wins). This makes suite-level `%VARS%` in prep steps
   resolve through the existing RunSetup flow with zero changes to the
   substitution code.
3. **Dependencies / Prerequisites**: concatenate bullet lists the same way
   (suite's first). Nice-to-have — if it complicates the helper, steps +
   variables are the required minimum.

`FsaDataStore.getRunSource(caseId, version)`: read the version's raw
markdown; if `findCaseDir` says the case is in a suite, read `suite.md`
and return `buildRunSource(caseMd, suiteMd)`, else the case markdown as-is.

Rewire the two consumers of raw run markdown to this single path:
- `createRun`: use `getRunSource` output for parse → variable resolution →
  substitution → freeze (replaces its direct `readTextFile` of the version).
- `RunSetupScreen`: parse `getRunSource` (instead of `getVersion`) so the
  variable prompt includes suite variables.
- `CaseDetailScreen.startRun`: decide the variables-vs-direct route by
  parsing `getRunSource` too (a case with no own variables may still
  inherit suite variables).

## C5 — UI

- `LibraryScreen`: group the flat list — one section per suite (header row:
  suite title, case count, `suite` badge; clicking it opens SuiteDetail),
  then an "Ungrouped" section (no header needed if there are no suites).
  Search filters within groups; a suite header also matches on its own
  title/tags. "+ New test case" keeps creating standalone cases; add a
  "+ New suite" affordance (small button next to it).
- New `SuiteDetailScreen.tsx`: title/description/tags, prep-step list
  (read-only preview, same card style as CaseDetail), the suite's cases
  (clickable), buttons: "New case in suite", "Edit suite", "Archive".
- `EditorScreen`: gains a mode. Screen union entries:
  `{ kind: "editor"; testCaseId?: string; suiteId?: string }` (new case in
  suite when `suiteId` set and no `testCaseId`) and
  `{ kind: "suiteEditor"; suiteId?: string }` (new suite when undefined,
  edit when set). SuiteEditor reuses EditorScreen's layout with
  `starterSuiteTemplate()`, parse preview with `{ requireSteps: false }`,
  and `createSuite`/`saveSuite` on save.
- `App.tsx`: add `suiteDetail` + `suiteEditor` screens and wire pushes.

No move-case-between-suites UI in v1 — moving the folder on disk is the
supported way (document this in the SuiteDetail empty-state hint or skip).

## C6 — verification

1. typecheck + build clean.
2. Parser/merge unit check with a scratch shared build + throwaway script:
   - `parseCaseDocument` with `{requireSteps: false}` accepts a stepless
     suite doc; default still rejects stepless case docs;
   - `buildRunSource`: suite with 2 prep steps + 1 variable merged into a
     case with 2 steps + 1 own variable → parse the merged text and assert:
     4 steps in order (2 `Prep: `-prefixed first), 2 variables, case's
     duplicate-named variable wins; case not in suite → passthrough.
   Delete scratch dist + script.
3. Live: create a suite via UI, create a case inside it, confirm existing
   standalone cases (real ones exist in `private/`) still list and open;
   start a run of the suite's case → RunSetup shows suite variables; the
   run shows prep steps first and the frozen `case.md` on disk contains
   them; copy the suite folder to a new name on disk → both suites list.

**Commit 3**: `Test case suites: folder-based grouping with shared prep steps`

---

# After all parts

Do not commit anything under `private/` (git-ignored) or `PLAN.md` itself;
delete PLAN.md once all three parts are implemented and verified.
