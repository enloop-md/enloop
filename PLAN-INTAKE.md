# Notes from the page: working sites and intake — implementation plan

Status: **written 2026-10-06; not started.**

This plan is written to be executed by a separate session ("implement
PLAN-INTAKE.md"). Every design decision below is locked; do not
re-litigate any of them mid-flight. Where the plan says *decided*, build
it as written. Where something is genuinely unspecified, pick the smallest
thing that satisfies the verification gate and note it in the status line
at the top of this file. **Do not commit** — the user commits. Update the
status line above after each part lands.

Read first, in this order:

1. `MANIFESTO.md` — the principle. Any friction is a defect; this feature
   exists to take friction out of *reporting* something, the way a case
   takes it out of *testing* something.
2. `extension/src/background/capture.ts` — the worker's buffer, the
   serialized state queue (`serialize`), and `syncCaptureRegistration`.
   The trail in this plan copies both patterns.
3. `extension/public/console-capture.js` (MAIN world wrapper; `send`,
   `wants`, `reportRequest` near line 277) and
   `extension/public/console-relay.js` (`announce`).
4. `extension/src/lib/capture.ts` and `shared/src/capture.ts` —
   `CapturedEntry`, `buildCaptureDigest`'s dedupe (`dedupeKey`,
   `normalizeMessage`), `redactUrl` semantics.
5. `extension/src/background/screenshot.ts` — the command and
   context-menu gesture pattern this plan extends.
6. `extension/src/lib/nav-state.ts`, `extension/src/sidepanel/App.tsx` —
   how a screen is added.
7. `shared/src/storage.ts` (`FreeRunStore`, `DataStore` at the bottom),
   `extension/src/lib/fsa-store.ts` `// ---- FreeRunStore ----` (line
   ~1161), `extension/src/lib/workspace-store.ts` free-run methods (line
   ~530) — the store shape intake copies.
8. `extension/src/lib/storage-registry.ts` `ensureGitignore`.
9. `extension/src/lib/page-access.ts` (`requestSiteAccess`,
   `getPageAccess`) and `extension/src/lib/use-active-page.ts`.
10. `plugins/enloop/skills/check/SKILL.md` steps 1–3, and the
    `agent-status` command in `plugins/enloop/validator/enloop-case.mjs`
    (line ~1772) as the model for a new CLI command.
11. `scripts/build-plugin.mjs` — `lib.mjs` is generated from
    `shared/src/plugin-entry.ts` and committed; rerun `npm run
    build:plugin` after touching anything it exports.

---

## 1. What this changes and why

A developer working on their own app notices something — *after editing a
user I land on the list; I want to stay on the edit form* — and today has
two bad options: stop and write it up properly (switch to the editor,
reconstruct which URL, which request, which redirect), or not write it at
all. Both lose. The context that makes the note actionable — the page,
the redirect chain, the request that 500'd, the console error — existed a
second ago in the browser and nobody kept it.

This plan adds three things:

1. **Working sites.** The user marks an origin (`https://app.test`) as a
   site they work on. From then on the extension keeps a short **trail**
   per tab on that origin, in memory, in the background: page loads with
   their redirect chains, the requests the page made, console errors and
   warnings. The trail is pruned continuously — older than *X* pages or *Y*
   minutes goes — but the last two pages are always kept.
2. **Notes (intake).** One shortcut (`Alt+Shift+N`), one context-menu
   item, or one panel button opens a composer: a text box, and under it
   **"Will be added to your note:"** — the exact lines that will be
   attached, each with a checkbox. What is shown is byte-for-byte what is
   written. Save writes `intake/<id>/` into the project's data folder.
3. **`/enloop:check` reads the inbox.** With no argument it looks for both
   the newest unchecked run and open notes, and asks which to deal with
   first, the run being the default. A note is worked like a request from
   the developer: find the code behind it, fix it or say why not, mark it
   done.

Naming, *decided*: the panel says **note** everywhere ("New note",
"Notes"). The folder, the schema and the CLI say **intake**
(`intake/`, `intakeFileSchema`, `enloop-case.mjs intake`). The docs say
once that a note lives in `intake/`.

---

## 2. Decisions

Locked. Each has its reason so nobody reopens it.

**D1. Page loads come from `chrome.webRequest`, requests and console from
the existing wrapper.** The user's own example — `POST /users/1/edit 302 →
/users` — is a top-level form post and its redirect. The in-page fetch
wrapper never sees it (it is not a fetch), and `performance` navigation
timing has no method and no intermediate URLs. `webRequest` with
`types: ["main_frame"]` gives method, status, the redirect target and
the error for every leg, under one `requestId`. It is observational only
(no `blocking`, no `requestBody`, no headers requested). The `webRequest`
permission carries **no install warning**, so adding it does not disable
the extension on update. Requests and console stay on the wrapper:
`webRequest` only reports hosts the extension holds a grant for, so an
API on another origin (`api.app.test`) would be invisible to it, while the
in-page wrapper sees every `fetch`/XHR the page makes.

**D2. SPA route changes come from `chrome.tabs.onUpdated`.** A
`changeInfo.url` on a tracked tab with no `main_frame` request for that
tab in flight is a client-side navigation: recorded as a navigation leg
with method `—` and no status (`via: "spa"`). No `webNavigation`
permission — it carries the "read your browsing history" warning.

**D3. The trail lives in `chrome.storage.session`, one key per tab**
(`enloop:trail:<tabId>`), written through one serialized queue like
`capture.ts`. Session storage survives the worker sleeping and dies with
the browser, which is the right lifetime for "what just happened". One key
per tab so a chatty tab never rewrites another tab's trail. Removed on
`chrome.tabs.onRemoved`; moved on `chrome.tabs.onReplaced`.

**D4. Pruning rule, exact.** A tab's trail is a list of pages, oldest
first. With retention `{ pages: P, minutes: M }` (defaults **P = 5, M =
10**), page *i* of *n* is kept when `i >= n - 2` (the last two pages,
always) **or** (`i >= n - P` **and** the page's `lastAt` is within *M*
minutes of now). `lastAt` is the time of the page's newest event, not its
load, so a page the user sat on for 20 minutes while things happened is
still "recent". Pruning runs on every trail write and on every read. No
`alarms` permission, no timer: a trail nobody writes to and nobody reads
costs nothing by sitting there, and its tab closing deletes it.
Hard caps per page: **150 events** (oldest non-navigation events dropped
first, counted in `page.dropped`); per tab: the page rule above is the
cap. Retention is configurable in Settings: pages 2–20, minutes 1–120.

**D5. What the trail records, and never records.** Navigation legs
(method, redacted URL, status, redirect target, error), requests (method,
redacted URL, status, duration), console `error`/`warn`/`uncaught` with a
stack. **Never** `log`/`info`/`debug`, headers, bodies, form data, query
strings (`?…` as everywhere else), cookies. The trail is in memory only;
nothing reaches disk until the user presses Save, and then only the lines
they left ticked.

**D6. Marking a site is the consent.** Console capture during runs is off
by default because the console can carry customer data. Marking a working
site turns on the trail for that origin only — it is the explicit act.
Marking requests host access for the origin (`requestSiteAccess`) if it is
not granted yet. Unmarking deletes every trail for that origin
immediately.

**D7. One wrapper, two consumers.** The relay announces to the wrapper the
*union* of what anyone wants: for a page whose `location.origin` is a
working site, `{ console: true, network: "all" }`; otherwise the capture
setting as today. The worker then filters per consumer: the run target
gets only what the run capture setting asks for (new filter
`wantedForRun(entry, settings)`, the exact logic of the wrapper's `wants` +
`wantsEveryRequest` moved worker-side), the trail gets errors, warnings,
uncaught and network for tabs whose top-level URL is a working site.
Registration: wanted when the capture setting is on **or** any working
site exists; matches are all granted origins when capture is on,
otherwise the working sites' origin patterns only.

**D8. The request URL travels on the entry.** `CapturedEntry.request`
gains an optional `url` (redacted, as `text` already is). The wrapper's
`reportRequest` sets it. Additive; nothing that reads `request` today
breaks, and the trail does not parse URLs back out of `text`.

**D9. The composer shows exactly what it writes.** One pure function,
`intakeContextItems(trail, now)` in `shared/src/intake.ts`, turns a trail
into a list of items; one pure function, `renderIntake(intake, items)`,
writes the Markdown. The composer's preview renders each item's `line` —
the very string `renderIntake` will emit for it — in monospace with a
checkbox. No second formatter, ever.

**D10. Default selection** (what is ticked when the composer opens):

| Item | Default |
|---|---|
| The page (title + URL) | on |
| Navigation line of the last two pages | on |
| Navigation line of older kept pages | off |
| Request with status ≥ 400 or failed, last two pages | on |
| Non-GET request (any status), last two pages | on |
| Successful GET requests | **off**, collapsed into one row "N GET requests" that expands |
| Console `error` / `uncaught`, last two pages | on |
| Console `warn` | off |
| Anything on older kept pages | off, under a collapsed "Earlier pages (k)" |
| Screenshot | off, offered only when one was captured (D12) |

Requests and console lines are deduplicated with the capture digest's key
(`method|url|status` / `level|normalizeMessage(text)`) per page, with
`×N`. A navigation line is one per page, legs joined with ` · `:

```
Navigation: GET /users/1/edit 200 · POST /users/1/edit 302 → /users · GET /users 200
```

Paths are shown origin-relative when on the working site's origin, full
otherwise. The preview header shows a character count of the ticked
lines (`≈ 412 characters`) so "am I adding too much" has a number.

**D11. Which folder a note goes to.** A working site is stored as
`{ origin, storageId, addedAt }`. When marking, the storage is suggested
in this order: a connected storage whose `environments.json` has an
environment with a domain value whose origin equals the site's origin; else
the workspace default storage. The Settings list lets the user change it.
If that storage is not connected when composing, the composer shows a
storage picker instead of failing. If it is the browser-only Inbox (OPFS)
storage, the composer says, once, under the Save button: *Skills cannot
read this storage — connect the project folder to have /enloop:check see
this note.*

**D12. Screenshot only when it is free.** The shortcut and the
context-menu item are gestures that grant `activeTab`, so the worker
captures the visible tab at that moment (same code path as
`screenshot.ts`) and hands it to the composer. Opened from the panel
button there is no screenshot and no screenshot row. Off by default
(D10). Stored as `intake/<id>/screenshot.png`.

**D13. Opening the composer.** The command `new-note`
(`Alt+Shift+N`, description "Write an Enloop note about this page") and
the context-menu item "Write an Enloop note about this page" both:
**first, synchronously in the listener**, call
`chrome.sidePanel.open({ windowId: tab.windowId })` — any `await` before
it loses the user gesture and Chrome refuses; then capture the screenshot;
then write `enloop:intake-request:<windowId>` = `{ tabId, url, at,
screenshotDataUrl? }` to `chrome.storage.session`. The panel consumes that
key on mount and on `storage.onChanged` (one mechanism whether the panel
was closed or open), deletes it, and pushes the composer screen. A request
older than 30 s is ignored and deleted. The command works on any tab; on a
tab that is not a working site the composer opens with only the page item
and a line *This site is not tracked — mark it to attach what happened
before* with the mark button.

**D14. The composer.** Textarea autofocused; `Ctrl/Cmd+Enter` saves;
`Esc` goes back. Save is disabled while the text is empty. After save the
panel pops back to where it was and shows a one-line confirmation:
*Noted. `/enloop:check` will offer it.* If the text looks like it carries
a secret (`looksLikeSecretValue`, D17), an inline warning shows under the
box — not a block: *Notes are written to the data folder. Leave the
password out.*

**D15. On disk.** `<data folder>/intake/<intakeId>/`:

- `intake.json` — `intakeFileSchema` (section 3). The only mutable file.
- `intake.md` — written once at save, plus a `## Resolution` section
  appended when resolved. Never rewritten otherwise.
- `screenshot.png` — only when ticked.

`intake/` is git-ignored (`ensureGitignore` `NEEDED` gains `"intake/"`):
it carries URLs and console text from a live session, like `runs/`.
Ids: `intake-<ISO stamp with [:.] → ->-<shortId>`, sorting chronologically
like run ids.

**D16. `/enloop:check` and the inbox.** A new CLI command `inbox`
prints the newest finished run, whether it was already checked, and the
open notes. A run is *checked* when its folder has `checked.json`, which
`check` writes at the end of its report via `enloop-case.mjs
mark-checked`. The choice rule in the skill (exact text in Part 6):

- `$ARGUMENTS` names a run or case → that run, no question (unchanged).
- `$ARGUMENTS` is `note`, `notes`, `intake` or an intake id → notes.
- No argument: unchecked run and open notes → **ask once**, run first and
  marked default; only one of the two → take it without asking; neither
  → say so (newest checked run is offered as before).

A note is worked as an instruction from the person who works on this app:
locate the code from the note and its context, then **make the change**
when the note asks for a behaviour change and the change is located with
confidence and confined to the app's own code; **ask** when it is
ambiguous, cross-cutting, a product question, or contradicts a case the
project has. Never commits. Resolves the note with `enloop-case.mjs intake
<dir> <id> --done --note "<one line: what changed, file:line>"` or
`--dismiss --note "<why>"`.

**D17. Passwords.** `shared/src/secrets.ts` gains
`looksLikeSecretValue(text)`: true when
`/\b(password|passwd|pwd|passcode|token|secret|api[ _-]?key)\b\s*[:=]\s*\S+/i`
matches. Used only by the composer's warning. The banned-name rule in
[[enloop-no-passwords]] is unchanged.

**D18. No links, no sharing.** Nothing in this feature produces a viewer
link or sends anything anywhere. Notes are files in the data folder.

---

## 3. Schema and pure functions — `shared/src/intake.ts`

Export from `shared/src/index.ts`; export `intakeFileSchema`,
`renderIntakeResolution` and `newIntakeId` from
`shared/src/plugin-entry.ts` (the validator needs them).

```ts
import { z } from "zod";

// ---- the trail (in memory, worker-side) ----

export interface TrailNavLeg {
  at: string;              // ISO
  method: string;          // "GET", "POST", … or "—" for an SPA change
  url: string;             // redacted: origin + path + "?…" when a query existed
  status: number | null;   // null: failed, or SPA change
  redirectTo?: string;     // redacted target of a 3xx
  error?: string;          // webRequest onErrorOccurred.error
  via: "load" | "spa";
}

export type TrailEvent =
  | { kind: "request"; at: string; method: string; url: string; status: number | null; durationMs: number }
  | { kind: "console"; at: string; level: "error" | "warn" | "uncaught"; text: string; stack?: string };

export interface TrailPage {
  seq: number;             // monotonically increasing per tab
  url: string;             // redacted final URL of the page
  title?: string;          // from tabs.onUpdated changeInfo.title
  startedAt: string;
  lastAt: string;          // newest event's `at` (or startedAt)
  nav: TrailNavLeg[];      // the legs that produced this page, in order
  events: TrailEvent[];    // capped at TRAIL_MAX_EVENTS_PER_PAGE
  dropped: number;
}

export interface TabTrail { tabId: number; nextSeq: number; pages: TrailPage[] }

export interface TrailRetention { pages: number; minutes: number }
export const DEFAULT_TRAIL_RETENTION: TrailRetention = { pages: 5, minutes: 10 };
export const TRAIL_ALWAYS_KEEP_PAGES = 2;
export const TRAIL_MAX_EVENTS_PER_PAGE = 150;

/** D4, exactly. Returns a new trail; never mutates. Clamps retention to
 * pages 2–20, minutes 1–120. */
export function pruneTrail(trail: TabTrail, retention: TrailRetention, now: Date): TabTrail;

/** Appends to the newest page, creating a page when there is none (an
 * event before any load seen — the tab predates marking). Enforces the
 * per-page cap (drop oldest event, bump `dropped`) and updates `lastAt`. */
export function appendTrailEvent(trail: TabTrail, event: TrailEvent, pageUrl: string): TabTrail;

/** Starts a new page from a finished navigation chain. */
export function startTrailPage(trail: TabTrail, legs: TrailNavLeg[], finalUrl: string, at: string): TabTrail;

// ---- the composer's items (D9, D10) ----

export type IntakeItemGroup = "page" | "navigation" | "request" | "console" | "screenshot";

export interface IntakeContextItem {
  id: string;              // stable within one trail snapshot: "page", "nav:<seq>", "req:<seq>:<key>", "con:<seq>:<key>", "shot"
  group: IntakeItemGroup;
  pageSeq: number | null;
  recent: boolean;         // on one of the last two pages
  defaultOn: boolean;      // D10
  /** Collapsed under "N GET requests" in the composer. */
  quietGet: boolean;
  /** The exact Markdown line renderIntake writes for this item, without
   * the leading "- ". */
  line: string;
  at: string;              // first occurrence, for ordering
}

export function intakeContextItems(
  trail: TabTrail | null,
  page: { url: string; title?: string },
  opts: { hasScreenshot: boolean },
): IntakeContextItem[];
```

`line` formats, *decided* (`<p>` = origin-relative path per D10; `(on
<p>)` names the page the line happened on and is omitted on the page the
note was written from):

```
Page: <title> — <full redacted url>                  (title omitted when absent)
Navigation: GET /users/1/edit 200 · POST /users/1/edit 302 → /users · GET /users 200
Navigation: — /users/42 (in-page)                      (an SPA leg)
Navigation: GET /reports failed (net::ERR_CONNECTION_REFUSED)
Request: PUT /api/users/1 200 (on /users/1/edit)
Request failed: GET /api/stats 500 ×2
Request failed: POST https://api.app.test/v1/sync failed
Console error ×3: TypeError: Cannot read properties of undefined (reading 'id') (on /users/1/edit)
Console warning: Each child in a list should have a unique "key" prop.
Screenshot: screenshot.png
```

Console lines: the text is cut at 200 characters with `…`. Stacks are not
in the line; `renderIntake` writes the collapsed stack (reuse
`collapseStack` — export it from `capture.ts`) under the bullet, indented,
for ticked console items only. The preview shows the stack too, greyed,
under its line.

Item order: `page` first, then everything else by `at` ascending,
`screenshot` last.

```ts
// ---- on disk ----

export const INTAKE_STATUSES = ["open", "done", "dismissed"] as const;

export const intakeFileSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  /** First line of the note, ≤ 80 chars — what lists show. */
  title: z.string(),
  status: z.enum(INTAKE_STATUSES),
  page: z.object({ url: z.string(), title: z.string().optional() }),
  /** The working site's origin, or the page's origin when not tracked. */
  origin: z.string(),
  hasScreenshot: z.boolean().default(false),
  /** Item ids that were written, so a reader knows what was left out
   * deliberately vs never recorded. */
  included: z.array(z.string()).default([]),
  /** How many offered items the user unticked. */
  excluded: z.number().int().nonnegative().default(0),
  resolvedAt: z.string().nullable().default(null),
  resolution: z.string().nullable().default(null),
});
export type IntakeFile = z.infer<typeof intakeFileSchema>;

export function newIntakeId(): string; // in id.ts, beside newFreeRunId

export function intakeTitle(note: string): string; // first non-empty line, ≤ 80, "…" when cut

export function renderIntake(file: IntakeFile, note: string, items: IntakeContextItem[]): string;
export function renderIntakeResolution(status: "done" | "dismissed", text: string, at: string): string;
```

`renderIntake` output, exactly this shape:

```markdown
# Note: <title>

Written <YYYY-MM-DD HH:MM> (local time) on <page url>.

<note text, verbatim>

## Context

Captured by Enloop from this tab. Query strings are shown as `?…`; no
headers, bodies or form data were recorded.

- Page: Users — https://app.test/users
- Navigation: GET /users/1/edit 200 · POST /users/1/edit 302 → /users · GET /users 200
- Request: PUT /api/users/1 200 (on /users/1/edit)

<k> further lines were available and left out by the writer.   (only when excluded > 0)
```

When no item is ticked the `## Context` section is
`No context was attached.` and nothing else. `renderIntakeResolution`
appends:

```markdown

## Resolution

Done <YYYY-MM-DD HH:MM>: <text>
```

(`Dismissed …` for `dismissed`.)

---

## 4. Parts

Each part leaves the tree typechecking and the plugin rebuilt. Do them in
order. Run the gate at the end of each before starting the next. Scratch
files go under the session scratchpad (`$S`), never `/tmp`.

### Part 1 — Shared: trail, items, render, schema

**Files:** new `shared/src/intake.ts`; `shared/src/id.ts`
(`newIntakeId`); `shared/src/capture.ts` (export `collapseStack`,
`normalizeMessage`; add `url?: string` to `CapturedEntry.request` with a
doc line pointing at D8); `shared/src/secrets.ts`
(`looksLikeSecretValue`); `shared/src/index.ts`;
`shared/src/plugin-entry.ts`. Then `npm run build:plugin`.

For the gate, also export `pruneTrail`, `startTrailPage`,
`appendTrailEvent`, `intakeContextItems`, `renderIntake` from
`plugin-entry.ts` — they are pure and tiny, and this is how they get
tested.

**Gate 1.** `npm run typecheck` passes. Then a node script in `$S`
importing `plugins/enloop/validator/lib.mjs`:

1. Build a trail of 7 pages with `startTrailPage`, `lastAt` of pages 1–4
   at now − 30 min, pages 5–7 at now − 1 min. `pruneTrail(t, {pages: 5,
   minutes: 10}, now)` keeps exactly pages 5, 6, 7. With all seven at
   now − 30 min it keeps exactly 6, 7 (the always-keep rule). With all
   seven at now − 1 min it keeps 3–7.
2. Append 160 events to one page: 150 remain, `dropped === 10`, and the
   page's `nav` is untouched.
3. The user's scenario: page A = `GET /users/1/edit 200`; on A a
   `PUT https://app.test/api/users/1 200` request; page B legs =
   `POST /users/1/edit 302 → /users`, `GET /users 200`; on B 12 GET
   requests 200 and one console error twice. `intakeContextItems` for
   page B (`title: "Users"`) returns, in order: `Page: Users —
   https://app.test/users`; the navigation line for A; `Request: PUT
   /api/users/1 200 (on /users/1/edit)`; the navigation line for B equal
   to `Navigation: POST /users/1/edit 302 → /users · GET /users 200`; one
   console item with `×2`; 12 `quietGet` items with `defaultOn: false`.
   Every non-quiet item above has `defaultOn: true`.
4. `renderIntake` with the default-on items contains each item's `line`
   prefixed `- `, verbatim, and `12 further lines were available…` when
   `excluded` is 12.
5. `looksLikeSecretValue("password: hunter2")` is true;
   `looksLikeSecretValue("the password field is misaligned")` is false.
6. A URL with a query (`/users?token=abc`) never appears with its query
   in any `line`.

### Part 2 — Worker: working sites, the trail, routing

**Files:** new `extension/src/lib/working-sites.ts`; new
`extension/src/background/trail.ts`; `extension/src/background/capture.ts`;
`extension/src/background/index.ts`; `extension/public/console-relay.js`;
`extension/public/console-capture.js`; `extension/manifest.config.ts`.

1. `working-sites.ts` (importable by panel and worker):
   - `WORKING_SITES_KEY = "enloop:working-sites"` in
     `chrome.storage.local`, value `WorkingSite[]` with
     `{ origin: string; storageId: string; addedAt: string }`.
   - `TRAIL_RETENTION_KEY = "enloop:trail-retention"`, value
     `TrailRetention`.
   - `readWorkingSites()`, `writeWorkingSites()`, `addWorkingSite(origin,
     storageId)`, `removeWorkingSite(origin)`, `isWorkingOrigin(sites,
     url)`, `readRetention()`, `writeRetention()`.
   - `TRAIL_GET_MESSAGE = "enloop:trail-get"` (`{ tabId }` → `{ trail:
     TabTrail | null }`, pruned), `INTAKE_REQUEST_KEY_PREFIX =
     "enloop:intake-request:"`.
   - Duplicate `WORKING_SITES_KEY` as a literal in `console-relay.js`
     with the same "change both" comment `CAPTURE_SETTINGS_KEY` has.
2. `trail.ts`:
   - Its own `serialize` queue (same shape as `capture.ts`) over
     per-tab keys `enloop:trail:<tabId>` in `storage.session`.
   - A module-level cache of working sites and retention, loaded lazily,
     invalidated on `storage.onChanged` for either key.
   - `chrome.webRequest.onBeforeRequest`, `onBeforeRedirect`,
     `onCompleted`, `onErrorOccurred`, each with filter `{ urls:
     ["<all_urls>"], types: ["main_frame"] }` and **no** extra info spec.
     Keep an in-memory `Map<requestId, { tabId, legs: TrailNavLeg[] }>`:
     `onBeforeRequest` opens or extends the chain (a redirected request
     fires it again with the same id and the new URL/method);
     `onBeforeRedirect` closes the current leg with `statusCode` and
     `redirectUrl`; `onCompleted`/`onErrorOccurred` close the last leg and
     call `startTrailPage` — but only when the tab's top-level origin at
     *chain start* or the final URL's origin is a working site. A chain
     lost to the worker sleeping mid-navigation simply records the page
     with no legs (`startTrailPage` with `[]` on the next event for that
     tab); do not try to persist the map.
   - `chrome.tabs.onUpdated`: `changeInfo.url` on a tracked tab with no
     open chain for that tab → append an SPA leg as a new page
     (`startTrailPage` with one `via: "spa"` leg). `changeInfo.title` →
     set the newest page's `title`.
   - `chrome.tabs.onRemoved` → delete the key. `onReplaced(added,
     removed)` → move the key.
   - Exported `acceptTrailEntries(tab, entries: CapturedEntry[])` called
     by `capture.ts` (below): for each entry of level `error`, `warn`,
     `uncaught` or `network`, map to a `TrailEvent` (network: method,
     `request.url` falling back to the entry `url`, status, duration) and
     `appendTrailEvent`. Everything else is dropped here.
   - The `TRAIL_GET_MESSAGE` handler returns the pruned trail.
   - On working-sites change, delete trails of tabs whose origin is no
     longer working (D6): `chrome.tabs.query({})`, check each tab's URL.
   - Every read and write calls `pruneTrail` with the cached retention.
3. `capture.ts`:
   - `acceptBatch` receives `sender.tab` (not just the window id). It
     forwards the batch to `acceptTrailEntries` when the tab's URL is a
     working site, then — for the run target — keeps only entries passing
     `wantedForRun(entry, settings)` (D7), reading capture settings
     through the same lazy cache pattern.
   - `syncCaptureRegistration`: `wanted` is `captureIsOn(settings) ||
     sites.length > 0`; `matches` per D7 (working-site patterns are
     `${origin}/*`; keep only those also in `grantedMatches()` — Chrome
     refuses a registration for an ungranted host). React to
     `WORKING_SITES_KEY` changes in the existing `storage.onChanged`
     listener.
4. `console-relay.js`: read both keys; `announce` sends the union per D7
   when `location.origin` is a working site. Re-announce on a change to
   either key.
5. `console-capture.js` `reportRequest`: add `url: redactUrl(url)` to
   `request`. Update the `STATE_EVENT` comment: network is `"off" |
   "failed" | "all"`.
6. `manifest.config.ts`: add `"webRequest"` to `permissions`, and extend
   the long comment above it with one paragraph: observational only, no
   install warning, fires only for granted hosts, used for the page loads
   of working sites (D1). Add the `new-note` command (`Alt+Shift+N`).
7. `background/index.ts`: `installTrailListeners()` at top level (the
   `webRequest` listeners must be registered synchronously at worker
   start, or Chrome does not wake the worker for them).

**Gate 2.** `npm run typecheck && npm run build` clean;
`extension/dist/manifest.json` lists `webRequest` and the `new-note`
command and no new host permission. The worker bundle has no reference
to `requestBody` or `extraHeaders` (`grep -c` returns 0). Runtime checks
are in Gate 5.

### Part 3 — Store: intake on disk

**Files:** `shared/src/storage.ts` (new `IntakeStore`, added to
`DataStore`); `extension/src/lib/fsa-store.ts`;
`extension/src/lib/workspace-store.ts`;
`extension/src/lib/storage-registry.ts`; any other `DataStore`
implementation the typechecker names (implement as "not supported" the
way that implementation already does for free runs, if it does).

```ts
export interface IntakeInput {
  note: string;
  page: { url: string; title?: string };
  origin: string;
  items: IntakeContextItem[];   // the ticked ones, in display order
  excluded: number;
  screenshotPng?: Uint8Array;   // only when the screenshot item is ticked
}

export interface IntakeStore {
  listIntake(): Promise<IntakeFile[]>;                 // newest first
  getIntake(id: string): Promise<{ file: IntakeFile; markdown: string }>;
  createIntake(input: IntakeInput): Promise<IntakeFile>;
  setIntakeStatus(id: string, status: IntakeFile["status"], resolution?: string): Promise<IntakeFile>;
  deleteIntake(id: string): Promise<void>;
  readIntakeScreenshot(id: string): Promise<Uint8Array>;
}
```

- `fsa-store.ts`: `INTAKE_DIR = "intake"`, files `intake.json`,
  `intake.md`, `screenshot.png`. Mutations under `this.locked(\`intake/${id}\`, …)`.
  `createIntake` writes `screenshot.png` first, then `intake.md`
  (`renderIntake`), then `intake.json` last — the json is the "this note
  exists" marker, so a note half-written by a crash is invisible rather
  than broken. `listIntake` skips folders without a parseable
  `intake.json`. `setIntakeStatus` to `done`/`dismissed` with a
  resolution appends `renderIntakeResolution` to `intake.md`; back to
  `open` clears `resolvedAt`/`resolution` in the json and leaves the md
  alone.
- `workspace-store.ts`: fan-out `listIntake` (tag ids, re-sort newest
  first), routed get/set/delete/read, `createIntakeIn(storageId, input)`
  plus the default-storage `createIntake`. Tag helper `tagIntake` beside
  the others — namespacing lives only there.
- `storage-registry.ts` `ensureGitignore`: add `"intake/"` to `NEEDED`.

**Gate 3.** `npm run typecheck && npm run build` clean. `ensureGitignore`'s
`NEEDED` contains `intake/`. (Disk behaviour is exercised in Gate 5 and by
the CLI in Gate 4 against files the panel wrote.)

### Part 4 — CLI: `intake`, `inbox`, `mark-checked`

**Files:** `plugins/enloop/validator/enloop-case.mjs` (three new `case`
blocks, plus the usage text); `npm run build:plugin`; bump
`plugins/enloop/.claude-plugin/plugin.json` to `0.21.0` (and anywhere else
the plugin version is mirrored — `grep -rn '0.20.1' plugins/`).

```
enloop-case.mjs intake <data folder>                     open notes, newest first
enloop-case.mjs intake <data folder> --all               every note, with status
enloop-case.mjs intake <data folder> <id>                print intake.md, then the path of its folder
enloop-case.mjs intake <data folder> <id> --done --note "<text>"
enloop-case.mjs intake <data folder> <id> --dismiss --note "<text>"
enloop-case.mjs intake <data folder> <id> --reopen
enloop-case.mjs inbox <data folder>
enloop-case.mjs mark-checked <run folder> --verdict "<one line>"
```

Output, exact formats (one record per line, two spaces between fields):

```
NOTE  intake-2026-10-06T14-03-11-201Z-1a2b3c4d  2026-10-06 14:03  After edit user I land on the list…  https://app.test/users
```

`--all` appends the status as a fifth field. `--done`/`--dismiss`
require `--note` (exit 2 with usage otherwise), write via the same
semantics as `setIntakeStatus`, print `RESOLVED <id> done`. An id that
does not exist: `MISSING <id>`, exit 1. A prefix of an id is accepted
when unique (`intake-2026-10-06T14` is enough).

`inbox`:

```
RUN   <run folder>  <case title>  finished 2026-10-06 13:40  unchecked
NOTE  … (as above, every open note, oldest first)
DEFAULT run
```

- `RUN` is the newest run with `finishedAt` set (same rule as check's
  step 2), `checked <date>` instead of `unchecked` when `checked.json`
  exists. Absent when there are no finished runs.
- `DEFAULT` is `run` when the run is unchecked; `notes` when the run is
  checked or absent and notes exist; `run` when no notes exist and a run
  does (checked or not); `none` otherwise.
- Exit 0 always; this is a listing.

`mark-checked <run folder> --verdict "…"` writes
`checked.json` = `{ "at": <ISO>, "verdict": "<text>" }`, prints
`CHECKED <run folder>`. Refuses (exit 1) a folder without `run.json`.

**Gate 4.** In `$S/data`: `mkdir -p runs/c1/run-2026-10-06T10-00-00-000Z-aaaa`
with a `run.json` that has `finishedAt` and a `case.md` whose title line
is `# Shop: Edit user`; two intake folders written with `intake.json` +
`intake.md` built by a node script calling `renderIntake` from `lib.mjs`
(status `open`, created 10:05 and 10:10), and a third folder with only an
`intake.md` (half-written).

- `inbox` prints one `RUN … unchecked`, two `NOTE` lines oldest first,
  `DEFAULT run`. The half-written folder does not appear.
- `mark-checked` on the run, then `inbox` → `checked 2026-…`, `DEFAULT
  notes`.
- `intake $S/data <prefix of first id> --done --note "kept on edit form:
  src/UserController.php:88"` → `RESOLVED`; its `intake.json` has
  `status: "done"`, `resolvedAt` set; its `intake.md` ends with the
  `## Resolution` block; `intake $S/data` lists one note; `--all` lists
  three fields + status for both.
- `--done` without `--note` exits 2. An unknown id prints `MISSING`.
- `npm run build:plugin` leaves `git status` showing only `lib.mjs`
  regenerated (plus the files this plan names).

### Part 5 — Panel: marking a site, the composer, the notes list

**Files:** `extension/src/lib/nav-state.ts`; `extension/src/sidepanel/App.tsx`;
new `extension/src/sidepanel/screens/NoteComposerScreen.tsx`,
`NotesScreen.tsx`, `NoteDetailScreen.tsx`; new
`extension/src/components/WorkingSiteStrip.tsx`;
`extension/src/sidepanel/screens/LibraryScreen.tsx`;
`extension/src/sidepanel/screens/SettingsScreen.tsx`; new
`extension/src/sidepanel/useIntakeRequest.ts`;
`extension/src/background/screenshot.ts` (the `new-note` command and menu
item, D13); `extension/src/sidepanel/store/DataStoreProvider.tsx` if the
store surface needs exposing.

1. **Screens.** `Screen` gains `{ kind: "noteNew"; tabId?: number;
   requestAt?: string }`, `{ kind: "notes" }`, `{ kind: "note"; intakeId:
   string }`; `isScreen` accepts them. Wire in `App.tsx` like the others.
2. **`useIntakeRequest`** (mounted once in `Shell`): reads and watches
   `enloop:intake-request:<thisWindowId>`, ignores > 30 s old, deletes the
   key, pushes `noteNew` with `tabId` and `requestAt`. The screenshot data
   URL stays in session storage under
   `enloop:intake-shot:<windowId>` (written by the worker with the
   request) and is read and deleted by the composer — never put a data URL
   in the nav stack.
3. **`WorkingSiteStrip`** at the top of the Library, for the active tab
   (`useActivePageUrl`), only for `http(s)` pages:
   - not tracked: `app.test` · button **Track this site** → requests
     access if needed (`requestSiteAccess`, must run in the click
     handler), suggests the storage per D11, `addWorkingSite`. Then shows
     *Tracking. Reload the tab to include console errors and API requests*
     with **Reload** (`reloadActiveTab`) while `wrapperState()` is
     `absent`.
   - tracked: `app.test` · *tracked* · **New note** (pushes `noteNew` with
     the active tab id) · a small **Stop** link (removes the site).
   - The Library header also gets a **Notes** entry showing the open count
     when > 0 (`listIntake` filtered to `open`), pushing `notes`.
4. **`NoteComposerScreen`**:
   - Resolves the tab (`tabId` or the active tab), its URL and title
     (`chrome.tabs.get`), the working site and its storage, the trail
     (`TRAIL_GET_MESSAGE`), the screenshot if any.
   - `intakeContextItems(...)` once on mount; the trail is a snapshot —
     events arriving while the user types do not reshuffle the list.
   - Layout: textarea (autofocus, 4 rows, grows); under it the heading
     **Will be added to your note** and `≈ N characters`; then the items:
     recent items, each a row `[✓] <line in monospace>` (console stacks
     greyed under their line); the quiet GETs as one row "N GET requests"
     that expands to their rows; "Earlier pages (k)" collapsed, expanding
     to its rows (all unticked). Untracked site: only the page row plus
     the D13 line with a **Track this site** button that, once tracked,
     shows *Tracking from now on — this note has no earlier context.*
   - Footer: storage label (picker when ambiguous/disconnected, D11),
     the OPFS warning when applicable, **Save note** (`Ctrl/Cmd+Enter`).
   - Secret warning per D14.
   - Save → `createIntakeIn(storageId, …)` with ticked items in display
     order, `excluded` = offered − ticked, screenshot bytes when ticked →
     pop → confirmation line on the screen below (pass through the
     existing notice mechanism if one exists; otherwise a transient
     banner in `Shell` for 4 s).
5. **`NotesScreen`**: open notes newest first (title, page path, age);
   then a collapsed "Done and dismissed (n)". Row → `note`.
6. **`NoteDetailScreen`**: renders `intake.md` with the existing
   `Markdown` component and the screenshot if any; buttons **Mark done**,
   **Dismiss**, **Reopen** (whichever apply; a resolution typed in the
   panel is optional — empty becomes "Resolved in the panel."), and
   **Delete** with an in-panel two-step confirm (never a browser
   `confirm()` dialog).
7. **Settings**: a **Working sites** section below capture: each origin
   with its storage (select over connected storages) and **Remove**;
   retention as two number inputs *Keep the last [5] pages, and nothing
   older than [10] minutes — the last 2 pages are always kept.* Clamped to
   D4's ranges on blur.
8. **`screenshot.ts`**: the `new-note` command and a second context-menu
   item, both per D13 (`sidePanel.open` first, synchronously). The
   capture reuses `captureVisibleTab`; failure means no screenshot, not
   an error.

**Gate 5 — in a loaded extension; left to the user if it cannot be
driven from this session.** Load `extension/dist` unpacked, connect a
data folder, use any local app with a form that posts and redirects (or
the repo's demo site). Each item is a pass/fail check:

1. Track the site from the Library strip; the browser asks for site
   access once; reload when told to.
2. Open an edit page, save it (POST → redirect to the list). Press
   `Alt+Shift+N`: the panel opens on the composer, focused, and the
   preview shows a navigation line containing `POST /…/edit 30x → /…` and
   `GET /… 200`.
3. Untick one line; the character count drops; save. The file on disk
   contains every ticked line verbatim and not the unticked one, and ends
   with `1 further line was available…`.
4. Visit 8 pages over a minute, open the composer: at most 5 pages'
   items are offered (2 recent + up to 3 earlier). Change retention to 1
   minute, wait 2 minutes, open again: exactly the last 2 pages' items.
5. A page that throws in the console: the error appears ticked; a warning
   appears unticked.
6. Close the tab; `chrome.storage.session` (inspect the worker) has no
   `enloop:trail:<that tabId>`. Stop tracking the site: every trail key
   for its tabs is gone.
7. On an untracked site, `Alt+Shift+N` opens the composer with only the
   page line and the *not tracked* hint.
8. With run capture **off** and a tracked site, start a run on that
   site: the run's `console.jsonl` stays empty (the wrapper forwards for
   the trail; the run filter drops it). With run capture on at `failed`,
   only failures reach the run although the wrapper forwards everything.
9. Notes list shows the open count; Mark done moves it under *Done and
   dismissed*.

### Part 6 — `/enloop:check` reads the inbox

**Files:** `plugins/enloop/skills/check/SKILL.md`;
`plugins/enloop/references/data-folder.md`.

1. Frontmatter `description`: add one sentence — *Also works the notes
   the developer wrote from the page with the extension (open intake),
   asking which to take first when a run is also waiting.*
2. Opening: `$ARGUMENTS` may also be `note`, `notes`, `intake`, or an
   intake id.
3. Replace the first paragraph of step 2 ("Find the run") with a new
   **step 2, "Choose what to check"**, and renumber the old step 2 to
   2a ("Find the run"):

   > ```bash
   > node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" inbox "$DATA_DIR"
   > ```
   >
   > It prints the newest finished run, whether a check already covered
   > it, and every open note. Decide:
   >
   > - `$ARGUMENTS` names a run or case → that run (2a). Do not mention
   >   the notes until the report's last line ("2 open notes are waiting").
   > - `$ARGUMENTS` is `note`/`notes`/`intake`/an intake id → step 9.
   > - No argument, `DEFAULT run` **and** at least one `NOTE` → ask once,
   >   one question, the run first and marked as the default:
   >   *Last run: <case title> (<finished>)* / *Notes (<n>): <first
   >   title>…* / *Both — the run, then the notes*. Under Claude Code use
   >   the question tool; elsewhere ask in one line and take the run if
   >   the answer is empty.
   > - Otherwise follow `DEFAULT` without asking: `run` → 2a, `notes` →
   >   step 9, `none` → say there is nothing waiting and name the newest
   >   checked run in case they meant it.

4. Step 8 (Report): add at the end — *Then mark the run as checked so the
   next `/enloop:check` does not offer it again:* `enloop-case.mjs
   mark-checked "<run folder>" --verdict "<your first report line>"`. Not
   for a `feedback.md` handed over without a run folder.
5. New **step 9, "Work a note"**, after step 8:

   > A note is a request from the person who works on this app, written
   > from the page the moment they noticed something, with what the
   > browser saw attached. Take open notes oldest first, one at a time.
   >
   > ```bash
   > node "$ENLOOP_PLUGIN/validator/enloop-case.mjs" intake "$DATA_DIR" <id>
   > ```
   >
   > 1. Read the note, then its `## Context`. The navigation lines are
   >    the route trail: map each path to its route and handler in this
   >    repo (`rg` the path pattern, the router config) before anything
   >    else — *`POST /users/1/edit 302 → /users`* names the handler that
   >    issued the redirect, which is usually the whole answer. A failed
   >    request names an endpoint; a console error names a file through
   >    its stack.
   > 2. Say in one line what the note asks for and where it lives
   >    (`file:line`).
   > 3. **Act.** When the note asks for a behaviour change or reports a
   >    bug, and you have located the code with confidence and the change
   >    is confined to this app's own code, make the change — the note is
   >    the developer's own instruction, and asking them to confirm what
   >    they just wrote is friction. **Ask instead** when the note is
   >    ambiguous, would change behaviour other screens rely on, is a
   >    product question rather than an instruction, or contradicts a
   >    stored case's `Expected` (then name the case and step — one of the
   >    two must change, and that is their call). Never commit.
   > 4. If a stored case covers the flow and the change makes one of its
   >    steps wrong, say which step; do not rewrite the case here.
   > 5. Resolve it:
   >    `enloop-case.mjs intake "$DATA_DIR" <id> --done --note "<what
   >    changed, file:line>"` — or `--dismiss --note "<why>"` when there
   >    is nothing to do (already fixed, works as intended, a duplicate of
   >    another note). Leave it open when you asked a question and got no
   >    answer.
   >
   > The screenshot, when the note has one, is `screenshot.png` in the
   > note's folder; read it when the note talks about something visual.
   > Never paste a note's context into anything outside this repo; it can
   > carry customer data like a run's console log.
   >
   > Report per note: its title, the verdict (changed / asked / dismissed),
   > `file:line`, and the resolution line you wrote.

6. `references/data-folder.md` layout block gains:

   ```
   ├── intake/         <intakeId>/{intake.json, intake.md} + screenshot.png — notes the
   │                   developer wrote from the page; git-ignored, like runs/
   ```

   and the `runs/` line gains `checked.json` (written by
   `/enloop:check`).

**Gate 6.** Reread the edited `SKILL.md` top to bottom: every step
reference resolves (no "step 2" pointing at the renamed one); `npm run
build:plugin` clean. Dry-run the decision table against Gate 4's folder
by hand: `DEFAULT run` with two notes → the question; after
`mark-checked` → straight to notes.

### Part 7 — Docs, privacy, changelog

**Files:** `docs/extension.md` (new section **Notes from the page**
after "Capturing the console and the network"); `docs/skills.md`
"Checking a run" (a paragraph on the inbox and notes); `PRIVACY.md`
("What the extension can read": the trail, on tracked sites only, in
memory, pruned, never on disk until saved; "What the extension stores":
`intake/`); `CHANGELOG.md` under Unreleased: a **Notes from the page**
heading with three bold-lead entries — tracking a site, writing a note
with the preview, check offers notes.

Write in the voice the docs already use: what the reader does and sees,
and why; no feature lists. The extension doc must state, plainly: what is
recorded and what never is (D5), the retention rule with its defaults
(D4), that marking a site is the consent (D6), the shortcut, and that the
note's context is exactly the ticked lines.

**Gate 7.** `npm run typecheck && npm run build:plugin && npm run build`
clean; `git status` shows no generated file outside `lib.mjs` (and
`grammar.md` only if it changed — it should not); `git diff --stat`
matches the files this plan names. Update the status line at the top of
this file to *built <date>; uncommitted* and list anything cut or
changed. Remind the user that Gate 5 is theirs if it was not run.

---

## 5. Out of scope, on purpose

- **Moving run capture's network half to `webRequest`.** Runs keep the
  wrapper. The trail uses `webRequest` only for page loads (D1).
- **Response bodies, request payloads, headers** — at any setting. A note
  that needs the payload says so in its text.
- **A live hand-off of notes to a watching agent** (`/enloop:serve`,
  `enloopd`). Notes are files; a watcher picking them up is a follow-up
  plan once the inbox exists.
- **Turning a note into a test case or a case step.** `/enloop:check`
  may point at the case a note affects (Part 6 step 9.4); writing one is
  the authoring skills' job.
- **Notes from tabs on sites the extension has no grant for** carrying
  context. They get the page line only.
- **Trail across a browser restart.** Session storage is the lifetime by
  design (D3).
- **Assigning notes to people, labels, priorities.** A note is a line in
  a developer's inbox, not a ticket.
