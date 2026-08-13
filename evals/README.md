# The eval matrix

Does the authoring loop hold on this model? Every guard in the plugin —
the hook, the `write` gate, the `brief` floor — narrows what a weak model
can break; none of them can say *"quick works on Haiku"*. Only running it
on Haiku says that. This harness runs it, per model, and asserts the result
with the same tools the plugin ships.

## What a run does

For each model: copy [`fixture-app/`](fixture-app/) (a fictional shop with
routes and `data-testid`s in `src/`, plus a pre-seeded `enloop/` data
folder and rules file, so a headless session never has a question to ask)
into a temp git repo, then:

```
claude -p "/enloop:quick the coupon banner" --model <m> --dangerously-skip-permissions
```

Then four deterministic assertions:

1. **Landed** — exactly one case sits where `FsaDataStore` reads
   (`enloop/test-cases/<id>/versions/v1.md`).
2. **Validates** — `enloop-case.mjs validate` exits clean.
3. **Real handles** — every `data-testid` the case names greps in the
   fixture's `src/`. A selector that greps nowhere was recalled, not read;
   this is the invented-specifics check no static guard can make.
4. **Cold run** — the readout parses, so the case meets the cold-runner
   bar's reporting.

One row per model; nonzero exit if any row failed. A failing row is the
matrix working: it is the fact you ran this to learn.

## Running it

```bash
node evals/run.mjs                          # default: haiku,sonnet
node evals/run.mjs --models haiku,sonnet,opus
node evals/run.mjs --keep                   # keep temp workspaces to read
```

Prerequisites: the `claude` CLI on PATH, logged in, with the **enloop
plugin enabled in the active config** (`CLAUDE_CONFIG_DIR` is inherited, so
point it at a config that has the plugin if your default does not). Each
row costs one real headless session on that model. Failed rows keep their
temp workspace and print the session's last lines.

This is a **local harness, not CI** — it needs credentials and a plugin
install that do not belong in a public repo's actions.

## When to run it

Before tagging a plugin release, and when a new model ships. The matrix is
the answer to "will the skills work on any model": not a promise, a
measurement.
