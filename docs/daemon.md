# enloopd — the standalone answering daemon

The agent channel ([skills.md](skills.md#serving-the-panel-live)) needs a
server: something watching the data folder to answer mid-run questions and
run case commands. A Claude Code session looping `/enloop:serve` is one
server. `enloopd` is the other — a plain CLI daemon for testers who don't
develop with an LLM, for machines without Claude Code, or for a shared box
serving a team.

```bash
npm install && npm run build:daemon        # from this repo, for now
node daemon/dist/enloopd.mjs setup         # pick backend, auth, folders
node daemon/dist/enloopd.mjs               # run (or --once under cron)
```

## Backends

The command half — provenance check, spawn, output streaming, Stop,
timeouts, heartbeat kill — is deterministic code and needs **no model and
no key**: `--commands-only` is a complete deployment on its own. Questions
need a brain, and `--backend` picks it:

| Backend | What it does | Auth |
| --- | --- | --- |
| `api` | One agentic loop per question against the Claude API (default model `claude-opus-5`), tools jailed to the app repo + data folder. The only backend that can **land patch versions** (validated minors, `v3` → `v3.1`). | `ANTHROPIC_API_KEY`, or an `ant auth login` profile — resolved by the SDK, never stored by enloopd |
| `claude-code` | Headless `claude -p` per question, in the app repo. Answer-only. | whatever Claude Code already has (subscription or key) |
| `codex` | Headless `codex exec` per question. Answer-only; the screenshot helps only if the configured model reads images. | Codex's own login |

`auto` (the default) prefers an installed `claude` (a subscription already
paid for), then a resolvable Anthropic credential, then `codex`. With
nothing viable the daemon refuses to start rather than silently ignoring
questions — `enloopd setup` walks the fix.

## When Claude Code is also running

Both servers speak the same files, and **Claude Code wins**: it likely
holds the context of the task being tested, while the daemon reads the
repo cold. Mechanically (PLAN-DAEMON §3):

- every server announces itself in `agent/watchers/<id>.json` each pass;
- the daemon **defers** any question younger than `--defer-seconds` (150)
  while a `claude-code` watcher has been seen in the last 3 minutes — and
  takes the question anyway after that, so a wedged loop never strands a
  tester;
- acks carry `by`, the panel says *who* is working, and on any race the
  daemon yields — after acking it re-reads, and before answering it checks
  both the ack and that no answer landed first; a complete answer is
  terminal for everyone;
- commands are claimed via `status.json` (`owner`), and **only the owner
  kills or reaps a process** — a pid is meaningless on another machine.

Stopping the daemon never kills the commands it started; they run to their
own exit, timeout, or the panel-heartbeat sweep of the next pass.

## Configuration

`enloopd --help` lists the flags; `enloopd.json` in the working directory
(written by `setup`) holds the same options, flags win. Never a secret in
it. Notables:

- `--repo <project>=<path>` maps a case's `@project` to its repo, so one
  daemon serves several apps; bare `--repo <path>` is the fallback.
- `--no-patch` answers without ever landing versions.
- `--no-heartbeat-kill` for synced/shared folders, where the panel's
  heartbeat arrives late and would kill healthy processes. Which is also
  the honest limit of "server" deployments: the extension writes to a
  local folder, so a remote daemon only works where that folder is
  genuinely shared (sync, NFS). A real multi-user backend is PLAN-BACKEND.
- `cliArgs.claude` / `cliArgs.codex` in the config file append argv to the
  CLI backends — e.g. permission flags, a `--model` for codex.
