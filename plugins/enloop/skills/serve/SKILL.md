---
name: serve
description: One manual pass over the Enloop data folder, serving whatever the extension asked. A tester mid-run asks a question from a step ("how do I check this exactly?") — answer it from the app's source, and when the step itself was the problem, land a compatible patch version the panel offers to hot-swap in. A tester clicks Run on a case-authored setup command — execute it in the background, stream output back. Run it when the panel says a question or command is waiting and you are already in a session; the always-on server is the enloopd daemon (docs/daemon.md), which resumes the case's authoring session by itself. Not for triaging finished runs; that is /enloop:check.
disable-model-invocation: true
allowed-tools: Read Grep Glob Write Edit Bash(git diff *) Bash(git log *) Bash(git status *) Bash(git rev-parse *) Bash(rg *) Bash(ls *) Bash(cat *) Bash(node *) Bash(mkdir -p *) Bash(printf *) Bash(setsid *) Bash(kill *) Bash(stat *) Bash(tail *) Bash(date *) Bash(bash *) Bash(cd *)
---

# Serve the panel

The extension's side panel cannot spawn a process or answer a question — it
can only write files into the connected data folder. This skill is one
**manual pass** over `agent/` in that folder, doing whatever the panel asked:
run it when the panel says a question or a command is waiting and you happen
to be sitting in a session already. The always-on server is the **enloopd
daemon** (docs/daemon.md) — it watches continuously and answers by resuming
the very session that authored the case; do not loop this skill as a
substitute for it.

Every pass is stateless and idempotent. All state lives in the files; a pass
that finds nothing to do says so in one line and ends. Never ask the user a
question mid-pass — the tester is in the browser, not the terminal, and the
whole point is that they never have to come here.

The panel is the sole authority on loading a patch into a live run, and the
run history under `runs/` stays read-only for you, as everywhere else. What
you own here is `agent/**` answers, progress lines and statuses,
`test-cases/**` versions via the validator, and the processes you spawn.

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

When `agent/` does exist, announce this loop before anything else — write
`agent/watchers/claude-code.json` (creating `watchers/` if needed):

```json
{ "id": "claude-code", "kind": "claude-code", "host": "<hostname>",
  "lastSeenAt": "<iso now>", "protocol": 1 }
```

`protocol` is the channel's wire version — currently **1**; it is what
lets the extension warn when a stale plugin serves a newer folder.

This is how a standalone answering daemon (`enloopd`) knows you are alive
and defers to you — you hold the task's context, it reads the repo cold.
You never defer to anyone and never back off a question you acked; the
daemon does both. Never touch another watcher's file.

## 3. Answer questions

A question directory holds `question.json`; your answer is `answer.md` plus
`answer.json`. **A directory with `answer.json` is done — skip it.** For
each one that is not:

1. **Acknowledge first, before reading anything else.** Write `ack.json`
   into the question's directory:

   ```json
   { "id": "<question id>", "pickedUpAt": "<iso now>",
     "by": { "id": "claude-code", "kind": "claude-code" } }
   ```

   The tester is watching a "waiting for an agent" line; this file is what
   turns it into "agent is working on the answer", and it must land within
   seconds of the pass seeing the question — not after the app source has
   been read. An `ack.json` already present means an earlier pass died
   mid-answer: leave the file as it is and keep going, the question still
   needs its answer.
2. **Say what you are doing, as you do it.** The tester sees one status
   line under their question, and a line that has not changed in a minute
   reads as a server that died. Rewrite `progress.json` in the question's
   directory whenever what you are doing changes:

   ```json
   { "id": "<question id>", "at": "<iso now>",
     "text": "Reading the reset form in ResetForm.tsx" }
   ```

   One short present-tense sentence, in your own words, about the actual
   thing — what you are opening, what you just found, that you are writing
   the answer or preparing a patch. Not a fixed phrase from a list: "Found
   it — the step names a button that was renamed in #412" tells them more
   than "Working". At the least, write one before you start reading, one
   when you know the answer, and one when you start writing it. Never
   write it after `answer.json` exists.
3. Read `question.json`: which case, which run, which step, what the tester
   selected, and what they asked — plus `pageUrl` (where they were
   standing) and `attachments`. Then read the run's frozen
   `"$DATA_DIR"/runs/<testCaseId>/<runId>/case.md` and `run.json` — the
   step (`stepId` is the positional `step-<n>` heading in document order)
   plus which steps are already executed.
4. Use the attachments — they are the tester's actual page at the moment of
   asking, which the app source alone cannot show:
   - `page.html` — a sanitized DOM snapshot (scripts and styles stripped,
     ids/classes/testids/aria kept; each frame introduced by a
     `<!-- enloop frame: <url> -->` marker). **Grep it, never read it
     whole** — it is where you verify that a selector you are about to
     recommend actually matches something, and where "A" in "check A is X"
     usually turns out to live.
   - `screenshot.png` — view it with Read. What the tester sees, including
     state the DOM does not spell out (an overlay, an empty table, a
     spinner that never resolved).
   Treat both as evidence of *that moment*, not of the current page — the
   tester may have navigated since.
5. Answer from evidence. Read the app source until the answer is concrete —
   the exact clicks, the exact field, `file:line` where it helps. The tester
   is standing in the page mid-run: the **first line of `answer.md` is the
   direct answer**, the click-path after it, background last. Do not
   speculate; if the source contradicts the step, say that plainly.
6. Decide whether to patch the case. Patch **only** when the step text
   itself was insufficient — when the next tester would have to ask the same
   question. A patch:
   - starts from the case's **latest stored** version — highest id,
     minors included (`v3.1` beats `v3`) — never from the frozen
     `case.md`, which is substituted and possibly quick-filtered;
   - edits only the step(s) the answer clarifies, and only ones the run has
     not judged yet: status `pending` or `running` in `run.json`, an
     untouched extra (`skipped` with null `startedAt` and `finishedAt`),
     **or the step the question was asked from, whatever its status** — the
     panel resets that step's result when the tester loads the patch, so a
     verdict never ends up describing text it did not judge;
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

     Exit 0 and every CHANGED step editable by the rule above, or fix the
     patch — and if it cannot be both compatible and right, answer without
     a patch;
   - lands via
     `node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" write <scratch> --data-dir "$DATA_DIR" --case <testCaseId> --patch`.
     `--patch` is what makes it a **minor** version — `v3` becomes `v3.1`,
     a second patch `v3.2` — so the folder shows at a glance what was
     authored (majors) and what was patched mid-run (minors); the next
     `quick`/`full`/`check` landing goes to `v4`. Take the landed id from
     the `landed v<id>` output line, never from your own count — a
     concurrent write shifts it.
7. Before writing, check the directory one more time: an `answer.json`
   that appeared meanwhile means another server finished first — a complete
   answer is terminal, never overwrite one. Otherwise write `answer.md`,
   then `answer.json` — **that order**; the panel treats `answer.json` as
   the completion marker:

   ```json
   { "id": "<question id>", "answeredAt": "<iso now>",
     "summary": "<one line>", "proposedVersion": "<landed id, e.g. \"3.1\">" | null }
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
     "exitCode": null, "endedAt": null, "reason": null, "owner": "claude-code" }
   ```

   Touch only commands you own (`owner` yours or absent): a pid another
   watcher recorded is a process on a machine that may not be this one.

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
