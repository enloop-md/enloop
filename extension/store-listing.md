# Chrome Web Store listing

The manifest can only carry so much: Chrome caps `name` at 75 characters and
`description` at 132, so `manifest.config.ts` holds the name and the first two
sentences and nothing more. This file is the long form — what goes in the
listing's detailed description, where the limit is 16,000 characters.

Keep the two in step. If the positioning changes, it changes in both places.

## Name

```
Enloop.md - managing human attention in AI loops
```

## Short description (the manifest's `description`, ≤132 characters)

```
The human is the slowest step in any AI feedback cycle. Enloop makes that step ruthlessly effective.
```

## Detailed description

```
Fix the Bottleneck in Human-in-the-Loop.

The human is the slowest step in any AI feedback cycle. Enloop makes that step
ruthlessly effective. By handling the heavy lifting of context and instruction,
it frees you to operate at the speed of thought, turning validation from a
chore into a seamless flow.

Enloop is a side panel that runs manual and automated test cases, and a set of
agent skills — for Claude Code and Codex — that write those cases from your
app's own source.

WHAT THE PANEL DOES

- A test case is one Markdown file in a folder you pick. No server, no
  account, nothing uploaded — diffable files you commit next to the code they
  test.
- Run a case step by step: Go opens the screen a step names, Highlight
  scrolls to the element it points at and flashes it, quoted values type
  themselves into the page, and scripted steps run in the page and decide
  their own result.
- One case, two depths: steps marked as the core path make a two-minute
  Quick run of the same case a Full run covers completely — written once,
  never duplicated.
- Values resolve when the run starts, not when the case was written: a
  BASE_URL follows whichever deployment you have open, can be pinned to a
  domain pattern so a random tab is refused, and falls back to the
  environment the case declares.
- Optionally capture what the page said during the run — console errors and
  failed requests land in the report beside the step where they happened.
- Every run freezes the exact case it executed and writes a readable report,
  plus a feedback file where each comment is addressed to whoever it is
  for: developer, product, test writer, docs, ops.
- Share a case as a link (the case travels inside the URL — still nothing
  uploaded), as a self-contained HTML page anyone can open with no install,
  or as plain Markdown.

WHAT THE SKILLS DO

The same repo ships agent skills for Claude Code and Codex that close the
loop around the panel:

- setup prepares an app repo once: the project name, the base URL cases
  default to, and the test-selector convention, so new UI arrives already
  instrumented.
- quick writes the two-minute happy-path case for the branch you are on;
  full extends it into the complete article — edge cases, error states,
  cleanup. Every route, label and selector is read from your app's source,
  and the case is validated with the real parser before it lands.
- check triages a finished run back in the repo: for every failure it
  decides — app bug (with file and line), defect in the case itself (fixed
  on the spot as a new version), or environment — and promotes standing
  feedback into project rules every future case obeys.
- instrument adds missing test handles to your code, following the
  convention your repo already uses.

Cases written by the skills meet a cold-runner bar: someone who has never
seen the system can click through — every address one click away, every
value prepared, zero questions before the run starts.

Open source, MIT licensed. The extension, the parser, the online viewer and
the skills are one repo: https://github.com/enloop-md/enloop
```

## Privacy practices tab

Everything the store's review form requires, paste-ready, matching what the
code actually does.

**Privacy policy URL** (the listing's privacy-policy field):

```
https://enloop-md.github.io/enloop/privacy.html
```

The canonical text is `PRIVACY.md` at the repository root; the served page
is `viewer/public/privacy.html`. Keep the two in step.

### Single purpose description

```
Enloop runs manual and automated software test cases from local Markdown
files in a browser side panel: it walks a tester through a case step by step
against the web app under test — opening the screen a step names,
highlighting the element it points at, typing the values it quotes — and
records the run's results, reports and feedback as local files in a folder
the user connects. Everything serves this one testing workflow; nothing is
collected or transmitted, and nothing is stored outside that user-chosen
folder and the browser's own extension storage.
```

### Remote code

Answer **"No, I am not using remote code."** All extension code ships in the
package; nothing is fetched from a server and executed. If the form or a
reviewer still demands a justification (the automated-step mechanism can look
like one from the outside):

```
Enloop does not download or execute code from any server. All extension code
ships in the package. The scripts that a test case's automated steps contain
are written by the user, stored in the user's own local files, and executed
only in the page under test when the user runs that step — the
browser-extension equivalent of a user script. Nothing is ever fetched from
the network and executed.
```

### Permission justifications

`sidePanel`:

```
The entire product is the side panel: the test-case library, the
step-by-step run screen and the run reports all render in it, beside the
page under test, so the tester can read a step and act on the page at the
same time.
```

`scripting`:

```
Three run-screen features execute in the page under test, each triggered by
the tester on the current step: Highlight scrolls the element a step names
into view and flashes it; a quoted test value is inserted into the form
field the tester clicks; and a case's automated steps run their script in
the page and report pass or fail. Injection targets only the tab the run is
using, and only on sites the user has granted access to.
```

`tabs`:

```
A run acts on one tab: the Go control navigates that tab to the address a
step names, Highlight and value insertion target it, and the values panel
follows the active tab's URL so page-derived variables (such as the
deployment's base URL) resolve against the page the tester is actually on.
```

`storage`:

```
chrome.storage keeps the panel's own small state — which screen was open and
the capture preferences — so closing the side panel mid-run (which happens
every time the tester clicks into the page under test) does not lose their
place. Test cases and run results live in a local folder the user connects;
no data leaves the machine.
```

Host permissions (`<all_urls>` is optional, requested at use):

```
Site access is optional and requested per origin at the moment a step first
needs to act on that site — never at install time. It is what lets
Highlight, value insertion and automated steps run on the specific web app
the user is testing, and on nothing else.
```

### Data usage certification

Enloop collects no user data: tick **none** of the data categories. The
three disclosure certifications (no sale to third parties, no use unrelated
to the single purpose, no use for creditworthiness) are all true — certify
them, then certify policy compliance.
