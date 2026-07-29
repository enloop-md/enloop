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

## Resolve it by detection, not by assumption

`ENLOOP_DATA_DIR` is the variable. `ENLOOP_CASES_DIR` is its former name
and is still honoured. Never assume which level a user pointed either at —
detect it:

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

If neither variable is set and the default does not exist, ask for the
path and tell the user to set it once:

```json
{ "env": { "ENLOOP_DATA_DIR": "/path/to/the/folder/you/connected" } }
```

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
