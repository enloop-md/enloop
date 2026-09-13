# Screenshots and guides

A run records verdicts, comments and the console. It can also record what
the tester *saw*: screenshots, taken by hand at any moment or by the runner
from a spec in the step, edited in a small editor of Enloop's own, and
written beside `run.json`. And a case run step by step, with a picture at
each step, is a **user guide** — the same grammar, panel and run, written
for an end user and exported as a folder anyone can read. A guide carries
less than a case on purpose, and it is written last: on the final build
of the feature, right before the push that ships it.

See also — [the case format](case-format.md) for the grammar,
[the extension](extension.md#screenshots) for the panel, and
[the skills](skills.md#writing-a-guide) for having an agent write a guide.

## Screenshots on any run

Every step of every run, and every free run, has two buttons: **📷
Screenshot** takes the visible page and attaches it to the step; **📷
Screenshot & edit** does the same and opens the editor on it, pre-cropped
to the step's highlighted element when Highlight matched one. A **📷** in
the run header captures to the current step, or to the run as a whole
before it has one.

Chrome photographs a tab for an extension only after the extension has
been *invoked* on that tab — a per-site grant, the one Highlight uses, is
not enough for it, and the alternative is access to every site, which
Enloop does not ask for. So the first screenshot on a tab is a gesture on
the page: **Alt+Shift+S**, or right-click and choose **Take an Enloop
screenshot**. Either takes the picture straight away and attaches it to
the step you are on; from then on the tab is photographable from the
panel's own buttons, and by the runner, until it moves to another site.
When a capture needs one, the buttons say so in an amber note. (Clicking
the toolbar icon would count too, but it closes the panel — use the
shortcut or the menu.) The shortcut can
be changed at `chrome://extensions/shortcuts`.

A click on the panel takes the page's focus, and a dropdown or menu you
opened there closes before the picture is taken. To photograph it open,
**hover** any capture button — the two under the step, the header 📷, a
Photo row's **Take** — with **Ctrl+Shift** held: it fires without a
click, and the page keeps its focus. (A native `<select>` list is drawn
by the browser outside the page and is not in the capture either way;
custom dropdowns are.) The Alt+Shift+S shortcut keeps focus too. **⏱ 3 s**
beside the buttons, and beside a Photo row's Take, counts down three
seconds before capturing — time to click into the page and open what the
picture needs; press it again to cancel.

Each screenshot shows as a thumbnail under its step, with a caption field,
**✎ Edit**, **↺ Original** (once it has been edited — puts the capture
back as it was), **Move** to another step or to the run, and **✕**. Click
the thumbnail to open the full image in a tab. Captions, moves and edits
are allowed after the run is finished; new captures are not.

On disk, the picture and its record are kept apart:

```
runs/<caseId>/<runId>/
├── run.json                    "screenshots": [{ id, seq, stepId, slot, caption, ops, … }]
├── report.md                   ![caption](screenshots/01.png) under each step
└── screenshots/
    ├── 01.source.png           as captured — never modified
    └── 01.png                  as edited — same bytes as the source until it is
```

`NN` is the capture order and is never reused within a run. The record in
`run.json` carries the annotations as a list of operations in the source
image's pixels, so an edit is reversible and a reader that only wants the
picture reads `NN.png`. Free runs keep the same layout under
`free-runs/<id>/screenshots/`, with the records in `free-run.json`.

## Photos the runner takes

A case already knows the selectors of what a step is about, so it can also
say what the picture is. A `### Photo` block in a step is that spec — the
runner resolves the selectors on the live page at the right moment, takes
the picture, draws the marks, and drops the result where the author wrote
`%PHOTO_1%`.

```markdown
## Save the order
Where: %DOMAIN%/orders/new
Selector: [data-testid="order-form"]
Fill in the form (1) and press `Save` (2).

%PHOTO_1%

### Expected
- A green banner reads `Order saved`.

### Photo
Crop: [data-testid="order-form"]
Callout: [data-testid="order-customer"] — Customer
Callout: [data-testid="order-save"] — Save
Blur: [data-testid="order-card-number"]
Caption: The order form, ready to save
```

The keys, all optional:

| Key | What it does |
| --- | --- |
| `Crop:` | selector of the container to cut to; absent, the whole viewport |
| `Pad:` | CSS pixels of margin around the crop; default 24 |
| `Mark:` | a rectangle around the element — repeatable |
| `Point:` | an arrow at the element — repeatable |
| `Callout:` | a numbered disc at the element; the text after ` — ` is the legend under the figure — repeatable, numbered in order |
| `Blur:` | the element pixelated — repeatable |
| `Take:` | `after` (default) when the step is given its verdict; `before` when the step becomes current; `manual` puts a **📷 Photo n** button on the step |
| `Mode:` | `confirm` (default) shows the picture first; `auto` keeps it with no interaction; ignored for `manual` |
| `Color:` | one of the seven palette colours; default red |
| `Caption:` | one line under the figure |

The n-th `### Photo` fills `%PHOTO_n%` wherever it appears in the step's
instructions or `### Expected`; a spec with no placeholder lands after the
instructions. `PHOTO_` is reserved — `%PHOTO_n%` is never a variable, is
never substituted, and shows in the panel as a `📷 n` chip that turns green
once the photo exists. A selector that matches nothing is skipped and
listed on the step as *n not found*; the photo is still taken.

**Two moments, three modes.** `Take: after` fires when you press the
verdict — for an automated step, when its script finishes — and the mark
lands whatever you do with the picture. `Take: before` fires when the step
becomes current, after Highlight. In `Mode: confirm` a sheet shows the
rendered picture with **Keep · Retake · Edit · Discard** — Enter keeps;
Retake runs the spec again; Edit keeps and opens the editor. `Mode: auto`
shows a two-second *Photo n taken* and moves on. A spec's photo is taken
once per run unless you press Retake, which replaces it. On a page Enloop
has no grant for, the step shows *Photo n not taken: no access to this
page* and the run continues.

## The editor

**✎ Edit**, **Screenshot & edit** and the sheet's **Edit** open the picture
over the page you are testing, filling its window, with zoom buttons in
the title row. On a page Enloop cannot script it opens over the side
panel instead, where dragging the panel's edge widens it. (Never a
separate tab: Chrome drops the connected folder's grant when an extension
tab closes, and the save right after would fail.) Tools across the top: **Select · Crop · Blur · Line ·
Arrow · Rect · Callout**, then seven colours (the last one used is
remembered), **Undo · Redo**, **Delete** when something is selected,
**↺ Original**, and **Cancel · Save**. Keys `1`–`7` pick a tool (`V` is
Select too), `Esc` drops the selection and then cancels, `Ctrl+Z` (`⌘Z`)
undoes, `Ctrl+Shift+Z` or `Ctrl+Y` redoes, `Delete` removes the selected
shape, `Ctrl+Enter` or `Ctrl+S` (`⌘`) saves.

Every shape stays editable after it is drawn — the runner's included.
With **Select**, click a shape to pick it (the one on top wins), drag it
to move it, drag a corner or edge handle to resize a box or the crop, or
an end handle to re-aim a line or arrow; a callout moves only. A swatch
recolours the selected shape; **Delete** removes it, and callouts
renumber to stay 1, 2, 3. A shape you have just drawn is selected, ready
for a nudge. Drawing a new crop replaces the old one, and the outside is
dimmed while you draw. Blur previews live. Callouts number themselves in
the order drawn, continuing after any the runner drew. Stroke widths,
arrow heads and disc sizes scale
with the picture, so a 4K capture and a phone-width one read the same
once shrunk. Save writes `NN.png` and returns to the tab you came from;
the source file is never touched, so **↺ Original** — in the editor or on
the thumbnail — is always available and always exact.

## Free runs

A free run has the same buttons under its notes. Each capture inserts
`%PHOTO_<n>%` at the caret of the notes box (at the end when the box is not
focused), so the notes say where each picture goes; delete the placeholder
and the picture is appended at the end of the export instead. `✎ Edit`,
captions and `✕` work as on a case run.

## A guide is for the end user, and it comes last

Two things set a guide apart from every other case in the folder, and
both follow from who reads it.

**It says less.** A tester needs the selector, the fixture, the note
about why a step is there, the verdict and the comment thread. The person
reading a guide needs none of that — they are trying to get something
done, and every internal name in the text is a word they have to skip.
So the export keeps the title, the goal, what to have ready, each step's
action in the words on screen, the pictures, and *You should see*.
Selectors, `### Note`, photo specs, test data, verdicts, comments and
ratings never reach it. Write the guide knowing that: if a sentence only
makes sense to someone who has seen the code, it does not belong.

**It is written on the final version of the feature.** A guide's
screenshots are the UI at the moment of the run. A label renamed after
the run, a button moved, a dialog redesigned — and every picture that
shows it is wrong, and nobody runs a guide twice to find out. So the
guide is the last step of a feature, not one of the first: after the
**quick** or **full** case has passed on the build that will ship, after
the last UI change is in, right before the final push. Write cases early
and often; write the guide once, at the end. If the feature changes after
the guide was exported, the answer is a new run and a new export, not an
edit to `README.md` — the words may still be right, the pictures are not.

## `@kind guide`

A header line, beside `@project`:

```markdown
# Shop: Place your first order
@version 0.0.13
@project Shop
@kind guide
```

It changes the reader, not the grammar. In the panel the verdict buttons
read **Done / Could not** and the Expected block **You should see**; the
Library and case screen show a *guide* badge; the linter stops asking for
`Kind: quick` marks. Everything else in the step contract still applies —
a guide with an invented button is worse than a case with one, because
nobody runs a guide twice.

The **guide** skill writes one from source, in end-user prose, with a
photo spec on every step that changes the screen — see
[the skills](skills.md#writing-a-guide).

## Exporting

A finished run that has at least one screenshot, or is a run of a guide,
offers **⬇ Download guide** on the run screen; a finished free run with
screenshots offers the same. It downloads one HTML file with every image
inlined, which opens offline and can be mailed as it is. Placeholders whose
photo was discarded are dropped from the text, and the button says so in a
line beside it.

From the repo, the plugin's validator exports the same thing
deterministically and adds the Markdown form:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" list-guides <data folder>
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" export-guide <data folder> <caseId> --run <runId> --format md|html|both
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" export-guide <data folder> --free <freeRunId>
```

`--format md` (the default) writes a folder; `html` a single page; `both`
both. The destination is `--out <dir>` or `<data folder>/guides/<slug>/`,
and the command refuses a non-empty folder unless `--force`:

```
<data folder>/guides/place-your-first-order/
├── README.md               the guide, with ![caption](images/01.png) figures
├── images/01.png …         the rendered screenshots
└── index.html              only with --format html or both; images inlined
```

What a guide contains, from the run: the title, goal and description;
*Before you start* from `# You will need` and `# Prerequisites`; then
every step the run did not skip, in run order, numbered over those steps
only — its title, `Go to:` from `Where:`, `Find it under:` from `Via:`,
the instructions with each `%PHOTO_n%` replaced by its figure, any
hand-taken screenshots of the step, and **You should see** from
`### Expected`. A figure is the image, its caption, and one legend line
per `Callout:` that had text. `### Note`, selectors, scripts, the photo
specs, verdicts, comments and ratings never reach it.

The **export-guide** skill drives the same command and fixes tester-voice
sentences in the exported file — never in the case
([the skills](skills.md#exporting-a-guide)).

## What stays local and what ships

`runs/` and `free-runs/` are git-ignored, screenshots included — a capture
may show a customer's data, and a run is working state. `guides/` is not
ignored: it holds what the export produced, and the export is the
deliverable. Re-export with `--force` after a new run rather than editing
`README.md` in place, unless the edit is wording — the picture files are
replaced, the words are yours.
