# The skills

The loop is **write → run → check**: author a case from the app's source,
execute it in the side panel, then bring the result back to the repo and
decide what it means. The same four skills do this in Claude Code and in
Codex — one `SKILL.md` each, written to the [Agent Skills][skills-std]
standard, which both agents read.

To install and invoke them:
**[Claude Code](claude-code.md)** · **[Codex](codex.md)**

[skills-std]: https://developers.openai.com/codex/skills

| Skill | Run it from | Writes | Claude Code | Codex |
| --- | --- | --- | --- | --- |
| setup | the app repo, once | project name + selector convention into the repo's agent instructions | `/enloop:setup` | `$setup` |
| quick | the app repo | a happy-path case into your data folder | `/enloop:quick` | `$quick` |
| full | the app repo | the complete case, extending a quick one in place | `/enloop:full` | `$full` |
| check | the app repo | fixes, and a verdict per failure | `/enloop:check` | `$check` |
| instrument | the app repo | `data-testid` attributes | `/enloop:instrument` | `$instrument` |

There is a fifth, `enloop-demo`, which lives in this repo's `.claude/skills/`
and produces demo cases exercising the grammar itself. It is intentionally
**not** distributable and ships in neither plugin: it needs this repo's parser,
its TypeScript build, and the extension build to verify what it produces.
Copying it into another project gives you a skill whose every path is wrong.

## What the skills need to know

Two values, both optional, wherever your agent reads environment from — see
the per-agent pages above for where that is. Installing the plugin installs
everything the skills *run*: the grammar and the parser ship inside it, so
there is nothing to clone and no path to Enloop to configure. What is left is
where your cases go and what your app is called.

- **`ENLOOP_DATA_DIR`** — the folder *this repo* writes to. It contains
  `test-cases/`, `runs/` and `free-runs/`. Optional, and often better left
  unset — see below.
- **`ENLOOP_PROJECT`** — the product name that prefixes case titles. The setup
  skill records it once so nothing has to ask again.

### Which folder, when you have several

One agent config serves every repo you work in, so a data folder set once at
user level is right for one project and wrong for the rest. Since the
extension connects several folders at once, both shapes are legitimate — a
folder per project, and one external folder shared by several — so the skills
resolve **per repo**, in this order:

1. **What you said in the request.** "write it to ~/qa/acme" wins outright,
   which is how one case goes somewhere other than the usual place without
   reconfiguring anything.
2. **`$ENLOOP_DATA_DIR`**, when nothing in the repo contradicts it.
3. **A data folder inside the repo** — `enloop/`, `test-cases/` or `.enloop/`
   at the root. Nothing to configure, cases are committed with the code they
   test, and it arrives with a clone. Prefer this when it fits.
4. **Otherwise they ask**, naming the candidates and how many cases each
   already holds, and offer to remember the answer for this repo —
   machine-locally, so a path never lands in a teammate's checkout.

If the repo has its own folder *and* the environment names a different one,
that is treated as a real question rather than an error: the skills say what
they found and ask which you meant.

Cases go **inside** `test-cases/`, not at the top of the data folder — a case
written one level off doesn't error, it just never appears in the Library.

Because that's easy to get wrong, the skills don't take the path on faith:
they detect which level you actually named, correct it if you pointed at the
`test-cases` subfolder, and verify after writing that the file landed where
`FsaDataStore` reads from. If the path is empty or unrecognisable they stop
and ask rather than creating a stray `test-cases/` somewhere unrelated. The
rules are in
[`references/data-folder.md`](../plugins/enloop/references/data-folder.md),
shared by every skill that touches the folder so they can't drift apart.

`ENLOOP_CASES_DIR` is the former name for `ENLOOP_DATA_DIR` and still works.
With neither set and no folder inside the repo, the skills ask rather than
defaulting: a folder nobody named is a folder nobody connected.

No skill hardcodes a path: the app repo is wherever you invoke it, and
everything about Enloop itself — the grammar, the parser that validates what
the skills write — is inside the installed plugin.

## Setting up a repo

Run this once per app repo, before the first case:

```
/enloop:setup          # Claude Code
$setup                 # Codex
```

It settles two things that every later case depends on.

**The project name.** One connected folder normally holds cases from every
repo you write from, so a case needs to say which app it belongs to.
The **setup** skill agrees a name with you and records it, after which
the authoring skills title cases `<Project>: ...` and set `@project` without
asking again.

**The selector convention**, written into the app repo's agent instructions —
`AGENTS.md`, `CLAUDE.md`, or both, whichever that repo already has. Highlight
is only as good as the handles in the app, and the **instrument** skill
backfilling them is work that decays the moment someone ships a screen without them. The
section it installs — which attribute this repo uses, how values are named,
what to do about list rows, and which elements are unreachable from the side
panel at all — is read into every agent session in that repo, so new UI
arrives instrumented instead of being retrofitted.

It detects the convention already in the repo rather than imposing one, checks
that your production build doesn't strip test attributes (if it does, every
selector you add would resolve in dev and nowhere else), and shows you the
block before touching either file. Re-running it updates that section in place.

It can also write `ENLOOP_DATA_DIR` and `ENLOOP_PROJECT` into the project's
settings for you, which is the same configuration described above — done once,
with the data folder detection already applied.

## Writing a case

Two skills, one procedure. **quick** covers the happy path and skips the
expensive app-map step — the two-minute case a developer wants before pushing
a branch. **full** is the complete article: edge cases, error states and
cleanup, and it *extends an existing quick case in place* rather than starting
a second one, so a feature never ends up with two competing cases.

Both derive every route, label and selector from source and validate with the
real parser before writing. Quick means smaller, not looser.

From inside the repo of the app you're testing:

```
/enloop:quick PROJ-1234   # Claude Code — the two-minute version
/enloop:full PROJ-1234    # Claude Code — the whole article
$quick PROJ-1234          # Codex
$full PROJ-1234           # Codex
```

The argument is the scope — a ticket id, a branch, a feature name, or a
sentence. With a branch checked out it diffs against `main` and covers what
actually changed, including the seams where the change meets existing
behaviour.

It never runs implicitly — `disable-model-invocation` in Claude Code,
`allow_implicit_invocation: false` in Codex — so it only ever runs when you ask.

What it does, in order:

1. Resolves the two roots and reads the case grammar from the copy shipped in
   the plugin (`references/grammar.md`), which is lifted verbatim from the
   comment above the parser at build time. It never works from a remembered
   version of the grammar.
2. Reads the [step contract](../plugins/enloop/references/step-contract.md).
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

## Checking a run

When a run finishes, the extension writes `report.md` (every step, for
sharing) and — only when there was something to act on — `feedback.md`, an
action list built from the failures and the tester's typed notes
(`bug` / `feature` / `docs`). Both land next to `run.json` in
`runs/<case-id>/<run-id>/`.

Back in the app repo:

```
/enloop:check          # Claude Code
$check                 # Codex
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

## Adding selectors to the app

`Selector:` is the field that makes a case fast to execute — the extension
scrolls the element into view and flashes it. It's also the field most often
missing, because the authoring skills refuse to invent one: if the element
has no stable handle in source, the step ships without a selector and the skill says
so.

The **instrument** skill is the fix. From the app repo:

```
/enloop:instrument sync console   # Claude Code
$instrument sync console          # Codex
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

Finally it checks that the app repo's agent instructions carry the convention
the **setup** skill installs, so new UI arrives already instrumented rather
than needing the next backfill — and points you at **setup** if it doesn't.
