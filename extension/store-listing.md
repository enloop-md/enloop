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

## Permission justifications

The store asks why each permission is needed. Answers, matching what the code
actually does:

| Permission | Why |
| --- | --- |
| `sidePanel` | The whole product is a side panel. |
| `scripting` | Highlighting an element, inserting a value and running an automated step all execute in the page under test. |
| `tabs` | A run acts on one tab: the `Where:` control navigates it, and highlights target it. |
| `storage` | Remembers which screen the panel was on, so closing it mid-run does not lose the run. |
| `<all_urls>` (optional) | Requested per origin, only when a step first needs to act on that site — never at install time. |
