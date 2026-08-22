# The extension

The Chrome side panel: installing it, the folder it stores cases in, the site
permissions it asks for and when, and the viewer it shares cases through.

See also — [the case format](case-format.md) for what a case file is, and
[the skills](skills.md) for having an agent write one.

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

On first run the panel asks you to connect a folder. Pick any directory; the
extension creates its layout inside:

```
<your folder>/
├── test-cases/          cases and suites
├── runs/                one folder per run: case.md, run.json, report.md
├── free-runs/           unscripted sessions
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
- **Chrome only reports the folder's name**, not its path. If you keep a
  folder per project, give them distinguishable names — two directories both
  called `test-cases` are indistinguishable in the panel and in Settings.

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

## During a run

Every step takes **comments**, and each comment says **who it is for**:

| Tick | When |
| --- | --- |
| Developer | the app did something wrong |
| Product | it works, but should work differently |
| Test writer | the case was wrong, unclear, or missing something |
| Docs | the documentation is wrong or missing |
| Ops | environment or test data, not the app itself |

Tick as many as apply, or none — an untagged comment is context, kept with
the run and addressed to nobody. This replaced a free-text box, a note with a
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

Before finishing a run you can also leave a **comment on the run as a whole** —
"ran against an old build", "felt slow throughout". It lands in `report.md`
above the steps, and it counts as feedback signal on its own, so a run that
passed while worrying the tester still produces a `feedback.md` for
the **check** skill to read.

### Asking the agent mid-run

When an agent session is watching your data folder (`/loop 1m /enloop:serve`
in Claude Code — [the serve contract](skills.md#serving-the-panel-live)),
two more things work during a run, without leaving the panel:

- **Ask the agent.** Select the confusing part of a step, press *Ask the
  agent*, and type the question — "how do I check this specifically?". By
  default the question carries a **screenshot** of the page you are on and a
  **page snapshot** (its structure, stripped of scripts and styles), both
  saved into the folder's `agent/` directory and nowhere else; untick either
  before sending. The answer appears under the step. If the step text itself
  was the problem, the agent lands a patched version and the panel offers
  **Load v‹n›** — it verifies first that every step you already executed is
  unchanged, and loading keeps every recorded status.
- **Run a case's commands.** Inline commands in Dependencies, Prerequisites
  and step text (`node scripts/seed.js …`) get a ▶ **Run** button. The
  watching session executes them from the app repo, output streams into a
  card in the panel, and **Stop** kills the process. Scripts die on their
  own timeout, or a few minutes after the panel closes — closing the panel
  is how you turn off a server you started from it.

No session watching? Questions and Run requests wait, and the panel says so
— nothing is lost, and nothing leaves your machine either way.

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
