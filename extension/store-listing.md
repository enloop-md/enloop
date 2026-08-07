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

- Cases are plain Markdown in a folder you pick. No server, no account,
  nothing uploaded. They are diffable files you can commit next to the code
  they test.
- Run a case step by step: open the screen it names, flash the element it
  points at, type the values it quotes, and let scripted steps decide their
  own result.
- Mark what you find as a bug, a feature request or a docs gap. The run
  writes a report and a feedback file addressed to whatever built the
  feature.
- Share a case as a link, a self-contained HTML page, or Markdown — with or
  without the machinery a manual tester does not need.

Open source, MIT licensed: https://github.com/enloop-md/enloop
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
