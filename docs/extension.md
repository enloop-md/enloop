# The extension

The Chrome side panel: installing it, the folder it stores cases in, the site
permissions it asks for and when, and the viewer it shares cases through.

See also — [the case format](case-format.md) for what a case file is,
[the skills](skills.md) for having an agent write one, and
[screenshots and guides](guides.md) for the pictures a run takes.

## Install

**From the Chrome Web Store** — the normal path:
[install Enloop](https://chromewebstore.google.com/detail/enloopmd-managing-human-a/fnpjeaabeckcihomnmeoapclokikanod).
Chrome keeps it updated automatically, and that's the whole install.

The two paths below load it as an **unpacked extension** instead — useful for
running a specific release or your own build. Chrome allows this on any
profile with Developer mode switched on.

**A. From a release — no build tools needed.**

1. Download `enloop-<version>.zip` from the
   [latest release](https://github.com/enloop-md/enloop/releases/latest).
2. Unzip it somewhere you intend to keep — `~/enloop-extension`, say. Chrome
   loads an unpacked extension from that path every time it starts, so moving
   or deleting the folder later disables it.
3. Open `chrome://extensions`, switch on **Developer mode** (top right).
4. **Load unpacked** → select the unzipped folder — the one with
   `manifest.json` directly inside it, not its parent.

To update: download the new zip, replace the folder's contents, and press
**Reload** on the Enloop card at `chrome://extensions`.

**B. From source**, which is what you want if you intend to change anything:

```bash
npm install
npm run build
```

Then `chrome://extensions` → **Developer mode** → **Load unpacked** → select
**`extension/dist`** (the build output, not the repo root and not
`extension/`).

Either way, open the side panel from the extension's toolbar icon. Installing
asks for no site permissions — see [Site access](#site-access) for what gets
asked for later, and when.

On first run the panel asks you to connect a folder — or takes a case file
straight away: the dashed **Drop a case file here** block on that screen,
and at the top of the Library ever after, accepts a dropped or picked `.md`
and makes it a runnable case. With no folder connected it lands in the
browser's own storage, listed in Settings as *Inbox (this browser)*; with
one, in the default folder.

 Pick any directory; the
extension creates its layout inside:

```
<your folder>/
├── project.json         what this folder is called: { "name": "Acme Shop" }
├── test-cases/          cases and suites
├── runs/                one folder per run: case.md, run.json, report.md,
│                        screenshots/NN.png (and NN.source.png as captured)
├── free-runs/           unscripted sessions, with their own screenshots/
├── guides/              exported guides: <slug>/README.md + images/, or index.html
└── agent/               the live channel to a watching agent session —
                         created on first use; see skills.md
```

A freshly connected folder is empty, and the Library offers to **load an
example case** into it. It runs against a public practice site and exercises
every control the panel has — Go, Highlight, values that type themselves into
fields, an automated step, and the quick/full split — so the first thing you
do is watch a run work rather than author one blind. It is an ordinary case
file; delete it when it has served its purpose.

After a rebuild, hit **reload** on `chrome://extensions` and reopen the side
panel — a build alone does not refresh an already-loaded extension.

## Storage: the connected folder

Local files are the only storage today. The folder you pick **is** the
database — the extension reads and writes it directly through the File System
Access API, and there is no server, no account, and nothing uploaded. (A
remote option is planned; `DataStore` is an interface with one implementation
so far, so it can be added without touching the screens. Until then, sharing
cases means sharing the folder — commit it, or put it on a synced drive.)

Two things follow from that API, and both are Chrome's design rather than
bugs:

- **Permission lapses when Chrome restarts.** The panel opens on *Welcome
  back* with a one-click **Reconnect** button. Your cases and runs are
  untouched; only the extension's access to them has to be re-granted, and
  Chrome requires a click to do it.
- **Chrome only reports the folder's name**, not its path — so the folder
  says what it is called itself, in a `project.json` at its root:

  ```json
  { "name": "Acme Shop" }
  ```

  The panel shows that name everywhere a folder appears: the reconnect
  buttons, the storage picker in the Library, Settings, with the directory
  name underneath. Without it, four repos that each keep their cases in an
  `enloop.md/` are four identical rows.

  You rarely write the file yourself. On connect, and on every refresh, a
  folder with no name recorded gets one: the `@project` its cases agree on,
  else the repository directory you picked when Enloop found the case folder
  inside it, else the directory name — and whatever it worked out is written
  back, so it is settled once and travels with the repo. **Rename** in
  Settings edits the same file. A folder holding several projects' cases is
  left unnamed on purpose: no single name is right, and the Library already
  groups those rows by `@project`.

**Disconnect** in Settings forgets the folder; it never deletes anything.

## Site access

Installing asks for no site permissions at all. The panel needs access to a
page only when a step acts on one — Highlight, an inserted value, an
automated script — and asks then, for that site, once:

> Enloop needs your permission to act on `app.example.com`. **Grant access**

Grants are per origin and ignore the port, so `localhost:3000` and
`localhost:8080` are one grant. Three pages can never be scripted no matter
what is granted, and the panel says so rather than reporting a selector as
missing: Chrome's own pages (`chrome://`, the extensions page), the Chrome
Web Store, and local `file://` pages unless *Allow access to file URLs* is
switched on for Enloop at `chrome://extensions`.

If you are upgrading from a build that requested `<all_urls>` at install
time, Chrome keeps what it already granted — nothing to re-approve.

## Panel colour

Hover the ⚙ in any header and a row of swatches drops down: slate (the
default), paper, sage, sky, lavender, rose, graphite and dark. One tap
changes the whole panel and remembers the choice in this browser, without
leaving the run you are on. Every light theme is the same grey scale
re-tinted — the lightness of every text and background is unchanged, so
nothing becomes harder to read than the default; dark inverts the scale
and switches native inputs to dark too. Clicking the ⚙ still opens
Settings.

## During a run

A case written in **groups** (`# Steps: <title>` sections — see [the case
format](case-format.md#groups)) shows each group's title and goal as a
heading over its steps, with a running tally of how the steps under it have
gone. The goal is the sentence to read before the next few verdicts: it
says what they are for. Numbering runs on through groups.

Every step takes **comments**, and each comment says **who it is for**:

| Tick | When |
| --- | --- |
| Developer | the app did something wrong |
| Product | it works, but should work differently |
| Test writer | the case was wrong, unclear, or missing something |
| Docs | the documentation is wrong or missing |
| Ops | environment or test data, not the app itself |

Tick as many as apply, or none — an untagged comment is context, kept with
the run and addressed to nobody. The panel shows the five names in one row;
**What do these mean?** unfolds the reasons above under each and stays
unfolded until you fold it again. **Add comment** lights up the moment the
box has anything in it, and clears both the box and the ticks, so the next
comment starts addressed to nobody.

Above the box, **+ Combine with previous step** adds the one comment testers
leave most often, in a single tap: "This step needs to be combined with the
previous step", addressed to the test writer. It is an ordinary comment once
added — remove it with its × — and the **check** skill knows the wording and
merges the two steps in the case's next version. Nothing changes in the run
you are on. The button is not offered on the first step, and disappears once
the comment is on the step. This replaced a free-text box, a note with a
category dropdown, and a task list, which between them asked a tester holding
a fact to first decide what kind of thing it was. Audience is a question
anyone can answer mid-run; taxonomy is not.

**The box saves as you type**, and what is in it counts as a comment whether
or not you press **Add comment** — the button is for starting a *second* one.
That matters because a side panel is destroyed every time you click into the
page you are testing, and because the most natural moment to write something
is right before pressing Finish.

Each audience gets its own section in `feedback.md`, so whoever picks the
file up can find their own name in it. Anything ticked for the **test writer**
goes one step further — see [project rules](#project-rules).

**Handing a finding to the agent that can fix it.** The step you are on,
and every step already given a result, offers **⚒ Prompt to fix this**. One
click gathers everything about that step into a Markdown prompt and copies
it: which project the fix belongs in (the case's `@project`, and the repo
the case was authored from when an agent stamped one), the environment and
main domain, the step's own text — where, via, selectors, instructions,
expected, note, the script and its result for an automated step — your
comments on it with their audiences, the questions you asked from it and
their answers, any earlier step that failed or carries a comment, and what
the page printed while the step was current: errors, warnings, uncaught
exceptions and failed requests, deduplicated, with stack traces, and the
request trace when you captured every request. Chatter stays in
`console.md`; a step whose log has nothing wrong in it gets no console
section. It ends with what to do — find the code, make **Expected** hold,
and say so instead if the finding is about the case rather than the app.
Paste it into Claude Code in the app's repo, or save it with **Download
.md**. It is a snapshot: a comment added afterwards is not in it, and
**Regenerate** makes it again. This needs no agent watching the folder.

**No agent on this machine?** A finished run shows **Comments for all
steps** at the bottom of the screen. It opens the same text as `feedback.md`
— every comment, rating and failure, grouped by audience — with a **Copy**
button and a **Download .md** button. That is how a QA engineer with no
Claude Code installed hands a run to the developer or test writer who has
it: paste the text into a ticket or a chat, or attach the file, and the
**check** skill reads it as it would read the file in the run's folder.

**Starting further in.** A run gets dirty — wrong data, a wrong turn at
step 4 — and the honest thing is a fresh one. But the early steps were
done and are not in question, and clicking Pass through them again is
theatre. Open any step ahead of the one you are on and press **⤵ Skip to
this step**: every undecided step before it is marked in one go, and that
step becomes the current one. Steps passed this way carry a *jumped over*
badge, and the report and `feedback.md` keep them apart from a step you
chose to skip: a jump says nothing about the steps under it, so the
**check** skill never reads them as steps the case should drop. Give one
of them a verdict later and it is yours again.

**Options, mid-run.** The status bar's **Options** (a green ● while
capture is on) unfolds the same capture boxes as Settings and the start
form — console output, failed requests, every request — plus the
screenshot-tools box on a test run. They are there because the moment you
want the console kept is the moment something odd just happened, and
because turning capture on only reaches a page from its *next* load: the
notice under the bar says so and offers **Reload page**, and a scenario
you refresh anyway loses nothing. Entries land in the run's
`console.jsonl` every few seconds from then on, which is what an agent
answering a "what did the page say" question reads — it is told that a
log with no console lines is a page that was not wrapped, not a page that
logged nothing.

Before finishing a run you can also leave a **comment on the run as a whole** —
"ran against an old build", "felt slow throughout". It lands in `report.md`
above the steps, and it counts as feedback signal on its own, so a run that
passed while worrying the tester still produces a `feedback.md` for
the **check** skill to read.

### Guide mode

A case whose header says `@kind guide` is a **user guide**: the same
grammar and the same run, written for the person who will use the feature
rather than the person testing it. The panel changes its words, not its
mechanics — the Library and case screen show a *guide* badge; there is a
single **Start run** (a guide has no quick tier); the Expected block reads
**You should see**; the verdict buttons read **Done / Could not**; the
screenshot tools are always on, since the run's pictures are the guide;
and a finished run always offers **⬇ Download guide**, screenshots or
not. Everything under [screenshots](#screenshots) applies. The walkthrough
from writing to shipping is in [guides](guides.md#guide-mode-start-to-finish).

### Screenshots

**Shown on guides, hidden on tests unless you ask.** Pictures are what a
guide is made of, so a guide run always shows the tools below. On a test
they are evidence for the odd step and dead space under every other, so a
test run hides them by default: no capture buttons, no delayed capture,
no unfilled photo slots. Turn them on with **Show 📷** in the run's status
bar, with **Screenshot tools on this run** in front of Start, or in
Settings under *Screenshots during runs* — one setting for the whole
extension, ticked anywhere, seen everywhere, like capture. Pictures
already taken are always shown and stay editable, the runner still takes
the photos a case's `### Photo` specs ask for, and the keyboard shortcut
and the page's context-menu capture work either way.

Every step has **📷 Screenshot** and **📷 Screenshot & edit**, and the run
header has a **📷** that captures to the current step or, before there is
one, to the run. A step's `### Photo` spec makes the runner take the
picture itself — cropped to the container the case names, with the
controls it names boxed, arrowed, numbered or blurred — when the step
becomes current (`Take: before`) or when you give the verdict (`Take:
after`); `Mode: confirm` shows it first with **Keep · Retake · Edit ·
Discard**, `Mode: auto` keeps it with a two-second toast, and `Take:
manual` leaves a **📷 Photo n** button for you to press. Each screenshot is
a thumbnail under its step with a caption, **✎ Edit**, **↺ Original**,
**Move** and **✕**; the editor opens over the page with select, crop, blur, line,
arrow, rectangle and numbered callouts in seven colours. Pictures land in
`screenshots/` beside `run.json` and are listed under their steps in
`report.md`. Free runs have the same buttons, and each capture drops a
`%PHOTO_n%` into the notes where the picture belongs. Chrome only
photographs a tab the extension has been invoked on, so the first capture
on a tab is **Alt+Shift+S** on the page or the page's **Take an Enloop
screenshot** context-menu item — after that the buttons and the runner
work on that tab. No all-sites access is asked for. The whole of it —
the spec keys, the editor's keys, what is stored where — is in
[screenshots and guides](guides.md).

### Asking the agent mid-run

When an agent is watching your data folder — a `/enloop:serve` pass in
Claude Code, run from the repo under test — two more things work during
a run, without leaving the panel. The panel checks for a connected
agent and shows setup instructions right where you'd otherwise wait:

- **Ask the agent.** Select the confusing part of a step, press *Ask the
  agent*, and type the question — "how do I check this specifically?". By
  default the question carries a **screenshot** of the page you are on and a
  **page snapshot** (its structure, stripped of scripts and styles), both
  saved into the folder's `agent/` directory and nowhere else; untick either
  before sending. The answer appears under the step. If the step text itself
  was the problem, the agent lands a patched version — a minor: `v3`
  becomes `v3.1`, so patches never masquerade as authored versions — and
  the panel offers **Load v‹3.1›**. It verifies first that every step you
  already executed is unchanged, and loading keeps every recorded status. The one exception is
  the step you asked from: it may be rewritten even if you already gave it
  a result, and loading then resets that one result so you redo the step
  against the new text. The panel says when you've been "waiting for an
  agent" versus when one has picked the question up — and, once it has,
  what it is doing right now, in the agent's own words: *Reading the reset
  form*, *Found it — the step names a renamed button*, *Writing the
  answer*. The line shows how long ago it last changed, so a long think is
  visibly a think and not a crash. Sent the wrong thing — pasted text you
  did not mean to, asked from the wrong step? **Withdraw** sits next to
  that line the whole time an answer is owed: the agent stops working on
  it (the daemon within seconds, a serve pass before it writes), and the
  card folds to *Withdrawn* with your text still readable for the
  corrected ask. An answer that lands anyway stays folded under it, one
  click away.
  An answer takes a while, and you will have gone to other tabs by the
  time it lands: every question card shows **↗ Bring me to the tab**
  whenever the tab you asked from is not the one in front of you. It
  brings that tab forward — the very tab, with whatever you had typed
  into the page still there, not a fresh copy of its address. The link
  disappears once you are back, and is not offered if the tab was closed
  and no other tab shows that page.
- **Run a case's commands.** Inline commands in Dependencies, Prerequisites
  and step text (`node scripts/seed.js …`) get a ▶ **Run** button. The
  watching session executes them from the app repo, output streams into a
  card in the panel, and **Stop** kills the process. Scripts die on their
  own timeout, or a few minutes after the panel closes — closing the panel
  is how you turn off a server you started from it.

No session watching? Questions and Run requests wait, and the panel says so
— nothing is lost, and nothing leaves your machine either way. Run
`/enloop:serve` again and the next pass picks them up. (An unattended
watcher, the [enloopd daemon](daemon.md), exists in the repo but is not
offered in the panel until it is fixed and debugged.)

### Project rules

A tester saying "this case should have started from the admin dashboard" is
sometimes reporting one broken case and sometimes stating how every case for
this app ought to be written. The second kind used to be thrown away: it went
into one case's next version and was learned again from scratch by the next
case anybody wrote.

So comments marked for the **test writer** are read by the **check** skill,
which decides which are one-offs and which are standing rules, and writes the
standing ones to `rules/<project>.md` in your connected folder. The **quick**
and **full** skills read that file before authoring and are told to obey it.
The rules live beside the cases rather than in the app repo because that is
the one place both halves can reach — the extension has a handle on the data
folder and nothing else.

The extension never writes that file itself. A rule is a judgement about
which of two things a comment was, and the skill that has read the run is the
one placed to make it.

### Rating steps and cases

Rules say what a case must do. Stars say what a good one looked like.

Under every step's verdict buttons, across from **Skip this step**, are five
stars; above **Finish run** are five more for the case as a whole. They rate
the *writing* — was this step clear, checkable, the right size — not the
feature: a step can fail and deserve five stars. Most steps get none, and
that is the intended state. The stars are for the outliers: the step you
would show someone as the way to write one, and the one that made you guess.
Tap a star to set, tap it again to clear.

A rating lands in `run.json`, in `report.md`, and in `feedback.md` under
*Steps the tester rated highly* and *…rated poorly*, beside whatever comment
you left on the step — "excellent, the Expected line names the exact toast"
teaches more than the stars alone. Across runs, the plugin's
`enloop-case.mjs ratings` command collects every rated step in a project,
printed as the run froze it, and the **quick** and **full** skills read that
before authoring the way they read the rules: highly rated steps are the
shape to write in, poorly rated ones the shape to avoid. The **check** skill
treats one or two stars on a step as a defect to fix, and a shape starred
across several cases as a rule worth writing down.

A side panel closes whenever you click into the page you are testing, which
during a run is constantly, and closing it destroys the panel. Reopening
returns to the screen you were on — including mid-run — and after a browser
restart, when that memory is deliberately dropped, the Library carries a
**Resume** banner for a run still in progress. Nothing is ever only in the
panel: every mark, note and comment is written to the run's folder as it
happens.

## Capturing the console and the network

A run records what the tester can see. The console is where the cheapest
evidence of a bug lives and where it is invisible by default — an uncaught
`TypeError` behind a button that appears to do nothing, a 401 logged by a fetch
wrapper. Two checkboxes turn that into part of the run, both **off** by
default:

- **Console output** — `log`/`info`/`warn`/`error`/`debug`, plus uncaught
  errors and unhandled rejections.
- **Failed requests** — method, URL, status and duration for requests that
  failed or came back 4xx/5xx. It is a separate box because it is a separate
  question: agreeing to keep logs is not agreeing to keep traffic.
  - **…and the ones that worked** — appears under it once requests are on, and
    turns the capture into the whole trace: every request the page made, in
    order, with its status. That answers a different question — *what does this
    actually call when I click that* — which is what the network tab normally
    gets opened for. Noisier, so it reaches the log's ceiling sooner, and worth
    switching back off once you have what you came for.

Never headers, never bodies, at any setting; query strings are redacted to
`?…`. All of it is off by default because console output can contain tokens and
customer data, and runs are written to a folder people commit.

They sit **directly above Start run** on a case screen, at the top of a free
run, and in **Settings → Capture during runs**, which is the same setting in
three places rather than three settings: capture is a browser-wide content
script registration, so ticking a box applies to every run from then on, not
to the one you are about to start. Untick it when you are done — while either
box is on, every `console` call and every request on the sites you have
granted Enloop runs through a wrapper, which costs a little of the speed you
are there to judge.

Before the run is also the only moment the decision is any use, because
**turning capture on needs a page reload; turning it off does not.** Enloop
wraps `console.*` and `fetch` in the page's own world, and the wrapper has to be
installed before any page script runs — otherwise it misses everything logged
during load, which is usually the interesting part. Chrome can only guarantee
that from the *next* page load, so the panel says so, offers a **Reload page**
button, and explains why behind the ⓘ next to it. Switching capture off reaches
every loaded page immediately. Capture covers the sites you have granted Enloop
access to, and no others.

What lands in the run's folder:

- **`console.jsonl`** — the record, appended every few seconds while the run is
  in progress.
- **`console.md`** — the same thing rendered for a person when the run
  finishes, grouped by the step that was running at the time.
- **`run.json`** — per-step counts (`consoleErrors`, `consoleWarnings`,
  `networkFailures`, `requests`), so the report can point at a step without
  anyone opening the log.

Whether any of it is handed to an agent is a second, separate decision, made in
the finish bar: **Include console output in the report**, ticked by default when
the run captured at least one error and unticked otherwise. What gets attached
is a deduplicated digest — errors, warnings and failed requests, with an
occurrence count and the step each first appeared in — not the raw log, because
fifty identical framework warnings read as fifty problems. Requests that
*succeeded* are kept apart from that list, under **What the page called**,
because they are context rather than findings: ranked among the errors they
would win on count every time, since the thing an app does most is succeed. `console.md` is kept
either way; the checkbox governs what leaves the folder, and the **check** skill
is told to respect it rather than read the file anyway.

## Sharing a case

A case screen can also hand the case to someone who will never open the
extension — **Share v*N*** at the bottom, with four downloads and a link.

The **full/simplified** axis is how much of the machinery the recipient sees.
Full is the case as authored, selectors and scripts included. **Simplified**
rewrites it for a person carrying it out by hand: automated steps are dropped
(and listed by title at the end, so the coverage is not silently missing),
`Selector:` and `Kind:` lines go, and `%VAR%` placeholders with a literal
default are filled in.

The **Markdown/HTML** axis is who they are. Markdown is the file — for a repo,
a PR, another Enloop folder, or a coding agent. HTML is [a page](extension.md#the-viewer): one
self-contained file, opened by double-clicking it, with the steps tickable and
the values copyable. Everything except the raw Markdown carries a suite's prep
steps along with the case, since a reader handed the case alone would be
missing the setup it assumes.

A finished **run** can be shared too, as what the tester saw rather than
what they were asked: **⬇ Download guide** appears on a finished run with at
least one screenshot, on any finished run of a `@kind guide` case, and on a
finished free run with screenshots. It is one HTML file with the pictures
inlined — the steps in the order they were run, each with its photos,
captions and callout legends, and *You should see* where the case had
Expected. The same document as a Markdown folder comes from the plugin's
`export-guide` command; see [screenshots and guides](guides.md#exporting).

## Environments and domains

A case builds its addresses on `%DOMAIN%` — the tab you start the run from,
unless you say otherwise — and declares a domain only for a second host
(`%ADMIN%/audit`). Its `@locations:` line names the hosts it is meant for,
and every address the run screen shows is green when it fits one of them
and red when it does not; the link opens either way. **Settings →
Environments** on a connected folder is where the addresses live: the
domain and variable names every environment provides, then one card per
deployment — local, staging, prod, a customer's instance — with an address
per domain and a value per variable. A card may be scoped to a `@project`,
so a folder holding several products' cases keeps their stagings apart, and
one card per project can be marked **default**. Everything writes through to
`environments.json` in the folder, which is also what the authoring skills
fill in when they derive the deployments from the repo — so the screen is
often already populated the first time you open it.

It is populated first because the skills insist on it. `/enloop:full` and
`/enloop:quick` read the project's environments before they read a line of
source, and when there are none they stop and ask once — set them up now,
or continue with local only — and never go on without an answer. Setting
them up is a short dialogue, the same one `/enloop:setup environments`
runs on its own: local is taken from the repo without a question, then
each further deployment from what you paste — a `tsh` line, a command, an
address, a sentence. That paste is the one question; a second — the
address, and until when for a temporary one — comes only when the paste
did not give it, and there is never a third: the name settles the rest,
`prod` is marked **production**, `pr-42` is temporary. The order is
deliberate: an address written before the deployments are known is an
invented one, so the question comes before the case rather than after.

A deployment that exists for one branch and one afternoon — a Shipyard or
ArgoCD preview — has a section of its own under the shared cards,
**Temporary**. Those cards live in `environments.local.json` beside
`environments.json`, git-ignored (the panel adds the line), so a preview
address never reaches a teammate's checkout, and each carries an expiry:
the end of today unless you set a date on the card. An expired one is gone
from this screen and from the picker the next time you look, and from the
file the next time anything is saved. **Add temporary** creates one for
today; a temporary environment is never the default.

A card may also show a **reach** — one line saying how an agent gets to
that deployment's *data*: `via tsh staging-postgres · verified 2 h ago`,
`via command · unreachable: command exited 1: Connection refused`, or
`manual: VPN
"Office", then psql -h db.internal`. The panel only shows it. It never
opens a tunnel or runs a command; that happens in the app repo, where
`/enloop:setup environments` records the reach from what you paste and
probes it once. When the probe finds no Teleport session, the line says so
and the `tsh login` it names is yours to run — certificates are the one
thing no skill can obtain for you. Nothing on a reach is a secret: host
names, service names, user names, ports; a pasted connection URL is
recorded without its password. A card marked **production** is treated as
such by the skills: nothing looks anything up there unless asked in so
many words, and a value found there is never written into the folder.

A case screen opens with the case's **goal**, then **You will** and **You
will need** — the four things a tester reads before Start — and the run
screen keeps the goal pinned under its title for the whole run. **Start
run** is one button: the quick path when the case marks one, with **Full**
beside it. A run does not start while any value is empty; the values block
opens and says where each missing value comes from.

**A value you type is kept for the next run of that case.** The record id
you were chasing, the account this bug needs, the address of a branch
deployment nothing knows about yet — typed once, and there again when you
come back, marked *from your last run* beside the field. Only typed values
come back; a generated one is generated afresh at start, and an address that
follows the open tab keeps following it. **↺ back to auto** clears the value
here and for next time, and picking an environment that has its own answer
for a name drops the remembered one rather than running staging against the
address you typed for prod. The values live in this browser, never in the
folder — a typed value is often an email address, and it is your working
state rather than the case's.

On a case screen, the **Environment** picker sits above **Start run**. Picking
one sets every domain and every environment-provided variable at once; the
values below stay editable, and each shows where it came from — the
environment's name, *open tab*, *default*, or a generator. The picker starts
on the environment you used last in that folder, else the project's default
— and when the one you used last has since expired, the default, as if it
had been deleted. A temporary environment is listed as `pr-42 · until Sep
11`, a production one as `prod · production`. **No environment** is always
on the list: then `%DOMAIN%` follows the tab you have open (and any other
domain whose `Match:` fits it), which is the answer for an address that
exists nowhere but in your address bar — the `DOMAIN` field under **Start
run** shows in green or red whether that tab is one the case names. A
preview you will come back to during the day is better as a temporary
environment, so every case fills its address in rather than following
whichever tab is in front. The run header names the environment for the
whole run, and the report lists the address each domain resolved to. The
screen never stops the run to ask for a value: a case that would need to
is refused by the skills' validator before it reaches the folder — and so
is one whose variable is left to the environment while no environment of
the project has a value for it.

## The viewer

<https://enloop-md.github.io/enloop/>

The same page, online, for people who should not have to install anything: send
a link and they read the case in a browser, tick steps off as they go, copy the
values into their own app, and fill in the variables — every `%NAME%` in the
document updates as they type.

**The case travels inside the link.** There is no server, no account and no
upload: the case is deflate-compressed and base64url-encoded into `#c=`, and
the page decodes and parses it on the reader's own device. It goes in the
**fragment** — the part after the `#` — which browsers never send to a server,
so a case naming internal URLs, staging logins or customer records never
reaches GitHub Pages or any access log along the way. The page you send is the
page they get, forever; nothing can be taken down or expire.

Compressing roughly halves the link, which is what keeps a long case inside the
length a ticket or chat client will carry. Older links, uncompressed and in the
`?c=` query string, still open.

**Copy link** on the case screen puts that link on your clipboard. Every case
file the extension writes also ends with a comment carrying its own link:

```markdown
<!-- enloop:viewer
Read this case in a browser — tick off steps, copy the values, fill in the
variables. The link below carries the case itself; nothing is uploaded, and
the part after the # never reaches a server at all.

https://enloop-md.github.io/enloop/#c=~xdc9TsQwEIbh3qf4tNF2…
-->
```

An HTML comment, so it is invisible on GitHub and in any preview but plainly
readable in the raw file — which is where someone handed a case file is
looking. It is regenerated on every write and stripped before the file is
parsed, so it never reaches the case model, a run, or an export; it is not
yours to maintain, and editing it does nothing.

**Drop a case file anywhere on the page** and it opens — the shortest route in
when the case arrived as a file rather than a link, and the way to move from
one case to the next without going back anywhere. Opened with no case, the
viewer also offers a box to paste one into, which is the way in for a case too
long to fit in a link.

---

### Building a case without an agent

The viewer also writes cases. **Build one** on its landing page opens a form —
title, description, values, prerequisites, and a card per step with
instructions, expected result, `Where:`, selectors and an optional script —
with the generated case file shown live underneath as you type. Download it as
`.md` into your connected folder, copy the Markdown, or open it as a case
straight away.

**✎ Edit** in the toolbar loads whatever case you are viewing back into that
form, so a case someone sent you as a link can be corrected and re-shared
without an editor or an agent.

It serializes through `renderCaseMarkdown` in `shared/`, the inverse of the
parser and its neighbour in the same file — a builder that drifted from the
grammar would emit files that look right and do not load.
