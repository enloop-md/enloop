# Changelog

Versions are the extension's; the plugin and the case grammar carry their
own numbers and are listed where they moved. Store uploads are the
`enloop-extension-v<version>.zip` attached to each GitHub release.

## Unreleased

Plugin 0.20.1 · daemon 0.1.0

### Running cases

- **Withdraw a question.** A question sent by mistake — the wrong text
  pasted, the wrong step asked from — no longer has to be answered.
  **Withdraw** sits beside the waiting line for as long as an answer is
  owed; it writes a `withdrawn` flag into the question's directory, the
  daemon stops its backend within seconds (the CLI child is killed, the
  API call cancelled) and writes nothing, and a serve pass skips the
  question or drops the answer it was about to write. The card folds to
  *Withdrawn* with the text still readable; an answer that lands anyway
  stays folded under it. Additive on protocol 1.
- **Skip to this step.** A run restarted after a dirty one no longer has
  to be clicked through: open any step ahead and **⤵ Skip to this step**
  marks every undecided step before it in one go. Those steps carry a
  *jumped over* badge and `jumpedOver: true` in `run.json`; the report
  says so per step, and `feedback.md` leaves them out of *Steps the tester
  skipped* — a jump is not a vote against the steps under it, and the
  check skill is told as much. A verdict given later clears the mark.
- **Screenshot tools hidden on test runs.** A guide run shows them as
  before; a test run no longer has capture buttons, the delayed capture
  and unfilled photo slots under every step. **Show 📷** in the run's
  status bar, the box in front of Start, or *Screenshots during runs* in
  Settings turns them on — one extension-wide setting. Pictures already
  taken always show, the runner's `### Photo` specs still fire, and the
  shortcut and context-menu capture keep working.
- **Capture, changeable mid-run.** **Options** in the run's status bar
  unfolds the console/requests capture boxes and the screenshot-tools
  box without leaving the run; the reload notice sits under it, since a
  page loaded before capture was on is wrapped only from its next load.
  Both servers are now pointed at the run's `console.jsonl` when a
  question is asked — the daemon's brief names it, the serve skill reads
  it — and told that a log with requests but no console lines means the
  page was never wrapped, not that it logged nothing.

## 0.16.0 — 2026-09-13

Extension 0.16.0 · plugin 0.20.0 · grammar 0.0.13 · daemon 0.1.0

### Writing cases

- **Environments before cases.** `full` and `quick` read the project's
  environments before any source, and when there are none they stop and
  ask once — set them up now, or continue with local only — and never go
  on without an answer. Setting up is the environment master, which
  `/enloop:setup environments` also runs on its own: local is recorded
  from the repo without a question, then each further deployment from what
  you paste — a `tsh` line, a command, an address, a sentence — and one
  more question, the address, only when the paste did not give one. A
  name like `prod` marks it production; a preview name makes it
  temporary. Each environment may carry a **reach**, how an agent gets to
  its data: Teleport (`tsh`), a command that exits 0 when the deployment
  answers, or a sentence for a human. The validator probes a reach as
  soon as it is recorded and keeps the result either way;
  `enloop-case.mjs reach` probes again. `tsh login` is the one step left
  to you, shown as the exact line to run. Nothing written is a secret — a
  pasted connection URL loses its password before it is recorded — and
  the panel only shows the reach; it never opens a tunnel.
- **A value left to the environment must exist somewhere.** With the data
  folder in view, the linter refuses a case whose environment-provided
  variable or domain has a value in no environment of its project — that
  run would have to ask — and warns, naming them, when some environments
  have it and others do not. Where the value differs per deployment and
  the environment has a reach, the skills record a **lookup** — a
  read-only `select` kept on the environment — and `enloop-case.mjs lookup
  … --record` runs it through the tunnel and writes the answer into the
  file. Production answers only with `--production`, and never records:
  what is found there stays with the tester.

### Running cases

- **Temporary environments.** A Shipyard or ArgoCD preview that exists
  for one branch has a home: **Add temporary** under Settings →
  Environments, or `--temporary` / `--until YYYY-MM-DD` from the skills.
  They live in `environments.local.json` beside `environments.json`,
  git-ignored, and each expires — the end of today unless a date says
  otherwise — after which it is gone from the picker, the screen and the
  file. The picker lists one as `pr-42 · until Sep 11`, a production one
  as `prod · production`; a temporary environment is never the default. A
  card with a reach shows it in one read-only line, with the last probe's
  verdict.
- **The editor opens over the page.** Edit no longer opens a tab of its
  own: the editor is framed into the tab under test, full size, and over
  the side panel when that page cannot be scripted. A tab of its own took
  the connected folder's grant with it when it closed, and the save
  failed; a frame does not. Drawn shapes can now be **selected, moved,
  resized, recoloured and deleted** after the fact, with undo and redo
  over the whole history — a runner-drawn callout and a hand-drawn one
  alike.
- **A capture that keeps the page's focus.** A click on the panel takes
  focus from the page, and the dropdown you opened there closes before
  the picture is taken. So every capture button also fires when you
  **hover it with Ctrl+Shift held**, and there is a delayed capture that
  counts down three seconds on the button while you click back into the
  page and open what should be in the picture.

### Guides

- **A guide comes last.** The docs and the **guide** skill now say what
  a guide is for and when to write it: it is for the end user, so it
  carries less than a case — selectors, notes, test data, verdicts and
  comments never reach the reader — and it is written once, on the final
  version of the feature, right before the push that ships it, because
  its screenshots are the UI at the moment of the run. The skill looks at
  the tree first and, when UI files are still uncommitted, asks once
  whether to write now or after the last change lands. **export-guide**
  ends by saying that a change to the feature means a new run and a new
  export, never an edit to the images.

## 0.15.0 — 2026-09-11

Extension 0.15.0 · plugin 0.19.0 · grammar 0.0.13 · daemon 0.1.0

### Writing cases

- **`Via:` — the address is never the only way to a page.** A step that
  moves to a new page also says how it is reached from the app's own
  menus (`Via: Settings → Users → the row`), shown under the address in
  the panel, the viewer and the downloaded page. The linter requires it
  on a move and accepts `Via: link only` when the UI genuinely has no
  path — a deep link, a redirect — provided the step says where the link
  comes from.
- **`enloop.md/` is the in-repo data folder.** The skills offer to create
  `<repo>/enloop.md/`; `enloop/`, `test-cases/` and `.enloop/` are still
  recognised.

### Running cases

- **↗ Bring me to the tab.** A question card shows the link whenever the
  tab you asked from is not the one in front of you — an answer takes a
  while, and you were in another tab by the time it came. It brings that
  very tab forward, not a fresh copy of its address, and disappears once
  you are back. Remembered for the browser session, with the page's
  address as the fallback.
- **⚒ Prompt to fix this.** On the current step and every decided one:
  one click gathers the step's text, your comments and their audiences,
  the question thread, earlier findings in the run, the console and
  network output captured while the step was current, and which project
  the fix belongs in — the case's `@project` and the repo it was authored
  from — into one Markdown prompt, copied and shown. Paste it into Claude
  Code in the app's repo. Works with no agent watching the folder.
- **Drop a case on the panel.** A dashed block on the Connect screen and
  at the top of the Library takes a case file — dropped, or picked with a
  click — and makes it a case you can run. With no folder connected the
  file lands in the browser's own storage, listed as *Inbox (this
  browser)*, so a case handed to you is one drop from a run with nothing
  set up. Several files at once are fine; a file that is not a case is
  refused by name.
- **The values you type come back next run.** A value typed under **Start
  run** — a record id, the account a bug needs, the address of a branch
  deployment — is kept for the next run of that case and shown *from your
  last run* beside the field. Only typed values: a generated one is fresh
  at start, and an address that follows the open tab keeps following it.
  **↺ back to auto** forgets it, and picking an environment that answers
  for the same name drops the remembered value rather than running one
  deployment against another's address. Kept in this browser, not in the
  folder.
- **One slash between a domain and its route.** An address that ends in
  `/` — pasted from the address bar, typed into an environment card,
  written as a `Default:` — loses it where a route follows, so
  `%DOMAIN%/orders` is `https://app.test/orders` and never
  `https://app.test//orders`, which most routers treat as a different path
  and answer with a 404 mid-run. Everywhere: the panel, the run's frozen
  case, the report, the viewer and a downloaded page as its values are
  edited. Nothing is added — `%DOMAIN%?next=/x` is left as written.
- **Every folder says which project it is.** Connected folders are listed
  by the name in their own `project.json` — `{ "name": "Acme Shop" }` at
  the data folder root — with the directory name under it, in the
  reconnect list, the Library's storage picker and Settings. Four repos
  that each keep their cases in an `enloop.md/` are no longer four
  identical rows. Nobody has to write the file: on connect, and on every
  refresh, a folder with no name recorded is named after the `@project`
  its cases agree on, else the repository directory you picked, and the
  answer is written back so it travels with the repo. **Rename** in
  Settings edits the same file. A folder holding several projects' cases
  keeps its directory name — the Library groups those by `@project`
  already.
- **Comment audiences are back in view.** The closed disclosure 0.14.0 put
  over the "This comment is for" checkboxes is gone; the row shows as it
  did before.
- **The daemon is off the menu for now.** Every "no agent connected"
  state points at one `/enloop:serve` pass in Claude Code; the enloopd
  daemon stays in the repo until it is fixed and debugged.
- **Screenshots.** Every step of every run — and every free run — has
  **📷 Screenshot** and **📷 Screenshot & edit**, and the run header a
  **📷** for the current step or the run itself. Chrome photographs a tab
  only after the extension is invoked on it, so the first picture on a
  tab is **Alt+Shift+S** or the page's **Take an Enloop screenshot**
  menu item; from then on the buttons and the runner work there. Site
  access stays per site — nothing asks for every site. Each one is a thumbnail
  under its step with a caption, **✎ Edit**, **↺ Original**, **Move** to
  another step, and **✕**. Edit opens the picture over the page: Crop,
  Blur, Line, Arrow, Rect and numbered Callout in seven colours, Undo,
  keys `1`–`6`, `Esc`, `Ctrl+Z`, `Ctrl+Enter` to save; the capture itself
  is never touched, so Original is always exact. Pictures land in
  `screenshots/` beside `run.json` — `01.source.png` as captured,
  `01.png` as edited — and `report.md` lists them under their steps. In a
  free run each capture drops a `%PHOTO_n%` into the notes at the caret.
  Same per-site grant as Highlight; on a page Enloop cannot see, the
  buttons are the grant notice.
- **Photos the runner takes.** A step's `### Photo` block says what the
  picture is — `Crop:` the container, `Mark:` a box, `Point:` an arrow,
  `Callout:` a numbered disc with a legend, `Blur:` a region, each a
  selector — and the runner takes it when the step becomes current
  (`Take: before`) or when you give the verdict (`Take: after`), finds
  the elements on the page, draws the marks and drops the result where
  the author wrote `%PHOTO_1%`. `Mode: confirm` shows it first with
  **Keep · Retake · Edit · Discard**; `Mode: auto` keeps it with a
  two-second toast; `Take: manual` leaves a **📷 Photo n** button. A
  selector that matches nothing is skipped and the step says *n not
  found*; a page with no grant says *Photo n not taken* and the mark
  still lands.
- **⬇ Download guide.** A finished run with at least one screenshot, any
  finished run of a guide, and a finished free run with screenshots offer
  one HTML file with every picture inlined: the steps in run order with
  their photos, captions and callout legends, *You should see* where the
  case had Expected, and none of the selectors, scripts, verdicts or
  comments. Opens offline; mail it as it is.

### Guides

- **`@kind guide`.** A header line beside `@project` that says the case's
  reader is an end user: the verdict buttons read **Done / Could not**,
  the Expected block **You should see**, the Library shows a *guide*
  badge, and the linter stops asking for `Kind: quick`. Nothing else
  changes — a guide is a case, run in the same panel, with the same
  contract behind it. Grammar 0.0.13 also brings `### Photo` and the
  reserved `%PHOTO_n%` placeholder, with linter rule `10` over them.
- **`/enloop:guide`.** Writes a guide from the app's source the way
  **full** writes a case: routes, labels and selectors read in the
  session, validated with the real parser, landed with `write` — in
  second person, one action per step, no internal names, with a photo
  spec on every step that changes the screen. Run it in the panel and the
  runner takes the pictures. A bare `/enloop:guide` gets the same
  confirm-scope question as `quick` and `full`.
- **`/enloop:export-guide`.** Picks the finished run (one closed question
  when there are several), and writes `<data folder>/guides/<slug>/` —
  `README.md` with `images/`, `index.html` with the pictures inlined, or
  both — through the validator's new `list-guides` and `export-guide`
  commands, which need nothing but `node`. Fixes tester-voice sentences in
  the exported file and never in the case. `runs/` stays git-ignored;
  `guides/` is the deliverable.

## 0.14.0 — 2026-09-05

Extension 0.14.0 · plugin 0.17.0 · grammar 0.0.11 · daemon 0.1.0

### The manifesto

`MANIFESTO.md` states the principle everything else serves: a human
verifying a flow puts in zero effort — never asked to decide, provide a
value, or look anything up. `PLAN-MANIFESTO.md` is the alignment plan;
this release carries its first pass.

### Writing cases

- **A case is a goal.** `Goal:` and `You will:` are header lines, one
  line each and required by the linter; `# You will need` lists what must
  be in the tester's hands before step 1. The case screen shows all three
  above Start, the run screen pins the goal under its title for the whole
  run, and the viewer, the downloaded page and the readable export carry
  them.
- **The contract is enforced.** Missing `### Expected`, a UI step with no
  `Selector:`, no entry point in a case that names addresses, and
  `%DOMAIN%` with no `@locations` are errors now, not warnings. A vault
  reference in a prerequisite warns: a test account's password is an
  environment value typed by the panel. The shipped example passes.
- **Every skill run ends with a link.** The `write` command appends the
  viewer-link comment to the case and prints the link; the report gives
  it first, then the two extension steps. The project name is derived
  from the repo's manifest before anyone is asked.

- **`%DOMAIN%` needs no declaration.** Every app address is written
  `%DOMAIN%/route`. The placeholder is empty by default and a run fills it
  with the tab it starts from — a branch, a review app, a local server —
  unless the tester types an address or picks an environment; a case
  guesses no host, so a wrong guess can no longer make it unrunnable.
  `%BASE_URL%` keeps working as an alias, and a declared `## APP` main
  domain from the previous convention runs unchanged. `# Domains` is now
  for a second host only. The skills write `%DOMAIN%` in new cases and
  record the app under test as `DOMAIN` in `environments.json`.
- **`@locations:` says where a case is meant to run.** A header line of
  comma-separated host globs — `localhost:8080, *.acme.com`. It gates
  nothing: every address the run screen, the online viewer and a
  downloaded page build is shown green when its host fits one and red
  when it fits none, and the link opens either way. The `DOMAIN` field on
  the case screen shows the same verdict before the run starts. The first
  entry without a `*` is what the viewer and a downloaded copy use for
  `%DOMAIN%`, so they stay clickable with no `Default:` line.
- **A value the run produces never goes in an address.** A placeholder
  nobody can fill — `%DOMAIN%/user.php?user=%USER_ID%` for a user the
  case creates — is a linter error with a specific answer: say where the
  tester clicks and give the address shape in backticks. The run screen no
  longer offers Go on an address still holding a placeholder, and the
  downloaded page does not link it. The step contract gains the rule and
  the by-eye check for a `Default:` invented to pass the linter.

### Running cases

- **A run never asks.** Start is one button — the quick path when the
  case marks one, Full beside it — and it stays disabled while any value
  is empty, with the values block saying where each one comes from.
  Comment audiences and the step rating sit under a closed disclosure;
  a comment with nobody ticked is routed at triage.
- **Point the extension at the repo.** Connecting a directory with no
  `test-cases/` finds the case folder up to two levels down, so "install
  and point it at the repo" is the whole instruction.
- **Simplified links.** The share row gains a second link that opens the
  viewer in the simplified view — no selectors, no scripts — for someone
  who will follow the case by hand.

## 0.13.0 — 2026-09-02

Extension 0.13.0 · plugin 0.15.0 · grammar 0.0.9 · daemon 0.1.0

### Writing cases

- **Domains and environments.** A case declares every deployment it touches
  under `# Domains` (`## APP`, `## ADMIN`), each with a `Default:` origin
  and an optional `Match:` glob, and uses them as address prefixes:
  `Where: %APP%/admin/reports`. An **environment** is a named set of domain
  addresses and variable values — local, staging, prod — kept in
  `environments.json` beside the cases and picked before a run; pick none
  and the main domain follows the open tab. The legacy `BASE_URL` variable
  still parses; the linter asks for it to become the main domain.
- **Variables are never asked of the tester.** Every variable resolves
  before the run from a `Default:`, a `Generator:` or the environment; one
  with none of the three is a linter error, not a prompt.
- **Step groups.** A case covering a broad change is written as concerns:
  `# Steps: Log in`, `# Steps: Restore password`, each opening with its
  goal — what its steps prove together — before the first step. Groups
  head the step list in the panel with a running tally; `report.md` and
  `feedback.md` open with a **By group** summary. The linter requires the
  goal and refuses an empty or duplicated group (rule 9).
- **Ratings feed the next case.** `enloop-case.mjs ratings` aggregates
  every rated case and step for a project, with the frozen step text and
  the tester's comments; the authoring procedure reads it, and the check
  skill treats a poorly rated step as a defect to fix.
- **Where and Note reach the panel.** A step's `Where:` address and
  `### Note` were parsed and frozen but dropped on the way into the run
  screen. Both show now, with the Go control on the address.

### Running cases

- **Star ratings.** Rate a step, or the whole case, one to five stars —
  independent of pass or fail. Ratings land in `run.json`, `report.md`
  and `feedback.md`, where four- and five-star steps are listed as the
  shape to write in and one- and two-star steps as the shape to avoid.
- **Comments, faster.** The audience row is condensed to names, with a
  **What do these mean?** toggle for the legend that remembers its state.
  **Add comment** lights up the moment there is text and clears the ticks
  after. A one-tap **Combine with previous step** chip adds the standard
  note to the test writer; the check skill merges the two steps in the
  next version.
- **Comments for all steps.** A finished run shows its feedback text —
  every comment, rating and failure, grouped by audience — with **Copy**
  and **Download .md**, so a tester with no agent on their machine can
  hand the run to someone who has one. The check skill accepts that file
  pasted in place of a run folder.
- **The agent says what it is doing.** While a question is being
  answered, the panel shows the server's own status line — *Reading
  ResetForm.tsx*, *Found it — the step names a renamed button*, *Writing
  the answer* — and how long ago it changed, instead of one unchanging
  "working on the answer". The serve skill writes `progress.json` as it
  goes; the daemon reports every file the model opens and asks the model
  to narrate through a `progress` tool, and drives headless Claude Code
  with streamed output so its tool calls are read live.

### Plugin and daemon

- The plugin's `setup` skill writes environments, the authoring skills
  read this project's ratings, and `brief` lists rule 9.
- The daemon stamps its version into its watcher file and warns once per
  folder when the extension's heartbeat speaks a different channel
  protocol.

## 0.12.0 — 2026-08-23

The panel knows when nobody is listening: it checks watcher freshness
itself and shows setup instructions where a tester would otherwise wait.
The daemon becomes the recommended server, resuming the case's authoring
session for a question; `/enloop:serve` is one manual pass.

## 0.11.0

Minor versions for mid-run patches: `v3` becomes `v3.1`, so patches never
masquerade as authored versions.

## 0.10.2

Pickup acknowledgment for questions, and mid-run fixes for the step you
are on.

## 0.10.1

Questions carry the page they were asked about: a screenshot and a
sanitized DOM snapshot, both opt-out.

## 0.10.0

Extra steps (`Kind: extra`), iframe targets for selectors, and the live
agent channel: ask a question from a step, run a case's commands.
