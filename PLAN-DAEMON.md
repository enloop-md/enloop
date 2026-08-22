# enloopd — a standalone answering daemon for the agent channel (outline)

Status: **outline for discussion**, not yet an execution plan. It locks the
protocol decisions (§3) because the serve skill and the extension have to
agree on them regardless of how the daemon itself is built; everything else
is direction, not commitment.

## 1. Goal

The agent channel today has exactly one server: a Claude Code session
looping `/enloop:serve`. That works for the developer who lives in Claude
Code, and for nobody else — a tester without an LLM development setup gets
"Waiting for an agent session…" forever.

`enloopd` is a CLI daemon that serves the same channel without an active
session: install it on a tester's machine (or a shared machine), point it
at the data folder and the app repo, and questions get answered and
commands get run. The answering is still an LLM's — the Claude API, or an
installed Claude Code / Codex driven headlessly — what goes away is the
open session someone has to keep looping.

```
enloopd setup                                         # pick backend, set up auth, write config
enloopd --data ~/enloop-data --repo ~/work/app        # foreground daemon
enloopd --data ~/enloop-data --repo ~/work/app --commands-only
```

The brain is pluggable (§4.2): the daemon can answer through the **Claude
API** directly, or by driving an installed **Claude Code** or **Codex** CLI
headlessly — whichever the machine already has credentials for.

It speaks the exact on-disk protocol the extension already speaks
(`agent/questions/*`, `agent/commands/*`, `heartbeat.json`, ack → answer →
patch), so the extension needs almost nothing new — and both servers can
coexist, with Claude Code taking priority because it likely holds the
context of the task being tested (§3).

### Non-goals

- **Not a backend.** The channel stays a directory. A true server-hosted
  story (extension talking HTTP to a shared service) is PLAN-BACKEND's API
  store; `enloopd` on a remote machine works only where the data folder is
  genuinely shared (§6).
- **Not a second author.** The daemon answers questions and lands
  serve-style patch versions; it does not write cases, triage runs, or
  replace `/enloop:check`.
- **No new extension surface** beyond showing *who* is working (§3.2).

## 2. The three occupancy cases

| Who is running | Behavior |
| --- | --- |
| Only Claude Code (`/loop 1m /enloop:serve`) | Exactly today: the pass acks, answers, patches, runs commands. |
| Only `enloopd` | The daemon does all of it: acks within its poll interval (~5 s, so pickup is *faster* than the 1-minute loop), answers via the API, executes commands. |
| **Both** | **Claude Code wins.** It is mid-task, with the feature's context already in its window; the daemon is a generalist reading the repo cold. The daemon defers while Claude Code is provably alive, and takes over the moment it is not (loop stopped, session wedged) — so priority never turns into starvation. |

## 3. Arbitration protocol (decided — this part is binding)

Everything below is additive to the current protocol; an extension or serve
skill that predates it keeps working (unknown JSON fields are ignored by
the zod schemas on read).

### 3.1 Presence: `agent/watchers/<watcherId>.json`

Every server announces itself once per pass/tick:

```json
{ "id": "claude-code",            // or "enloopd-<host>-<8hex>"
  "kind": "claude-code" | "daemon",
  "host": "nords-laptop",
  "lastSeenAt": "<iso>" }
```

- The serve skill gains one step: touch `agent/watchers/claude-code.json`
  at the top of every pass (§2 of the skill, next to the inbox snapshot).
- The daemon touches its own file every tick.
- A watcher is **fresh** if `lastSeenAt` is younger than **180 s** (three
  loop intervals). Stale files are informational garbage; anyone may
  overwrite their own, nobody deletes another's.

### 3.2 Claiming a question: `ack.json` grows `by`

```json
{ "id": "<question id>", "pickedUpAt": "<iso>",
  "by": { "id": "enloopd-nords-laptop-1a2b3c4d", "kind": "daemon" } }
```

The extension shows it: "**Claude Code** is working on the answer…" /
"**Enloop daemon** is working on the answer…". Absent `by` (old skill
versions) renders as the generic line.

### 3.3 Priority rules

Claude Code's serve pass **never defers and never backs off** — it acks
every unanswered question it sees, exactly as today.

The daemon, for each unanswered, un-acked question:

1. **Fresh `claude-code` watcher present** → defer. Do not ack. Keep a
   fallback clock per question: if the question is still un-acked after
   **150 s** (2.5 loop intervals — Claude Code had two chances), take it
   anyway. This is the "loop is running but wedged/busy" escape.
2. **No fresh `claude-code` watcher** → ack immediately.

Races (both ack within the same seconds) resolve by two re-reads, and the
daemon always yields:

- After writing `ack.json`, the daemon re-reads it ~2 s later. If `by.kind`
  is now `claude-code`, the daemon abandons the question silently.
- Immediately before writing `answer.md`/`answer.json`, each side re-reads:
  the **daemon** abandons if the ack now names claude-code *or* an answer
  already exists; **Claude Code** checks only that no `answer.json` exists
  (first complete answer is terminal — never overwrite one).

### 3.4 Commands: claim by `status.json`, own by `owner`

`status.json` gains `"owner": "<watcherId>"`. Rules:

- The same defer rule applies: with a fresh claude-code watcher, the daemon
  waits 150 s before touching a new `request.json`; without one it starts
  the command immediately. Whoever writes `status.json` first owns it; the
  daemon re-reads ~2 s after writing and backs off if claude-code won.
- **Only the owner may kill, reap, or heartbeat-sweep a command** — the pid
  is meaningless on any other machine. This is what makes a server-hosted
  daemon coherent: its processes live and die on the server.
- A `running` command whose owner has been stale for **10 min** is orphaned:
  another watcher *on the same host* (matching `host`) may take ownership
  and sweep it; a watcher on a different host may only mark it
  `killed / reason "orphaned"` after the hard timeout has long passed, so
  the panel is not left showing "running" forever.

## 4. What the daemon is

A single Node CLI (workspace package `daemon/`, bin `enloopd`), reusing
`@tcm/shared` for the parser, schemas, lint, and `checkRunCompat` — the
protocol layer is already written and typed; the daemon adds a Node-fs
port of the handful of `FsaDataStore` operations it needs (same layout,
`node:fs` instead of the File System Access API).

Three internal services on one poll loop (default 5 s):

1. **Command executor — no LLM involved.** Provenance grep, `run.sh`,
   the setsid + pid-file spawn recipe, kill flags, hard timeout, heartbeat
   sweep — a direct port of serve §4/§5, deterministic code. This half
   works with **no API key at all**: `--commands-only` is a valid,
   useful deployment (a tester who just wants one-click setup commands).
2. **Answerer — pluggable backend** (§4.2). The daemon owns the lifecycle
   either way: it writes the ack itself before invoking any backend (the
   pickup signal must not depend on a model starting up), builds one
   self-contained per-question brief, invokes the backend, and validates
   what came back (`answer.md` + `answer.json` present and parseable, any
   landed version self-checked) before considering the question done.
3. **Arbitrator** — §3, wrapped around both.

### 4.2 Answering backends

`--backend api | claude-code | codex` (default `auto`: use what `setup`
configured; failing that, first of — an Anthropic credential resolves →
`api`; a `claude` binary on PATH → `claude-code`; a `codex` binary →
`codex`).

- **`api` — Claude API, Tool Runner.** One agentic run per question via the
  Anthropic TypeScript SDK (`@anthropic-ai/sdk`,
  `client.beta.messages.toolRunner`) with a small closed tool set, each a
  `betaZodTool`: `read_file`, `grep`, `list_dir` (path-jailed to the app
  repo and the data folder), `validate_case` and `land_case_version`
  (wrapping the shared lint + the versions/v<n+1> write with the same
  compat self-check the skill performs). The system prompt is the serve
  skill's §3 contract, distilled. `screenshot.png` goes into the first user
  message as an image block; `page.html` is reached through `grep`.
  Model `claude-opus-5` by default, `--model` to override; adaptive
  thinking (the default — no `thinking` parameter sent). Auth is the SDK's
  zero-arg resolution: `ANTHROPIC_API_KEY`, or an `ant auth login` profile.
- **`claude-code` — headless Claude Code.** Per question, spawn
  `claude -p "<brief>"` in the app repo with a non-interactive permission
  preset scoped to the repo + data folder (exact flags pinned during
  implementation). Uses whatever auth Claude Code already has —
  subscription or key — so a machine with Claude Code installed needs no
  separate API key; and if the enloop plugin is installed the brief simply
  points at the one question directory and the serve §3 rules apply.
- **`codex` — headless Codex.** Per question, spawn
  `codex exec "<brief>"` in the app repo. Same brief; the daemon notes in
  it that the screenshot may be unreadable if the configured model cannot
  view images (the snapshot and source still carry the answer).

The brief is generated by the daemon and self-contained — question dir,
run dir, repo root, the answer/patch rules, and the path to the daemon's
own bundled validator — so neither CLI backend requires the enloop plugin
to be installed. Backends are answer-only: commands, heartbeats, kills and
arbitration always stay in the daemon, identical across backends.

### 4.3 `enloopd setup` — the key/backend wizard

One interactive command, safe to re-run, that ends with a working config
and no secrets stored by enloopd itself:

1. Detect what the machine has: `claude` binary, `codex` binary, an
   Anthropic credential (`ANTHROPIC_API_KEY` set, or `ant auth status`
   reporting an active profile).
2. Offer the viable backends (recommending in the order found above) plus
   `commands-only`.
3. Walk the auth for the chosen backend by delegating to that tool's own
   login — `ant auth login` for `api` (or paste a key, which setup exports
   via a shell-profile snippet it prints rather than writing to disk),
   `claude` login for `claude-code`, `codex login` for `codex` — then
   verify with a one-token ping / `--version` probe.
4. Ask for data folder(s) and repo(s), write `enloopd.json` (backend,
   model, paths — never a key), and print the one line to run next.

Keys therefore live where they already live — the env, the `ant` profile
store, or the CLIs' own auth stores — and rotating them never touches
enloopd config.

Configuration (flags > `enloopd.json` next to the data folder > env):
`--backend`, `--data` (repeatable), `--repo` (repeatable, or a
`project → repo` map so one daemon serves several apps by each case's
`@project`), `--model`, `--defer-seconds`, `--poll-seconds`,
`--commands-only`, `--no-commands`, `--no-patch`.

With no configured backend and not `--commands-only`, the daemon refuses to
start with a one-line pointer at `enloopd setup` — never silently ignores
questions.

## 5. What changes in this repo (small, and before the daemon exists)

1. **Serve skill**: touch `agent/watchers/claude-code.json` each pass;
   include `by` in `ack.json`; include `owner` in `status.json`; add the
   answer-terminality re-read. One doc pass in `docs/skills.md`.
2. **Shared schemas**: `agentWatcherSchema`; optional `by` on the ack;
   optional `owner` on command status. All additive with `.optional()` /
   `.default()`.
3. **Extension**: render `by` in the working line; nothing else.

These ship independently of the daemon and make the protocol
multi-server-safe on day one.

## 6. Deployment notes and open questions

- **Server deployment is bounded by the folder.** The extension writes to a
  local directory; a daemon elsewhere sees it only through a synced/shared
  mount (Syncthing, SMB, a shared dev box). That works, with two caveats:
  sync latency eats into the ack SLA, and the panel heartbeat arrives late
  — so `enloopd` should ship a `--no-heartbeat-kill` (or a much longer
  stale limit) preset for synced folders. The clean multi-user server story
  remains PLAN-BACKEND.
- **Cost**: one question ≈ one short agentic run; entirely usage-billed to
  the operator's key. Worth printing per-answer token/cost totals to the
  daemon log so a team lead can see what the convenience costs.
- **Open**: package name on npm (`enloopd` vs `enloop-serve`); whether the
  daemon should also expose `$check`-style run triage (leaning no — see
  non-goals); whether `land_case_version` should be withheld on
  `--commands-only`-adjacent "answer but never patch" mode for cautious
  teams (`--no-patch` flag, probably yes); whether `auto` should prefer
  `claude-code` over `api` when both are viable (an installed Claude Code
  usually means a subscription already paid for — leaning yes, with the
  wizard saying which it picked and why).

## 7. Phases (when this graduates from outline to plan)

1. Protocol additions in this repo (§5) — shippable alone.
2. `daemon/` package: Node store port + command executor + heartbeat sweep;
   `--commands-only` works end to end. No API dependency yet.
3. Answerer, `api` backend via Tool Runner; `--no-patch` mode;
   screenshot-as-image; backend-result validation.
4. CLI backends (`claude-code`, `codex`): the self-contained brief, spawn
   presets, and the `enloopd setup` wizard with auth detection/delegation.
5. Arbitration soak: both servers against one folder, scripted races
   (the Part-7-style dry run, plus a kill-the-loop-mid-answer case).
6. Packaging (`npx enloopd`, single-file build via the same bundling used
   for `lib.mjs`), docs page, README row.
