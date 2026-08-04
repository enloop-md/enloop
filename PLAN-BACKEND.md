# Enloop backend — implementation plan

Status: **plan, not yet started.** Written 2026-07-29.

This document is the execution spec for moving Enloop from a File System
Access-only Chrome extension to a hosted, multi-user product, without losing
the local-folder mode and without duplicating the case grammar.

Read this top to bottom before writing code. Sections 1–7 are decisions and
contracts; section 15 is the phased task list to execute. Section 17 designs
environments, which is deliberately *not* in this pass but is specified because
it changes the run record and variable resolution.

`PLAN-TOOLING.md` is the sibling plan for the skills and the extension
workflow. Three items there need columns this schema does not have yet — a
run-level comment, a quick/full run tier, and captured console output — and
each is flagged at its point of use rather than folded in here. The first two
are now built client-side, so `run.comment` and `run.tier` are settled
requirements for §4.4; console capture is not built and not decided.

---

## 1. Goal

Today the extension is the whole product: `FsaDataStore` reads and writes a
folder the user picked, and the Claude Code skills write into that same folder
from another repo. There is no account, no sharing, no server.

After this work:

- A Symfony/Postgres backend owns cases, versions, runs and free runs for
  teams, behind email+password auth.
- Data is organized as **organization → project → folder → case**, where a
  folder may also carry suite behaviour.
- The extension talks to that backend by default, and still works entirely
  offline against a local folder when the user chooses that mode.
- A Vue console (options API) manages the library, versions, runs and org
  settings in a full browser tab, where the side panel is too narrow.
- The `/enloop:write` and `/enloop:check` skills reach the same data over HTTP
  with an API token instead of guessing at directory levels.

### Non-goals for this pass

- SSO / OAuth / SAML. Email+password only (section 6 leaves room).
- Per-project ACLs. Access is org-wide in this pass; the schema is shaped so
  project-level membership is an additive migration (section 5.4).
- Real-time collaboration, presence, live cursors.
- Screenshot/video capture. The `attachment` table and object-storage path are
  designed but not built (section 4.6).
- Moving run *execution* into the web app. Running a case needs page access;
  that stays in the extension.

---

## 2. Decisions

Locked in before planning; do not relitigate mid-execution.

| # | Decision | Consequence |
|---|---|---|
| D1 | **Symfony 7.2 + Doctrine ORM 3 + Postgres 16 + Vue 3 (options API)** | Server is PHP, so `shared/src/markdown.ts` cannot be reused server-side. See section 3 — this is the biggest structural consequence in the plan. |
| D2 | **Keep both storage modes; backend is the default** | `DataStore` gains a second implementation (`ApiDataStore`); `FsaDataStore` stays. The UI needs a mode picker and a capability flag set (section 8). |
| D3 | **Markdown stays the source of truth, stored as `TEXT` in its own table** | `case_version.body` holds the exact bytes a human or a skill wrote. Derived header fields are denormalized columns for listing/search. No files, no blob store for markdown. |
| D4 | **Skills reach data over HTTP with an API token, via a thin Node CLI** | `references/data-folder.md`'s detection dance is replaced by `enloop` CLI calls. The FS path stays supported as a fallback for local mode. |
| D5 | **Semantic parsing stays in TypeScript; PHP only indexes headers** | Section 3. PHP implements ~120 lines of header/outline extraction, never the full grammar. Parity is enforced by a shared fixture corpus. |
| D6 | **Opaque DB-backed bearer tokens, not JWT** | One mechanism for browser sessions and CLI tokens, instant revocation, no key rotation, no refresh-token dance. Costs one indexed lookup per request (cached). |

---

## 3. The parsing split (read this first)

`shared/src/markdown.ts` is 709 lines and the README declares its doc comment
to be *the* spec for the case grammar. Porting it to PHP would create a second
spec that silently drifts. So it is not ported.

### 3.1 What the server genuinely needs

Two things, and both are shallow:

1. **Index fields**, so it can list and search cases without shipping every
   body to the client: `title`, `description`, `tags`, `author`, `project`,
   `formatVersion`, `changeNote`, `stepCount`, `stepTitles`.
2. **Step count/ids for a run**, so `run_step` rows can exist as real rows.

Step ids are positional — `parseOneStep` assigns `step-${index + 1}`
(`shared/src/markdown.ts:337`). So "the ids of a document's steps" is
mechanically "count the `## ` headings inside the `# Steps` section". No step
internals — `Selector:`, `Where:`, `### Expected`, `### Note`, fenced scripts —
are ever needed server-side.

### 3.2 What stays in TypeScript, client-side

- Full `parseCaseDocument`: every step field, variables, dependencies,
  prerequisites.
- `buildRunSource` (suite prep merging) — the extension has the case body and
  the suite body and merges locally.
- `resolveVariableValues` + `substituteVariables` — generators like `page-url`
  and `page-domain` read the active tab, which only the extension can do.
- `renderRunReport` / `renderRunFeedback`.

The three writers are all JS/TS — the extension, the Vue console, and the Node
CLI — so all three import `@tcm/shared` and produce identical text.

### 3.3 Run creation is therefore client-composed

`POST /runs` sends the **already-merged, already-substituted** body as
`frozenBody`, plus the resolved `variableValues`. The server:

1. Stores `frozenBody` verbatim in `run.frozen_body` — the immutable artifact,
   exactly what `runs/<id>/case.md` is today.
2. Counts steps with its own indexer and creates `run_step` rows `step-1..N`.
3. **Rejects the request if its own count disagrees with the client's
   `stepIds` length** (HTTP 422). Cheap integrity check that catches both a
   client bug and a truncated upload.

The server never re-derives step semantics. It cannot disagree with the client
about what a step *means*, only about how many there are.

### 3.4 PHP indexer scope and parity harness

`server/src/Markdown/CaseIndexer.php` — one class, one public method:

```php
final class CaseIndexer
{
    public function index(string $body): CaseIndex;  // ~120 lines
}
```

`CaseIndex` is a readonly DTO: `title`, `description`, `tags`, `author`,
`project`, `formatVersion`, `changeNote`, `stepCount`, `stepTitles`.

Rules it must reproduce, taken from the grammar doc comment:

- The first `# ` heading is the title; everything else is one heading level
  deeper than naive reading suggests.
- Directly under the title, optional and in any order: `@version`, `@author`,
  `@project`, `Tags: a, b`, `Change note: ...`. First line that matches none of
  these ends the header block.
- Description is the free text after that header, up to the first `# ` section.
- Top-level sections are `# Variables`, `# Dependencies`, `# Prerequisites`,
  `# Steps`.
- Inside `# Steps`, each `## ` heading is one step, in document order.
- Missing `@version` defaults to `CURRENT_FORMAT_VERSION`.
- `\r\n` is normalized to `\n` before anything else.
- A fenced code block's contents are never scanned for headings (a
  `## ` line inside a fence is not a step — guard against this explicitly;
  it is the most likely parity bug).

**Parity harness** — the mechanism that keeps D5 safe:

- `shared/test-fixtures/cases/*.md` — corpus of case documents. Seed it from
  `private/test-cases/**/versions/*.md` plus hand-written edge cases: no
  header lines at all, tags with odd spacing, a `##` inside a fence, CRLF, a
  suite doc with no steps, unicode titles, empty description.
- `shared/test-fixtures/cases/expected/<name>.json` — the expected `CaseIndex`
  fields. **Generated from the TS parser** (`npm run fixtures:generate -w
  shared`), committed, and reviewed in diffs.
- `shared/test/indexer-parity.test.ts` asserts the TS parser still produces
  each committed JSON.
- `server/tests/Markdown/CaseIndexerParityTest.php` walks the same directory
  and asserts `CaseIndexer` produces the same JSON.

CI runs both. Changing the grammar means regenerating fixtures, which fails the
PHP test until the indexer is updated — the drift becomes a build error instead
of a mystery.

---

## 4. Data model

Postgres 16. All ids `uuid` (v7 preferred for index locality — use
`symfony/uid` `UuidV7`). All timestamps `timestamptz`. Soft delete only where
noted; everything else is hard-deleted or archived.

### 4.1 Identity and tenancy

```
user
  id uuid pk
  email citext not null unique          -- CREATE EXTENSION citext
  password_hash text not null           -- argon2id via Symfony PasswordHasher
  name text not null default ''
  email_verified_at timestamptz null
  is_active boolean not null default true
  last_login_at timestamptz null
  created_at, updated_at timestamptz not null

organization
  id uuid pk
  slug text not null unique             -- url-safe, immutable after create
  name text not null
  created_by uuid fk user null on delete set null
  created_at, updated_at

org_membership
  id uuid pk
  organization_id uuid fk organization on delete cascade
  user_id uuid fk user on delete cascade
  role text not null                    -- owner|admin|member|viewer
  created_at
  unique (organization_id, user_id)
  index (user_id)

invitation
  id uuid pk
  organization_id uuid fk organization on delete cascade
  email citext not null
  role text not null
  token_hash text not null unique       -- sha256 of the emailed secret
  invited_by uuid fk user null on delete set null
  expires_at timestamptz not null
  accepted_at timestamptz null
  accepted_by uuid fk user null
  created_at
  index (organization_id, email)

api_token
  id uuid pk
  user_id uuid fk user on delete cascade
  organization_id uuid fk organization null on delete cascade   -- null = all user's orgs
  name text not null                    -- "laptop CLI", "session: Chrome"
  type text not null                    -- session|api
  token_prefix text not null            -- first 8 chars, shown in UI lists
  token_hash text not null unique       -- sha256(secret); secret shown once
  scopes jsonb not null default '[]'    -- reserved; empty = full user rights
  expires_at timestamptz null           -- session: +14d sliding; api: null
  last_used_at timestamptz null
  revoked_at timestamptz null
  created_at
  index (user_id, revoked_at)

password_reset
  id uuid pk
  user_id uuid fk user on delete cascade
  token_hash text not null unique
  expires_at timestamptz not null       -- +1h
  used_at timestamptz null
  created_at
```

### 4.2 Library structure

```
project
  id uuid pk
  organization_id uuid fk organization on delete cascade
  slug text not null
  name text not null
  description text not null default ''
  archived boolean not null default false
  created_by uuid fk user null
  created_at, updated_at
  unique (organization_id, slug)

folder
  id uuid pk
  project_id uuid fk project on delete cascade
  parent_id uuid fk folder null on delete cascade
  name text not null
  slug text not null
  path text not null                    -- materialized: '/api/auth/' (slugs)
  position int not null default 0
  suite_body text null                  -- suite.md content; non-null => suite
  suite_updated_at timestamptz null
  archived boolean not null default false
  created_at, updated_at
  unique (project_id, parent_id, slug)
  index (project_id, path)
```

**Suites are folders.** Today a suite is a directory holding `suite.md` plus
case subdirectories, one level only (`fsa-store.ts:82`). Unifying it with
generic folders removes a second tree concept. A folder whose `suite_body` is
non-null behaves as a suite for the cases inside it.

Inheritance rule for v1: **a case inherits from its nearest ancestor folder
with a `suite_body`, and only that one.** Merging multiple ancestors is
deliberately deferred (section 16, Q1) because `buildRunSource` has ordering
semantics — prep steps prepend, variables append, case wins on name clash —
that get ambiguous with several suites in play.

```
test_case
  id uuid pk
  project_id uuid fk project on delete cascade
  folder_id uuid fk folder null on delete set null
  public_id text not null               -- 'sync-a-contact-fd11549b', FS parity
  title text not null                   -- denormalized from current version
  project text not null default ''      -- @project, denormalized; search/filter
  description text not null default ''
  tags jsonb not null default '[]'
  current_version_id uuid fk case_version null   -- deferrable, set after insert
  current_version_number int not null default 0
  archived boolean not null default false
  created_by uuid fk user null
  created_at, updated_at
  unique (project_id, public_id)
  index (project_id, archived, title)
  index (folder_id)

case_version
  id uuid pk
  case_id uuid fk test_case on delete cascade
  number int not null                   -- 1,2,3... == v1.md, v2.md
  body text not null                    -- THE source of truth, verbatim
  format_version text not null
  author text not null default ''
  project text not null default ''
  change_note text not null default ''
  title text not null                   -- indexer output, for history views
  description text not null default ''
  tags jsonb not null default '[]'
  step_count int not null
  step_titles jsonb not null default '[]'
  created_by uuid fk user null
  created_at
  unique (case_id, number)
```

`case_version` rows are **immutable and append-only**, exactly like `vN.md`
files. Editing a case writes `number + 1`. Nothing ever updates `body`.

### 4.3 Why `body` lives here and not in files

This was an open question; the decision is a `TEXT` column in `case_version`.

- Postgres moves any value over ~2 KB out of the main row into TOAST storage
  and compresses it. A large body does not widen the row, does not slow
  sequential scans over header columns, and is only read when `body` is
  selected. The per-value ceiling is 1 GB.
- Real sizes: existing cases in `private/test-cases` are single-digit KB;
  a pathological generated case is maybe 200 KB. Three orders of magnitude of
  headroom.
- Files or S3 would cost transactional consistency (a committed version row
  whose file never landed), a second backup/restore path, and shared storage
  the moment a second app instance exists — buying nothing at these sizes.
- The separate table is required regardless of size: versions are 1..N per
  case and immutable. That is normalization, not a size trade.

**The discipline that matters** is never loading `body` in list queries.
Doctrine hydrates every scalar field of an entity, so listings must use DTO
projections, never entity hydration:

```php
// VersionRepository
$qb->select(sprintf(
    'NEW %s(v.id, v.number, v.changeNote, v.createdAt, v.stepCount)',
    VersionSummary::class,
))->from(CaseVersion::class, 'v')->where('v.case = :case');
```

Add a PHPStan rule or a code-review checklist item: any repository method
returning `CaseVersion[]` for a listing is a bug. Same applies to
`run.frozen_body`.

### 4.4 Runs

```
run
  id uuid pk
  project_id uuid fk project on delete cascade
  case_id uuid fk test_case null on delete set null      -- null if case deleted
  case_version_id uuid fk case_version null on delete set null
  case_version_number int not null
  case_title text not null              -- denormalized, survives case deletion
  case_public_id text not null          -- ditto, for FS export parity
  suite_folder_id uuid fk folder null   -- which suite merged in, if any
  status text not null                  -- in_progress|passed|failed|aborted
  frozen_body text not null             -- merged + substituted case.md
  variable_values jsonb not null default '{}'
  report_body text null                 -- renderRunReport output, set on finish
  feedback_body text null               -- renderRunFeedback output, may stay null
  started_at timestamptz not null
  finished_at timestamptz null
  started_by uuid fk user null
  created_at, updated_at
  index (project_id, started_at desc)
  index (case_id, started_at desc)

run_step
  id uuid pk
  run_id uuid fk run on delete cascade
  step_key text not null                -- 'step-1' — matches parser output
  position int not null
  status text not null                  -- pending|running|success|failed|warning|skipped
  comment text not null default ''
  automated_result jsonb null
  started_at timestamptz null
  finished_at timestamptz null
  lock_version int not null default 1   -- Doctrine optimistic lock
  unique (run_id, step_key)

run_step_note
  id uuid pk
  run_step_id uuid fk run_step on delete cascade
  note_key text not null                -- client-generated 'note-ab12cd34'
  type text not null                    -- note|feature|bug|docs
  text text not null
  position int not null default 0
  created_at
  unique (run_step_id, note_key)

run_step_task
  id uuid pk
  run_step_id uuid fk run_step on delete cascade
  task_key text not null
  text text not null
  done boolean not null default false
  position int not null default 0
  unique (run_step_id, task_key)

free_run
  id uuid pk
  project_id uuid fk project on delete cascade
  title text not null
  notes text not null default ''
  feedback_body text null
  started_at timestamptz not null
  finished_at timestamptz null
  created_by uuid fk user null
  index (project_id, started_at desc)
```

Notes and tasks are rows, not JSONB, because `/enloop:check` and future
reporting want to query them across runs ("every `bug` note this sprint").
`note_key`/`task_key` preserve the client-generated ids from `newNoteId()` /
`newTaskId()` so a client patch is idempotent and FS round-tripping is lossless.

`report_body` / `feedback_body` are rendered **by the client** on finish (the
renderers are TS) and stored as immutable artifacts, mirroring `report.md` and
`feedback.md` on disk today. Server does not generate them; see section 16 Q2.

### 4.5 Audit

```
audit_log
  id uuid pk
  organization_id uuid fk organization on delete cascade
  actor_user_id uuid fk user null
  action text not null                  -- 'case.version.created', 'member.role.changed'
  subject_type text not null
  subject_id text not null
  meta jsonb not null default '{}'
  created_at
  index (organization_id, created_at desc)
```

Written by a Doctrine event subscriber for mutations on org/membership/token,
and explicitly in handlers for case/run mutations. Never in the request path of
a hot loop (`PATCH run step` is exempt — too chatty).

### 4.6 Designed, not built

```
attachment
  id uuid pk
  project_id uuid fk project on delete cascade
  run_id uuid fk run null on delete cascade
  run_step_id uuid fk run_step null on delete cascade
  storage_key text not null             -- S3/MinIO object key
  filename text not null
  mime_type text not null
  size_bytes bigint not null
  created_by uuid fk user null
  created_at
```

Create the migration in Phase 3 but ship no endpoints. Screenshots are the
first genuine object-storage case; markdown never is.

---

## 5. Auth and authorization

### 5.1 Token model (D6)

One table, two lifetimes:

- **Session token** — `type=session`, issued by `POST /auth/login`,
  `expires_at = now + 14d`, refreshed to +14d on any use more than 24h after
  the last refresh (sliding, cheap). Stored by the extension in
  `chrome.storage.local`, by the Vue app in `localStorage`.
- **API token** — `type=api`, created explicitly in settings or by
  `enloop login`, no expiry, revocable, prefix `enl_`. This is what the skills
  use.

Wire format: `Authorization: Bearer <secret>`. The secret is
`base64url(random_bytes(32))` prefixed with `enl_` for API tokens. Only
`sha256(secret)` is stored. On creation the full secret is returned once and
never again.

Verification: `TokenAuthenticator` (Symfony custom authenticator) hashes the
presented secret, looks up `api_token.token_hash` (unique index), rejects if
`revoked_at` or expired. Cache hash → user id in APCu for 60s to keep the
per-request cost near zero; **invalidate on revoke** by cache key deletion, and
keep the TTL short enough that a missed invalidation self-heals.

No cookies, so no CSRF surface. This also sidesteps the awkwardness of cookie
auth from a `chrome-extension://` origin.

### 5.2 Registration and onboarding

`POST /api/v1/auth/register { email, password, name }`:

1. Validate: email RFC-ish + `citext` uniqueness; password ≥ 12 chars, checked
   against Symfony's `NotCompromisedPassword` (k-anonymity HIBP lookup — make
   it soft-fail if the API is unreachable so registration never hard-breaks).
2. Create `user` (argon2id hash).
3. Create an `organization` — name `"<name>'s workspace"` or the email local
   part, slug uniquified — with an `owner` membership.
4. Create a `project` named `"Default"`, slug `default`.
5. Issue an email-verification token, send mail, return a session token.

Steps 3–4 matter: without them a fresh account lands on an empty state with
nothing to click.

Email verification is recorded but **not enforced** in this pass. Add
`ENLOOP_REQUIRE_EMAIL_VERIFICATION` (default `false`) checked by a single
voter attribute so enforcement is a config flip later.

### 5.3 The rest of the auth surface

| Endpoint | Notes |
|---|---|
| `POST /auth/login` | Generic `invalid_credentials` for both wrong email and wrong password. Constant-ish time: always run a hash verify, against a dummy hash if the user is missing. |
| `POST /auth/logout` | Revokes the presenting token only. |
| `GET /auth/me` | User + orgs + memberships + default project. One call the clients boot from. |
| `POST /auth/password/forgot` | Always 204, even for unknown emails. Creates `password_reset`, mails link. |
| `POST /auth/password/reset` | Consumes token (single use), **revokes every session token** for that user, keeps API tokens (a password reset shouldn't break CI). |
| `POST /auth/email/verify` | Consumes verification token. |
| `POST /auth/email/verify/resend` | Rate-limited hard. |
| `PATCH /auth/me` | name, and password change (requires current password; revokes other sessions). |

Rate limits (`symfony/rate-limiter`, sliding window, Redis or Postgres backed):

| Route | Limit |
|---|---|
| `POST /auth/login` | 10/min per IP **and** 5/min per email |
| `POST /auth/register` | 5/hour per IP |
| `POST /auth/password/forgot` | 3/hour per email, 10/hour per IP |
| `POST /auth/email/verify/resend` | 3/hour per user |
| authenticated writes | 600/min per token (abuse ceiling, not a product limit) |

### 5.4 Roles and permissions

Roles on `org_membership`: `owner`, `admin`, `member`, `viewer`.

| Capability | owner | admin | member | viewer |
|---|:--:|:--:|:--:|:--:|
| Read cases/runs | ✓ | ✓ | ✓ | ✓ |
| Create/edit cases, versions, folders | ✓ | ✓ | ✓ | — |
| Start/update/finish runs, free runs | ✓ | ✓ | ✓ | — |
| Archive cases, delete runs | ✓ | ✓ | ✓ | — |
| Create/archive projects | ✓ | ✓ | — | — |
| Invite / remove members, change roles | ✓ | ✓ | — | — |
| Rename org, transfer ownership, delete org | ✓ | — | — | — |
| Create own API tokens | ✓ | ✓ | ✓ | ✓ |

Enforcement, belt and braces:

1. **Voters** — `ProjectVoter`, `CaseVoter`, `RunVoter`, `OrganizationVoter`,
   all delegating to one `PermissionResolver` that answers
   `(user, organization, capability)`. Every controller action calls
   `denyAccessUnlessGranted`. Because there is exactly one resolver,
   introducing per-project membership later means changing one class.
2. **Repository scoping** — every finder takes the resolved project or org and
   filters on it. No `find($id)` on a tenant-owned entity in a controller,
   ever. Enforce with a PHPStan custom rule if it slips.
3. A functional test matrix (role × endpoint) asserting 403/404 — the single
   most valuable test file in the suite. A cross-tenant read must return
   **404**, not 403, so ids are not enumerable.

---

## 6. HTTP API

Base `/api/v1`. JSON in, JSON out, `camelCase` keys (matching the existing TS
types verbatim so `ApiDataStore` needs no field mapping).

### 6.1 Conventions

- **Errors**: RFC 9457 `application/problem+json`:
  `{ type, title, status, detail, errors?: [{ pointer, message }] }`.
  Validation → 422 with `errors`. Auth → 401. Permission → 403. Missing or
  cross-tenant → 404. Version conflict → 409.
- **Pagination**: `?page=1&perPage=50` (max 200) with
  `{ data: [...], meta: { page, perPage, total } }`. Runs also accept
  `?before=<iso>&limit=` cursor form, since run lists grow without bound.
- **Concurrency**: `PUT /folders/{id}/suite` and `POST /cases/{id}/versions`
  take `If-Match` with the current `ETag` (suite: `suite_updated_at`; case:
  `current_version_number`). Mismatch → 409 with the current value, so a client
  can rebase instead of clobbering. `run_step` uses Doctrine
  `lock_version` → 409.
- **Idempotency**: `POST /runs` and `POST /cases` accept
  `Idempotency-Key`; a repeat within 24h returns the original result. Prevents
  duplicate cases when a skill retries a timed-out request.
- **Limits**: request body 4 MB; `body` field 1 MB (413 beyond that).
- **CORS**: `nelmio/cors-bundle`, allowed origins = the console origin plus
  `chrome-extension://<published id>` and, in dev, a regex for unpacked ids.
  Allow `Authorization`, `Content-Type`, `If-Match`, `Idempotency-Key`;
  expose `ETag`. No credentials mode needed (bearer, not cookies). The
  extension's `manifest.config.ts` needs the API origin in `host_permissions`.

### 6.2 Endpoints

**Auth** — see section 5.3.

**Organizations**

```
GET    /orgs                                list caller's orgs + role
POST   /orgs                                { name }
GET    /orgs/{orgId}
PATCH  /orgs/{orgId}                        { name }
DELETE /orgs/{orgId}                        owner only, requires ?confirm=<slug>
GET    /orgs/{orgId}/members
PATCH  /orgs/{orgId}/members/{userId}       { role }  (cannot demote last owner)
DELETE /orgs/{orgId}/members/{userId}
GET    /orgs/{orgId}/invitations
POST   /orgs/{orgId}/invitations            { email, role }
DELETE /orgs/{orgId}/invitations/{id}
POST   /invitations/accept                  { token }  (auth required)
GET    /invitations/preview?token=          unauth: org name only, for signup UX
```

**Tokens**

```
GET    /me/tokens
POST   /me/tokens                           { name, organizationId? } -> secret ONCE
DELETE /me/tokens/{id}
```

**Projects**

```
GET    /orgs/{orgId}/projects?archived=
POST   /orgs/{orgId}/projects               { name, slug? }
GET    /projects/{projectId}
PATCH  /projects/{projectId}                { name, description, archived }
DELETE /projects/{projectId}                requires ?confirm=<slug>
```

**Folders**

```
GET    /projects/{projectId}/folders        full tree, one call, no bodies
POST   /projects/{projectId}/folders        { name, parentId? }
PATCH  /folders/{folderId}                  { name, parentId, position }  (cycle-checked)
DELETE /folders/{folderId}                  ?strategy=reparent|cascade
GET    /folders/{folderId}/suite            { body, updatedAt } or 404
PUT    /folders/{folderId}/suite            { body }  If-Match
DELETE /folders/{folderId}/suite            folder stops being a suite
```

**Cases and versions**

```
GET    /projects/{projectId}/cases?folderId=&q=&tag=&archived=&page=
POST   /projects/{projectId}/cases          { body, folderId? }
GET    /cases/{caseId}                      meta + current version summary
PATCH  /cases/{caseId}                      { folderId, archived }
DELETE /cases/{caseId}                      hard delete; runs survive (denormalized)
GET    /cases/{caseId}/versions             summaries only, no bodies
POST   /cases/{caseId}/versions             { body, changeNote? }  If-Match
GET    /cases/{caseId}/versions/{n}         includes body
GET    /cases/{caseId}/run-source?version=n { body, suiteBody, suiteFolderId }
```

`POST /cases` derives `public_id` server-side with the same shape as
`newTestCaseId()` (`slug-8hex`) so FS export/import round-trips.

`GET /run-source` returns the case body **and** the applicable suite body
unmerged — the client merges with `buildRunSource`, per section 3.3.

**Runs**

```
GET    /projects/{projectId}/runs?caseId=&status=&before=&limit=
POST   /projects/{projectId}/runs           { caseId, version, variableValues,
                                              frozenBody, stepIds[], suiteFolderId? }
GET    /runs/{runId}                        run + steps + notes + tasks + frozenBody
PATCH  /runs/{runId}/steps/{stepKey}        StepPatch shape, If-Match lock_version
POST   /runs/{runId}/finish                 { status, reportBody, feedbackBody? }
DELETE /runs/{runId}
GET    /runs/{runId}/report                 text/markdown
```

**Free runs**

```
GET    /projects/{projectId}/free-runs
POST   /projects/{projectId}/free-runs      { title }
GET    /free-runs/{id}
PATCH  /free-runs/{id}                      { title?, notes? }
POST   /free-runs/{id}/finish               { feedbackBody }
DELETE /free-runs/{id}
```

**Ops**

```
GET    /health                              db + migration state, unauth
GET    /version                             app + grammar CURRENT_FORMAT_VERSION
```

`GET /version` exposing the server's expected grammar format version lets a
client warn when it is older than the data it is reading.

### 6.3 OpenAPI

`nelmio/api-doc-bundle` with attributes on controllers; spec served at
`/api/doc.json` and checked into `server/openapi.json` by a CI job that fails
on drift. The TS client (section 7) is hand-written, not generated — it must
implement the existing `DataStore` interface, which no generator will produce —
but the spec keeps the CLI and third parties honest.

---

## 7. `ApiDataStore` and the `DataStore` interface

`shared/src/storage.ts` already promises this: *"a later implementation can call
a remote HTTP API against the same folder layout without any caller needing to
change."* Mostly true; three things need to give.

### 7.1 Interface changes

1. **Scope.** `ApiDataStore` is constructed with `{ baseUrl, token, projectId }`;
   no method signature grows a project parameter. Switching project means
   constructing a new store — which is what `DataStoreProvider` already does
   on connect.
2. **Folders.** New optional methods, in a `FolderStore` interface that
   `DataStore` extends:
   ```ts
   listFolders(): Promise<FolderNode[]>;
   createFolder(name: string, parentId?: string): Promise<FolderNode>;
   renameFolder(id: string, name: string): Promise<void>;
   moveFolder(id: string, parentId: string | null): Promise<void>;
   deleteFolder(id: string, strategy: "reparent" | "cascade"): Promise<void>;
   moveCase(caseId: string, folderId: string | null): Promise<void>;
   ```
   `FsaDataStore` implements these over nested directories (see 7.3).
3. **Run creation moves the compose step to the caller.** `createRun` currently
   does merge + resolve + substitute internally (`fsa-store.ts:443`). Extract
   that into a shared free function:
   ```ts
   // shared/src/run-source.ts
   export function composeRunSource(
     caseMarkdown: string, suiteMarkdown: string | null,
     variables: TestCaseVariable[], values: Record<string, string>,
   ): { frozenBody: string; doc: TestCaseVersion; resolved: Record<string, string> };
   ```
   Both stores call it; `ApiDataStore` posts the result, `FsaDataStore` writes
   it to disk. **Do this refactor first, verified against the existing
   extension, before any API code exists** — it is the one change that touches
   working code, and it must be behaviour-preserving.

### 7.2 Capabilities

```ts
export interface StoreCapabilities {
  folders: boolean;      // nested organization
  projects: boolean;     // more than one library
  sharing: boolean;      // other users exist
  suites: boolean;
  archive: boolean;
}
```

`DataStore.capabilities: StoreCapabilities`. The UI hides rather than disables
what a mode cannot do — a local folder has no members to invite.

### 7.3 Local mode after this change

`FsaDataStore` keeps working with two additions:

- `listFolders()` walks directories; a directory containing `suite.md` reports
  `isSuite: true`. This drops the current one-level nesting limit
  (`fsa-store.ts:82`) — `findCaseDir` becomes a recursive walk. Cap depth at 8
  and keep the "ids are globally unique" assumption, which the recursion
  relies on.
- `capabilities = { folders: true, projects: false, sharing: false, suites: true, archive: true }`.

### 7.4 Extension changes

- `DataStoreProvider` gains a third connection shape: `{ status: "connected",
  mode: "local" | "account", ... }`, and an account path that stores the
  session token in `chrome.storage.local` (not `localStorage` — the side panel
  is a page, but `chrome.storage` survives more).
- `ConnectScreen` offers two routes: **Sign in** (email/password, register
  link to the console) and **Use a local folder**.
- New `ProjectPickerScreen` for account mode, remembered per install.
- `SettingsScreen` shows mode, account, project, and a sign-out.
- Everything downstream of `useReadyStore()` is untouched. Verify this claim by
  grepping for `FsaDataStore` outside the provider — there should be no hits.

---

## 8. Vue console

`web/`, Vue 3 + Vite + TypeScript, **options API** per D1, Pinia, vue-router.
Imports `@tcm/shared` directly for parsing and rendering — the same package the
extension uses, so the editor's live preview and the extension's rendering
cannot disagree.

### 8.1 Routes

| Route | Purpose |
|---|---|
| `/login`, `/register`, `/forgot`, `/reset`, `/verify` | auth |
| `/invite?token=` | accept, with signup-if-needed |
| `/` | org + project switcher, recent runs |
| `/p/:projectId/library` | folder tree + case list, drag-to-move, search |
| `/p/:projectId/cases/:caseId` | detail: current version, steps rendered, version list |
| `/p/:projectId/cases/:caseId/edit` | markdown editor, live parse, validation errors, save as new version |
| `/p/:projectId/cases/:caseId/versions/:n` | one version, diff vs previous |
| `/p/:projectId/folders/:folderId/suite` | suite editor |
| `/p/:projectId/runs` | run history, filters, pass/fail |
| `/p/:projectId/runs/:runId` | run detail: steps, statuses, notes, tasks, report |
| `/p/:projectId/free-runs` | free run list + notes |
| `/settings/org/:orgId` | members, invitations, roles, rename |
| `/settings/tokens` | API tokens |
| `/settings/account` | name, password, email |

### 8.2 Stores

`auth` (user, orgs, token, boot from `GET /auth/me`), `library` (folder tree +
cases for the active project), `runs`, `ui`.

### 8.3 Two things not to get wrong

- **Markdown rendering must sanitize.** The extension uses `react-markdown`,
  which is safe by default. Vue has no such default — use `markdown-it` with
  `html: false` plus DOMPurify on the output, and **never** `v-html` on
  unsanitized case text. Case bodies are attacker-controlled in a multi-tenant
  product; this is the main new XSS surface the console introduces.
- **The editor must validate before saving** by calling `parseCaseDocument` and
  surfacing the thrown error inline, exactly as `EditorScreen.tsx` does. The
  server's indexer will not catch a malformed step body — by design (section 3).

---

## 9. CLI and the skills

### 9.1 `cli/` — new npm workspace `@tcm/cli`, binary `enloop`

Node 20+, TypeScript, zero heavy deps (`node:util` `parseArgs`), depends on
`@tcm/shared` for parsing/validation before upload.

```
enloop login                       # email+password prompt -> creates an API token
enloop logout
enloop whoami                      # user, orgs, active project — the skills' preflight
enloop project list
enloop project use <id|slug>
enloop folder list
enloop case list [--folder <id>] [--tag t] [--json]
enloop case get <id> [--version n] [--raw]
enloop case create --file <path> [--folder <id>]
enloop case version <id> --file <path> [--change-note "..."]
enloop suite get <folderId> / enloop suite set <folderId> --file <path>
enloop run list [--finished] [--limit n] [--json]
enloop run get <id> [--json]
enloop run report <id>
enloop import <dir> [--project <id>]     # FS layout -> API
enloop export <dir> [--project <id>]     # API -> FS layout
```

Config precedence: flags → env (`ENLOOP_API_URL`, `ENLOOP_API_TOKEN`,
`ENLOOP_PROJECT`) → `~/.config/enloop/config.json` (mode 0600).

Every command supports `--json` and exits non-zero with a one-line stderr
message on failure. The skills depend on both.

`case create` and `case version` parse the file with the real parser before
sending, so a malformed case fails locally with a good message instead of
becoming a 422.

### 9.2 Skill migration

`plugins/enloop/references/data-folder.md` currently teaches an elaborate
directory-level detection ritual, because writing one level off fails silently.
That whole failure mode disappears with an API. Rewrite it as
`references/data-access.md`:

- **If `ENLOOP_API_URL` (or a stored CLI config) is present → API mode.**
  Preflight `enloop whoami`; resolve the project from `ENLOOP_PROJECT` or ask.
  Write with `enloop case create --file`, which prints the case id and URL.
  Verify with `enloop case get <id>`. No paths, no levels, no detection.
- **Else → local mode**, and the existing detection rules apply unchanged.

Keep the local rules verbatim in the same file rather than deleting them — D2
means both modes stay real, and a skill that only knows about the API is a
regression for solo users.

Per-skill edits:

- `skills/write/SKILL.md` — resolution step becomes mode detection; the write
  step becomes a CLI call; keep reading the grammar fresh from
  `$ENLOOP_HOME/shared/src/markdown.ts` (unchanged, still the spec).
- `skills/check/SKILL.md` — `enloop run list --finished --limit 1 --json` to
  pick a run, `enloop run get --json` to read it, `enloop case version` to land
  a fix. Case defects it fixes itself become a new version over the API, which
  keeps the "never edit a previous version in place" rule intact for free.
- `skills/instrument/SKILL.md` — untouched; it only writes app source.
- `.claude/skills/enloop-demo/SKILL.md` — must gain the API path too, since its
  whole job is verifying a case lands where the extension can see it.

### 9.3 Import path for existing data

`php bin/console enloop:import --project=<id> --dir=<path> [--dry-run]`, and
the equivalent `enloop import` in the CLI (which is the one users will actually
run, since it works remotely).

Mapping:

| On disk | Becomes |
|---|---|
| `test-cases/<caseId>/versions/vN.md` | `test_case.public_id = <caseId>`, `case_version.number = N`, `created_at` from mtime |
| `test-cases/<caseId>/meta.json` | `test_case.archived` |
| `test-cases/<suiteId>/suite.md` | `folder` with `suite_body`, name from the suite's title |
| cases inside a suite dir | cases with `folder_id` set |
| `runs/<caseId>/<runId>/case.md` | `run.frozen_body` |
| `runs/.../run.json` | `run` + `run_step` + notes + tasks (legacy string notes upgrade to `type: note`, mirroring `runNoteOrLegacySchema`) |
| `runs/.../report.md`, `feedback.md` | `run.report_body`, `run.feedback_body` |
| `free-runs/<id>/{free-run.json,notes.md}` | `free_run` |

Idempotent on `(project_id, public_id)` and `(case_id, number)`: re-running
skips what exists and reports counts. `private/test-cases` in this repo is the
test corpus — importing it must produce a library identical to what the
extension shows from disk, and that comparison is the acceptance test.

---

## 10. Repository layout after this work

```
extension/          Chrome extension (React + Vite) — unchanged except provider/screens
shared/             parser, schemas, ids, variables — grammar spec lives here
  src/api-client.ts     low-level fetch wrapper (auth, errors, retries)
  src/api-store.ts      ApiDataStore implements DataStore
  src/run-source.ts     composeRunSource, extracted from FsaDataStore
  test-fixtures/        parity corpus consumed by TS and PHP tests
web/                Vue 3 console (options API)
server/             Symfony 7.2 API
  src/Entity/ Repository/ Controller/Api/ Dto/ Security/ Markdown/ Command/ EventSubscriber/
  migrations/
  tests/Unit/ Functional/ Markdown/
cli/                @tcm/cli, the `enloop` binary
plugins/enloop/     skills — updated for API mode
.claude/skills/     enloop-demo
docker/             compose, php-fpm, caddy, postgres, mailpit
```

`server/` is not an npm workspace; root `package.json` workspaces become
`["shared", "extension", "web", "cli"]`.

---

## 11. Testing

**PHP**

- Unit: `CaseIndexer` (with the parity corpus), `PermissionResolver`, token
  hashing/expiry, slug generation, folder cycle detection, path materialization.
- Functional (`WebTestCase` + `dama/doctrine-test-bundle` for transaction
  rollback, `zenstruck/foundry` factories):
  - the role × endpoint matrix from 5.4;
  - cross-tenant access returns 404 for every tenant-owned resource;
  - full run lifecycle: create case → version → run → patch steps → finish →
    report;
  - `If-Match` conflicts return 409 without writing;
  - rate limiters return 429 with `Retry-After`;
  - auth flows: register, verify, login, forgot/reset, invite/accept.
- Target: ≥85% line coverage on `src/`, and a hard rule that every new endpoint
  ships with a functional test in the same commit.

**TypeScript**

- Add `vitest` to `shared` (it currently has no tests at all — this work is the
  reason to fix that): `parseCaseDocument` round-trips, `buildRunSource`
  merging, `composeRunSource` equivalence with the pre-refactor behaviour,
  variable substitution, `renderRunReport` snapshots, the parity fixtures.
- `ApiDataStore` tested against a mock fetch, asserting it satisfies the same
  behavioural contract as `FsaDataStore` — one shared test suite parameterized
  over both implementations is the goal (`storeContract(makeStore)`), with the
  FSA side driven by a memory-backed handle shim.

**End-to-end**

- Playwright against docker compose: register → create project → create case in
  the console → run appears via API → finish run → report renders.
- Manual checklist for the extension (Playwright can't drive a side panel
  cheaply): sign in, pick project, run a case with variables and an automated
  step, finish, see the report in the console.

---

## 12. Infrastructure

`docker/compose.yaml`: `postgres:16` (citext enabled via init SQL),
`php:8.3-fpm` (opcache, apcu), `caddy` (HTTP/2, TLS in prod), `mailpit`
(dev mail catcher).

`make up | migrate | test | fixtures | shell` at the repo root so no one needs
to remember compose invocations.

Env (`server/.env`, real values in `.env.local` / deployment secrets):

```
APP_ENV, APP_SECRET
DATABASE_URL=postgresql://...
MAILER_DSN
ENLOOP_CONSOLE_URL=https://console.example.com      # link building in emails
ENLOOP_CORS_ORIGINS=https://console.example.com,chrome-extension://<id>
ENLOOP_REQUIRE_EMAIL_VERIFICATION=false
ENLOOP_MAX_BODY_BYTES=1048576
```

CI (GitHub Actions), one workflow, parallel jobs:

1. `php`: composer install, `php-cs-fixer --dry-run`, `phpstan --level=8`,
   `doctrine:schema:validate`, migrations up on a clean DB, phpunit.
2. `js`: `npm ci`, `npm run typecheck` (shared + extension + web + cli),
   `vitest run`, build extension and web.
3. `parity`: the fixture corpus through both parsers.
4. `openapi`: regenerate and diff `server/openapi.json`.

Deployment for v1: single VM, docker compose, Caddy TLS, nightly
`pg_dump` to object storage with a **restore drill documented and actually
performed once** before real user data exists. Postgres backups nobody has
restored are not backups.

---

## 13. Security checklist

- argon2id via Symfony `PasswordHasher` (never a hand-rolled hash).
- Tokens: 32 random bytes, only `sha256` stored, shown once, prefix for display.
- No user enumeration: `/auth/login` and `/auth/password/forgot` reveal nothing.
- Rate limits per 5.3, with `Retry-After`.
- Cross-tenant → 404, never 403.
- DTO + `symfony/validator` on every write; no `$request->request->all()` into
  an entity; no client-supplied `organizationId` on nested resources — derive
  it from the path.
- Body size caps (Caddy, PHP `post_max_size`, and app-level `ENLOOP_MAX_BODY_BYTES`).
- Markdown is **never** rendered server-side; clients sanitize (section 8.3).
- Invitations: hashed single-use tokens, 7-day expiry, bound to the invited
  email, and accepting requires being signed in as that email.
- `audit_log` for auth, membership, token and case-version events.
- Security headers via Caddy: HSTS, `X-Content-Type-Options`, a console CSP
  that forbids inline script.
- Dependabot/`composer audit` + `npm audit` in CI, failing on high severity.

---

## 14. Delivery order and risk

The sequencing rule: **nothing touches working extension code until the backend
can already serve it**, with one deliberate exception — the `composeRunSource`
extraction (7.1.3), which lands first, alone, verified in the real extension.

Highest risks, and the mitigation each:

| Risk | Mitigation |
|---|---|
| TS/PHP parser drift (D5) | Fixture parity in CI; PHP scope kept to ~120 lines of header/outline only |
| Regressing local mode while adding accounts | One `storeContract` test suite run against both stores; local mode has no server dependency at all |
| `frozen_body` trust — client composes the run | Server validates step count; body size capped; single-tenant blast radius |
| Doctrine accidentally loading `body`/`frozen_body` in lists | DTO projections mandated in 4.3, plus a review checklist item |
| Skills silently writing nowhere (today's failure mode) | API mode returns an id and URL; `enloop case get` verification step retained in the skill |
| Scope creep into per-project ACLs | Single `PermissionResolver` seam; explicitly deferred |

---

## 15. Phased task list

Each phase ends with a checkpoint that must pass before the next begins.

### Phase 0 — Scaffold

1. `docker/compose.yaml` + `Makefile` + postgres init SQL (`citext`, `uuid`).
2. `composer create-project symfony/skeleton server`; add doctrine,
   migrations, security, validator, serializer, mailer, rate-limiter, uid,
   nelmio/cors, nelmio/api-doc, phpstan, php-cs-fixer, phpunit, foundry, dama.
3. `web/` Vite + Vue 3 + TS + router + Pinia skeleton; root `package.json`
   workspaces updated to include `web` and `cli`.
4. `GET /api/v1/health` returning db connectivity + pending-migration count.
5. CI workflow with all four jobs, green on an empty app.

**Checkpoint:** `make up && curl localhost:8080/api/v1/health` → 200;
`npm run typecheck` still green across all workspaces.

### Phase 1 — `composeRunSource` extraction (touches existing code)

1. Add `shared/src/run-source.ts` with `composeRunSource`.
2. Rewrite `FsaDataStore.createRun` to call it; delete the inline
   merge/resolve/substitute.
3. Add `vitest` to `shared`; test that a fixture case + suite produces the
   byte-identical frozen body the old code produced (capture expected output
   from the current implementation *before* refactoring).
4. Build the extension, run a real suite-attached case with variables, confirm
   `case.md` in the run folder is unchanged in shape.

**Checkpoint:** an actual run in the browser, and `git diff` on a
freshly-produced `case.md` vs one produced before the refactor showing no
difference.

### Phase 2 — Identity, orgs, tokens

1. Entities + migration: `user`, `organization`, `org_membership`,
   `invitation`, `api_token`, `password_reset`, `audit_log`.
2. `TokenAuthenticator`, `PermissionResolver`, `OrganizationVoter`, APCu cache.
3. Auth endpoints (5.3) + registration onboarding (5.2, including default org
   and project — so Phase 3 has somewhere to write).
4. Org/member/invitation/token endpoints (6.2).
5. Rate limiters, mailer templates (verify, reset, invite) against mailpit.
6. Functional tests: auth flows + role matrix + cross-tenant 404s.

**Checkpoint:** register → verify → login → invite a second user → accept →
role change → create an API token → `curl` with it → revoke → 401. All via
HTTP, all covered by tests.

### Phase 3 — Library: projects, folders, cases, versions

1. `CaseIndexer` + parity corpus + fixture generator + both test suites
   (do this **before** the endpoints that depend on it).
2. Entities + migration: `project`, `folder`, `test_case`, `case_version`,
   `attachment` (table only).
3. Project endpoints; folder endpoints incl. cycle detection, path
   materialization, `?strategy=` on delete.
4. Case + version endpoints; `public_id` generation matching `newTestCaseId`;
   `If-Match` on new versions; DTO projections for every list.
5. `GET /cases/{id}/run-source` resolving the nearest ancestor suite.
6. Functional tests, including a 1 MB body accepted and 1 MB + 1 byte rejected.

**Checkpoint:** create a case from a real markdown file via curl, list it, add
v2, move it into a suite folder, and confirm `GET /run-source` returns the case
body plus the right suite body.

### Phase 4 — Runs and free runs

1. Entities + migration: `run`, `run_step`, `run_step_note`, `run_step_task`,
   `free_run`.
2. `POST /runs` with step-count validation and `Idempotency-Key`.
3. `PATCH /runs/{id}/steps/{key}` with optimistic locking; notes/tasks upsert
   by client key.
4. `POST /runs/{id}/finish` storing report/feedback bodies; `GET /report` as
   `text/markdown`.
5. Free run endpoints.
6. `enloop:import` console command; import `private/test-cases` and diff the
   result against what the extension lists from the same folder.

**Checkpoint:** the whole lifecycle over HTTP, and an import of the existing
private corpus that reports every case, version, run and free run accounted
for.

### Phase 5 — `ApiDataStore` and the extension

1. `shared/src/api-client.ts` — fetch wrapper: bearer auth, problem+json → typed
   errors, 401 → sign-out callback, retry with backoff on 429/5xx.
2. `shared/src/api-store.ts` — `ApiDataStore implements DataStore`.
3. `FolderStore` methods on both stores; recursive `findCaseDir` in
   `FsaDataStore`; `capabilities` on both.
4. `storeContract()` shared test suite, run against both implementations.
5. Extension: provider modes, `ConnectScreen` sign-in, `ProjectPickerScreen`,
   `SettingsScreen`, token in `chrome.storage.local`, API origin in
   `host_permissions`.
6. Grep-verify that no screen imports `FsaDataStore` directly.

**Checkpoint:** sign in from the side panel, pick a project, run a case with a
generated variable and an automated step against the backend, finish it, and
see the run in `GET /runs`. Then switch to local mode and do the same offline.

### Phase 6 — Vue console

1. Auth pages + invite acceptance + `auth` store booting from `/auth/me`.
2. Library: folder tree, case list, search, drag-to-move, archive.
3. Case detail + version history + diff; editor with live parse and validation;
   suite editor.
4. Run history + run detail + report view; free runs.
5. Org settings (members, invites, roles), token settings, account settings.
6. Sanitized markdown rendering (8.3) with an XSS test case in the corpus
   (`<img onerror>` in a case title must render inert).

**Checkpoint:** a case authored entirely in the console runs in the extension
without edits.

### Phase 7 — CLI, skills, docs

1. `cli/` with every command in 9.1, `--json` everywhere, non-zero exits.
2. `enloop import` / `enloop export` (export must round-trip to a folder the
   extension can open in local mode — that is the parity proof for D2).
3. Rewrite `references/data-folder.md` → `data-access.md` with both modes;
   update `write`, `check`, and `enloop-demo` skills.
4. README rewrite: accounts, projects, the two modes, CLI setup, self-hosting.
   Keep the existing local-folder story intact rather than replacing it.
5. `/enloop:write` end-to-end from a real app repo into a hosted project, then
   `/enloop:check` on the resulting run.

**Checkpoint:** the full write → run → check loop, with no filesystem path
configured anywhere.

### Later (not in this pass)

Per-project membership; attachments and screenshots; SSO; webhooks; scheduled
suite runs; cross-run analytics ("flakiest step"); a public run-report share
link; billing. **Environments** are specified in section 17 — the design is
worked out because it changes the run record and the grammar's variable
handling, but it is not in this pass.

---

## 16. Open questions

**Q1 — Nested suite merging.** v1 uses the nearest ancestor suite only. If
teams want a root suite plus a section suite, `buildRunSource` needs an
ordering rule (outermost prep first? variable precedence innermost-wins?) and
the grammar doc comment becomes the place to specify it. Decide when someone
asks, not before.

**Q2 — Should report rendering move server-side?** Today the client renders and
the server stores. That is fine while every client is TS. A server-rendered
report would be needed for emailed reports or public share links — and would
force a PHP port of `renderRunReport`, i.e. reopening D5. Prefer: keep
rendering client-side, and if emails need a report, have the client store it at
finish time (which it already does).

**Q3 — Deleting a case with runs.** Current plan: hard-delete the case, keep
runs via denormalized `case_title` / `case_public_id`. Alternative is soft
delete, which keeps history navigable but complicates uniqueness on
`public_id`. Revisit if orphaned runs feel bad in the console.

**Q4 — Org-scoped vs user-scoped API tokens.** `api_token.organization_id` is
nullable, so both work. CI in a client repo probably wants a token that
survives a person leaving — which really means service accounts, deferred.

**Q5 — Where does `.claude/test-map.md` live?** `/enloop:write` caches an app
map in the app repo and the README says commit it. That stays repo-local and
does not move into the backend — but if two testers on different machines both
generate one, the backend is the natural place to share it. Not in this pass.

**Q6 — GDPR-shaped obligations.** Account deletion, data export, and retention
are unaddressed. `DELETE /orgs/{id}` exists; a user-level "delete me and my
data" flow does not. Needed before this is a real product with real customers.

---

## 17. Environments (designed, not in this pass)

A project is deployed in several places — local, staging, production — and a
case should be runnable against any of them without being rewritten. Today a
case either hardcodes a host (and is wrong everywhere else) or names a bare
route like `/admin/sync` and resolves it against whatever page the tester
happens to have open, which is right most of the time and silently wrong the
rest.

Microservices make this sharper: one environment is not one domain. A case can
legitimately touch the app, an admin console, and an API on three different
hosts, and all three move together when you switch from staging to local.

### 17.1 The schema is the point

The naive model is a bag of key/value pairs per environment. It rots: someone
adds `admin_url` to staging, nobody adds it to local, and a case written on
staging fails on local with a message about an undefined variable rather than
about the real problem. The failure surfaces at run time, on the tester.

So the **host keys belong to the project, not to the environment**:

- `environment_schema_host` — the project's contract. `web`, `api`, `admin`,
  `auth`. Each key has a label, a description of what lives there, and a
  `required` flag.
- `environment` — `local`, `staging`, `production`. Naming only.
- `environment_host` — the value: one base URL per (environment, schema key).

An environment is **complete** when it has a value for every required key.
Adding a key to the schema makes every environment incomplete until filled, and
that is the desired behaviour, not a nuisance: it is the moment someone
notices local was never given the new service's URL. Incomplete environments
are listed and flagged, and cannot be selected for a run.

This is what "every environment has the same dataset" has to mean mechanically:
identical key sets by construction, differing only in values.

```
environment_schema_host
  id uuid pk
  project_id uuid fk project on delete cascade
  key text not null                     -- 'web' — slug, immutable after create
  label text not null                   -- 'Web app'
  description text not null default ''  -- what lives here
  required boolean not null default true
  position int not null default 0
  created_at, updated_at
  unique (project_id, key)

environment
  id uuid pk
  project_id uuid fk project on delete cascade
  slug text not null                    -- 'staging'
  name text not null                    -- 'Staging'
  is_default boolean not null default false
  archived boolean not null default false
  position int not null default 0
  created_at, updated_at
  unique (project_id, slug)

environment_host
  id uuid pk
  environment_id uuid fk environment on delete cascade
  schema_host_id uuid fk environment_schema_host on delete cascade
  base_url text not null                -- 'https://staging.example.com', no trailing slash
  created_at, updated_at
  unique (environment_id, schema_host_id)
```

`base_url` is validated as an absolute `http(s)` URL with no path beyond a
prefix, normalized without a trailing slash so joining is unambiguous.

### 17.2 How a case reaches an environment

**No new grammar.** Each schema key is injected into a run as a variable named
`<KEY>_URL` — `web` becomes `%WEB_URL%`, `admin` becomes `%ADMIN_URL%`. The
existing substitution pass already replaces `%NAME%` everywhere including
`Where:`, `Selector:` and automated step scripts, so a case writes:

```
## Open the sync console
Where: %WEB_URL%/admin/sync-console
```

and nothing in `parseCaseDocument` changes. This is the whole reason to reuse
variables rather than invent an `@host` sigil: it is already wired end to end,
and the frozen `case.md` ends up recording the resolved absolute URLs, so a run
is self-describing about where it actually ran.

Rules that need deciding once and enforcing:

- Injected names are **reserved**. A case declaring its own `WEB_URL` under
  `# Variables` is a validation error at save time, not a silent shadow.
- A case referencing `%X_URL%` for a key the project's schema does not define
  is a validation error too — catchable when the case is saved, which is the
  cheap moment.
- `resolveVariableValues` gains environment values as a third source, ahead of
  generators and defaults. They are not editable in the run-setup prompt;
  showing them read-only is what tells the tester which environment they are
  about to hit.

### 17.3 Run record

`run` gains `environment_id` (fk, nullable, `on delete set null`) and a
denormalized `environment_name text not null default ''`, on the same
reasoning as `case_title`: the run must still describe itself after the
environment is renamed or deleted. `variable_values` already captures the
resolved URLs.

`renderRunReport` and `renderRunFeedback` grow an Environment line. "Failed on
staging" and "failed on local" are different findings, and today the report
cannot tell them apart — which also means `/enloop:check` cannot either, and
it should: an app bug that reproduces only on one environment is a deployment
finding, not a code finding.

### 17.4 Local mode keeps working

D2 says both storage modes stay real, so environments cannot be a backend-only
feature. In local mode they live in `<data folder>/environments.json` with the
same shape — schema keys, environments, values — read and written by
`FsaDataStore`. The `enloop export` round-trip carries it, so a project can
move between modes without losing them.

### 17.5 UI

- Project settings: edit the schema (add/rename/remove keys), then a grid of
  environments × keys, with incomplete cells visibly empty rather than absent.
  The grid is the artifact that makes drift obvious at a glance.
- Side panel: an environment picker, remembered per project per install, shown
  in the run-setup screen and in the run header. The picker must be *visible
  during the run*, not just at setup — "which environment am I on" is the
  question a tester asks when something looks wrong.
- Editing production URLs is gated at `admin`; `member` may run against any
  environment but not redefine one.

### 17.6 Migration from what exists now

Bare routes (`Where: /admin/sync`) keep resolving against the active tab, which
is what the extension does today. That stays as the fallback for cases written
before environments and for projects that never define any.

Once a project has a schema, `/enloop:check` can offer to rewrite bare routes
to `%WEB_URL%/...` in the version it is already writing — a mechanical edit,
opt-in, and visible in the diff rather than applied silently.

### 17.7 Open questions

**Q7 — Non-URL environment values.** Test account emails, tenant ids and
feature-flag states differ per environment too, and the same schema discipline
would fit (`environment_value` alongside `environment_host`). Deferred until
someone asks: URLs are the case that blocks navigation today. **Credentials are
explicitly out of scope** — never stored, in either mode. A case that needs a
password says which password-manager entry to use.

**Q8 — Per-environment expected values.** A step asserting `3 records synced`
is environment-specific in a way no URL substitution fixes. Probably a case
authoring problem (assert on shape, not on seeded counts) rather than a
platform one, but worth revisiting if it recurs.

**Q9 — Environment health.** A "check all hosts respond" action before a run
would catch the most common false failure — testing against a service that is
down — but it needs the extension to make cross-origin requests to every host,
which widens `host_permissions`. Worth it only if false failures prove common.
