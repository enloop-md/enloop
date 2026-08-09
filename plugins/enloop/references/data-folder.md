# Resolving the Enloop data folder

<!-- Shared by the write and check skills. The resolution itself is
     `enloop-case.mjs data-folder`, not prose here: it is an algorithm, it ran
     identically every time, and every line of it was re-read into context on
     every authoring session. What is left here is the part that is a
     judgement — what to do when the answer is ambiguous or absent. -->

The single most common way an authored case is silently lost: writing it one
directory level off, where the extension never looks.

## The layout is fixed

The **data folder** is the directory the user picked with "Connect folder…" in
the extension. It owns this layout:

```
<data folder>/
├── test-cases/     one directory per case: <caseId>/meta.json + versions/v<n>.md
├── runs/           <caseId>/<runId>/{case.md, run.json, report.md, feedback.md}
└── free-runs/      <freeRunId>/{free-run.json, notes.md, feedback.md}
```

Cases go in `<data folder>/test-cases/<caseId>/`, **never** directly in the
data folder — `FsaDataStore` reads exactly these paths. A data folder is often
itself *named* `test-cases`, which yields a correct-but-confusing
`.../test-cases/test-cases/<caseId>/`. That doubled segment is right. Do not
"fix" it.

## Ask the plugin which folder

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" data-folder
```

It resolves per repo — what the user named in this request (`--want <path>`),
then `$ENLOOP_DATA_DIR`, then a folder inside this repo — detects which level
of the layout the path names, and prints one of three verdicts:

- **`RESOLVED <path>`** (exit 0) — use it. The `write` line it prints is where
  the case goes. A `path pointed one level too deep` note means the setting
  names the `test-cases` subfolder rather than the connected folder; the value
  is already corrected, but tell the user so they fix it once instead of
  hitting it in every project.
- **`AMBIGUOUS`** (exit 1) — an in-repo folder and an environment variable name
  different places. That is a genuine conflict, not an error: the user may have
  a per-project folder and a shared one and mean either. Ask, naming both and
  what each holds.
- **`NONE`** (exit 1) — nothing answers. Ask. Never fall back to a default that
  happens to exist: a folder nobody named is a folder nobody connected, and a
  case that lands there is a case in nobody's Library.

State the folder you resolved and how you got there, in one line, before you
write anything. It is the cheapest possible correction point.

## Asking well

When you ask, ask once and make the answer cheap:

- **Offer the candidates the command found**, each with its absolute path and
  how many cases it already holds — a folder with 40 cases in it is
  recognisable in a way a path is not.
- **Offer to create an in-repo folder** when the repo has none: `<repo>/enloop/`,
  which the extension can connect as a storage of its own and which keeps cases
  with the code. Say that the extension writes a `.gitignore` there so runs stay
  local.
- **Offer to remember the answer**, so this is asked once per repo rather than
  once per case:
  - *Claude Code* — `.claude/settings.local.json` in this repo, which is
    machine-local and git-ignored, so a per-project path never lands in a
    teammate's checkout:
    ```json
    { "env": { "ENLOOP_DATA_DIR": "/abs/path/to/the/folder" } }
    ```
  - *Codex* — there is no per-repo settings file. Offer a `.envrc` line if the
    repo uses direnv, otherwise show the `export` line for them to put wherever
    they keep per-project environment. Do not write to a shell profile
    uninvited.
- **A per-case override is always available.** Someone who keeps one folder per
  project but wants *this* case in a shared one says so in the request, and
  `--want` honours it without disturbing what is recorded.

## Verify after writing — always

Writing to the wrong level fails silently: no error, and the case simply never
appears in the Library.

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" verify "$DATA_DIR" "<caseId>"
```

`OK` lists the version files you just wrote. `WRONG LEVEL` means the case landed
directly in the data folder instead of inside `test-cases/` — move it and say so
in your report. `MISSING` prints what the folder does hold, which is usually
enough to see where it went.

State the full absolute path of what you wrote in your report either way. It is
the one line that lets the user spot a misplaced case immediately, rather than
discovering it as an empty Library.
