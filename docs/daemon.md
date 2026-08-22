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

**Several projects, one daemon.** List every data folder in `dataDirs` and
map each `@project` in `repos`; the daemon reads the project name off the
run's frozen case and answers from the right repo. **Several backends**
is not a thing — one daemon, one backend; run two daemons from two
directories if you genuinely need both.

## When Claude Code is also running

Both servers speak the same files, and **Claude Code wins**: it likely
holds the context of the task being tested, while the daemon reads the
repo cold. Mechanically (PLAN-DAEMON §3):

- every server announces itself in `agent/watchers/<id>.json` each pass;
- the daemon **defers** any question younger than `deferSeconds` while a
  `claude-code` watcher has been seen in the last 3 minutes — and takes
  the question after that anyway, so a wedged loop never strands a tester;
- acks carry `by`, the panel says *who* is working, and on any race the
  daemon yields — after acking it re-reads, and before answering it checks
  both the ack and that no answer landed first; a complete answer is
  terminal for everyone;
- commands are claimed via `status.json` (`owner`), and **only the owner
  kills or reaps a process** — a pid is meaningless on another machine.
  Ownership is per-host and survives daemon restarts.

Nothing to coordinate by hand: start and stop either server whenever;
the files arbitrate.

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
