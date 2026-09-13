# The environment master

<!-- Shared by the setup skill (step 3, and the whole of `/enloop:setup
     environments`) and by authoring.md §2b when a project has no
     environments yet. One dialogue, written to be followed line by line:
     local is derived from the repo without a question, every other
     deployment comes from what the user pastes, and the probe of how the
     agent reaches its data runs before anything is written. The skill that
     sent you here continues where it left off when the report is done. -->

Environments are recorded **before** any case is written, because a case
carries addresses and values, and an address written before the
deployments are known is an invented one. This file records them. Follow
the steps in order; do not skip a step because it looks done.

Two rules hold throughout. **No secret is ever written**: a `tsh` reach
holds certificates and needs none; a pasted URL or connection string that
carries a password is recorded without it, and the report says so. **The
user answers at most two questions per environment**: the paste, and the
address when the paste did not give one. Everything else — whether it is
production, whether it is temporary, whether it is reachable — is decided
from what was pasted and stated in the report, not asked.

## 0. Resolve the plugin, the folder and the project

The same three paths `authoring.md` §1 resolves, in the same way. If the
skill that sent you here already settled them — setup confirmed the
project name in its step 2, authoring resolved all three in its §1 — use
those values and only run the last line.

```bash
ENLOOP_PLUGIN="<the plugin root: the directory one level above the references/ folder holding this file>"
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" version
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" data-folder
```

`version` failing means the plugin is installed wrong: say so and stop.
`data-folder` prints `RESOLVED <path>` — that path is the data folder.
`AMBIGUOUS` or `NONE` mean ask, the way `data-folder.md` beside this file
says to; never guess a folder.

The project name, in this order: `$ENLOOP_PROJECT` if set; the `Project:`
line of the `## Enloop` section in the repo's `AGENTS.md` or `CLAUDE.md`;
else the `name` in `package.json` / `composer.json` / `pyproject.toml`
(last path segment, no scope), else the repo directory name, title-cased —
and say in the report that it was derived.

Set both once, so every line below is pasteable as written:

```bash
DATA_DIR="<the path RESOLVED printed>"
PROJECT="<the project name>"
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT"
```

Read the print. `environments (none for <project>)` means nothing is
recorded yet and every step below applies. An `env` line per environment
means some are: keep them, and treat step 1 as filling `local` rather than
creating it. The `domains` line is the contract — the names every
environment gives an address for; `(none declared)` means `DOMAIN` will be
declared by the first `--set DOMAIN=` below.

## 1. Local, from the repo, without asking

The dev server's address is in the repo. Read it there — a remembered
address is an invented one — and record it before any question is asked.

```bash
rg -n -i '(APP|BASE|PUBLIC|SITE|API|ADMIN|FRONTEND|BACKEND)_?URL|HOST(NAME)?=' .env.example .env.* 2>/dev/null
rg -n -i 'baseURL|baseUrl' playwright.config.* cypress.config.* 2>/dev/null
rg -n -i 'ports:|hostname|VIRTUAL_HOST|\.localhost' docker-compose*.yml compose*.yml 2>/dev/null
rg -n -i 'staging|production|prod\.|demo\.' README.md fly.toml vercel.json netlify.toml app.yaml 2>/dev/null | head -20
```

From that, decide:

- **The domain names.** `DOMAIN` for the app under test — the name every
  case uses without declaring it. A second name only for a host that is
  genuinely separate — an admin console on its own host, a second tenant,
  the site the flow starts from. A path under the same host is a route,
  not a domain.
- **The local address of each.** The dev server port from `.env.example`,
  the compose file or the Playwright config.

Record `local` with what was found, one `--set` per domain name:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT" --env local --set DOMAIN=http://localhost:3000
```

With a second host, add it to the same line:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT" --env local --set DOMAIN=http://localhost:3000 --set ADMIN=http://localhost:3001
```

If the four searches found **nothing**, record `local` with
`DOMAIN=http://localhost:3000` exactly as the first line above and say in
the report — not in a question — that the port was a guess. The fourth
search's hits (staging, production, demo hosts in the README or deploy
config) are not recorded here; they are the addresses to propose in
step 2 when the user names those environments.

## 2. The loop: every other environment, from what the user pastes

Ask this one question, verbatim, and wait:

> Add another environment? Name it (staging, prod, …) and paste how you
> reach it — a `tsh` line, a command, or a sentence — or say done.

Repeat it after every environment is recorded, until the answer is
"done". Never proceed on an empty answer; ask again. For each answer,
take the name from it (`staging`, `prod`, `pr-42`, …; the first word when
the answer starts with one) and decide the reach from the rest, in this
order — the first rule that matches wins:

1. **The text contains `tsh`** → pass the whole pasted text, verbatim, as
   `--tsh`. Ask nothing about it: proxy, service, user and database are
   parsed out of it, and anything unparsed is kept in the reach's note.

   ```bash
   node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT" --env staging --tsh 'tsh login --proxy=teleport.example.com && tsh db connect staging-postgres --db-user readonly --db-name app'
   ```

   If the command exits 1 saying the string yields neither proxy nor
   service, show that message and ask the question again for the same
   environment — that is the same question, not a new one.

2. **The text is a URL with a scheme** (`https://…`, `http://…`) → that is
   `DOMAIN` for the new environment. If it carries a password
   (`https://user:pass@host`), record the URL without the `user:pass@`
   part and say in the report that the password was dropped. A database
   URL (`postgres://`, `postgresql://`, `mysql://`) is not an address: keep
   only its host and database name, as a manual reach, and drop the rest.

   ```bash
   node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT" --env staging --set DOMAIN=https://staging.example.test
   ```

   ```bash
   node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT" --env staging --reach manual --note "database db.staging.example.test/app; the password stays with the tester"
   ```

3. **The text is a command** — it starts with a program name (`ssh`,
   `kubectl`, `nc`, `curl`, `pg_isready`, `./scripts/…`) and reads like a
   shell line, not like a sentence (no spaces around a `:`) → a `command`
   reach whose probe is the text, verbatim. The command must exit 0 when
   the deployment's data is reachable; say that in the report if the text
   looks like something else.

   ```bash
   node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT" --env staging --reach command --probe "pg_isready -h db.staging.internal -p 5432"
   ```

4. **Anything else** — a sentence, a VPN name, "ask ops" → a `manual`
   reach with the text as the note, verbatim. It is never probed.

   ```bash
   node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT" --env office --reach manual --note "VPN \"Office\", then psql -h db.internal"
   ```

Then two flags, decided from the answer and never asked:

- **Production.** The name matches `prod` or `production` as a word
  (`prod`, `Production`, `prod-eu`; not `product`), or the user said it is
  production → add `--production` to the line, and say so in the report.
  A name that does not match but the user called production gets the flag
  the same way. To clear a wrong flag: `--no-production`.
- **Temporary.** The answer contains the word `temporary`, `preview`, `PR`
  or `branch`, or the hostname carries a number or a branch-like token
  (`pr-42`, `feat-`, `-preview-`) → add `--temporary`, which puts the
  environment in `environments.local.json`, git-ignored, expiring at the
  end of today. If the user named a day, use `--until YYYY-MM-DD` instead;
  if not, ask *"Until when? (today)"* once — folded into the address
  question below when that is needed too, so it stays one question.

  ```bash
  node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT" --env pr-42 --set DOMAIN=https://pr-42.shipyard.example.test --temporary
  ```

  ```bash
  node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT" --env pr-42 --set DOMAIN=https://pr-42.shipyard.example.test --until 2026-09-18
  ```

**The address.** A `tsh` line, a command and a sentence say how to reach
the data, not where the app is. When the answer gave no `https://` address,
ask once:

> What is `DOMAIN` for staging?

— naming every domain the contract declares when there is more than one
(*"What are `DOMAIN` and `ADMIN` for staging?"*), and carrying the expiry
when a temporary environment did not say (*"What is `DOMAIN` for pr-42,
and until when? (today)"*). Before asking, check
step 1's fourth search: a README or deploy config that names the staging
host is the answer, and then the question is *"Is `DOMAIN` for staging
`https://staging.example.test` (from README.md)?"*. Record the answer on
the same environment with `--set`; an answer of "don't know" leaves it
empty, listed as a hole in the report. **Never ask a third question about
one environment.** Combine what you have into one line when you can:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT" --env prod --set DOMAIN=https://shop.example.com --tsh 'tsh db connect prod-postgres --db-user readonly --db-name app' --production
```

Then ask the loop question again.

## 3. Read the probe

Adding a `tsh` or `command` reach probes it once, inside the command you
just ran, and writes the result either way — a VPN that is down today is
not a reason to lose what the user typed. Read the `reach` line in the
print:

```
           reach    tsh staging-postgres as readonly@app via teleport.example.com — verified 2026-09-11T10:02:11+03:00
           reach    command — unreachable: exit 1: Connection refused
           reach    tsh prod-postgres as readonly@app via teleport.example.com — unreachable: run: tsh login --proxy=teleport.example.com
```

`verified <time>` is reachable; nothing to do. `unreachable: <why>` with
any other reason is recorded as it is and goes in the report as it is —
do not retry, do not edit the reach to make it pass.

`unreachable: run: tsh login …` is the one thing the agent cannot do:
Teleport login opens a browser and needs the user's credentials. Show the
user the exact `tsh login` line from the print and tell them to run it in
this session, prefixed with `!` so it runs in their shell:

> Run `! tsh login --proxy=teleport.example.com` here, then say done.

Wait for their answer. Then probe again, once:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" reach "$DATA_DIR" "$PROJECT" --env staging
```

It prints one line whose first word is the verdict, and writes it back:

```
REACHABLE     staging   tsh staging-postgres (tunnel opened on 127.0.0.1:54321, select 1 ok)
LOGIN NEEDED  staging   run: tsh login --proxy=teleport.example.com
UNREACHABLE   staging   command exited 1: Connection refused
UNPROBED      staging   no reach recorded
```

`REACHABLE` — continue. `LOGIN NEEDED` again — show the same line once
more and continue with the loop; do not wait silently, do not retry a
third time on your own. `UNREACHABLE` — record it in the report as
printed. `UNPROBED` — the environment has no reach or a `manual` one;
nothing was probed and nothing is wrong. To probe every environment at
once, at the end:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" reach "$DATA_DIR" "$PROJECT" --all
```

## 4. Mark the default

The default environment is the one cases are normally run against: its
addresses lead every case's `@locations:` line and fill a declared
domain's `Default:`. If the print shows no `(default)`, mark one — staging
when there is one, else local, never prod unless the user said so — and
say which in the report:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT" --env staging --default
```

A temporary environment is never the default.

## 5. Look up the values the reach makes reachable

The contract's `variables` line may already name values no environment
holds — a QA account, a tenant id — from earlier setup or from a case that
declared them. When an environment's probe said reachable (its reach is
`tsh` or `command`, not `manual`) and it has an empty value for such a
name, offer once, in one closed question naming them:

> Try to find `QA_EMAIL`, `TENANT_ID` on staging with a query?

On yes, derive the SQL from the repo's schema and seeds, read in this
session — the table and column names come from a migration or a model
file, like every other specific — and record it as a lookup, then run it:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT" --env staging --lookup QA_EMAIL="select email from users where role='admin' and deleted_at is null order by id limit 1"
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" lookup "$DATA_DIR" "$PROJECT" --env staging --variable QA_EMAIL --record
```

`--lookup` accepts only a query that begins with `select` or `with` and
holds one statement; anything else is refused before any tunnel opens.
`lookup` prints `VALUE  QA_EMAIL=<value>` then `WROTE` when the value went
into the environment, or `EMPTY  QA_EMAIL` with exit 1 when the query
returned no row — leave the hole and say so. On a production environment
`lookup` requires `--production` and refuses `--record` outright: a value
found on prod stays with the tester and is never written to a file. On a
"no", or when no environment qualifies, skip this step without comment.

## 6. Report

Print the environments one last time, then one block, and only one:

```bash
node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" environments "$DATA_DIR" "$PROJECT"
```

- Each environment on its own line: its addresses and where each came
  from (the repo file, or "pasted"), its reach and the probe's verdict as
  printed, `(default)` on the one that is, `(production)` on those that
  are, `(temporary, until <day>)` on those that are and that they live in
  `environments.local.json`, which is not committed.
- Every empty address or value, as a hole, with the line that fills it:
  `enloop-case.mjs environments "$DATA_DIR" "$PROJECT" --env <name> --set NAME=value`,
  or the panel's Environments screen.
- Every `LOGIN NEEDED`, with the one line to run:
  `tsh login --proxy=<proxy>`, then `enloop-case.mjs reach "$DATA_DIR" "$PROJECT" --env <name>`.
- Every password dropped from a paste, and every value that was a guess
  (the local port when the repo said nothing).

Then return to the skill that sent you here.
