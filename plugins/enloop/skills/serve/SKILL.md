---
name: serve
description: Watch the Enloop data folder and serve the extension's live requests. A tester mid-run asks a question from a step ("how do I check this exactly?") — answer it from the app's source, and when the step itself was the problem, land a compatible patch version the panel offers to hot-swap in. A tester clicks Run on a case-authored setup command — execute it in the background, stream output back, and kill everything you started once the panel's heartbeat goes stale. Run it on a loop, "/loop 1m /enloop:serve" — one pass per invocation, a cheap no-op when idle. Not for triaging finished runs; that is /enloop:check.
disable-model-invocation: true
allowed-tools: Read Grep Glob Write Edit Bash(git diff *) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(rg *) Bash(ls *) Bash(cat *) Bash(node *) Bash(mkdir -p *) Bash(printf *) Bash(setsid *) Bash(kill *) Bash(stat *) Bash(tail *) Bash(date *) Bash(bash *) Bash(cd *)
---

# Serve the panel

The extension's side panel cannot spawn a process or answer a question — it
can only write files into the connected data folder. This skill is the other
end of that channel: one pass over `agent/` in the data folder, doing
whatever the panel asked since the last pass. Run it on a loop:

```
/loop 1m /enloop:serve
```

Every pass is stateless and idempotent. All state lives in the files; a pass
that finds nothing to do says so in one line and ends. Never ask the user a
question mid-pass — the tester is in the browser, not the terminal, and the
whole point is that they never have to come here.

The panel is the sole authority on loading a patch into a live run, and the
run history under `runs/` stays read-only for you, as everywhere else. What
you own here is `agent/**` answers and statuses, `test-cases/**` versions
via the validator, and the processes you spawn.

## 1. Resolve where things live

Two roots. Never hardcode either.

- **App repo** — where you are now: the repo root
  (`git rev-parse --show-toplevel`). Where answers come from, and the
  working directory every command runs in.
- **Data folder** — ask the plugin, which is two levels above this skill's
  folder and holds `validator/` and `references/` (under Claude Code it is
  also `$CLAUDE_PLUGIN_ROOT`):

  ```bash
  ENLOOP_PLUGIN="<that directory>"
  node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" data-folder
  ```

  `RESOLVED` prints the folder; use it. `AMBIGUOUS` or `NONE` exits non-zero
  and means you must ask — read `references/data-folder.md` at the plugin
  root for how — but ask **once, before the loop starts**, never from inside
  a pass.

## 2. Snapshot the inbox

```bash
ls -d "$DATA_DIR"/agent/questions/*/ 2>/dev/null
ls -d "$DATA_DIR"/agent/commands/*/ 2>/dev/null
```

No `agent/` directory, no entries, and no running command to babysit —
report `serve: idle` and end the pass. Never create `agent/` yourself: the
extension creates it on first use, and its absence is what says the channel
is not in use here.

## 3. Answer questions

A question directory holds `question.json`; your answer is `answer.md` plus
`answer.json`. **A directory with `answer.json` is done — skip it.** For
each one that is not:

1. Read `question.json`: which case, which run, which step, what the tester
   selected, and what they asked. Then read the run's frozen
   `"$DATA_DIR"/runs/<testCaseId>/<runId>/case.md` and `run.json` — the
   step (`stepId` is the positional `step-<n>` heading in document order)
   plus which steps are already executed.
2. Answer from evidence. Read the app source until the answer is concrete —
   the exact clicks, the exact field, `file:line` where it helps. The tester
   is standing in the page mid-run: the **first line of `answer.md` is the
   direct answer**, the click-path after it, background last. Do not
   speculate; if the source contradicts the step, say that plainly.
3. Decide whether to patch the case. Patch **only** when the step text
   itself was insufficient — when the next tester would have to ask the same
   question. A patch:
   - starts from the case's **latest stored** `versions/v<n>.md` — never
     from the frozen `case.md`, which is substituted and possibly
     quick-filtered;
   - edits only the step(s) the answer clarifies, and only ones whose
     status in `run.json` is `pending` (an untouched extra — `skipped` with
     null `startedAt` and `finishedAt` — counts as pending);
   - never adds or removes a step, never changes a `Kind:` line, never
     touches any other step's text, and keeps `@version` as it is;
   - carries a `Change note:` under the title naming what changed and which
     run's question prompted it;
   - is prepared in a scratch file **outside any `versions/` directory**
     (every `versions/v<n>.md` write is hook-linted and blocks on errors);
   - is self-checked before landing:

     ```bash
     node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" compat \
       "$DATA_DIR/test-cases/<id>/versions/v<n>.md" <scratch file>
     ```

     Exit 0 and every CHANGED step pending in `run.json`, or fix the patch —
     and if it cannot be both compatible and right, answer without a patch;
   - lands via
     `node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" write <scratch> --data-dir "$DATA_DIR" --case <testCaseId>`.
     Take the landed number from the `landed v<n>` output line, never from
     your own count — a concurrent write shifts it.
4. Write `answer.md`, then `answer.json` — **that order**; the panel treats
   `answer.json` as the completion marker:

   ```json
   { "id": "<question id>", "answeredAt": "<iso now>",
     "summary": "<one line>", "proposedVersion": <landed n or null> }
   ```

   Never claim the patch is compatible — the panel verifies on its own and
   offers the swap only if it agrees. You proposed; it decides.

## 4. Execute commands

A command directory holds `request.json`; your side is `run.sh`,
`status.json`, and the kill. The wrapper writes `output.log` and
`exit-code` on its own.

**New** (`request.json` present, `status.json` absent):

1. If a `kill` file is already there, the tester cancelled before any pass
   saw it: write `status.json` with `state:"killed"`, `reason:"user"`, and
   move on. Nothing is spawned.
2. Provenance: the exact `command` string must appear in the run's frozen
   `case.md` or in the case's latest `versions/v<n>.md` — check with
   `rg -F <the string>`. Absent → `status.json` with `state:"refused"`,
   `reason:"provenance"`, and move on. You execute what was authored into a
   case, nothing else. A command that looks interactive (`--interactive`,
   a prompt-driven tool) still runs — stdin is `/dev/null`, its timeout is
   the honest outcome — but say so in the report.
3. Write the command, verbatim, as the dir's `run.sh` (one line, no
   wrapping of your own).
4. Spawn it detached, in its own process group, from the app repo root:

   ```bash
   cd "$APP_REPO" && setsid bash -c \
     'echo $$ > "<dir>/pid"; bash "<dir>/run.sh" </dev/null >> "<dir>/output.log" 2>&1; echo $? > "<dir>/exit-code"' &
   ```

   The wrapper writes **its own** pid, because nothing else is reliable:
   `$!` names `setsid` itself, which may have forked, while `$$` inside the
   new session is the group leader by construction. And no `timeout(1)`
   wrapper — timeout moves its command into a separate process group, which
   would put the very processes you must kill out of `kill -- -<pid>`'s
   reach. You are the timeout (below).
5. Read `<dir>/pid` (it exists within a moment of the spawn) and write
   `status.json`:

   ```json
   { "state": "running", "pid": <from the pid file>, "startedAt": "<iso now>",
     "exitCode": null, "endedAt": null, "reason": null }
   ```

**Running** (`status.json` says `running`), in this order per pass:

1. `exit-code` exists → rewrite `status.json` with `state:"exited"`,
   `exitCode` from the file, `endedAt` now.
2. `kill` file exists → `kill -- -<pid>` (the pid is the process group),
   then `state:"killed"`, `reason:"user"`, `endedAt` now.
3. The timeout is yours to enforce: `T` is `timeoutSeconds` from
   `request.json` (0 = none). `startedAt + T` in the past and
   `kill -0 <pid>` still succeeding → kill the group, `state:"killed"`,
   `reason:"timeout"`. Ticking once a minute means a command can overrun
   its cap by up to a pass; that is the accepted precision.

## 5. Enforce the heartbeat

The panel touches `"$DATA_DIR"/agent/heartbeat.json` every 20 seconds while
it is open. Check its mtime once per pass, only when at least one command is
`running`:

```bash
stat -c %Y "$DATA_DIR/agent/heartbeat.json"   # missing file = stale
```

Older than **300 seconds** → the extension is closed: kill every running
process group as in §4 and mark each `state:"killed"`,
`reason:"heartbeat"`. Directories already `exited`, `killed` or `refused`
are never touched.

## 6. Report

One line per thing that happened this pass: a question answered (with
`proposed v<n>` when a patch landed), a command started / exited / killed /
refused, a heartbeat sweep. Nothing happened — exactly `serve: idle`. Keep
it to lines; the tester reads results in the panel, not here.
