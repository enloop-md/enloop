# Screenshots, photos the runner takes, and guides — implementation plan

Status: **written 2026-09-11; parts 1–8 built the same day, uncommitted; typecheck, build, build:plugin and the validator smoke tests pass; not yet exercised in a loaded extension (Gates 5 and 6).**

Decided while building, where the plan left it open:

- `run.json` / `free-run.json` carry `screenshotSeq`, a counter that never
  goes down, so a removed or retaken screenshot's number is never reused.
- `FsaDataStore` serialises every read-modify-write of one run folder
  (verdicts, comments, screenshots, swaps) through a per-folder lock; the
  runner and a verdict used to race for `run.json`.
- The injected measurer cancels running page animations before it waits,
  so a `Take: before` photo never shows Highlight's orange flash.
- Runner-taken photos are stored with an empty caption; the spec caption
  is the fallback everywhere a caption is shown.
- The Take button is offered on any unfilled slot, not only manual ones,
  so a deleted or failed runner photo can be taken again.
- `--force` only empties a folder that holds nothing but a previous
  export's `README.md`, `index.html` and `images/NN.png`.
- Automated steps run as part of a chain (`chainAutomatedFrom`) do not
  take `after` photos; only the step whose Run button was pressed does.
- The library learns a case's kind by loading its current version after
  the list renders; summaries were left unchanged.

Decided where the plan was silent (parts 4–8): runner-taken photos are
stored with an empty caption and the spec caption is the input's
placeholder; `after` photos are taken only for the automated step the
tester pressed Run on, not for steps `chainAutomatedFrom` runs on its
own; a discarded or failed runner slot is not re-fired (a failed one gets
a **Take** retry on the spec row); the free-run caret is the last one seen
in the textarea, else the placeholder is appended on its own line;
`--project` on `list-guides` drops free runs (they have no project);
a rendered PNG missing on disk is still referenced by `export-guide` and
reported as `WARN`; the `guide` badge in the Library is learned by a
background `getVersion` per listed case, since summaries carry no `kind`.

This plan is written to be executed by a separate session ("implement
PLAN-GUIDES.md"). Every design decision below is locked; do not re-litigate
any of them mid-flight. Where the plan says *decided*, build it as written.
Where something is genuinely unspecified, pick the smallest thing that
satisfies the verification gate and note it in the status line at the top
of this file. **Do not commit** — the user commits. Update the status line
above after each part lands.

Read first, in this order:

1. `MANIFESTO.md` — the principle. Zero effort from the human.
2. `shared/src/schemas.ts` — `stepSchema` (~95), `testCaseVersionSchema`
   (~148), `runStepStateSchema` (~314), `runFileSchema` (~398), `runSchema`
   (~461), `freeRunFileSchema` (~505), `agentQuestionFileSchema` (~544, the
   only binary-attachment precedent).
3. `shared/src/storage.ts` — `RunStore` (68), `FreeRunStore` (134),
   `AgentChannelStore` (168); the comment on `appendConsole` about what may
   and may not go in `run.json`.
4. `shared/src/markdown.ts` — the grammar doc comment (1–440), header
   parsing (`@project` ~454), the step-body splitter for `### Expected` /
   `### Note` (~766), `renderCaseMarkdown` (~915, subsections at ~1018),
   `renderRunReport` (~1278), `renderRunFeedback` (~1428).
5. `shared/src/variables.ts` — how `%NAME%` is found and substituted; the
   `%PHOTO_n%` placeholder must pass through untouched.
6. `shared/src/lint.ts` — `lintCase`, rule ids, rule `3b` (~625), the
   undeclared-variable check.
7. `shared/src/html.ts` — `renderMarkdown`, `renderInline`,
   `CASE_PAGE_CSS` — reused by the HTML export.
8. `extension/src/lib/fs-utils.ts` — `writeBinaryFile` (149); there is no
   binary read helper yet. `NotFoundError` at line 3.
9. `extension/src/lib/fsa-store.ts` — file-name constants (88–139),
   `createRun` (678), `updateStep` (737), `finishRun` (798, writes
   `report.md`), `askQuestion` (~985, writes `screenshot.png` *before*
   `question.json`), `getRunDir` (879), `createFreeRun` (912).
10. `extension/src/lib/workspace-store.ts` — every `DataStore` method is
    mirrored here; `askQuestion` (~406) shows a `Uint8Array` passing through.
11. `extension/src/lib/page-capture.ts` — `captureScreenshot()` is the only
    `captureVisibleTab` call in the repo. `extension/src/lib/page-access.ts`
    — the per-origin host grant it depends on.
12. `extension/src/lib/highlight.ts` — how a step's selectors are resolved
    in the page; `extension/src/lib/run-engine.ts` — `markManualStep`,
    `runAutomatedStep`, `chainAutomatedFrom`.
13. `extension/src/lib/question-tab.ts` — `chrome.storage.session` usage;
    the editor hand-off uses the same storage.
14. `extension/src/sidepanel/screens/RunScreen.tsx` — state (59–160),
    `handleMark` (166), `StepRow` (1295), the auto-highlight effect
    (~1400), the expanded step body (1480–1700). `readOnly` and
    `currentStepId` (98–104).
15. `extension/src/sidepanel/screens/RunAgentChannel.tsx` 88–160 —
    `StepQuestions`, the capture-and-attach flow to copy the shape of.
16. `extension/src/sidepanel/screens/FreeRunScreen.tsx` — the notes
    textarea (~143) and `updateFreeRun` autosave (~65).
17. `extension/src/components/Markdown.tsx` — `insertValues` and the
    rehype plugin for quoted values; the `%PHOTO_n%` chip hooks in beside it.
18. `extension/src/lib/download.ts` — `downloadTextFile`, `fileSlug`.
19. `shared/src/plugin-entry.ts` and `scripts/build-plugin.mjs` — what the
    validator bundle exports; `lib.mjs` and `grammar.md` are generated and
    committed; rerun `npm run build:plugin` after any `shared/src` change.
20. `plugins/enloop/validator/enloop-case.mjs` — the `case "…"` switch
    (`validate` 210, `write` 373, `brief` 510, `data-folder` 621, `verify`
    735, usage block 1205–1218).
21. `plugins/enloop/skills/full/SKILL.md`, `skills/full/agents/openai.yaml`,
    `plugins/enloop/references/authoring.md`, `references/step-contract.md`,
    `plugins/enloop/hooks/confirm-scope.mjs` line 19.
22. `extension/vite.config.ts`, `extension/manifest.config.ts`,
    `extension/sidepanel.html`.
23. `viewer/src/builder.ts` — `fromMarkdown` / `toDocument` must round-trip
    the new step fields.
24. `docs/extension.md`, `docs/skills.md`, `docs/case-format.md`,
    `CHANGELOG.md` Unreleased.
25. `/home/nord/WORK/RIGEL/ewr-symfony/frontend/template-builder/src/components/includes/PhotoEditor.vue`
    — the reference editor. Read once for the idea; do not port (G8).

There is no unit-test runner in this repo. Verification is `npm run
typecheck`, `npm run build:plugin`, `npm run build`, loading the built
extension, and running the validator against a scratch data folder as each
gate below spells out.

---

## 1. What this changes and why

A run today records verdicts, comments, ratings and the console. It cannot
record what the tester *saw*. And a case run step by step, with a picture
at each step, **is a user guide** — the same grammar, panel and run,
written for an end user, exported as a folder anyone can read.

The point of doing it in Enloop rather than with a screenshot tool is the
manifesto: the human puts in zero effort. A case already knows the
selectors of the things a step is about. So the case can also say *what
the picture is*: which container to crop to, which elements to box, point
at, number, or blur — and the runner takes the picture at the right
moment, finds those elements on the page, draws the marks, and drops the
result into the text where the author put `%PHOTO_1%`. The tester confirms
or retakes; in `auto` mode they do nothing at all.

In one paragraph: every run and every free run gets screenshots, taken by
hand at any moment or by the runner from a `### Photo` spec in the step,
stored as files beside `run.json`, listed there with their annotation
list. A screenshot can be edited in a small editor of our own (crop, line,
arrow, rectangle, numbered callouts, blur, colour), reverted to the
original, captioned, and moved between steps. A case may declare
`@kind guide`; the `guide` skill writes one from source in end-user prose
with photo specs; `export-guide` turns a finished run into a Markdown
folder with images or one self-contained HTML page.

---

## 2. Decisions

Locked in.

| # | Decision | Consequence |
|---|---|---|
| G1 | **Screenshots are a run feature, not a guide feature.** | Every run of every case, and every free run, has the capture buttons and the photo specs. A guide is a case whose *prose* is for an end user; the panel gates only two labels on kind (G12). |
| G2 | **Bytes live in files, records live in `run.json`.** | `runs/<caseId>/<runId>/screenshots/<NN>.source.png` (as captured) and `<NN>.png` (rendered; identical bytes when there are no ops — written always so no reader branches). `run.json` gains a run-level `screenshots` array (§3.1). `NN` is the two-digit capture sequence, never reused within a run. Free runs: the same under `free-runs/<id>/screenshots/`, records in `free-run.json`. |
| G3 | **A screenshot belongs to a step, or to the run, and optionally fills a slot.** | `stepId` is the current step at capture time or `null`. `slot` is the 1-based index of the step's `### Photo` spec it fills, or `null` for a hand-taken shot. One screenshot per slot; retaking replaces. A screenshot can be moved to any step; moving clears its slot. |
| G4 | **Photo specs live in the step, as `### Photo` subsections; placeholders are `%PHOTO_n%`.** | `n` counts the step's `### Photo` blocks in document order. `%PHOTO_n%` in the step's instructions or `### Expected` is where the image lands on export. A spec with no placeholder lands after the instructions. `PHOTO_` is a reserved variable prefix: never a variable, never substituted, never an undeclared-variable finding. Full syntax in §3.3. |
| G5 | **Three modes, two moments.** | `Mode: auto` takes and keeps the photo with no interaction. `Mode: confirm` (default) takes it and shows a preview with **Keep / Retake / Edit / Discard**. `Mode: manual` puts a **📷 Photo n** button on the step preloaded with the spec, and the tester decides when. `Take: after` (default) fires when the tester gives the verdict (or, for an automated step, when the script finishes); `Take: before` fires when the step becomes current, after the auto-highlight has run. Runner-taken photos never fire twice for one slot unless the tester presses Retake. |
| G6 | **The runner marks elements by resolving selectors at capture time.** | One injected script scrolls the crop target (else the first marked element) into view, waits 250 ms, returns every requested rect in device pixels. Marks become ordinary ops (§3.1) — the editor can undo or add to them, nothing is special. A selector that matches nothing is skipped and listed in the record's `missing`; the photo is still taken. |
| G7 | **Crop is one op at most; blur is any number.** | Drawing a crop replaces the existing crop op in place. Render order: source, blurs, shapes, then crop — so a callout over a blurred field stays crisp and a crop never shifts shapes. Coordinates are source pixels (device pixels as Chrome captured them). |
| G8 | **Hand-written canvas editor, no library, no port of PhotoEditor.vue.** | The Vue file is Options API in a React 19 codebase, hard-codes red, has no line/callout/blur/colour, chains a data URL per operation, saves as `image/jpg` (not a MIME type), and its Cancel emits the edited image. Its op-list idea and arrow-head maths are restated in §5.2. Fabric/Konva would add 300 KB+ for selection handles this plan does not want (see §10). |
| G9 | **Stroke, head, disc and pixel sizes derive from the source width.** | `lineWidth = max(3, round(w / 480))`, arrow head `= lineWidth * 5`, callout radius `= lineWidth * 5`, callout font `bold ${radius * 1.3}px system-ui`, blur cell `= max(8, round(w / 120))`. One module (§5.2) used by preview, final render and runner. |
| G10 | **Seven colours, red first.** | `#E5484D`, `#F76B15`, `#30A46C`, `#0090FF`, `#8E4EC6`, `#1C2024`, `#FFFFFF`. Last used remembered in `localStorage` `enloop.shot.color`. Runner-drawn marks use the spec's `Color:` or red. |
| G11 | **Callouts number themselves.** | Hand-drawn: `n = existing callout ops + 1`. Runner-drawn: the order of `Callout:` lines in the spec, numbered before any hand-drawn ones. White numeral on a filled disc (near-black numeral on white). |
| G12 | **`@kind guide` is a header line, parsed like `@project`.** | `kind: "case" \| "guide"` on `TestCaseVersion`; absent = `case`. Grammar `0.0.12 → 0.0.13`. In a guide's run the verdict buttons read **Done / Could not** and the Expected block **You should see**; the linter drops rule `3b` warnings for guides. Everything else in the contract still applies. |
| G13 | **Export is deterministic and lives in the validator; the panel offers single-file HTML.** | `enloop-case.mjs export-guide` (§7) from a run or a free run; `shared/src/guide.ts` holds the only renderers. The run and free-run screens offer **⬇ Download guide** once finished, when there is at least one screenshot or the case is a guide. |
| G14 | **A guide includes every non-skipped step in run order and drops tester-only text.** | `note`, `selectors`, `script`, `### Photo` specs, verdicts, comments, ratings never reach a guide. `where` → "Go to", `via` → "Find it under", `expected` → "You should see". Placeholders become figures; unfilled placeholders are dropped with a warning on export. |
| G15 | **The `guide` skill writes for someone who will never see the case, and writes the photo specs.** | Rules in §8.1, the only place they live. |
| G16 | **`export-guide` never edits the case.** | Wording fixes after export go to the exported file. |
| G17 | **Screenshots stay local like the rest of the run.** | `runs/` and `free-runs/` are already git-ignored. Exported guides default to `<data folder>/guides/<slug>/` and are the deliverable, not ignored. |
| G18 | **`captureVisibleTab` keeps riding the per-origin host grant.** | No `activeTab`. On an ungranted page the photo buttons show `PageAccessNotice`; a runner-taken photo is skipped with an inline notice *Photo n not taken: no access to this page*. |
| G19 | **Thumbnails read bytes through the store.** | `readScreenshot` returns bytes; the panel caches object URLs keyed `${id}:${updatedAt}` and revokes on unmount. |
| G20 | **Revert is "ops = []".** | **↺ Original** in the editor and on the thumbnail sets `ops` to `[]` and rewrites `<NN>.png` from the source. The source file is never modified after capture. |
| G21 | **Free-run screenshots insert their own placeholder.** | Taking a photo in a free run appends `%PHOTO_<seq>%` at the caret of the notes textarea (end of text when unfocused). Export renders `notes.md` with placeholders replaced; screenshots not referenced are appended at the end. |
| G22 | **`RunSummary` and `FreeRunFile` carry a screenshot count.** | History and case-detail rows show `📷 n`. |

---

## 3. Shared model

### 3.1 Schemas — `shared/src/schemas.ts`

```ts
/** One drawn operation, in the source PNG's pixel space. Render order is
 * blurs, then shapes in list order, then the crop — see
 * extension/src/lib/screenshot-render.ts. */
export const screenshotOpSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("crop"), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  z.object({ tool: z.literal("blur"), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  z.object({ tool: z.literal("line"), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), color: z.string() }),
  z.object({ tool: z.literal("arrow"), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), color: z.string() }),
  z.object({ tool: z.literal("rect"), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(), color: z.string() }),
  z.object({ tool: z.literal("callout"), x: z.number(), y: z.number(), n: z.number().int().positive(), color: z.string() }),
]);

export const runScreenshotSchema = z.object({
  id: z.string(),
  /** 1-based capture order; the file stem, zero-padded to two digits. */
  seq: z.number().int().positive(),
  /** The step it illustrates, or null for the run as a whole. */
  stepId: z.string().nullable(),
  /** Which `### Photo` of that step it fills (1-based), null when taken by hand. */
  slot: z.number().int().positive().nullable(),
  takenAt: z.string(),
  /** Bumped on every edit; the panel keys its thumbnail cache on it. */
  updatedAt: z.string(),
  pageUrl: z.string(),
  caption: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  ops: z.array(screenshotOpSchema),
  /** Spec selectors that matched nothing when the runner took it. */
  missing: z.array(z.string()),
});

/** A `### Photo` block of a step — what the runner should capture. */
export const photoSpecSchema = z.object({
  /** Selector of the container to crop to; empty = the viewport. */
  crop: z.string(),
  /** CSS px of padding around `crop`; default 24. */
  pad: z.number().int().nonnegative(),
  /** Rectangles. */
  marks: z.array(z.string()),
  /** Arrows pointing at. */
  points: z.array(z.string()),
  /** Numbered discs, in order; `text` is the legend line (may be empty). */
  callouts: z.array(z.object({ selector: z.string(), text: z.string() })),
  /** Pixelated. */
  blurs: z.array(z.string()),
  take: z.enum(["before", "after", "manual"]),
  mode: z.enum(["auto", "confirm"]),
  color: z.string(),
  caption: z.string(),
});
```

- `stepSchema`: `photos: z.array(photoSpecSchema)`.
- `runFileSchema`: `screenshots: z.array(runScreenshotSchema).default([])`
  (the on-disk migration exception). `runSchema`: `screenshots` and `kind`
  passed through by `composeRun`.
- `freeRunFileSchema`: `screenshots: z.array(runScreenshotSchema).default([])`
  (`stepId` and `slot` always null there).
- `testCaseVersionSchema`: `kind: z.enum(["case", "guide"])`, parser
  always supplies it.
- `shared/src/types.ts`: export `ScreenshotOp`, `RunScreenshot`,
  `PhotoSpec`, `CaseKind`; `RunSummary` gains `screenshots: number`.

### 3.2 Store interfaces — `shared/src/storage.ts`

`RunStore`:

```ts
addScreenshot(testCaseId, runId, input: {
  stepId: string | null; slot: number | null; pageUrl: string; width: number; height: number;
  sourcePng: Uint8Array; ops: ScreenshotOp[]; renderedPng: Uint8Array | null; missing: string[]; caption: string;
}): Promise<{ run: Run; screenshot: RunScreenshot }>;
/** When `ops` is given, `renderedPng` must be too — the store never renders. */
updateScreenshot(testCaseId, runId, id, patch: {
  caption?: string; stepId?: string | null; slot?: number | null; ops?: ScreenshotOp[]; renderedPng?: Uint8Array;
}): Promise<Run>;
removeScreenshot(testCaseId, runId, id): Promise<Run>;
readScreenshot(testCaseId, runId, id, which: "rendered" | "source"): Promise<Uint8Array>;
```

`addScreenshot` with a non-null `slot` first removes any existing
screenshot of the same `stepId` + `slot` (that is Retake). `renderedPng:
null` means "same as source". Refuse `addScreenshot` on a finished run;
allow update/remove after finish (a caption typo is fixable).

`FreeRunStore`: the same four as `addFreeRunScreenshot(id, input)`,
`updateFreeRunScreenshot(id, shotId, patch)`, `removeFreeRunScreenshot`,
`readFreeRunScreenshot`, with `stepId`/`slot` absent from the input.
Allowed while `finishedAt` is null; update/remove allowed after.

Mirror all eight in `WorkspaceStore` exactly as `askQuestion` is mirrored.
`FsaDataStore`: `SCREENSHOTS_DIR = "screenshots"`; add
`readBinaryFile(dir, name)` to `fs-utils.ts`. `listRuns` and
`listFreeRuns` count `screenshots.length`.

### 3.3 Grammar — `shared/src/markdown.ts`

**Header.** `const kindMatch = /^@kind:?\s+(case|guide)\s*$/i` beside
`projectMatch`; any other value is a parse error `"@kind must be case or
guide"`. `renderCaseMarkdown` writes `@kind guide` after `@project` only
for guides. `CURRENT_FORMAT_VERSION = "0.0.13"`.

**`### Photo` subsections.** Extend the step-body splitter (~766) to peel
off every `### Photo` block, in order, alongside `### Expected` and
`### Note` (any order, any count of Photo). A block is `Key: value` lines
until the next `###` or `##`; unknown keys are a parse error naming the
key. Keys, all optional:

```
### Photo
Crop: #order-form                       selector; absent = viewport
Pad: 24                                 integer css px; default 24
Mark: #save-button                      repeatable — rectangle
Point: .toast                           repeatable — arrow
Callout: #email — The address the invoice goes to     repeatable — numbered disc; text after " — " is the legend, optional
Blur: [data-testid=card-number]         repeatable — pixelated
Take: after | before | manual           default after
Mode: auto | confirm                    default confirm (ignored for manual)
Color: #0090FF                          one of G10, default #E5484D
Caption: The order form, ready to save  one line
```

`renderCaseMarkdown` writes each block back after `### Expected` and
before `### Note`, only the keys that differ from defaults, `Callout:`
with ` — text` only when text is non-empty.

**Placeholders.** In `variables.ts`, the reference finder skips names
matching `/^PHOTO_\d+$/`; substitution leaves them verbatim. Add
`photoPlaceholders(text): number[]` (the distinct `n`s in order) to
`markdown.ts` and export it.

**Grammar doc comment.** Add `@kind guide` to the header block, the
`### Photo` block with the key list above to the step section, and the
`%PHOTO_n%` sentence to the prose section. Two paragraphs, no more.

**Reports.** `renderRunReport`: under each step, one line per attached
screenshot in `seq` order — `![<caption or "Photo n" or "Screenshot">](screenshots/<NN>.png)`
— and run-level ones under the header. `renderRunFeedback`: one header
line `Screenshots: <n>, in screenshots/ beside this file.` when nonzero.

### 3.4 Linter — `shared/src/lint.ts`

New rule id `10` (photos), errors unless said otherwise:

- `%PHOTO_n%` in a step with fewer than `n` `### Photo` blocks.
- A `### Photo` on a step with `Take: after` or `before` and `Mode: auto`
  whose `Crop:`, `Mark:`, `Point:`, `Callout:` and `Blur:` are all empty —
  *warning*: "an unmarked full-viewport photo; say what it shows with
  `Crop:` or a mark".
- `Callout:` or `Mark:` selectors that also appear in `Blur:` (error: the
  same element cannot be pointed at and hidden).
- A `### Photo` whose selectors include none of the step's `Selector:`
  lines and the step has selectors — *warning* (probably the wrong step).
- `Color:` not in the palette (error).

Rule `3b` quick-mark *warnings* are skipped when `doc.kind === "guide"`.
Selector-looking strings in `Callout:` text — none; free text.

### 3.5 Guide renderers — new `shared/src/guide.ts`

```ts
export interface GuideRenderOptions { imageRef: (shot: RunScreenshot) => string }
export function guideSteps(doc: TestCaseVersion, run: RunFile): { step: Step; state: RunStepState; label: string }[]
export function renderGuideMarkdown(doc: TestCaseVersion, run: RunFile, opts: GuideRenderOptions): { text: string; warnings: string[] }
export function renderGuideHtml(doc: TestCaseVersion, run: RunFile, opts: GuideRenderOptions): { text: string; warnings: string[] }
export function renderFreeRunGuideMarkdown(free: FreeRunFile, notes: string, opts: GuideRenderOptions): { text: string; warnings: string[] }
export function renderFreeRunGuideHtml(free: FreeRunFile, notes: string, opts: GuideRenderOptions): { text: string; warnings: string[] }
```

`guideSteps`: document order, run state not `skipped`, labels numbered
over the included steps only.

A **figure** is rendered as (Markdown):

```
![<caption>](<ref>)
*<caption>*                      only when non-empty
1. <callout legend text>         one line per spec callout with text, in order; only for slot-filling shots
```

Markdown shape, exactly:

```
# <title>
<goal>                                       omitted when empty
<description>
<run-level figures, seq order>
## Before you start                          only when prerequisites or youWillNeed non-empty
- <youWillNeed…> - <prerequisites…>
## <group title>                             only when doc.groups non-empty
<group goal>
### <n>. <step title>                        H2 when there are no groups
Go to: `<where>`                             when set
Find it under: <via>                         when set and not "link only"
<instructions with each %PHOTO_n% replaced by its figure, or removed (warning) when unfilled>
<slotless figures attached to this step, seq order>
**You should see:**
<expected, same placeholder treatment>
---
*Made with Enloop from run <runId> of v<version>.*
```

HTML: `<!doctype html>`, `<title>`, a `<style>` with the body/heading/
code/list rules lifted from `CASE_PAGE_CSS` plus
`figure{margin:12px 0} img{max-width:100%;border:1px solid #ddd;border-radius:6px} figcaption{color:#666;font-size:.9em} figure ol{font-size:.9em}`,
prose through `renderMarkdown`, figures as `<figure><img><figcaption>…</figcaption><ol>…</ol></figure>`.
No scripts.

Free run: `# <title>`, then `notes` with `%PHOTO_n%` replaced by the
figure of the screenshot whose `seq === n`, unreferenced screenshots
appended, same footer with the free-run id.

Export everything above, plus `photoPlaceholders` and `fileSlug` (moved
to `shared/src/id.ts`; the extension re-exports it), from
`plugin-entry.ts`.

---

## 4. Store implementation

### 4.1 `FsaDataStore`

- `addScreenshot`: read the file; if `slot` non-null, remove the existing
  same-step-same-slot record and its two files; `seq = max(seq) + 1`;
  stem `padStart(2, "0")`; ensure `screenshots/`; write `<stem>.source.png`,
  then `<stem>.png` (`renderedPng ?? sourcePng`), then push the record and
  write the JSON — record last, as the ready marker.
- `updateScreenshot`: caption/stepId/slot; when `ops` given require
  `renderedPng`, overwrite `<stem>.png`; `updatedAt = nowIso()`. Moving
  (`stepId` in patch) forces `slot = null` unless the patch also sets it.
- `removeScreenshot`: `removeEntry` both (ignore `NotFoundError`), splice,
  write.
- `readScreenshot`: `readBinaryFile`.
- Free-run variants identical against `free-runs/<id>/`.
- `listRuns` / `listFreeRuns`: counts.

The Inbox (OPFS) is the same class over `navigator.storage.getDirectory()`;
nothing extra, the gate tests it.

### Gate 4

- `npm run typecheck` clean.
- From the browser console against the store (before the UI exists):
  add a screenshot → `01.source.png`, `01.png`, one record; add with
  `slot: 1` twice on the same step → the first's files are gone, one
  record with `seq 3`; update caption → `updatedAt` changes; remove →
  files gone. Same on a free run.
- Any `run.json` in `private/` from before this part still parses with
  `screenshots: []`.

---

## 5. Capture, the runner, and the editor (extension)

### 5.1 Rendering — new `extension/src/lib/screenshot-render.ts`

```ts
export const SHOT_COLORS = ["#E5484D", "#F76B15", "#30A46C", "#0090FF", "#8E4EC6", "#1C2024", "#FFFFFF"] as const;
export function metrics(sourceWidth: number): { lineWidth: number; head: number; radius: number; font: string; cell: number }
/** Blurs then shapes, onto a ctx already showing the source at 1:1. Never crops. */
export function drawOps(ctx: CanvasRenderingContext2D, ops: ScreenshotOp[], sourceWidth: number): void
/** Full render: source, ops, then crop. PNG bytes. */
export async function renderScreenshot(source: ImageBitmap, ops: ScreenshotOp[]): Promise<Uint8Array>
export function cropOf(ops: ScreenshotOp[]): CropOp | null
export function withCrop(ops: ScreenshotOp[], crop: CropOp | null): ScreenshotOp[]   // replaces in place (G7)
```

Geometry, `m = metrics(w)`, all source pixels:

- **blur**: draw the region to a canvas of `ceil(w/cell) × ceil(h/cell)`
  with default smoothing, then back to the region with
  `imageSmoothingEnabled = false`. Applied before shapes regardless of
  list order.
- **line**: `lineWidth`, round caps.
- **arrow**: shaft shortened by `0.6 * head` at the tip; head triangle at
  `(x2,y2)`, `(x2 - head·cos(a∓π/7), y2 - head·sin(a∓π/7))` with
  `a = atan2(y2-y1, x2-x1)`, filled and stroked.
- **rect**: `strokeRect`, square joins.
- **callout**: filled disc `radius`, ring `lineWidth/2` in white (near-black
  on white), numeral centred, colour per G11.
- **crop**: render everything full-size, then `drawImage` the crop region
  into a `w × h` output canvas. Clamp to bounds, minimum 8 × 8.

`OffscreenCanvas` + `convertToBlob({ type: "image/png" })`.

### 5.2 Element rects — new `extension/src/lib/element-rects.ts`

```ts
export interface DeviceRect { x: number; y: number; w: number; h: number }
/** Scrolls `scrollTo` (a selector, may be "") into view (block: "center"),
 * waits 250 ms, then returns the viewport-clamped rect of the first match
 * of every selector, in device pixels; null entries for no match or an
 * empty intersection. Top frame only. Null overall when the page cannot be
 * scripted. */
export async function elementRects(scrollTo: string, selectors: string[]): Promise<(DeviceRect | null)[] | null>
```

One `chrome.scripting.executeScript` call; the injected function does the
scroll, a `setTimeout` promise, then `querySelector` per selector,
`getBoundingClientRect`, intersect with the viewport, multiply by
`devicePixelRatio`.

### 5.3 The runner — new `extension/src/lib/photo-runner.ts`

```ts
export interface TakenPhoto { sourcePng: Uint8Array; width: number; height: number; ops: ScreenshotOp[]; missing: string[]; pageUrl: string }
export async function takePhoto(spec: PhotoSpec, stepSelectors: string[]): Promise<TakenPhoto | { error: string }>
```

1. `selectors = [spec.crop, ...marks, ...points, ...callouts.map(c => c.selector), ...blurs]`
   (empty crop stays as an empty string placeholder).
   `scrollTo = spec.crop || selectors.find(s => s) || stepSelectors[0] || ""`.
2. `rects = await elementRects(scrollTo, selectors)`; null → `{ error: "no access" }`.
3. `png = await captureScreenshot()`; null → error. Decode `width/height`
   via `createImageBitmap`.
4. `dpr = width / window.innerWidth` is **not** available here (the panel
   is not the page); the injected function returns `devicePixelRatio`
   alongside the rects — extend `elementRects` to return `{ dpr, rects }`.
5. Build ops, all clamped to the image:
   - crop: rect of `spec.crop` padded by `spec.pad * dpr` on each side;
     when `spec.crop` matched nothing, no crop (and it is listed in
     `missing`). Crop covering ≥ 95 % of the image → no crop.
   - blurs: `{ tool: "blur", ...rect }` each.
   - marks: `{ tool: "rect", ...rect expanded by lineWidth }` each.
   - points: tip at the midpoint of the element's left edge minus
     `lineWidth`; tail `L = 100 * dpr` away at angle `+150°` (down-left).
     If the tip is in the left 30 % of the crop (or image when no crop),
     mirror: tip at the right-edge midpoint, tail at `+30°`. Clamp tail
     into the crop.
   - callouts: disc centre at `(rect.x - radius * 0.7, rect.y - radius * 0.7)`,
     clamped so the disc stays inside the crop; `n` = 1-based order among
     callouts whose selector matched.
   - colour: `spec.color`.
6. Return; the caller adds it to the store and renders `<NN>.png` with
   `renderScreenshot` (rendering happens in the panel, once, on add).

### 5.4 Capture UI — new `extension/src/sidepanel/screens/RunScreenshots.tsx`

Rendered in the expanded step body **after `expected`/`note` and before
`StepQuestions`**; once more above the step list (`stepId={null}`) below
`WhatToExpect`; and in `FreeRunScreen` under the notes textarea.

Props: `owner: { kind: "run"; testCaseId; runId } | { kind: "free"; freeRunId }`,
`step: RunStep | null`, `screenshots: RunScreenshot[]` (those for this
step), `readOnly`, `onChanged(next)`, `onInsertPlaceholder?(seq)` (free
run only).

Rendered, top to bottom:

- **Spec row** (case runs only, one per `step.photos[i]`): `📷 Photo <i+1>`
  chip with the caption or the crop selector as its label, then its state:
  *manual* → a **Take** button; *taken* → nothing (the thumbnail below
  shows `slot i+1`); *before/after and pending* → a grey *takes itself
  <before you start / when you mark it>* note; *missing selectors* → an
  amber `n not found` marker with a tooltip listing them.
- **Buttons**: `📷 Screenshot`, `📷 Screenshot & edit` (hidden when
  `readOnly`; `PageAccessNotice` instead when the page is not granted).
- **Thumbnails**: this step's screenshots in `seq` order, 120 px tall,
  object URL per G19, click opens the rendered PNG in a new tab. Under
  each: caption input (700 ms debounce → update), `✎ Edit`, `↺ Original`
  (only when `ops.length > 0`; two-click confirm), `Move ▾` (`<select>` of
  *Run* + every step `#label title`; hidden in free runs), `✕` (two-click
  confirm), and a `slot n` badge when slot-filled.
- **Confirm preview** (a fixed-position sheet inside the panel, over the
  list): the rendered image scaled to the panel width, the caption from
  the spec, buttons **Keep · Retake · Edit · Discard**. *Keep* is the
  default `Enter`. *Retake* re-runs `takePhoto` with the same spec.
  *Edit* keeps and opens the editor. The sheet is shown only for
  `Mode: confirm`; for `auto` a 2 s toast *Photo n taken* appears.

Hand capture flow: `captureScreenshot()` → dimensions → `activePageUrl()`
→ `addScreenshot({ slot: null, ops: [], renderedPng: null, missing: [], caption: "" })`
→ for `& edit`, `openEditor` (§5.5) with initial ops `[]`, or a crop from
`elementRects("", [matchedSelector])` padded `48 * dpr` when the step's
Highlight matched (skip when it would cover ≥ 90 %).

Runner hooks in `RunScreen.tsx`:

- **before**: in the effect that auto-highlights when a step becomes
  current, after the highlight resolves, for each `photos[i]` with
  `take === "before"` and no screenshot at `slot i+1`: `takePhoto`, then
  add (auto) or open the confirm sheet (confirm). Serial, in order.
- **after**: `handleMark` becomes: for each `photos[i]` with
  `take === "after"` and no slot fill, `takePhoto` and add/confirm
  **before** `markManualStep` runs; a Discard in the sheet still lets the
  mark proceed. For automated steps, the same in `runAutomatedStep`'s
  caller after the script result is in and before the row collapses.
  Skip statuses (`skipped`) never take photos.
- A runner error is an inline notice on the spec row, never a thrown
  error; the mark still lands.

The run header gets a `📷` icon button (right of the goal line) that
captures to the current step or to the run.

### 5.5 The editor page

Files: `extension/editor.html`, `extension/src/editor/main.tsx`,
`extension/src/editor/Editor.tsx`, `extension/src/lib/editor-handoff.ts`.

`vite.config.ts`: `build.rollupOptions.input = { sidepanel: "sidepanel.html", editor: "editor.html" }`.
Verify `dist/editor.html` exists; if crxjs drops it, declare the page in
`web_accessible_resources` and note it in the status line.

Hand-off through `chrome.storage.session`:

```ts
interface EditorJob { token; owner; screenshotId; title; sourceDataUrl; ops: ScreenshotOp[]; width; height; returnTo: TabRef | null }
interface EditorResult { token; cancelled: boolean; ops?: ScreenshotOp[]; renderedDataUrl?: string }
```

- Panel `openEditor(job)`: set `enloop:editor:<token>`; `chrome.tabs.create`
  with `editor.html#<token>`; await the first of `storage.session.onChanged`
  for `enloop:editor-result:<token>` or `tabs.onRemoved` of the editor tab
  (= cancelled); delete both keys; on a result, decode and
  `updateScreenshot({ ops, renderedPng })`. `set` throwing (quota) → notice
  *Screenshot too large to edit*, attachment kept as is.
- Editor: token from `location.hash`; load; decode to `ImageBitmap`; Save
  → `renderScreenshot` → write result → activate `returnTo` → close self.
  Cancel writes `{cancelled:true}` and closes. Missing job → *This editor
  session has expired* + Close.

UI: top bar **Crop · Blur · Line · Arrow · Rect · Callout** (radio,
`aria-pressed`), seven swatches, **Undo**, **↺ Original** (ops = [],
confirm), spacer, **Cancel**, **Save**. Keys: `1–6` tools, `Esc`, `⌘/Ctrl+Z`,
`⌘/Ctrl+Enter`, `⌘/Ctrl+S`. Two stacked canvases (base = source + ops,
overlay = the drag), backing store at source size, CSS-scaled to fit
`min(100vw − 32px, (100vh − 96px) × aspect)`, pointer coordinates divided
by the CSS scale, `setPointerCapture`. Crop shows outside dimmed
`rgba(0,0,0,.45)` with a dashed border; blur preview draws the pixelated
region live. Drags under 4 source px are discarded except callout, which
commits at the down point. Below the canvas: `<w>×<h>` and `→ <cw>×<ch>`
when cropped.

### 5.6 Placeholders and labels in the panel

- `Markdown.tsx`: a rehype/remark pass turns `%PHOTO_n%` into an inline
  chip `📷 n` (title: the spec caption; amber when the slot is empty,
  green when filled — the component receives `filledSlots: number[]`
  from the step row). Off the run screen (viewer, case detail) the chip
  is plain grey.
- `RunScreen.tsx`: verdict labels and the Expected label per G12 from
  `run.kind`. `CaseDetailScreen` / `LibraryScreen`: a `guide` badge.
  `report.md`: `- Kind: guide`.
- `FreeRunScreen.tsx`: `RunScreenshots` under the notes; `onInsertPlaceholder`
  inserts `%PHOTO_<seq>%` at the textarea caret (append with a blank line
  when unfocused) and triggers the existing autosave.
- `viewer/src/builder.ts`: `StepDraft` gains `photos: PhotoSpec[]`
  round-tripped untouched (no form fields this plan); `fromMarkdown` /
  `toDocument` carry it.

### Gate 5

- `typecheck`, `build` clean; `dist/editor.html` exists.
- Unpacked build, scratch folder, a case with these steps (write it by
  hand, it need not lint clean except rule 10):
  - step A: `### Photo` `Crop: <a container>` `Callout: <a field> — The field`
    `Callout: <a button> — The button` `Take: after` (confirm default),
    `%PHOTO_1%` in instructions.
  - step B: two photos, one `Take: before` `Mode: auto` with `Mark:` and
    `Blur:`, one `Take: manual` with `Point:`.
  - step C: no photos.
- Run it on a granted page. Marking A opens the confirm sheet with the
  cropped image, two numbered discs, legend caption; Keep → thumbnail
  with `slot 1`, chip turns green. Retake replaces (files of the old
  one gone, new `seq`). Expanding B takes photo 1 silently with a
  toast; its rendered PNG shows a box and a pixelated area; **Take** on
  photo 2 draws an arrow. Deleting a callout in the editor (Undo) and
  Save updates `<NN>.png`; `↺ Original` restores the plain crop-less
  capture. `& edit` on C with a matched selector opens pre-cropped.
- A spec selector that matches nothing: photo still taken, amber `1 not
  found` on the row, `missing` in `run.json`.
- Ungranted page: buttons replaced by the grant notice; marking a step
  with an `after` photo shows the *not taken* notice and still marks.
- Move a screenshot to another step → `slot` becomes null. Header `📷`
  before Start → run-level.
- Free run: take two screenshots; the textarea gains `%PHOTO_1%` and
  `%PHOTO_2%` at the caret; `✎ Edit` works; finish; `free-run.json` has
  both records.
- Finish the case run; `report.md` shows image lines under the right
  steps. Inbox (OPFS) does the same.
- A guide case shows *Done / Could not* and *You should see*.

---

## 6. Library, history, download

- `RunHistoryScreen`, `CaseDetailScreen`, free-run rows: `📷 n` when
  nonzero.
- Finished run and finished free run: **⬇ Download guide** when
  `screenshots.length > 0 || kind === "guide"` — `renderGuideHtml` /
  `renderFreeRunGuideHtml` with data-URL `imageRef` from `readScreenshot`
  bytes, `downloadTextFile(`${fileSlug(title)}-guide.html`, html, "text/html")`.
  Warnings from the renderer (unfilled placeholders) are shown in a
  one-line notice beside the button.

### Gate 6

A finished run and a finished free run each download an `.html` that
opens offline with every image inline, callout legends under the figures,
and the step order of the run.

---

## 7. Export from the validator — `plugins/enloop/validator/enloop-case.mjs`

```
list-guides <data folder> [--project "<name>"]
export-guide <data folder> <caseId> [--run <runId>] [--out <dir>] [--format md|html|both] [--force]
export-guide <data folder> --free <freeRunId> [--out <dir>] [--format …] [--force]
```

`list-guides`: finished runs with `screenshots.length > 0` or a frozen
`case.md` of `kind === "guide"`, plus finished free runs with
screenshots; newest first:

```
run   <caseId>  <runId>      <finishedAt>  <n> screenshots  <kind>  <title>
free  -         <freeRunId>  <finishedAt>  <n> screenshots  -       <title>
```

`NONE`, exit 1, when empty. `--project` filters on `@project`.

`export-guide`:

- Run: `--run`, else the newest finished run of the case with screenshots,
  else the newest finished run; `NO RUN` exit 1 when none.
- Out: `--out`, else `<data folder>/guides/<fileSlug(title)>/`; `EXISTS
  <path>` exit 1 when non-empty unless `--force` (empties it first).
- `md` (default): `README.md` from the Markdown renderer with
  `imageRef = "images/<stem>.png"`, rendered PNGs copied to `images/`.
  `html`: `index.html` with data URLs. `both`: both.
- Prints `WARN <text>` per renderer warning, `WROTE <abs path>` per file,
  last line `GUIDE <abs dir>`.

### Gate 7

- `npm run build:plugin`; `grammar.md` heading says 0.0.13 and contains
  `### Photo` and `@kind guide`.
- Against the Gate 5 folder: `list-guides` lists the run and the free
  run; `export-guide … --format both` writes `README.md`, `images/…`,
  `index.html`; the legend lines sit under the right figures; the
  `%PHOTO_1%` in step A is replaced in place; a second call without
  `--force` prints `EXISTS`; `--free` exports the free run.
- `validate`: `%PHOTO_2%` on a step with one `### Photo` errors (rule
  10); `Blur:` + `Callout:` on the same selector errors; `@kind banana`
  fails to parse; a guide with no quick marks has no `3b` warning.

---

## 8. Skills, hook, docs

### 8.1 `plugins/enloop/skills/guide/SKILL.md`

Frontmatter modelled on `full` (`disable-model-invocation: true`, same
`allowed-tools`). Description: *Write a user guide for Enloop — a case in
`@kind guide` form, addressed to an end user rather than a tester, for a
feature or flow in the app repo you are currently in, with `### Photo`
specs so the runner takes and marks up the screenshots itself. Every route,
label and selector is derived from source. The guide is run in the
extension like any case and `export-guide` turns the run into a Markdown
folder or an HTML page. Use when the user asks for a user guide, how-to,
walkthrough, onboarding doc or help-centre article.*

Body, in order:

1. Scope from `$ARGUMENTS`; on empty, the git-derived closed question from
   `full`, verbatim.
2. `brief`, then `../../references/authoring.md` in full with the **guide
   column** of its table.
3. **Guide prose rules**, a checklist the model walks before validating:
   1. Second person, present tense: *Open the Orders page*.
   2. One action per step; the title is that action in imperative form.
   3. `### Expected` says what the reader sees after the action, as
      bullets, in the words on screen. It exports as *You should see*.
   4. No internal names in prose: no component, class, route parameter,
      ticket, branch, environment, selector. `Selector:` lines are still
      required on UI steps; they are never exported.
   5. No "verify", "assert", "check that", "test".
   6. `Goal:` is what the reader will have accomplished. `You will:` is the
      shape of the work in one line.
   7. `# You will need` lists what a reader needs in hand, never test data.
   8. No `Kind: quick`; `Kind: extra` marks a step the reader may skip and
      its first sentence says so.
   9. `### Note` is not exported; author reminders only.
4. **Photo rules**:
   1. Every step that changes what is on screen has one `### Photo` and a
      `%PHOTO_1%` in its instructions where the reader should look at it —
      usually right after the sentence that names the screen.
   2. `Crop:` is the smallest container that still shows where the reader
      is: the form, the dialog, the card — not the whole viewport unless
      the step is about the whole page. Take the selector from source the
      way `Selector:` is taken.
   3. `Callout:` each control the instructions mention, in the order the
      text mentions them, with the legend text being the control's label
      as the reader sees it. Reference them in prose as `(1)`, `(2)`.
   4. `Mark:` the thing the reader should notice; `Point:` at something
      small or transient (a toast, a badge). At most three marks of any
      kind per photo — beyond that, split the step.
   5. `Blur:` anything personal or secret that the sandbox will show: card
      numbers, emails of real people, tokens. Find them in source by the
      field they render.
   6. `Take: after` when the photo shows the result of the action;
      `Take: before` when it shows where to click. `Mode: auto` only when
      the crop and marks are exact; leave `confirm` when unsure.
   7. `Caption:` one line, what the reader is looking at, not what to do.
5. Validate and land as `authoring.md` §9–10 say.
6. Hand-off, verbatim: *Open the case in the Enloop panel and run it —
   the runner takes the photos; confirm or retake each. When the run is
   finished, run `/enloop:export-guide`.*

`agents/openai.yaml`: display name *Enloop: user guide*, short description
*Write a user guide as a runnable case; the runner takes the screenshots.*,
`allow_implicit_invocation: false`.

### 8.2 `plugins/enloop/skills/export-guide/SKILL.md`

`allowed-tools: Read Edit Bash(node *) Bash(ls *)`. Description: *Export a
finished Enloop run or free run as a user guide — a folder with `README.md`
and images, or a single HTML page with the screenshots inlined.*

1. `data-folder`; state the folder.
2. `list-guides`; one candidate → use it; several → one closed question
   listing title, date, screenshot count; `NONE` → say so and stop.
3. Format from `$ARGUMENTS` (`html`, `md`, `both`; default `md`); `--out`
   when the user named one.
4. `export-guide`; on `EXISTS`, ask before `--force`. Repeat every `WARN`
   line to the user.
5. Read the produced file once; apply wording changes the user asked for,
   and fix tester-voice sentences (rules 3.4, 3.5), in the exported file
   only (G16). Say what changed.
6. Report absolute paths.

### 8.3 Hook, manifests, references

- `hooks/confirm-scope.mjs` line 19: `(quick|full|guide)`.
- `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`: `0.19.0`;
  description gains *, write user guides whose screenshots the runner
  takes, and export them*.
- `references/authoring.md`: a *guide* column in the table at the top
  (happy path plus every screen the reader passes; no app map; no quick
  marks; photo specs; prose rules in the guide skill). A short section
  "Photo specs" pointing at `grammar.md` for the keys.
- `references/step-contract.md`: `### Photo` listed among the step's
  subsections, one paragraph.
- `references/data-folder.md`: `screenshots/` in the `runs/` and
  `free-runs/` lines; `guides/` as a top-level line.

### 8.4 Docs and changelog

- `docs/guides.md` (new): what a guide is; `@kind guide`; `### Photo`
  keys with one example; the three modes and two moments; the confirm
  sheet; the editor's tools and keys; revert, move, caption; free runs
  and `%PHOTO_n%`; the two export formats and folder layout; `runs/`
  local vs `guides/` shipped.
- `docs/extension.md`: `### Screenshots` under "During a run"; folder
  layout block; "Sharing a case" mentions **⬇ Download guide**.
- `docs/case-format.md`: `@kind`, `### Photo`, `%PHOTO_n%`.
- `docs/skills.md`: `## Writing a guide`, `## Exporting a guide`, table.
- `README.md` "The pieces": one sentence on guides.
- `CHANGELOG.md` Unreleased: subtitle *Plugin 0.19.0 · grammar 0.0.13*;
  *Running cases*: **Screenshots**, **Photos the runner takes**, **⬇
  Download guide**; new *Guides* section: **`@kind guide`**,
  **`/enloop:guide`**, **`/enloop:export-guide`**; in the changelog's
  voice.

### Gate 8

- `enloop-case.mjs version` prints 0.0.13; `brief` mentions `### Photo`.
- Local marketplace install lists `guide` and `export-guide`; bare
  `/enloop:guide` gets the confirm-scope instruction.
- Every doc link added resolves.

---

## 9. Order of work and the status line

1. §3 shared model, grammar, linter, renderers; `build:plugin`.
2. §4 store (runs and free runs).
3. §5.1 render, §5.2 rects, §5.3 runner, §5.5 editor page and hand-off.
4. §5.4 capture UI and runner hooks, §5.6 placeholders and labels, free
   run.
5. §6 history and download.
6. §7 validator commands.
7. §8 skills, hook, references, docs, changelog.

After each part, replace the status line with `Status: **written
2026-09-11; parts 1–N built, uncommitted.**` and list anything decided
under "genuinely unspecified" beneath it. Leave this file in place; the
user removes it at release.

---

## 10. Left for later — not in this plan

Recorded so the next plan starts here, and so nobody builds them into
this one.

- **Full-page capture.** Scroll-and-stitch of a page taller than the
  viewport; today a `Crop:` taller than the viewport is clipped to the
  visible part and the record says so in `missing` (add the selector
  with a `(clipped)` suffix). Needs a stitching pass and a way to hide
  sticky headers.
- **Text labels on the image.** A `label` op with text, font size from
  `metrics`, and a `Label: <selector> — text` spec key. Deferred because
  the legend under the figure already carries the text and reads better
  in Markdown.
- ~~**Select, move and resize drawn shapes.**~~ Built the same day, in
  the hand-written editor (`lib/screenshot-edit.ts`): hit-testing,
  handles, move, resize, recolour, delete, undo/redo over the history.
  G8 stands.
- **Auto-blur by pattern.** `Blur: /\d{4} \d{4} \d{4} \d{4}/` finding text
  nodes by regex rather than by selector; needs a text-walker in the
  injected script and rect-per-range via `Range.getClientRects()`.
- **Video / GIF of a step.** A `Record:` spec key using
  `chrome.tabCapture`; changes the permission set (G18).
- **PDF and DOCX export.** `export-guide --format pdf` through a headless
  Chrome print of `index.html`; DOCX via a library in the validator
  bundle. Both change the "no dependencies" promise of `lib.mjs`.
- **Photo specs in the viewer's builder form.** Today they round-trip
  untouched (§5.6); a form section per `### Photo` is straightforward
  once the keys have settled.
- **Screenshots for agent questions reuse.** A question asked from a
  step could attach the step's latest screenshot instead of a fresh
  capture. Small; do it when the runner's photos prove better than the
  raw viewport.
- **Localised guides.** One run, several languages: the prose comes from
  the case, the pictures from the run; `export-guide --lang` would need
  per-language case versions and a way to pair them with one run.
