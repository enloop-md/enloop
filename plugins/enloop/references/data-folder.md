# Resolving the Enloop data folder

<!-- Shared by the write and check skills. One source of truth: both must
     resolve the folder identically or cases land where the extension
     cannot see them. -->

The single most common way an authored case is silently lost: writing it
one directory level off, where the extension never looks.

## The layout is fixed

The **data folder** is the directory the user picked with "Connect
folder…" in the extension. The extension creates and owns this layout
inside it:

```
<data folder>/
├── test-cases/     one directory per case: <caseId>/meta.json + versions/v<n>.md
├── runs/           <caseId>/<runId>/{case.md, run.json, report.md, feedback.md}
└── free-runs/      <freeRunId>/{free-run.json, notes.md, feedback.md}
```

Cases go in `<data folder>/test-cases/<caseId>/`, **never** directly in
the data folder. This is not a convention you can vary — `FsaDataStore`
reads exactly these paths, so a case one level off does not exist as far
as the extension is concerned.

The trap: a data folder is often itself *named* `test-cases`, which yields
a correct-but-confusing `.../test-cases/test-cases/<caseId>/`. That
doubled segment is right. Do not "fix" it.

## Which folder, before which level

There are two questions here and they are easy to run together. **Which
folder** does this repo's cases belong in, and **which level** of it did the
path name. Get the first wrong and the case lands, intact and correct, in
another project's Library.

That first question got harder the moment the extension learned to connect
several folders at once. A single agent config serves every repo you work
in, so a `ENLOOP_DATA_DIR` set once at user level names one folder and is
wrong for every project that does not share it. Meanwhile both shapes are
legitimate: a folder per project, committed inside the repo it tests, and one
external folder shared by several projects.

So resolve **per repo**, in this order, and stop at the first that answers:

1. **What the user said in this request.** "write it to ~/qa/acme" settles
   it. So does "ask me where" — see *Asking well* below.
2. **`$ENLOOP_DATA_DIR`**, when it is set *and* nothing in this repo
   contradicts it (branch 3). An explicit variable is an explicit answer.
   `ENLOOP_CASES_DIR` is its former name and is still honoured.
3. **A data folder inside this repo.** Check `enloop/`, `test-cases/` and
   `.enloop/` at the repo root for the layout signature below. This is the
   shape to prefer when it exists: cases are committed with the code they
   test, they arrive with a clone, and nothing has to be configured per
   machine.
4. **Ask.** Do not fall back to a default that happens to exist.

```bash
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
for d in "$root/enloop" "$root/test-cases" "$root/.enloop"; do
  [ -d "$d/test-cases" ] || [ -d "$d/runs" ] && echo "IN_REPO=$d"
done
echo "ENV=${ENLOOP_DATA_DIR:-${ENLOOP_CASES_DIR:-unset}}"
```

If step 3 finds an in-repo folder **and** the environment names a different
one, that is a genuine conflict rather than an error: the user may have a
per-project folder and a shared one and mean either. Say what you found and
ask which, naming both paths. Never silently prefer one.

## Asking well

When you ask, ask once and make the answer cheap:

- **Offer the candidates you found**, each with its absolute path and how
  many cases it already holds (`ls <path>/test-cases | wc -l`) — a folder
  with 40 cases in it is recognisable in a way a path is not.
- **Offer to create an in-repo folder** when the repo has none:
  `<repo>/enloop/`, which the extension can connect as a storage of its own
  and which keeps cases with the code. Say that the extension writes a
  `.gitignore` there so runs stay local.
- **Offer to remember the answer**, so this is asked once per repo and not
  once per case:
  - *Claude Code* — `.claude/settings.local.json` in this repo, which is
    machine-local and git-ignored, so a per-project path never lands in a
    teammate's checkout:
    ```json
    { "env": { "ENLOOP_DATA_DIR": "/abs/path/to/the/folder" } }
    ```
  - *Codex* — there is no per-repo settings file. Offer a `.envrc` line if
    the repo uses direnv, otherwise show the `export` line for them to put
    wherever they keep per-project environment. Do not write to a shell
    profile uninvited.
- **A per-case override is always available.** Someone who keeps one folder
  per project but wants *this* case in a shared one says so in the request,
  and step 1 honours it without disturbing what is recorded.

State the folder you resolved and how you got there, in one line, before you
write anything. It is the cheapest possible correction point.

## Then resolve the level, by detection

Once you have a folder, never assume which level the path names — detect it:

```bash
d="${ENLOOP_DATA_DIR:-${ENLOOP_CASES_DIR:-$ENLOOP_HOME/private/test-cases}}"
d="${d%/}"

if [ -d "$d/test-cases" ] || [ -d "$d/runs" ] || [ -d "$d/free-runs" ]; then
  echo "DATA_DIR=$d"                        # already the data folder
elif [ -d "$d/../runs" ] || [ -d "$d/../free-runs" ]; then
  echo "DATA_DIR=$(dirname "$d") DEEP"      # pointed one level too deep
elif ls -d "$d"/*/versions >/dev/null 2>&1; then
  echo "DATA_DIR=$(dirname "$d") DEEP"      # ...and nothing has been run yet
elif [ -z "$(ls -A "$d" 2>/dev/null)" ]; then
  echo "DATA_DIR=$d EMPTY"                  # nothing to detect — see below
else
  echo "DATA_DIR=$d UNRECOGNISED"
fi
```

The third branch matters on a fresh setup: with cases written but nothing
yet run, there is no `runs/` sibling to detect, so the giveaway is instead
that the directory contains `<caseId>/versions/` children — meaning it *is*
the `test-cases` folder, not the data folder above it.

Read the result:

- **`DATA_DIR=<path>`** with no suffix — use it. Cases go to
  `<path>/test-cases/<caseId>/`.
- **`DEEP`** — the user pointed at the `test-cases` subfolder rather than
  the connected folder. The value printed is already corrected to the
  parent, so use it as-is; but tell them, so they fix their setting once
  instead of hitting this in every project.
- **`EMPTY`** — an empty directory is genuinely ambiguous: it could be the
  folder they just connected, or a typo. Do not guess. Ask whether this is
  the folder they connected in the extension; if it is, create
  `test-cases/` inside it and say that you did.
- **`UNRECOGNISED`** — a non-empty directory with none of these signatures
  is probably the wrong path entirely. Stop and ask. Do not create the
  layout inside an unrelated directory; that is how a source repo acquires
  a stray `test-cases/`.

If nothing resolved, you are at step 4 above: ask, using *Asking well*.
Never write into `$ENLOOP_HOME/private/test-cases` as a silent fallback —
that is this repo's own scratch folder, and a case that lands there is a
case in nobody's Library.

## Verify after writing — always

Writing to the wrong level fails silently: no error, and the case simply
never appears in the Library. One command closes that loop:

```bash
ls -d "$DATA_DIR"/test-cases/<caseId>/versions/v*.md
```

It must list the file you just wrote. Then confirm the case sits **beside**
its siblings, not above them:

```bash
ls "$DATA_DIR"
```

That must show `test-cases` (and usually `runs`/`free-runs`) — not the
case id itself. **If you see the case id in that listing, you wrote it one
level too high**: move it into `test-cases/` and say so in your report.

State the full absolute path of what you wrote in your report. It is the
one line that lets the user spot a misplaced case immediately, rather than
discovering it as an empty Library.
