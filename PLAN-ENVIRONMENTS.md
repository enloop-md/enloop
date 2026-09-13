# Environments before cases — implementation plan

Status: **written 2026-09-11; parts 1–7 built the same day, uncommitted; typecheck, extension build, build:plugin and Gates 1, 2, 3 and 6 pass against the validator; Gate 4 (panel in a loaded extension) and Gate 5's eval are left to the user.** Plugin bumped to 0.20.0.

Decided while building, where the plan left it open or was found wrong:

- A `tsh` reach needs proxy *or* service, not both — `tsh` remembers the
  proxy of its last login, and a pasted `tsh db connect prod-postgres`
  alone is a valid answer.
- `lookup --variable NAME` on an environment with no lookup of that name
  borrows the same-named lookup from another environment of the project
  and says so; the schema is the same per deployment, only the answer
  differs.
- `--no-production` writes `production: false` rather than deleting the
  flag, so the name match does not re-flag it on the next touch. The
  match runs only while `production` is undefined.
- `--default` on a temporary environment is refused; `--temporary` on
  the default drops the flag. `--until` in the past is refused.
- `isReadOnlySql` also refuses a `with …` whose body carries a modifying
  verb outside string literals — Postgres allows `with x as (delete …)
  select`.
- Reach sub-flags given without `--reach` amend the existing reach and
  re-probe; an unknown valued flag is refused rather than swallowed into
  the project name.
- The linter takes `environmentsOfProject` beside `environmentProviders`
  so the E9 warning can name an environment that holds no value at all.
  Both E9 rules fire only when the caller computed providers.
- The panel writes an environments file only when its content changed,
  with a trailing newline like the validator, so a temporary-only edit
  never dirties the committed file.
- A database URL pasted into the master becomes a `manual` reach holding
  host and database name, not a `DOMAIN`.
- The panel's temporary card takes its project from the storage label
  when the label is not a layout folder name.

This plan is written to be executed by a separate session ("implement
PLAN-ENVIRONMENTS.md"). Every design decision below is locked; do not
re-litigate any of them mid-flight. Where the plan says *decided*, build
it as written. Where something is genuinely unspecified, pick the smallest
thing that satisfies the verification gate and note it in the status line
at the top of this file. **Do not commit** — the user commits. Update the
status line above after each part lands.

Read first, in this order:

1. `MANIFESTO.md` — the principle. The tester never looks anything up.
2. `shared/src/environments.ts` — the environments model and its doc comment.
3. `plugins/enloop/validator/enloop-case.mjs` — the `environments`,
   `validate` and `data-folder` commands (`case "environments"` near
   line 794, `readEnvironments` near line 76).
4. `shared/src/lint.ts` lines 60–150 and 300–330 and 660–690 — how the
   linter treats environment-provided names.
5. `extension/src/lib/fsa-store.ts` around `getEnvironments` (line ~575)
   and `extension/src/lib/storage-registry.ts` `ensureGitignore` (line ~477).
6. `extension/src/sidepanel/screens/EnvironmentsScreen.tsx` and the
   environment picker in `CaseDetailScreen.tsx` (lines ~95–200).
7. `plugins/enloop/skills/setup/SKILL.md` step 3, and
   `plugins/enloop/references/authoring.md` section 2b.
8. `scripts/build-plugin.mjs` — `lib.mjs` and `grammar.md` are generated
   from `shared/src` and committed; rerun `npm run build:plugin` after any
   change under `shared/src` that the validator uses.
9. `docs/extension.md` "Environments and domains", `docs/skills.md`
   "Setting up a repo", `docs/case-format.md` "Variables: everything else".

There is no unit-test runner in this repo. Verification is `npm run
typecheck`, `npm run build:plugin`, `npm run build`, and running the
validator against a scratch data folder as each gate below spells out.

---

## 1. What this changes and why

Today an environment is a static bag: addresses per domain, a value per
variable name, in `environments.json`. That works for the QA account on
staging. It does not answer three things the user hits every time a case
is written:

- **A value nobody recorded.** The linter accepts a variable as
  "environment-provided" as soon as its *name* is in the contract, even
  when no environment holds a value. The case lands, and the tester is
  asked for the value at run time — exactly what the manifesto forbids.
- **How to get to a deployment's data.** Staging and prod are reached
  through Teleport (`tsh`). Nothing records that, so an agent asked for a
  user id on staging has no way to find one, and the tester goes hunting.
- **Deployments that exist for an afternoon.** A Shipyard or ArgoCD
  preview has an address and a database that are only valid for one
  feature branch. `environments.json` is committed and shared, so they
  have no home and today are "no environment, follow the open tab".

The plan: environments become a **setup step that precedes authoring**.
`full` and `quick` stop when the project has no environments and offer
the **environment master**, a dialogue that records local from the repo
without asking, then adds staging, prod and others from what the user
pastes (a `tsh` string) or answers. Each environment may carry a **reach**:
how the agent gets to its data. Temporary environments live in a
git-ignored file with an expiry. The linter refuses a case whose
environment-provided variable has no value in any environment.

---

## 2. Decisions

Locked in.

| # | Decision | Consequence |
|---|---|---|
| E1 | **Reach is a property of the environment, agent-side only.** | `reach` on an `Environment`: `transport` is `tsh`, `command` or `manual`. The panel shows it read-only in one line and never executes anything. Only the validator (Node) opens tunnels and runs probes. |
| E2 | **Three transports, no more.** | `tsh` (Teleport: proxy, db service, db user, db name); `command` (a shell command that exits 0 when the deployment is reachable — the extension point for VPNs and other tunnels); `manual` (a sentence for a human; never probed). SSH, kubectl and cloud proxies are expressed as `command`. |
| E3 | **No secret is ever written.** | `tsh` holds certificates. A pasted connection URL with a password is *not* stored: host and database name go into the reach, the skill says the password was dropped. `environments.json` and `environments.local.json` may contain hostnames, service names, usernames, ports. Never passwords, never tokens. |
| E4 | **Temporary environments live in `environments.local.json`.** | Same schema as `environments.json`, beside it, git-ignored (the panel's `ensureGitignore` adds the line). Each temporary environment has an `expires` ISO timestamp. The contract (`domains`, `variables` arrays) lives only in `environments.json`; the local file's arrays are written empty and ignored on read. |
| E5 | **Temporary means "until end of today" unless said otherwise.** | `--temporary` sets `expires` to 23:59:59 local time today; `--until YYYY-MM-DD` to 23:59:59 local of that day. Expired environments are dropped on read by every consumer and pruned from the file on the next write. There is no browser-session-only environment; "this session" is "today". |
| E6 | **Merged on read, split on write.** | Every reader (validator, panel store) reads both files and returns one `EnvironmentsFile` whose local entries carry `local: true`. Every writer splits by that flag. `id`s are unique across both files. |
| E7 | **Production is a flag, and discovery there is opt-in.** | `production: true` on an environment. The master sets it when the name matches `/\bprod(uction)?\b/i` or the user says so. `lookup` against a production environment requires `--production`, and `--record` is refused there: a value found on prod is never written to any file. |
| E8 | **The gate is in authoring, before scope.** | `authoring.md` 2b: when `environments` prints `(none for <project>)`, ask one closed question — run the environment master now, or continue with local derived from the repo only. Never proceed silently. Never proceed on an empty answer. |
| E9 | **An environment-provided name needs a value somewhere.** | Lint error (not warning) when a variable or domain is in the contract but *no* environment of the case's project has a non-empty value for it, and `--data-dir` was passed. Warning listing the environments that lack it when at least one has it. |
| E10 | **Probe before record, record even on failure.** | Adding a `tsh` or `command` reach runs the probe once. The result (`verifiedAt` / `verifyError`) is written either way; a VPN that is down today is not a reason to lose what the user typed. |
| E11 | **Lookups are per environment, SQL only, read-only by construction.** | `lookups: { VARNAME: "select …" }` on an environment. The validator refuses anything whose first keyword is not `select` or `with`, or that contains a second statement. Runs through the environment's reach; `manual` reach cannot run lookups. |
| E12 | **The master is one reference file, used from two skills.** | `references/environment-master.md`. `setup` step 3 becomes "follow the master". `authoring.md` 2b offers it and follows it inline when accepted. `/enloop:setup environments` runs the master alone. |
| E13 | **Discovery defaults to the default environment.** | Every command that takes `--env` and is given none uses the project's default environment; when none is flagged, the first non-production one; never production implicitly. |
| E14 | **No grammar change.** | The case format does not move. Plugin stays `0.18.0` (already unreleased); the changelog gains entries under Unreleased. |

---

## 3. Schema

`shared/src/environments.ts`. Additive; every field optional so existing
files parse.

```ts
export const reachSchema = z.object({
  transport: z.enum(["tsh", "command", "manual"]),
  /** tsh: the Teleport proxy host, `teleport.example.com[:443]`. */
  proxy: z.string().optional(),
  /** tsh: the database service name from `tsh db ls`. */
  dbService: z.string().optional(),
  /** tsh: `--db-user`. */
  dbUser: z.string().optional(),
  /** tsh: `--db-name`. */
  dbName: z.string().optional(),
  /** tsh: protocol for the client to use. Default `postgres`. */
  dbProtocol: z.enum(["postgres", "mysql"]).optional(),
  /** command: exits 0 when the deployment's data is reachable. Run with
   * `sh -c` from the data folder. */
  probe: z.string().optional(),
  /** command: a command that prints `host:port` of a database reachable
   * from this machine while the probe holds — optional; without it,
   * lookups on a `command` reach are refused. */
  dbAddress: z.string().optional(),
  /** manual, and any transport: one sentence for a human. */
  note: z.string().optional(),
  /** ISO timestamp of the last successful probe. */
  verifiedAt: z.string().optional(),
  /** Why the last probe failed; absent when it passed. */
  verifyError: z.string().optional(),
});

export const environmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  project: z.string().optional(),
  default: z.boolean().optional(),
  /** E7. */
  production: z.boolean().optional(),
  /** E4/E6: lives in environments.local.json. Set by the reader, honoured
   * by the writer; a value in the file itself is ignored on read. */
  local: z.boolean().optional(),
  /** E5: ISO timestamp; only meaningful with `local`. */
  expires: z.string().optional(),
  domains: z.record(z.string()).default({}),
  values: z.record(z.string()),
  reach: reachSchema.optional(),
  /** E11: variable name → SQL. */
  lookups: z.record(z.string()).optional(),
});
```

New helpers, exported and re-exported from `shared/src/index.ts`:

```ts
/** Local-time end of `day` (a `YYYY-MM-DD`, default today) as ISO with offset. */
export function endOfDayIso(day?: string, now = new Date()): string;
/** Whether `env` is past its `expires` at `now`. Never true without `expires`. */
export function isExpired(env: Environment, now = new Date()): boolean;
/** Both files → one. Local entries get `local: true`; expired ones dropped;
 * the local file's `domains`/`variables` are ignored. */
export function mergeEnvironmentFiles(shared: EnvironmentsFile, local: EnvironmentsFile | null, now?: Date): EnvironmentsFile;
/** One → both. Local entries (minus the `local` flag) go to the second
 * file with empty contract arrays; expired ones are pruned. */
export function splitEnvironmentFiles(merged: EnvironmentsFile, now?: Date): { shared: EnvironmentsFile; local: EnvironmentsFile };
/** E13. */
export function discoveryEnvironment(file: EnvironmentsFile, project: string): Environment | null;
/** Names → the environments of `project` that hold a non-empty value for them. */
export function providersByName(file: EnvironmentsFile, project: string): Record<string, string[]>;
/** One line for the panel: `via tsh prod-postgres · verified 2 h ago` /
 * `via command · unreachable: …` / `manual: <note>`. */
export function describeReach(reach: Reach, now?: Date): string;
```

`environmentsForProject` and `defaultEnvironment` are unchanged and keep
working on the merged file. `environmentValues` is unchanged.

`endOfDayIso` format: `2026-09-11T23:59:59+03:00`. Compute the offset
from `now.getTimezoneOffset()`; do not depend on a library.

---

## 4. Parts

Each part leaves the tree typechecking and the plugin rebuilt. Do them in
order. Run the gate at the end of each before starting the next.

### Part 1 — Schema, merge, expiry, gitignore

**Files:** `shared/src/environments.ts`, `shared/src/index.ts`,
`extension/src/lib/fsa-store.ts`, `extension/src/lib/storage-registry.ts`,
`plugins/enloop/validator/enloop-case.mjs` (`readEnvironments` and the
write in `case "environments"`).

1. Add the schema and helpers from section 3.
2. `fsa-store.ts`: `ENVIRONMENTS_LOCAL_FILE = "environments.local.json"`.
   `getEnvironments()` reads both with `tryReadJson` and returns
   `mergeEnvironmentFiles`. `saveEnvironments(file)` calls
   `splitEnvironmentFiles` and writes both; write the local file only when
   it has entries or already exists (do not litter folders that never used
   one — check with a `getFileHandle` inside try/catch).
3. `storage-registry.ts` `ensureGitignore`: add
   `"environments.local.json"` to `NEEDED`.
4. Validator `readEnvironments(dataDir)`: read both files, return
   `{ file, localFile, data: merged, known }`. `known` is true when the
   shared file parsed. Every writer in `enloop-case.mjs` that currently
   does `writeFileSync(env.file, JSON.stringify(data …))` goes through a
   new `writeEnvironments(env, data)` that splits and writes both files,
   creating the local file only when it has entries.
5. `npm run build:plugin` so `lib.mjs` carries the new exports.

**Gate 1.** In a scratch folder `$S` (under the session scratchpad, never
`/tmp`):

```bash
mkdir -p $S/test-cases && echo '{"name":"Shop"}' > $S/project.json
V=plugins/enloop/validator/enloop-case.mjs
node $V environments $S Shop --env local --set DOMAIN=http://localhost:3000
cat > $S/environments.local.json <<EOF
{"domains":[],"variables":[],"environments":[
 {"id":"env-tmp1","name":"pr-42","project":"Shop","domains":{"DOMAIN":"https://pr-42.shipyard.test"},"values":{},"expires":"2999-01-01T00:00:00Z"},
 {"id":"env-tmp0","name":"pr-41","project":"Shop","domains":{"DOMAIN":"https://pr-41.shipyard.test"},"values":{},"expires":"2000-01-01T00:00:00Z"}]}
EOF
node $V environments $S Shop
```

Assert: the print lists `local` and `pr-42`, and `pr-42` is marked
`(temporary, until 2999-01-01)`; `pr-41` is absent. Then
`node $V environments $S Shop --env local --set DOMAIN=http://localhost:3001`
rewrites; assert `environments.json` has no entry with `local` or
`expires`, and `environments.local.json` now holds only `pr-42`.
`npm run typecheck` passes.

### Part 2 — Validator: reach, temporary, production, `reach` command

**Files:** `plugins/enloop/validator/enloop-case.mjs`, new
`plugins/enloop/validator/reach.mjs` (plain Node, not bundled — it uses
`child_process` and `net`).

New flags on `environments … --env <name>`:

| Flag | Effect |
|---|---|
| `--temporary` | entry goes to the local file, `expires` = `endOfDayIso()` |
| `--until YYYY-MM-DD` | as above with that day; implies `--temporary` |
| `--production` / `--no-production` | sets/clears the flag |
| `--reach tsh --proxy H --db-service S [--db-user U] [--db-name N] [--db-protocol postgres\|mysql]` | sets reach, then probes (E10) |
| `--reach command --probe "<cmd>" [--db-address "<cmd>"]` | sets reach, then probes |
| `--reach manual --note "<sentence>"` | sets reach, no probe |
| `--reach none` | removes reach |
| `--lookup NAME="select …"` (repeatable) | sets `lookups[NAME]`; adds NAME to the variables contract; refuses non-select (E11) |
| `--tsh "<pasted tsh command line>"` | parses a pasted string into a `tsh` reach, see below |

`--tsh` parsing (the master pastes what the user gave, verbatim): accept
`tsh login --proxy=H` / `--proxy H`, `tsh db login S`, `tsh db connect S
--db-user U --db-name N`, `tsh proxy db S --db-user U --db-name N
[--port P]`, and combinations separated by `&&` or newlines. Take every
`--proxy`, the first positional after `db login|db connect|proxy db`,
`--db-user`, `--db-name`. Anything unparsed is kept in `note`. A string
that yields neither proxy nor service is an error naming what was found.

Print, per environment, after the existing value lines:

```
           reach    tsh prod-postgres as readonly@app via teleport.example.com — verified 2026-09-11T10:02:11+03:00
           reach    command — unreachable: exit 1: Connection refused
           reach    manual: VPN "Office", then psql -h db.internal
```

and `(temporary, until 2026-09-11)`, `(production)` on the env line.

**`reach` command:**

```
node enloop-case.mjs reach <folder> "<project>" [--env <name>]
```

Probes one environment (default: E13) or, with `--all`, every one with a
`tsh` or `command` reach. Prints one line per environment, exit 0 when all
probed are reachable, 1 otherwise:

```
REACHABLE     staging   tsh staging-postgres (tunnel opened on 127.0.0.1:54321, select 1 ok)
LOGIN NEEDED  prod      run: tsh login --proxy=teleport.example.com
UNREACHABLE   pr-42     command exited 1: Connection refused
UNPROBED      local     no reach recorded
UNPROBED      office    manual: VPN "Office", then psql -h db.internal
```

Writes `verifiedAt` / `verifyError` back (E10).

**`reach.mjs`** exports:

```js
export async function probeReach(reach, { cwd, timeoutMs = 20000 }) // → { ok, detail, needsLogin? }
export async function withTunnel(reach, { cwd, timeoutMs }, fn)     // opens, calls fn({host, port}), always closes
export function parseTshString(text)                                 // → partial reach or throws
export function isReadOnlySql(sql)                                   // E11
```

tsh probe, in order; each failure is the message:

1. `tsh` on PATH, else `tsh not installed` (`needsLogin: false`).
2. `tsh status --format=json`; non-zero exit or a `valid_until` in the
   past → `needsLogin: true`, detail `run: tsh login --proxy=<proxy>`.
3. `tsh db ls --format=json`; `dbService` not among `metadata.name` →
   `database service "<s>" not in tsh db ls (<names…>)`.
4. `withTunnel`: pick a free port with `net.createServer().listen(0)`,
   spawn `tsh proxy db --tunnel --port <p> <service> [--db-user U]
   [--db-name N]`; wait until a TCP connect to `127.0.0.1:<p>` succeeds
   (poll every 250 ms) or the process exits or timeout; then call `fn`;
   then `SIGTERM` the child.
5. Inside the tunnel: if `psql` (postgres) or `mysql` is on PATH, run
   `select 1` against `127.0.0.1:<p>` with the user/db name, 10 s timeout,
   `PGPASSWORD` unset (tsh handles auth). If the client is missing, the
   probe passes with detail `tunnel opened; no psql on PATH, query not
   run`.

command probe: `sh -c "<probe>"` with `cwd`, 20 s timeout; exit 0 is
reachable, else `command exited <code>: <last stderr line>`.

**A `tsh` shim for verification**, since the executing session has no
Teleport. Write it to the scratchpad, not the repo:

```bash
mkdir -p $S/bin && cat > $S/bin/tsh <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "status --format=json") [ "$TSH_LOGGED_IN" = 1 ] && echo '{"active":{"valid_until":"2999-01-01T00:00:00Z"}}' || exit 1 ;;
  "db ls") echo '[{"metadata":{"name":"staging-postgres"}},{"metadata":{"name":"prod-postgres"}}]' ;;
  "proxy db") port=$(echo "$@" | sed -n 's/.*--port \([0-9]*\).*/\1/p'); exec node -e "require('net').createServer(s=>s.end()).listen($port,'127.0.0.1');setInterval(()=>{},1e6)" ;;
  *) echo "shim: unknown $*" >&2; exit 2 ;;
esac
EOF
chmod +x $S/bin/tsh
```

**Gate 2.**

```bash
export PATH=$S/bin:$PATH
node $V environments $S Shop --env staging --set DOMAIN=https://staging.shop.test \
  --tsh 'tsh login --proxy=teleport.shop.test && tsh db connect staging-postgres --db-user readonly --db-name shop' --default
```
Assert with `TSH_LOGGED_IN` unset: the env line shows the reach, and
`verifyError` in `environments.json` starts with `run: tsh login`.
`TSH_LOGGED_IN=1 node $V reach $S Shop` prints `REACHABLE staging …`
and exits 0; the file now has `verifiedAt` and no `verifyError`.
`node $V environments $S Shop --env prod --set DOMAIN=https://shop.test --tsh 'tsh db connect prod-postgres'` sets `production: true`
without the flag being passed (name match). `--env pr-42 --temporary`
lands in the local file with today's `endOfDayIso`. `--lookup
QA_EMAIL="delete from users"` exits 1 with a message containing
`read-only`. `--reach command --probe 'exit 3'` records
`verifyError: "command exited 3"`. `node $V reach $S Shop --env staging` with the shim removed from PATH prints `UNREACHABLE staging tsh not installed`.

### Part 3 — Lint: a provided name must have a provider (E9)

**Files:** `shared/src/lint.ts`, `plugins/enloop/validator/enloop-case.mjs`
(`validate` and `write`), `npm run build:plugin`.

1. `LintOptions` gains `environmentProviders?: Record<string, string[]>`
   — name → environments (of the case's project) holding a non-empty
   value. Passed alongside `environmentNames` wherever that is passed; the
   validator computes it with `providersByName(merged, project)` where
   `project` is `--project` if given, else the document's `@project` after
   parsing (so compute it after the parse, inside `lintCase` via the
   option being a function is *not* wanted — instead the validator parses
   once with `parseCaseDocument` to learn the project, then lints).
2. New rule, in the block near line 308 where a variable without
   `Default:`/generator is checked. When `environmentsKnown`, the name is
   in `environmentNames`, and `environmentProviders[name]` is empty or
   absent: **error**
   `%NAME% is left to the environment, but no environment of this project has a value for it — the run would have to ask. Record one: enloop-case.mjs environments <folder> "<project>" --env <name> --set NAME=value, or run the environment master (/enloop:setup environments).`
   When some but not all of the project's environments provide it:
   **warning** `NAME is empty in <env1>, <env2> — a run there will ask.`
   Domains get the same two rules, worded for addresses.
3. `cold.fromEnvironment` keeps its meaning; add `cold.unprovided:
   string[]` for the error case so the `write` command can print it in
   its refusal summary the way it prints other errors.

**Gate 3.** With the scratch folder from Gate 2 (staging has `DOMAIN`,
nothing has `QA_EMAIL`): `node $V environments $S Shop --variable QA_EMAIL`,
then validate a case (take `brief`'s minimal case and add a
`# Variables` section with `## QA_EMAIL` and a description only) with
`--data-dir $S --project Shop`: exit 1, one error naming `QA_EMAIL` and
the master. `node $V environments $S Shop --env staging --set QA_EMAIL=qa@shop.test`
→ validate exits 0 with a warning naming `local`, `prod`, `pr-42`.
Without `--data-dir` the old behaviour holds (no error). `npm run
typecheck` and `build:plugin` clean; the committed `lib.mjs` diff is only
the new code.

### Part 4 — Panel: temporary environments and read-only reach

**Files:** `extension/src/sidepanel/screens/EnvironmentsScreen.tsx`,
`CaseDetailScreen.tsx`, `extension/src/lib/workspace-store.ts` (no change
expected beyond types).

1. **Picker** (CaseDetailScreen): options come from
   `environmentsForProject(merged, project)` as today; a temporary one
   renders as `pr-42 · until Sep 11`, a production one as `prod ·
   production`. A remembered selection whose environment expired falls
   back to the default exactly as a deleted one does today.
2. **EnvironmentsScreen**: below the shared list, a **Temporary** section
   with its own explanatory line: *"This machine only, never committed.
   Each one expires; expired ones disappear."* Same card as above with two
   extra controls: an expiry date input (`<input type="date">`, writes
   `endOfDayIso(day)`) and no `default` toggle (a temporary environment is
   never the default). An **Add temporary** button creates one with
   `expires = endOfDayIso()`, `local: true`, project = the storage's
   project name when known else empty.
3. **Reach**, on every card that has one: one read-only line from
   `describeReach`, with a title attribute holding `verifyError` when
   present. Below it, muted: *"Set from the repo with /enloop:setup
   environments; the panel never opens tunnels."* No editing of reach in
   the panel (E1).
4. Remove the doc-comment sentence in `EnvironmentsScreen.tsx` that says
   per-PR deployments "deliberately have no home on this screen" — they do
   now.
5. `production` toggle on shared cards: a small checkbox labelled
   *production*, saved like `default`.

**Gate 4.** `npm run typecheck && npm run build` clean. Load the
extension against the scratch folder from Gate 2 (or the fixture folder
`evals/fixture-app/enloop.md` with the files copied in): Settings →
Environments shows staging with the reach line and `pr-42` under
Temporary; changing its date rewrites `environments.local.json` only
(check `git status` shows no change to `environments.json`); the case
picker offers `pr-42 · until …`. Set `expires` in the file to the past,
reopen: it is gone from both screens and from the file after the next
save.

### Part 5 — Skills: the environment master and the gate

**Files:** new `plugins/enloop/references/environment-master.md`;
`plugins/enloop/skills/setup/SKILL.md`; `plugins/enloop/references/authoring.md`;
`plugins/enloop/skills/full/SKILL.md` and `quick/SKILL.md` (one paragraph
each); `plugins/enloop/hooks/confirm-scope.mjs` unchanged.

**`environment-master.md`** — the dialogue, written for a weak model,
imperative, in this order:

0. Resolve `$ENLOOP_PLUGIN`, the data folder and the project name exactly
   as `authoring.md` §1 does. Print `environments` for the project.
1. **Local, from the repo, without asking.** The `rg` block from setup
   step 3 (moved here verbatim). Record `local` with what was found. If
   nothing was found, record `local` with `DOMAIN=http://localhost:3000`
   and say it was a guess, in the report, not in a question.
2. **Then the loop.** Ask one closed question:
   *"Add another environment? Name it (staging, prod, …) and paste how
   you reach it — a `tsh` line, a command, or a sentence — or say
   done."* Repeat until "done". For each answer:
   - If the text contains `tsh` → `--tsh "<text>"`. Ask nothing else.
   - If it is a URL with a scheme → that is `DOMAIN` for the new
     environment; if it carries a password (`user:pass@`), drop the
     password and say so (E3).
   - If it is a command (starts with a program name, contains no spaces
     around `:` like prose) → `--reach command --probe "<text>"`.
   - Otherwise → `--reach manual --note "<text>"`.
   - When the answer gave no address, ask once: *"What is `DOMAIN` for
     <name>?"* Then record. Never ask a third question per environment.
   - Name matching `/\bprod(uction)?\b/i` → `--production`, and say so.
   - The word "temporary", "preview", "PR" or "branch" in the answer, or a
     hostname that contains a number or a branch-like token
     (`pr-42`, `feat-`), → `--temporary`; ask *"Until when? (today)"* only
     if the user did not say.
3. **Probe** happens inside `environments … --reach` (E10). Read its
   print. `LOGIN NEEDED` is the one thing the agent cannot do: show the
   exact `tsh login` line and tell the user to run it with `! tsh login
   …` in this session, then re-run `enloop-case.mjs reach`. Do not wait
   silently; do not retry on your own more than once.
4. **Default.** If no environment is default, mark staging, else local,
   never prod, and say which (this is already the rule in setup step 3;
   keep the sentence).
5. **Report**: one block — each environment, its addresses, its reach
   and probe result, which is default, which are temporary and until
   when, every empty value as a hole, and the one line to run for any
   `LOGIN NEEDED`.

**`setup/SKILL.md`**: step 3 becomes "Follow
`../../references/environment-master.md` in full" plus the README and
rules-file paragraphs that step 3 already has (they stay in setup, not in
the master). Add at the top under `$ARGUMENTS`: *"`environments` as the
argument runs only step 3 and step 9's environments lines — the way to
add or repair environments after setup."*

**`authoring.md` §2b**: after the `environments` print, add the gate
(E8):

> If it prints `environments (none for <project>)`, stop. Ask one closed
> question: *"No environments are recorded for <project>. Set them up now
> (local from the repo, then staging/prod from what you paste), or
> continue with local only?"* On "set up", follow
> `environment-master.md` in full, then continue here. On "local only",
> record local from the repo as the master's step 1 does and continue.
> Never continue without recording at least local: a case with no
> environment has no `@locations:` and no address to default to.

And in §8 (write the case), where variables are declared, one sentence:
a variable left to the environment must have a value in at least one
environment *now* — `validate --data-dir` refuses it otherwise (E9); the
fix is `environments … --set`, from a seed or fixture, or a lookup (Part
6), never a blank.

**`full/SKILL.md`, `quick/SKILL.md`**: one paragraph under "Then follow
the procedure": *"Environments come first. If the project has none,
§2b asks whether to set them up before any source is read. That is the
intended order — an address written before the deployments are known is
an invented one."*

**Gate 5.** Read every changed skill file end to end once. Run
`node evals/run.mjs --models sonnet --keep` if the `claude` CLI is
available (see `evals/README.md`); the fixture folder
`evals/fixture-app/enloop.md` has no `environments.json`, so the run must
show the gate question being asked — check the kept transcript. If the
CLI is not available, say so in the status line and do a dry read
instead: follow `environment-master.md` by hand against the scratch
folder with the tsh shim, executing each command it names, and confirm
every command line in the file runs as written.

### Part 6 — Lookups

**Files:** `plugins/enloop/validator/enloop-case.mjs` (`lookup` command),
`reach.mjs`, `authoring.md` §7/§8, `environment-master.md` (one
paragraph).

```
node enloop-case.mjs lookup <folder> "<project>" [--env <name>] (--variable NAME | --sql "select …") [--record] [--production]
```

- Resolves the environment (E13). `--variable NAME` uses
  `lookups[NAME]`; `--sql` runs the given text. E11 applies to both.
- Production requires `--production`; `--record` on production is refused
  with a message saying the value stays with the tester (E7).
- Runs through `withTunnel` for `tsh`; for `command` reach, runs the
  probe then `dbAddress` to learn `host:port`, refusing when `dbAddress`
  is absent; `manual` is refused: `manual reach cannot run a query —
  record the value with --set`.
- Runs the SQL with `psql -At -c` (or `mysql -N -B -e`), 10 s timeout.
  Prints `VALUE  NAME=<first column of first row>`; `EMPTY  NAME` with
  exit 1 when no row.
- `--record` writes the value into the environment's `values` (E6 split
  applies), prints `WROTE`.
- `lookup … --all --record` runs every `lookups` entry of the environment.

`authoring.md` §8, variables: when a value differs per deployment and the
environment has a `tsh` or `command` reach, prefer recording a lookup over
a literal: `environments … --env staging --lookup QA_EMAIL="select email
from users where role='admin' and deleted_at is null order by id limit 1"`
then `lookup … --variable QA_EMAIL --record`. The SQL comes from the
repo's schema and seeds, read in this session, like everything else.

`environment-master.md`: after the loop, if any environment has a
runnable reach and the contract already has variables with no value
there, offer once: *"Try to find <NAME, …> on <env> with a query?"* and
on yes derive the SQL from the schema.

**Gate 6.** Extend the shim so `psql` exists on PATH and prints
`qa@shop.test` for any `-c` (write it like the tsh shim). With
`TSH_LOGGED_IN=1`: `node $V lookup $S Shop --env staging --sql "select email from users limit 1"`
prints `VALUE  qa@shop.test` (an ad-hoc `--sql` has no name, so no
`NAME=` prefix), and the same line with `--record` exits 1 with
`--record needs --variable`. Then
`node $V environments $S Shop --env staging --lookup QA_EMAIL="select email from users limit 1"` and
`node $V lookup $S Shop --env staging --variable QA_EMAIL --record`
→ `WROTE`, and `environments.json` has `QA_EMAIL` under staging.
`node $V lookup $S Shop --env prod --variable QA_EMAIL` exits 1 naming
`--production`; with `--production --record` exits 1 saying the value is
not recorded; with `--production` alone prints `VALUE`. `--sql "select 1;
drop table users"` exits 1 before any tunnel is opened (assert the shim's
`proxy db` branch never ran — have it touch `$S/tunnel-opened` and check
the file is absent).

### Part 7 — Docs and changelog

**Files:** `docs/extension.md` "Environments and domains",
`docs/skills.md` "Setting up a repo" and "What the skills need to know",
`docs/case-format.md` "Variables: everything else, resolved by Enloop",
`plugins/enloop/references/data-folder.md` (layout block gains
`environments.json` and `environments.local.json`), `CHANGELOG.md`.

Write in the voice the docs already use: what the reader does and sees,
why, no feature lists. Cover: environments come before cases and the
skills ask once; temporary environments and the local file; what a reach
is and that the panel only shows it; `tsh login` is the user's step; a
provided variable must have a value somewhere; lookups, and that
production never records.

`CHANGELOG.md` under Unreleased, two entries under *Writing cases* and
one under *Running cases*, in the existing style (bold lead, then one
paragraph).

**Gate 7.** `npm run typecheck && npm run build:plugin && npm run build`
clean; `git status` shows no generated file outside `lib.mjs` and
`grammar.md`; `git diff --stat` matches the files this plan names plus
`lib.mjs`. Update the status line at the top of this file to
*built <date>; uncommitted* and list anything cut or changed.

---

## 5. Out of scope, on purpose

- Browser-session-only environments (E5 says today is the unit).
- Editing reach in the panel (E1).
- Any transport the three in E2 cannot express — ssh and kubectl are
  `command`.
- The daemon and the backend branch: they keep reading
  `environments.json`; the local file is a per-machine fact and stays
  out of `enloop export` until the backend plan says otherwise.
- API-based lookups (`curl` against an admin API). A `command` reach with
  a `probe` covers the reachability half; querying comes later if SQL
  turns out not to be enough.
- Network-capture discovery from the extension (reading ids out of XHR
  responses on an admin page). Separate plan if wanted.
