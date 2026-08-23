# enloopd — the standalone answering daemon

The agent channel ([skills.md](skills.md#serving-the-panel-live)) needs a
server: something watching the data folder to answer mid-run questions and
run case commands. A Claude Code session looping `/enloop:serve` is one
server. `enloopd` is the other — the same LLM-powered answering, **without
an active session**. It thinks with the Claude API, or with an installed
Claude Code or Codex driven headlessly; what it removes is the open
session someone has to keep looping. Leave it running on a tester's
machine or a shared box, and the tester never touches a terminal. The
extension needs no configuration to use it: both servers speak the same
files, and the panel simply shows which one picked a question up.

## Install

Requires **Node 20+** and, for now, this repository — the daemon builds to
a single self-contained file (an npm package is planned):

```bash
git clone https://github.com/enloop-md/enloop.git
cd enloop
npm install
npm run build:daemon        # → daemon/dist/enloopd.mjs, one file
```

Run it as `node daemon/dist/enloopd.mjs …`, or put `enloopd` on your PATH:

```bash
npm link -w daemon          # global symlink; `enloopd --help` now works
```

The built file is portable: copy `daemon/dist/enloopd.mjs` anywhere and run
it with `node`. The one runtime dependency is `@anthropic-ai/sdk`, and only
the `api` backend loads it — `--commands-only` and the CLI backends run
from the single file alone.

## Quick start

```bash
enloopd setup
```

The wizard is interactive, safe to re-run, and does four things: detects
what the machine has (a `claude` binary, a `codex` binary, an Anthropic
credential), recommends a backend, walks the auth for it by pointing at
that tool's own login, and asks for your data folder and app repo. It ends
by writing `enloopd.json` in the current directory — **never with a secret
in it** — and printing the one line to run next:

```bash
enloopd
```

That's the daemon: it polls the folder every few seconds, announces itself
in `agent/watchers/`, answers questions through the chosen backend, and
executes the commands testers click in the panel. Stop it with Ctrl-C —
processes it started for commands are deliberately *not* killed with it;
they run to their own exit, timeout, or the heartbeat sweep of a later
pass.

No long-lived process wanted? `--once` does a single pass and exits, which
makes cron the scheduler:

```cron
* * * * *  cd /home/qa/acme && /usr/local/bin/enloopd --once >> enloopd.log 2>&1
```

(`cd` first — the config file is looked up in the working directory.)

## The authoring session answers first

The best answerer for a question about a case is the session that wrote
the case — it still holds the feature's context. The plugin's guard hook
stamps that provenance automatically: every time a version lands,
`test-cases/<id>/context.json` records the authoring session's id, the
repo it ran in, and the host (machine-local, kept out of version control
by the folder's `.gitignore`). For a question, the daemon checks it first:
same host and `claude` installed → it answers via

```
claude -p "<the question brief>" --resume <that session> --fork-session
```

— the authoring context, recovered for exactly one question, *forked* so
the real session's history stays clean. Session gone, different machine,
or the resume fails → it falls through to the configured backend below.
`--no-resume` (or `"resumeAuthorSession": false`) turns the whole
mechanism off.

## Backends and their auth

Answering is always an LLM's work — `--backend` picks whose:

| Backend | What it does | Auth — set up once |
| --- | --- | --- |
| `api` | One agentic loop per question against the Claude API (default model `claude-opus-5`), with read/grep/list tools jailed to the app repo + data folder. The only backend that **lands patch versions** (validated minors, `v3` → `v3.1`). Reads the question's screenshot. | `export ANTHROPIC_API_KEY=…` in your shell profile, **or** `ant auth login` (the SDK finds the profile by itself). enloopd stores neither. |
| `claude-code` | Headless `claude -p` per question, run in the app repo. Answer-only. | Whatever Claude Code already has — log in to `claude` once (subscription or key) and the daemon rides it. |
| `codex` | Headless `codex exec` per question. Answer-only; the screenshot helps only if the configured model reads images. | `codex login`, once. |

`auto` (the default) prefers an installed `claude` — a subscription already
paid for — then a resolvable Anthropic credential, then `codex`. With
nothing viable the daemon **refuses to start** rather than silently
ignoring questions; `enloopd setup` walks the fix.

One narrow exception: the command half — provenance check, spawn, output
streaming, Stop, timeouts, heartbeat kill — is deterministic code, so
`--commands-only` runs it with no backend and no key at all. That mode
answers nothing; it exists for a machine that should only execute the
commands testers click.

## Configuration

Precedence: **flags > `enloopd.json` in the working directory > defaults.**
The wizard writes the file; here it is in full, with the defaults spelled
out. (The comments below are for this page — the real file is plain JSON,
no comments.)

```jsonc
{
  // Folders the extension is connected to. Repeatable as --data.
  "dataDirs": ["/home/qa/acme-data"],

  // Where answers come from and commands run: a case's @project name maps
  // to its repo; "*" is the fallback. Repeatable as
  // --repo <path> or --repo <project>=<path>.
  "repos": {
    "Acme": "/home/qa/src/acme",
    "*": "/home/qa/src/acme"
  },

  "backend": "auto",          // auto | api | claude-code | codex
  "model": "claude-opus-5",   // api backend only

  // Arbitration and pacing (seconds).
  "deferSeconds": 150,        // how long questions are left to a live
                              // Claude Code loop before the daemon takes them
  "pollSeconds": 5,

  // Capability switches.
  "commandsOnly": false,      // run commands, never answer (no key needed)
  "noCommands": false,        // answer, never run commands
  "noPatch": false,           // answer, but never land patch versions

  // For synced/shared folders (Syncthing, NFS): the panel's heartbeat
  // arrives late there, and killing on it would murder healthy processes.
  "heartbeatKill": true,

  // Extra argv appended to the CLI backends — permission flags for
  // `claude -p`, a model for codex, whatever your setup needs.
  "cliArgs": {
    "claude": [],
    "codex": []
  }
}
```

Every key has a flag twin (`--backend`, `--model`, `--defer-seconds`,
`--poll-seconds`, `--commands-only`, `--no-commands`, `--no-patch`,
`--no-heartbeat-kill`), plus `--once` for single-pass runs —
`enloopd --help` is the authoritative list.

**Several projects, one daemon** — including fully isolated ones. A
common shape: three projects, each with its own data folder, its own
`CLAUDE_CONFIG_DIR` (separate login and session store), and its own Chrome
profile with the extension connected to that project's folder. One daemon
serves all three:

```jsonc
{
  "dataDirs": ["/home/qa/p1-data", "/home/qa/p2-data", "/home/qa/p3-data"],
  "repos":    { "P1": "/home/qa/src/p1", "P2": "/home/qa/src/p2", "P3": "/home/qa/src/p3" },
  "claudeConfigDirs": {
    "/home/qa/p1-data": "/home/qa/.claude-p1",
    "/home/qa/p2-data": "/home/qa/.claude-p2",
    "/home/qa/p3-data": "/home/qa/.claude-p3"
  }
}
```

The daemon reads `@project` off the run's frozen case to pick the repo.
Isolation holds by itself for **resumes**: each case's `context.json`
records the authoring session's own `CLAUDE_CONFIG_DIR`, and the daemon
spawns `claude` with exactly that dir — right login, right session store,
per case, with nothing to configure. The `claudeConfigDirs` map only
covers *fresh* claude-code runs on cases that carry no stamp. **Several
backends** is not a thing — one daemon, one backend; run two daemons from
two directories if you genuinely need both.

## How the three sides communicate — and why they can't race

There are no sockets and no shared process. The only thing the extension,
a Claude Code session, and the daemon can all reach is the **data
folder**, so the entire protocol is files under `agent/`:

```
extension (panel)          Claude Code session           enloopd daemon
  writes requests            one manual /enloop:serve      polls every ~5s
  polls for replies          pass when you invoke it
        │                          │                            │
        └──────────────┬───────────┴────────────┬───────────────┘
                       ▼                        ▼
                <data folder>/agent/
                ├── heartbeat.json      panel touches every 20s
                ├── watchers/<id>.json  each server announces itself
                ├── questions/<id>/     question.json → ack.json
                │                       → answer.md → answer.json
                └── commands/<id>/      request.json → status.json,
                                        run.sh, output.log, exit-code, kill
```

Every participant is deliberately **stateless between looks** — the panel
document is destroyed whenever the tester clicks into the page under test,
a serve pass exists for one invocation, the daemon re-derives everything
each poll — so all state must be re-readable from the files. That is also
what keeps the race rules simple: nothing exists to coordinate except
"whose write is on disk."

Two signals precede any work. `heartbeat.json` is the panel saying "a
human is here"; it gates only process lifetime (a server kills the command
processes *it* started once the heartbeat is >5 minutes stale).
`watchers/<id>.json` is each server saying "I'm serving" — a Claude Code
pass writes `claude-code.json` at the top of every pass, the daemon
touches its own file each tick, and "fresh" means an mtime under 3
minutes. Presence drives every priority decision, and the panel reads it
too: no fresh watcher → the setup instructions appear instead of an
endless wait.

**A question's life, and its three race guards.** The extension writes
`question.json` (attachments first, so no server ever sees a question
without its evidence), then polls.

1. *Claiming is asymmetric by design.* A Claude Code pass acks any
   unanswered question immediately, always. The daemon first asks: fresh
   `claude-code` watcher, and question younger than `deferSeconds` (150)?
   Then it **defers** — an interactive session is even closer to the task
   than a resumed one. The age clock is the anti-starvation guard: a
   wedged or ended session cannot strand the tester, because freshness
   fades in 3 minutes and the clock runs regardless.
2. *The ack race has one predetermined winner.* Both may write `ack.json`
   within the same seconds — last writer wins on a single file, and the
   resolution is behavioral: the daemon **re-reads its own ack ~2 seconds
   after writing it** and abandons silently if `by` now names claude-code.
   Claude Code never re-checks and never yields. A race needs two stubborn
   parties; there is only one.
3. *Completion is terminal.* `answer.md` lands first, `answer.json`
   second — only the pair counts, so the panel never renders half an
   answer. Immediately before writing, each side re-reads the directory:
   the daemon aborts if an answer exists *or* its ack was taken over;
   Claude Code checks only that no `answer.json` exists. First complete
   answer wins; a late finisher discards its own work, never overwrites.

The daemon retries only its **own** ack, and only once it is >15 minutes
cold (a previous pass died mid-answer); it never touches a question held
by someone else's ack. And the resumed session
(`claude -p --resume … --fork-session`) is not a fourth racer — it is a
child process that only prints an answer; the daemon alone writes the
channel files on its behalf.

**Commands trade context for ownership.** A pid only means something on
the machine that spawned it, so the claim is `status.json` with an
`owner`: the daemon claims *before* spawning (write, wait ~2s, re-read;
lost the race → back off having spawned nothing), a serve pass claims
right after spawning and never backs off, and the same defer window
applies to the daemon while a claude-code watcher is fresh. From there:
**only the owner kills, reaps, or heartbeat-sweeps** its processes; the
owner id is per-host and stable across restarts (or a cron `--once`
daemon could never reap what its previous run spawned); completion never
depends on the owner being alive, because the spawn wrapper itself writes
`exit-code` and the panel treats that file as authoritative; and a
`running` status whose owner has gone silent long past the command's
timeout is relabeled `killed / orphaned` — but nobody ever signals a pid
they did not create.

Three properties carry the whole design: **single-file claims** (whoever's
write survives is visible to everyone), **asymmetric yielding** (exactly
one party backs off in every contest), and **terminal artifacts**
(`answer.json`, `exit-code` — once they exist, further work is
discard-your-own). Start and stop any participant whenever; the files
arbitrate.

## Limits worth knowing

- **A "server" deployment is bounded by the folder.** The extension writes
  to a local directory, so a daemon on another machine only works where
  that directory is genuinely shared (sync, NFS) — set
  `"heartbeatKill": false` there. A real multi-user backend is
  PLAN-BACKEND's territory.
- **CLI backends answer but never patch** — landing a validated version
  needs the `api` backend's tool (or a real serve loop with the plugin).
- **Cost is per question**, on the operator's key or subscription. The
  daemon logs one line per question with the backend used; keep an eye on
  it the first week.
- **stdin is closed for commands** — a prompt-driven script runs to its
  timeout, not to an answer. Same rule as the serve skill.
