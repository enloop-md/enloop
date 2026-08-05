# Enloop

A Chrome side-panel extension for running manual and automated test cases,
plus the Claude Code skills that write those cases for you.

Open source under the [MIT license](LICENSE) — the extension, the case
parser, and the skills are all in this repo.

Cases are plain Markdown in a folder you pick. The extension reads and writes
that folder directly through the File System Access API — no server, no
database, no account. Your cases are diffable files you can commit wherever
you like.

- **The extension** runs cases: step-by-step, marking pass/fail, executing
  automated steps in the page, capturing notes, and writing a run report.
- **[The viewer](#the-viewer)** shares them: send anyone a link and they read
  the case in a browser — steps to tick off, values to copy, variables to fill
  in — with no install and no account. The case rides inside the link, so
  there is still nothing uploaded anywhere.
- **The skills** close the loop: `/enloop:setup` prepares an app repo once,
  `/enloop:write` writes a case for a real feature or ticket from inside the
  app repo being tested, and `/enloop:check` triages the finished run back in
  that same repo — deciding per failure whether the app is wrong or the case
  is. `/enloop-demo` produces demo cases that exercise the case grammar
  itself.

---

## Part 1 — The extension

### Install

Enloop is not in the Chrome Web Store. Both paths below install it as an
**unpacked extension**, which Chrome allows on any profile with Developer mode
switched on.

**A. From a release — no build tools needed.**

1. Download `enloop-<version>.zip` from the
   [latest release](https://github.com/enloop-me/enloop/releases/latest).
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
└── free-runs/           unscripted sessions
```

A freshly connected folder is empty, and the Library offers to **load an
example case** into it. It runs against a public practice site and exercises
every control the panel has — Go, Highlight, values that type themselves into
fields, an automated step, and the quick/full split — so the first thing you
do is watch a run work rather than author one blind. It is an ordinary case
file; delete it when it has served its purpose.

After a rebuild, hit **reload** on `chrome://extensions` and reopen the side
panel — a build alone does not refresh an already-loaded extension.

### Storage: the connected folder

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

### Site access

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

### The case format

A case is one Markdown file. The full grammar is the doc comment at the top of
[`shared/src/markdown.ts`](shared/src/markdown.ts) — that comment is the spec,
and it is the thing to read when writing cases by hand.

```markdown
# Careerminds: Sync a contact from the CRM to the mailer
@version 0.0.3
@author Your Name
@project Careerminds
Tags: sync-console, integrations, manual

Verifies the single-contact sync path added in PROJ-1234.

# Variables

## TEST_CONTACT_EMAIL
Email of a contact present in both the CRM and the mailer.
Default: qa.bot@example.com

# Prerequisites
- Logged in to the admin as a super-admin

# Steps

## Open the sync console
Where: /admin/sync-console
Selector: #account-tabs
Navigate to the page.

### Expected
- The account picker renders as tabs.
- Each tab shows the account name with its sync purpose beneath it.

## Sync the contact
Where: /admin/sync-console
Selector: [data-testid="sync-crm-mailer"]
Selector: #sync-crm-mailer-btn
Click `Sync CRM → Mailer`.

### Expected
- A spinner appears on that button only.
- A toast reports synced / skipped / failed counts.

### Note
Regression check — this button used to stay disabled when the local column
had no match, even though the sync creates the record.
```

Key fields: `Where:` (the route or screen the tester starts from), `Selector:`
(the extension scrolls it into view and flashes it), `### Expected` (pass
criteria only), `### Note` (background, rendered dimmed). A fenced code block
in place of instructions makes the step **automated** — the script runs in the
page's own world with DOM access and calls `api.fail(msg)` to fail the step.

Selectors named in a step's *prose* are clickable too: inline code that can
only be a selector (`#sync-btn`, `[data-testid="row"]`, `.modal .btn`) renders
as a Highlight control, as does a link written `[the Sync button](#sync-btn)`.
Nothing declares this and no existing case needs changing — it is recognised
from the text, and deliberately strict, so visible UI labels in backticks
(`` `Save changes` ``), ticket refs (`#1234`), routes and filenames stay plain.

`Selector:` may be repeated. The candidates are tried **in order** and the
first one that matches the page wins, so a step can name an exact handle and
fall back to a looser one when the element sits in a modal or its `data-testid`
has not been deployed yet. The run screen shows which candidate matched. A
single line is always one selector even when it contains commas — `.a, .b` is a
CSS group, and the browser returns whichever comes first in the document, not
the one written first.

A `Where:` that names a route, an absolute URL, or a local address gets a **Go**
control in the run screen that navigates the tab the run is using — the same tab
Highlight and automated steps act on, so opening the page leaves you where the
next step expects. A bare route resolves against whatever page is open and
refuses rather than guesses when there is nothing to resolve against; write
`Where: %BASE_URL%/admin/sync` when a case has to be certain.

Every literal a tester must type is written in **double quotes** —
`Put "Buy milk" in the task field`. The side panel turns each quoted value into
a control: click it and the next input, textarea or **select** you click on the
page receives the value, with the events a React- or Vue-controlled field needs
to register the change. A select is matched by its visible option text, since
that is what an author quotes. There's a copy fallback for anywhere the
extension can't reach.

The two marks are not interchangeable: backticks mean *find this* (a visible
label, or a selector — which gets a Highlight control), double quotes mean
*type this*. ``Set `Priority` to "High"`` reads correctly in both directions.

`Kind: quick` on a step marks it as part of the core path. A case is authored
**once, in full**; starting a run then offers **Quick** (only the marked steps)
or **Full** (all of them), so a developer checking their own branch gets a
two-minute run without anyone writing a second case. Suite prep steps always
run. The tier is recorded on the run and shown in the report, the run header and
run history — a quick pass and a full pass are not the same evidence.

Before finishing a run you can leave a **comment on the run as a whole** —
"ran against an old build", "felt slow throughout". It lands in `report.md`
above the steps, and it counts as feedback signal on its own, so a run that
passed while worrying the tester still produces a `feedback.md` for
`/enloop:check` to read.

A side panel closes whenever you click into the page you are testing, which
during a run is constantly, and closing it destroys the panel. Reopening
returns to the screen you were on — including mid-run — and after a browser
restart, when that memory is deliberately dropped, the Library carries a
**Resume** banner for a run still in progress. Nothing is ever only in the
panel: every mark, note and comment is written to the run's folder as it
happens.

`# Prerequisites` is where services the tester must start themselves belong,
with the command for each. The run screen renders Prerequisites and
Dependencies together in a **"Before you start"** block, collapsed by default —
most runs happen against an environment that is already up, so it stays out of
the way of the current step without being absent, which is what it was before.

`@project` names the app under test. One connected folder usually holds cases
from several repos, so the skills also prefix the title with it — that is what
makes a case findable in the side panel, which lists cases **most recently
updated first**.

Variables declared under `# Variables` resolve when a run starts — from their
generator, or their default — and every `%NAME%` placeholder in the document is
substituted with the result: title, instructions, selectors, and scripts
included. The case screen shows the resolved values under **Start run** and
lets you override any of them first, but it never stops the run to ask. A
variable that ends up with no value is left alone, so the step reads `%NAME%`
rather than a blank where a value should have been.

**Suites** are folders with a `suite.md` holding shared setup; each case inside
inherits the suite's prep steps (prefixed `Prep:`), variables, dependencies, and
prerequisites when a run starts.

A case screen can also hand the case to someone who will never open the
extension — **Share v*N*** at the bottom, with four downloads and a link.

The **full/simplified** axis is how much of the machinery the recipient sees.
Full is the case as authored, selectors and scripts included. **Simplified**
rewrites it for a person carrying it out by hand: automated steps are dropped
(and listed by title at the end, so the coverage is not silently missing),
`Selector:` and `Kind:` lines go, and `%VAR%` placeholders with a literal
default are filled in.

The **Markdown/HTML** axis is who they are. Markdown is the file — for a repo,
a PR, another Enloop folder, or Claude Code. HTML is [a page](#the-viewer): one
self-contained file, opened by double-clicking it, with the steps tickable and
the values copyable. Everything except the raw Markdown carries a suite's prep
steps along with the case, since a reader handed the case alone would be
missing the setup it assumes.

### The viewer

<https://enloop-me.github.io/enloop/>

The same page, online, for people who should not have to install anything: send
a link and they read the case in a browser, tick steps off as they go, copy the
values into their own app, and fill in the variables — every `%NAME%` in the
document updates as they type.

**The case travels inside the link.** There is no server, no account and no
upload: the case is base64url-encoded into `?c=`, and the page decodes and
parses it on the reader's own device. The viewer also accepts the same payload
as `#c=`, which is never sent to a host at all — worth using when a case names
internal URLs. Either way, the page you send is the page they get, forever;
nothing can be taken down or expire.

**Copy link** on the case screen puts that link on your clipboard. Every case
file the extension writes also ends with a comment carrying its own link:

```markdown
<!-- enloop:viewer
Read this case in a browser — tick off steps, copy the values, fill in the
variables. The link below carries the case itself; nothing is uploaded.

https://enloop-me.github.io/enloop/?c=IyBTaWduIGluIHdpdGgg…
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

## Part 2 — The skills

The loop is **write → run → check**: author a case from the app's source,
execute it in the side panel, then bring the result back to the repo and
decide what it means.

| Skill | Lives | Run it from | Writes |
| --- | --- | --- | --- |
| `/enloop:setup` | `enloop` plugin (installable anywhere) | the app repo you are testing, once | the project name and the test-selector convention into that repo's `CLAUDE.md` |
| `/enloop:write` | same plugin | the app repo you are testing | a real case into your cases folder |
| `/enloop:check` | same plugin | the app repo you are testing | a triage report, and a fixed case version when the case was at fault |
| `/enloop:instrument` | same plugin | the app repo you are testing | `data-testid` attributes in the app's source, so Highlight can find elements |
| `/enloop-demo` | this repo's `.claude/skills/` | this repo only | a demo case exercising the grammar |

`/enloop-demo` is intentionally **not** distributable: it needs this
repo's parser, its TypeScript build, and the extension build to verify what it
produces. Copying it into another project gives you a skill whose every path is
wrong. Don't.

### Installing the plugin

Both `/enloop:write` and `/enloop:check` ship in the same plugin. Pick one
of three install paths, depending on what you're doing.

**A. Try it, or use it solo across your own projects.** Add this repo as a
marketplace and install:

```
/plugin marketplace add enloop-me/enloop
/plugin install enloop@enloop
```

Update later with `/plugin update enloop`. Works in every project; nothing
to commit anywhere.

**B. Give it to your team.** Same two commands, run by each teammate. If the
repo is private, they need read access — marketplaces work fine from private
repositories. To make a project install it automatically for everyone who opens
it, declare the marketplace in that project's `.claude/settings.json` rather
than asking people to run commands.

**C. Develop it.** Symlink the plugin folder into your skills directory so
edits are live and versioned in one place:

```bash
ln -s "$PWD/plugins/enloop" ~/.claude/skills/enloop
```

It loads next session as `enloop@skills-dir`; `/reload-plugins` picks it up
immediately. This is the setup to use if you intend to change the skill or the
step contract. (If you've relocated `CLAUDE_CONFIG_DIR`, use that path instead
of `~/.claude`.)

### Configuring it

The skills need to know where this repo lives, since they run from *other*
repos and read the grammar and the run data from here. Set it once in your
user `settings.json`:

```json
{
  "env": {
    "ENLOOP_HOME": "/path/to/enloop"
  }
}
```

Then point the skills at your **data folder** — the directory you picked with
"Connect folder…" in the extension:

```json
{
  "env": {
    "ENLOOP_HOME": "/path/to/enloop",
    "ENLOOP_DATA_DIR": "/path/to/the/folder/you/connected"
  }
}
```

This is the folder the extension owns, containing `test-cases/`, `runs/` and
`free-runs/`. Cases go **inside** `test-cases/`, not at the top of the data
folder — a case written one level off doesn't error, it just never appears in
the Library.

Because that's easy to get wrong, the skills don't take the path on faith:
they detect which level you actually named, correct it if you pointed at the
`test-cases` subfolder, and verify after writing that the file landed where
`FsaDataStore` reads from. If the path is empty or unrecognisable they stop
and ask rather than creating a stray `test-cases/` somewhere unrelated. The
rules are in
[`references/data-folder.md`](plugins/enloop/references/data-folder.md), shared
by both skills so they can't drift apart.

If you keep a **separate data folder per project**, set `ENLOOP_DATA_DIR` in
that project's `.claude/settings.json` rather than your user one — the
project value wins, so each repo writes to its own folder and you're never
relying on remembering which one is current. Keep `ENLOOP_HOME` in the user
settings; it's the same everywhere.

`ENLOOP_CASES_DIR` is the former name for this setting and still works.
Unset, it defaults to `$ENLOOP_HOME/private/test-cases` — this repo's
git-ignored scratch folder, which is rarely what you want for real cases.

Neither skill hardcodes a path: the app repo is `${CLAUDE_PROJECT_DIR}`, and
everything about Enloop comes from `$ENLOOP_HOME`.

### Setting up a repo

Run this once per app repo, before the first case:

```
/enloop:setup
```

It settles two things that every later case depends on.

**The project name.** One connected folder normally holds cases from every
repo you write from, so a case needs to say which app it belongs to.
`/enloop:setup` agrees a name with you and records it, after which
`/enloop:write` titles cases `<Project>: ...` and sets `@project` without
asking again.

**The selector convention**, written into the app repo's `CLAUDE.md`. Highlight
is only as good as the handles in the app, and `/enloop:instrument` backfilling
them is work that decays the moment someone ships a screen without them. The
section it installs — which attribute this repo uses, how values are named,
what to do about list rows, and which elements are unreachable from the side
panel at all — is read into every Claude Code session in that repo, so new UI
arrives instrumented instead of being retrofitted.

It detects the convention already in the repo rather than imposing one, checks
that your production build doesn't strip test attributes (if it does, every
selector you add would resolve in dev and nowhere else), and shows you the
block before touching `CLAUDE.md`. Re-running it updates that section in place.

It can also write `ENLOOP_HOME`, `ENLOOP_DATA_DIR` and `ENLOOP_PROJECT` into
the project's settings for you, which is the same configuration described
above — done once, with the data folder detection already applied.

### Writing a case

From inside the repo of the app you're testing:

```
/enloop:write PROJ-1234
```

The argument is the scope — a ticket id, a branch, a feature name, or a
sentence. With a branch checked out it diffs against `main` and covers what
actually changed, including the seams where the change meets existing
behaviour.

It is `disable-model-invocation: true`, so it only ever runs when you ask.

What it does, in order:

1. Resolves the two roots and reads the case grammar fresh from
   `$ENLOOP_HOME/shared/src/markdown.ts`. It never works from a remembered
   version of the grammar and never carries a vendored copy.
2. Reads the [step contract](plugins/enloop/skills/write/references/step-contract.md).
3. Works out the scope from the diff and states it back to you in one line, so
   a wrong reading costs seconds instead of a whole case.
4. Builds or refreshes an **app map** at `.claude/test-map.md` in the app repo
   — routes, screens, and the selectors for key elements, each with the file it
   came from. This is the expensive part, and it's cached. Commit it; teammates
   and later runs get it free.
5. Writes the case, deriving **every** route, label, and selector from source
   read during that session.
6. Validates by parsing the result with the real parser and checking it against
   the contract's reject list.
7. Writes `<id>/meta.json` and `<id>/versions/v1.md` into `test-cases/` in
   your data folder, then verifies the file landed where the extension reads
   from and reports the absolute path.

Then open the extension, find the case in the Library, and run it.

### Checking a run

When a run finishes, the extension writes `report.md` (every step, for
sharing) and — only when there was something to act on — `feedback.md`, an
action list built from the failures and the tester's typed notes
(`bug` / `feature` / `docs`). Both land next to `run.json` in
`runs/<case-id>/<run-id>/`.

Back in the app repo:

```
/enloop:check
```

With no argument it takes the most recent finished run and tells you which
one it picked. Pass a run id, case id, or case title to pick a different
one.

It reads the run, then makes one judgement per finding — the judgement the
tester can't make and the report can't contain:

| Verdict | What it means | Evidence it must give |
| --- | --- | --- |
| App bug | Behaviour contradicts the app's own source | `file.ext:123` and the mechanism |
| Case defect | The step was stale, wrong, or unanswerable | the grep showing the selector or route is gone |
| Environment | Wrong build, missing fixture, bad integration state | what must be true for a rerun to mean anything |
| Not reproducible | Couldn't be located in source from here | what it would take to reproduce |

It also sweeps every `Where:` and `Selector:` in the case — including on
steps that passed, and including fallback selectors a passing run never
reached — against current source, because a selector that changed under a
passing step is next run's mystery failure.

Then it acts on what it owns. **Case defects it fixes itself**, writing
`versions/v<n+1>.md` with a `Change note:` and re-checking the edited steps
against the step contract; previous versions are never edited in place.
**App bugs it reports and stops** — file, line, and the fix it would make —
because you may want a ticket or a different fix rather than an edit
appearing under you. Say go and it implements it.

Nothing is rerun, and it won't claim otherwise: a fixed case and a patched
bug both need another pass through the extension.

### Adding selectors to the app

`Selector:` is the field that makes a case fast to execute — the extension
scrolls the element into view and flashes it. It's also the field most often
missing, because `/enloop:write` refuses to invent one: if the element has no
stable handle in source, the step ships without a selector and the skill says
so.

`/enloop:instrument` is the fix. From the app repo:

```
/enloop:instrument sync console
```

It takes a screen, component path, feature, case id, or nothing (meaning
whatever the last write/check flagged), and adds test handles to the app's
source. Attribute-only changes — no reformatting, no restructuring — so the
diff is reviewable and merges as its own commit.

What it does that a hand-rolled "add data-testid everywhere" pass doesn't:

- **Follows your existing convention** instead of introducing a second one.
  It counts what's already in the repo (`data-testid` vs `data-test` vs
  `data-cy`) and matches both the attribute and the naming shape.
- **Checks the attribute survives the production build first.** Toolchains
  like `babel-plugin-react-remove-properties` strip test attributes from
  prod bundles. If your testers hit a production build, every selector you
  add would resolve in dev and nowhere else. It stops rather than proceed.
- **Handles lists properly.** Highlight uses `document.querySelector`, so a
  testid repeated across rows always flashes row one. Lists get a container
  handle, a shared row handle, and a `data-<entity>-id` for addressing a
  specific row by variable.
- **Names for role, not visible text.** A testid derived from a button's
  label breaks on a copy change or translation — exactly the coupling a
  testid exists to avoid.
- **Is idempotent.** Elements with a usable `id`, `name`, or stable
  `aria-label` are left alone. A second run produces an empty diff.

It also flags what no attribute can fix, which is worth knowing before you
write a case against a screen: Highlight runs `document.querySelector` in
the **top frame only**, so content inside an `<iframe>` or behind a shadow
root is unreachable no matter what you tag it with.

Finally it checks that the app repo's `CLAUDE.md` carries the convention
`/enloop:setup` installs, so new UI arrives already instrumented rather than
needing the next backfill — and points you at `/enloop:setup` if it doesn't.

### The step contract

The contract is what makes the output executable rather than merely plausible.
It is a real file — [`step-contract.md`](plugins/enloop/skills/write/references/step-contract.md)
— and it is the thing to edit when cases come out wrong.

The rules, in brief:

1. One step is one action with one observable result. If it contains "then",
   split it.
2. Every step states where it starts, via `Where:`.
3. Every UI step carries a `Selector:`, taken from source — never invented,
   never a structural path. Repeat the line for ordered fallbacks when the
   element can genuinely move (a modal, a portal, a handle not yet deployed),
   best first.
4. `### Expected` holds binary, observable pass criteria as bullets. Nothing
   else.
5. Rationale, regression history, and caveats go in `### Note`.
6. Test data is resolved before the run. A variable gets a default, a
   generator, or explicit instructions for obtaining it — never "find a company
   that…" mid-run.
7. No conditionals inside a step. A conditional becomes its own skippable step.
8. Cleanup is explicit. A case that can't be run twice will be run once.

It ends in a reject list the skill checks mechanically before writing
anything. If the generated cases drift, tighten that list rather than
re-explaining the goal in the prompt.

---

## Repository layout

```
extension/          Chrome extension (React + Vite, side panel)
viewer/             the online viewer (static page, GitHub Pages)
shared/             parser, schemas, id/variable helpers — the grammar lives here
plugins/enloop/     the distributable skill plugin
.claude/skills/     enloop-demo (this repo only)
.claude-plugin/     marketplace manifest, so this repo is installable
private/            local connected-folder data (git-ignored)
```

The case *page* — markup, styles and behaviour — lives in
[`shared/src/html.ts`](shared/src/html.ts), not in the viewer. The viewer
renders it from a link and the extension inlines it into a downloadable file,
and the promise of a shared link is that both show the same thing, so there is
deliberately only one of it. The behaviour is serialized into the standalone
file with `Function.prototype.toString`, which is why `attachCasePage` must
stay self-contained — a reference to anything outside its own body throws in
the downloaded file, where the surrounding module does not exist.

Development:

```bash
npm run dev         # extension with HMR
npm run dev:viewer  # viewer on http://localhost:5174
npm run build       # production build to extension/dist
npm run build:viewer
npm run typecheck   # shared + extension + viewer
```

The viewer deploys to GitHub Pages from `master` on any change under `viewer/`
or `shared/` — see [`.github/workflows/pages.yml`](.github/workflows/pages.yml).
It needs **Settings → Pages → Source: GitHub Actions** switched on once in the
repo.

## Contributing

Issues and pull requests are welcome.

Two things to know before opening a PR:

- **The grammar's spec is the doc comment** at the top of
  [`shared/src/markdown.ts`](shared/src/markdown.ts). If you change how a
  document parses, change that comment in the same commit and bump
  `CURRENT_FORMAT_VERSION`. Existing case files must keep parsing.
- **Examples must be generic.** Everything in this repo — README samples, the
  step contract, doc comments — uses a fictional admin app with a CRM and a
  mailer. Don't paste in routes, ticket ids, company names, or bug narratives
  from a real employer or client; those belong in your own cases folder, which
  is git-ignored for exactly this reason.

## License

[MIT](LICENSE) © Sergey Ryabenko
