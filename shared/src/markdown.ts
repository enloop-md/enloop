import {
  describeCounts,
  hasCaptureSignal,
  renderCaptureDigest,
  summarizeDigestItem,
  type CaptureCounts,
  type CaptureDigest,
} from "./capture.js";
import {
  COMMENT_AUDIENCES,
  DEFAULT_PHOTO_PAD,
  DEFAULT_SHOT_COLOR,
  PHOTO_MODE,
  PHOTO_TAKE,
  VARIABLE_GENERATORS,
} from "./schemas.js";
import { describeRating, isExemplaryRating, isPoorRating } from "./rating.js";
import { stripViewerComment } from "./viewer-link.js";
import {
  IMPLICIT_DOMAIN_NAMES,
  coldLocation,
  isMainDomainName,
  joinResolvedValue,
} from "./variables.js";
import type {
  CaseKind,
  CommentAudience,
  FreeRunFile,
  PhotoSpec,
  RunScreenshot,
  RunComment,
  RunCommentDraft,
  RunFile,
  RunStepState,
  Step,
  StepType,
  TestCaseVariable,
  TestCaseVersion,
  VariableGenerator,
  TestCaseDomain,
  StepGroup,
} from "./types.js";

/**
 * Format version of this grammar itself — bump only when the grammar below
 * changes in a way that would matter to a parser (new/renamed sections,
 * changed line syntax, etc). Not to be confused with a test case's own
 * v1.md/v2.md version history, which tracks edits to a case's *content*
 * under this same grammar.
 */
export const CURRENT_FORMAT_VERSION = "0.0.13";

/**
 * Grammar. There is no separate spec by design: this comment is it, sitting
 * against the parser that implements it, and `scripts/build-plugin.mjs`
 * lifts it verbatim into the plugin as `references/grammar.md` so the
 * authoring skills read the same words without needing this repo.
 *
 * The very
 * first `# ` heading in the file is special-cased as the case title;
 * every other heading level is one below what you'd naively expect, since
 * that first H1 already "used up" the top level:
 *
 *   # Case title
 *   @version 0.0.1
 *   @author Sergey Ryabenko
 *   @project Careerminds                       (the app under test — which
 *                                                repo/product this case
 *                                                belongs to, so a reader
 *                                                opening the file cold knows
 *                                                what they are looking at)
 *   @kind guide                                (optional — a user guide:
 *                                                the same grammar and run,
 *                                                written for an end user;
 *                                                exported with its
 *                                                screenshots. Absent =
 *                                                an ordinary case)
 *   Tags: auth, smoke
 *   @locations: localhost:8080, *.acme.com     (host globs — where this
 *                                                case is meant to run; see
 *                                                `%DOMAIN%` below)
 *   Goal: A user can sign in with either of      (one plain line — what the
 *   their two email addresses                     case proves; pinned on
 *                                                 screen for the whole run)
 *   You will: log in and out several times,     (one line — the shape of
 *   change the primary and secondary email        the work, read before
 *                                                 Start so nothing mid-run
 *                                                 is a surprise)
 *   Change note: Added SSO redirect check      (the header lines may come
 *                                                 in any order; all are
 *                                                 optional to the parser,
 *                                                 and the linter requires
 *                                                 `Goal:` and `You will:`)
 *
 *   Free text description.                      (background: why the case
 *                                                 exists, which ticket —
 *                                                 not the goal, which has
 *                                                 its own line)
 *
 *   A case is a **goal**, and its steps are how the goal is proved. The
 *   goal is one line a person who has never seen the app understands on
 *   sight, and the run screen keeps it above whatever step is current.
 *   A large goal falls into subgoals — `# Steps: <title>` groups, below,
 *   each with a one-line goal of its own. Before Start the tester also
 *   reads `You will:` and `# You will need`, so they know the shape of
 *   the next few minutes and have everything in hand before step 1.
 *
 *   Every address in a case is written as a domain plus a route —
 *   `%DOMAIN%/admin/reports` — never as a literal host. `%DOMAIN%` is the
 *   deployment under test and needs no declaration: it is **empty by
 *   default, and when empty a run takes the open tab's origin** (scheme,
 *   host, port), so the same case runs against a branch, a review app, a
 *   local dev server or a customer's instance by starting it from that
 *   tab. A value typed on the case screen or a picked environment's
 *   address overrides the tab; nothing in the case has to change.
 *
 *   `@locations:` says where the case is *meant* to run: a comma-separated
 *   list of host globs (`localhost:8080`, `*.acme.com`, `app.*.test`; `*`
 *   matches any run of characters, case-insensitively; a port is compared
 *   when the pattern spells one; a pattern with `/` is checked against the
 *   whole address). It gates nothing. Every address the panel, the viewer
 *   or a downloaded page shows is coloured **green** when its host fits
 *   one of the globs and **red** when it fits none — the link still opens,
 *   because a tester on an unusual tab may mean it, but they see it first.
 *   The first entry with no `*` also serves as `%DOMAIN%`'s address where
 *   no tab exists to read: the online viewer, a downloaded copy, the
 *   linter's cold run. Omit `@locations` and nothing is coloured.
 *
 *   `%BASE_URL%` is the pre-`DOMAIN` spelling of the same thing and keeps
 *   working: undeclared it behaves exactly like `%DOMAIN%`; declared as a
 *   variable with `Generator: page-origin` (the oldest form) it still
 *   resolves as before. New cases write `%DOMAIN%`.
 *
 *   # Domains                                   (optional — only for a
 *                                                 case that touches more
 *                                                 than one host)
 *
 *   ## ADMIN
 *   The admin console, a separate deployment.   (free text description)
 *   Default: https://admin.staging.example.test  (the origin a cold run
 *                                                 uses)
 *   Match: admin.*.example.test                  (optional glob — which
 *                                                 open tabs count as this
 *                                                 domain)
 *
 *   A declared domain is a *second* deployment the case touches — the app
 *   and its admin console, a marketing site and the app it signs into,
 *   two tenants of one product — named once here and used as an address
 *   prefix everywhere else: `- Open %ADMIN%/tenants`, `Where:
 *   %ADMIN%/audit`, a link in prose. A scenario walks between hosts: "do X
 *   at %DOMAIN%/orders, then check Y at %ADMIN%/audit". `DOMAIN` itself
 *   may be declared here too, to give it a description, a `Default:` or a
 *   `Match:`; declared or not, it is the *main* domain, the one a bare
 *   route (`Where: /admin/reports`) resolves against. Without a `DOMAIN`
 *   entry, the first declared domain is the main one — the pre-`DOMAIN`
 *   convention (`## APP`), still honoured.
 *
 *   A domain is not a variable. It has no generator, and its value is
 *   decided per run by the **environment** the tester picks — local,
 *   staging, prod, or a custom set of addresses — which the extension
 *   keeps in `environments.json` beside the cases, one value per domain
 *   per environment. Resolution, first hit wins: a value typed on the
 *   case screen; the picked environment's value; when no environment is
 *   picked, the open tab's origin — for `DOMAIN`, for the main domain, or
 *   for any domain whose `Match:` glob accepts the tab's host; the
 *   `Default:`; for `DOMAIN`, the first concrete `@locations` entry;
 *   nothing, in which case `%ADMIN%` stays literal. `Default:` is what a
 *   run from a blank tab, the online viewer and a downloaded page use, so
 *   a declared domain should carry one — the address of the deployment
 *   the project normally tests against. `Match:` is what lets a tester
 *   start from whichever tab they have open without the panel guessing
 *   the admin console's tab is the app.
 *
 *   # Variables                                 (optional)
 *
 *   ## USERNAME
 *   Login username to register with.            (free text description,
 *                                                like a step's instructions)
 *   Generator: random-string 8                   (see below)
 *
 *   ## PRODUCT_ID
 *   Product to add to cart.
 *   Default: sku-12345                          (literal default)
 *
 *   A variable is a value the run needs that is not an address: an
 *   account, a record id, a fresh string. **Every variable is resolved
 *   before the run starts, by Enloop, and never asked of the tester**: it
 *   carries a `Default:`, or a `Generator:`, or its name is one the
 *   project's environments provide (the same `environments.json` — an
 *   environment supplies variables as well as domains, so `%QA_EMAIL%` can
 *   differ between staging and prod). A variable with none of the three is
 *   a linter error, not a question the panel asks.
 *
 *   A value the run itself produces — the id of a user created in step 2,
 *   the URL of a record that does not exist until the case makes it — is
 *   not a variable, and **never goes into an address**. An address with a
 *   placeholder nobody can fill (`%DOMAIN%/user.php?user=%USER_ID%`) is
 *   a link that opens the wrong page, and a made-up `Default:` to satisfy
 *   the linter is worse: it opens a wrong page that looks right. Write
 *   where the tester clicks, and give the address *shape* as help, in
 *   backticks so no renderer links it: "Click the new user's row in
 *   `[data-testid="users-table"]` (opens `/user.php?user=<id>`)".
 *
 *   Generators, given as `Generator: <name> [arg]`: `timestamp` (epoch ms,
 *   or ISO text with arg `iso`), `random-number` (arg `min-max`, default
 *   `0-999999`), `random-string` (arg = length, default 8), and the page
 *   generators `page-url`, `page-origin`, `page-domain`, which read the
 *   active tab when the run starts. The page generators predate `%DOMAIN%`:
 *   a `## BASE_URL` variable with `Generator: page-origin` is the legacy way
 *   to say "the deployment I have open", still parsed and still resolved,
 *   and the linter asks for it to become `%DOMAIN%` instead.
 *   `page-domain` (host only, no scheme, no port) remains right for a
 *   value that is *about* a host — a tenant name, an email suffix — never
 *   for an address prefix. `Match:` on a page generator works as it does
 *   on a domain: a tab the glob refuses yields nothing and resolution
 *   falls through to the `Default:`.
 *
 *   Domains and variables share one namespace — `%NAME%` is looked up in
 *   both — so a name may not be declared in both sections. Starting a run
 *   resolves every declared domain and variable (a value typed on the case
 *   screen wins; then the environment; then the tab, for what may read it;
 *   then the generator, for a variable that has one; then the `Default:`;
 *   else empty) and replaces every `%NAME%` placeholder anywhere in the rest
 *   of the document (title, description, step instructions, selectors,
 *   scripts) with the resolved value. A name that resolves to nothing is
 *   not substituted at all: the step keeps the literal `%NAME%`. A value
 *   ending in `/` where a `/` follows it loses the slash, so `%DOMAIN%/orders`
 *   is one slash deep whether or not the address was recorded with a
 *   trailing one. See `substituteVariables`.
 *
 *   # Dependencies                              (optional, bullet list)
 *   - Seeded test user
 *
 *   # You will need                             (optional, bullet list)
 *   - Access to a mailbox that receives the confirmation codes
 *   - A second browser, signed out
 *
 *   What must be in the tester's **hands** before step 1 — a mailbox, a
 *   device, a second browser, a colleague's approval — as distinct from
 *   what must be true (`# Dependencies`) and what to do first
 *   (`# Prerequisites`). Rendered open above Start everywhere, never
 *   collapsed, so a tester gets these things now rather than halfway
 *   through a step with a code expiring.
 *
 *   # Prerequisites                             (optional, bullet list)
 *   - Open https://app.example.com/admin/reports
 *   - API running locally: `npm run dev` in the app repo,
 *     which also starts the worker — wait for "ready" in its output
 *     - nested detail lines belong to their item too
 *
 *   An item is one flush-left `- ` bullet plus everything indented under it:
 *   wrapped prose and nested bullets stay part of the item they continue
 *   rather than becoming items of their own.
 *
 *   Anything the tester must *do* before step 1 belongs in Prerequisites,
 *   including where the run begins and starting any service locally — with
 *   the address and the command, so each is actionable rather than a
 *   reminder. A tester is usually already in the app, so the entry point
 *   earns a bullet here rather than a first step that spends a verdict on
 *   arriving. This block is rendered Markdown with no page behind it,
 *   unlike a step's `Where:`, so an address in it is absolute or built from
 *   a domain (`%DOMAIN%/admin/reports`) — a bare route has no origin to
 *   resolve against here. Dependencies is for what must
 *   already be true and is not the tester's to arrange: a deployed branch,
 *   a migration, an access level. The run screen renders both in one
 *   collapsed "Before you start" block, since the usual case is an
 *   environment that is already up.
 *
 *   # Steps
 *
 *   ## Step title
 *   Where: /admin/integrations                  (optional — the route or
 *                                                 screen the tester should
 *                                                 already be on before doing
 *                                                 this step, so "which app
 *                                                 am I in?" stays out of the
 *                                                 instructions prose)
 *   Via: Settings → Users → the user's row     (how the page is reached in
 *                                                 the app's own UI. Required
 *                                                 whenever the step moves to
 *                                                 a page the previous step
 *                                                 was not on; `Via: link
 *                                                 only` says the UI has no
 *                                                 path — a deep link, a
 *                                                 redirect target)
 *   Kind: quick                                 (optional — marks this step
 *                                                 as part of the core happy
 *                                                 path. A "quick" run
 *                                                 executes only the marked
 *                                                 steps; a "full" run
 *                                                 executes every step. A case
 *                                                 is authored once, in full,
 *                                                 and the marks pick out the
 *                                                 subset worth running during
 *                                                 development.)
 *   Kind: extra                                 (optional — the opposite dial:
 *                                                 an optional side-check,
 *                                                 skipped by default. It stays
 *                                                 visible in the run, numbered
 *                                                 with a minor increment under
 *                                                 the ordinary step before it
 *                                                 — 2.1, 2.2 — and starts the
 *                                                 run already marked skipped;
 *                                                 the tester opts in by giving
 *                                                 it a verdict. For
 *                                                 conditionals ("only if a
 *                                                 second account exists"),
 *                                                 nice-to-verify checks, and
 *                                                 steps that keep arriving
 *                                                 skipped. A step has one
 *                                                 `Kind:` — quick or extra,
 *                                                 not both; any other value
 *                                                 is ignored.)
 *   Selector: #login-button                     (optional — scrolls this
 *                                                 into view and flashes it
 *                                                 in the page when the step
 *                                                 is focused, or on demand
 *                                                 via the Highlight button)
 *   Selector: [data-testid="login"] button      (optional fallbacks — repeat
 *   Selector: form .btn-primary                  the line; they are tried in
 *                                                 order and the first one
 *                                                 that matches something on
 *                                                 the page wins)
 *   Free text instructions (manual step — no code fence found).
 *
 *   `Where:`, `Via:`, `Selector:` and `Kind:` form a header block directly
 *   under the step title and may appear in any order; the first line that
 *   is none of them ends the header and begins the instructions.
 *
 *   `Where:` is never the only way to find a page. Its address may point
 *   at a deployment the tester is not on, or be incomplete, and a Go
 *   control that opens the wrong page is worse than none — so a step that
 *   moves to a new page also says how a person gets there from the app's
 *   own screens: `Via: Settings → Users → the row for the account`. The
 *   panel shows it under the address. When the UI genuinely has no path —
 *   a link from an email, a redirect the app performs, a page only a URL
 *   reaches — the step says so with `Via: link only`, so the tester knows
 *   not to look for a menu. A step on the same page as the one before it
 *   needs no `Via:`.
 *
 *   A `Where:` that is a route (`/admin/x`), an absolute URL, or a local
 *   address (`localhost:3000/admin`) gets a Go control in the run screen
 *   that navigates the tab the run is using. The standard form is
 *   `Where: %DOMAIN%/admin/x` — the domain plus the route — which
 *   substitutes to an absolute URL before the run starts and so works from
 *   a blank tab, in the viewer and in a downloaded copy, coloured by
 *   `@locations`. A bare route resolves against the main domain, and for
 *   a case with none against whatever page is open — refusing to guess
 *   when there is none. An address still holding a placeholder after
 *   substitution gets no Go control: the panel will not open
 *   `/user.php?user=%USER_ID%`. Prose (`the CRM's web console →
 *   Contacts`) is left alone; it names a place, not an address.
 *
 *   A single `Selector:` line is always one selector, even when it contains
 *   commas — `a, b` is a CSS selector *group*, and `querySelector` returns
 *   whichever of the two comes first in the document, not the one written
 *   first. Ordered fallback is what repeated lines buy you: write the most
 *   specific/stable handle first, then progressively looser ones for the
 *   dynamic containers and generated class names it might have to survive.
 *
 *   Every literal the tester must type is written as "**value**" — double
 *   quotes around a bolded run — e.g. `Put "**Buy milk**" in the task
 *   field`. The side panel turns each one into a control: clicking it arms
 *   the page so the next input, textarea or select the tester clicks
 *   receives the value, with a copy fallback. It takes both marks because
 *   either alone is something authors already write for other reasons —
 *   quotes for an error message being cited, bold for emphasis — and a
 *   control offering to type a quoted sentence fragment into the page is
 *   worse than no control. Backticks mean the opposite thing (a label or
 *   element to *find*), so those must not be swapped either. The pair is
 *   deliberately still readable as ordinary Markdown: these files are read
 *   on GitHub and in editors far more than they are run.
 *
 *   Anywhere in a step's prose — instructions, `### Expected`, `### Note` —
 *   a selector written as inline code (`` `#sync-btn` ``,
 *   `` `[data-testid="row"]` ``) renders in the side panel as a control
 *   that flashes that element, the same as the step's own `Selector:`.
 *   Nothing declares this; it is recognised from the text. A Markdown link
 *   with a fragment href does the same with prose for a label:
 *   `[the Sync button](#sync-crm-btn)`. Visible UI labels in backticks —
 *   which is how the step contract asks authors to quote them — are left
 *   alone; only text that could not be a label qualifies.
 *
 *   ### Expected                                (optional)
 *   What should happen — pass criteria only.
 *
 *   ### Note                                    (optional)
 *   Background the tester may want but must not have to read to judge
 *   pass/fail: rationale, regression history, caveats. Keeping it out of
 *   `### Expected` is the whole point — Expected stays scannable.
 *   `### Expected` and `### Note` may appear in either order.
 *
 *   ### Photo                                   (optional, repeatable —
 *   Crop: #order-form                            what the runner should
 *   Pad: 24                                      photograph for this step,
 *   Mark: #save-button                           and how to mark it up:
 *   Point: .toast                                `Crop:` the container to
 *   Callout: #email — The address on the invoice  cut to (viewport when
 *   Blur: [data-testid="card-number"]            absent), `Pad:` css px
 *   Take: after                                  around it (24); `Mark:` a
 *   Mode: confirm                                box, `Point:` an arrow,
 *   Color: #E5484D                               `Callout:` a numbered disc
 *   Caption: The order form, ready to save       with an optional legend
 *                                                after " — ", `Blur:`
 *                                                pixelated — each a selector,
 *                                                each repeatable, resolved
 *                                                on the page when the photo
 *                                                is taken. `Take:` before |
 *                                                after | manual — when: as
 *                                                the step becomes current,
 *                                                as its verdict is given, or
 *                                                by a button. `Mode:` auto |
 *                                                confirm — keep silently, or
 *                                                offer Keep / Retake / Edit /
 *                                                Discard. Only the keys that
 *                                                differ from these defaults
 *                                                need writing.)
 *
 *   The n-th `### Photo` of a step fills `%PHOTO_n%` wherever that appears
 *   in the step's instructions or `### Expected` — the place the picture
 *   belongs when the run is exported as a guide. `PHOTO_` is a reserved
 *   prefix: `%PHOTO_n%` is never a variable and never substituted. A photo
 *   with no placeholder is placed after the instructions.
 *
 *   ## Another step title
 *   ```js
 *   if (!document.querySelector('#el')) api.fail('missing #el');
 *   ```                                          (fenced code block present
 *                                                  -> automated step; runs
 *                                                  in the page's own MAIN
 *                                                  world with DOM access)
 *
 *   # Steps: Restore password                  (optional — a group. The
 *                                                 title after the colon
 *                                                 names it)
 *   The reset mail reaches the migrated          (the group's goal: what
 *   address and its link signs the user in.       its steps prove together,
 *                                                 in a sentence or two —
 *                                                 required by the linter)
 *
 *   ## Request a reset link
 *   ...
 *
 *   A case covering a broad change — "the email refactoring" — is a
 *   handful of concerns, not a flat list of twenty verdicts: log in,
 *   restore a password, change the address. Each concern is a group: a
 *   `# Steps: <title>` section whose prose is the goal and whose `## `
 *   steps are the steps that prove it. Groups are headings over one list,
 *   not lists of their own: steps keep numbering through them, `Kind:`
 *   marks apply per step, and a quick run drops a group whose steps are
 *   all filtered out. A plain `# Steps` holds ungrouped steps and may sit
 *   before or between groups (shared setup, cleanup). The run screen heads
 *   each group's steps with its goal, and the report and feedback file
 *   sum each group up — which is what lets a reader see that "restore
 *   password" is broken while "log in" is fine, without reading every
 *   step.
 *
 * `version`/`createdAt` are not part of the text — callers supply them
 * (derived from the filename and file mtime) via `fallback`. `@version`
 * (the format version) defaults to `CURRENT_FORMAT_VERSION` when absent,
 * so older files written before this field existed still parse as current.
 *
 * A suite's `suite.md` reuses this exact grammar for its shared preparation
 * steps, description, variables, dependencies, and prerequisites — with one
 * relaxation: pass `{ requireSteps: false }` to allow a suite with no prep
 * steps at all (`opts.requireSteps` defaults to `true` for ordinary cases).
 */
export function parseCaseDocument(
  raw: string,
  fallback: { version: string; createdAt: string },
  opts: { requireSteps?: boolean } = {},
): TestCaseVersion {
  const requireSteps = opts.requireSteps ?? true;
  // The generated viewer-link comment is machine-written and belongs to the
  // file, not to the case — dropped here so no reader of the model ever has
  // to know it exists. See `stripViewerComment`.
  const lines = stripViewerComment(raw).replace(/\r\n/g, "\n").split("\n");

  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;

  if (!lines[i]?.startsWith("# ")) {
    throw new Error('Test case Markdown must start with a level-1 heading, e.g. "# Case title".');
  }
  const title = lines[i].slice(2).trim();
  i++;

  let formatVersion = CURRENT_FORMAT_VERSION;
  let author = "";
  let project = "";
  let kind: CaseKind = "case";
  let tags: string[] = [];
  let locations: string[] = [];
  let goal = "";
  let youWill = "";
  let changeNote = "";
  while (i < lines.length) {
    const line = lines[i];
    const goalMatch = /^Goal:\s*(.*)$/i.exec(line);
    const youWillMatch = /^You will:\s*(.*)$/i.exec(line);
    const versionMatch = /^@version\s+(.*)$/i.exec(line);
    const authorMatch = /^@author\s+(.*)$/i.exec(line);
    const projectMatch = /^@project\s+(.*)$/i.exec(line);
    const kindMatch = /^@kind:?\s+(.*)$/i.exec(line);
    const tagsMatch = /^Tags:\s*(.*)$/i.exec(line);
    // With or without the colon: `@locations:` reads as a list the way
    // `Tags:` does, and `@locations` matches the other `@` lines.
    const locationsMatch = /^@locations:?\s*(.*)$/i.exec(line);
    const noteMatch = /^Change note:\s*(.*)$/i.exec(line);
    if (versionMatch) {
      formatVersion = versionMatch[1].trim();
      i++;
      continue;
    }
    if (authorMatch) {
      author = authorMatch[1].trim();
      i++;
      continue;
    }
    if (projectMatch) {
      project = projectMatch[1].trim();
      i++;
      continue;
    }
    if (kindMatch) {
      const value = kindMatch[1].trim().toLowerCase();
      if (value !== "case" && value !== "guide") {
        throw new Error(`@kind must be case or guide, not "${kindMatch[1].trim()}".`);
      }
      kind = value;
      i++;
      continue;
    }
    if (tagsMatch) {
      tags = tagsMatch[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      i++;
      continue;
    }
    if (locationsMatch) {
      locations = locationsMatch[1]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      i++;
      continue;
    }
    if (goalMatch) {
      goal = goalMatch[1].trim();
      i++;
      continue;
    }
    if (youWillMatch) {
      youWill = youWillMatch[1].trim();
      i++;
      continue;
    }
    if (noteMatch) {
      changeNote = noteMatch[1].trim();
      i++;
      continue;
    }
    break;
  }

  const rest = lines.slice(i).join("\n");
  const { preamble, sections: topSections } = splitTopSections(rest, 1);
  const description = preamble.trim();

  let domains: TestCaseDomain[] = [];
  let variables: TestCaseVariable[] = [];
  let dependencies: string[] = [];
  let prerequisites: string[] = [];
  let youWillNeed: string[] = [];
  const groups: StepGroup[] = [];
  const steps: Step[] = [];

  for (const section of topSections) {
    const name = section.heading.trim().toLowerCase();
    const stepsHeading = STEPS_HEADING_RE.exec(section.heading.trim());
    if (name === "domains") domains = parseDomains(section.content);
    else if (name === "variables") variables = parseVariables(section.content);
    else if (name === "dependencies") dependencies = parseBulletList(section.content);
    else if (name === "prerequisites" || name === "prerequirements")
      prerequisites = parseBulletList(section.content);
    else if (name === "you will need") youWillNeed = parseBulletList(section.content);
    else if (stepsHeading) {
      // Every `# Steps` / `# Steps: <group>` section contributes steps, in
      // document order, numbered as one list — a group is a heading over a
      // stretch of the same list, not a list of its own. The prose between
      // a group's heading and its first step is the group's goal.
      const groupTitle = (stepsHeading[1] ?? "").trim() || undefined;
      const { preamble, sections } = splitTopSections(section.content, 2);
      if (groupTitle && !groups.some((g) => g.title === groupTitle)) {
        groups.push({ title: groupTitle, goal: preamble.trim() });
      }
      for (const s of sections) {
        steps.push(parseOneStep(s.heading, s.content, steps.length, groupTitle));
      }
    }
  }

  if (requireSteps && steps.length === 0) {
    throw new Error('No steps found — add a "# Steps" section with "## " step headings.');
  }

  domains = withImplicitDomain(domains, variables, `${title}\n${rest}`);

  return {
    version: fallback.version,
    createdAt: fallback.createdAt,
    formatVersion,
    author,
    project,
    kind,
    changeNote,
    title,
    goal,
    youWill,
    youWillNeed,
    description,
    tags,
    locations,
    domains,
    variables,
    dependencies,
    prerequisites,
    groups,
    steps,
  };
}

/** `# Steps`, or `# Steps: <group title>` — the heading of a section that
 * holds steps. Group 1 is the title, absent on the plain form. */
const STEPS_HEADING_RE = /^Steps(?::\s*(.*))?$/i;

/** The description the panel and the viewer show for the implicit entry,
 * since the text has none. */
export const IMPLICIT_DOMAIN_DESCRIPTION =
  "The deployment under test. Empty by default: a run takes the open tab's address unless an environment or a value typed here says otherwise.";

/**
 * `domains` plus the undeclared `%DOMAIN%` (or legacy `%BASE_URL%`) the
 * text uses, as an entry flagged `implicit`, so the rest of the model —
 * resolution, the values form, the report — needs no special case. It goes
 * **first** when nothing else is declared, which makes it the main domain;
 * behind explicit entries otherwise, so a case that put `## APP` first
 * keeps the main domain it chose — `tabOriginFor` reads the tab for it
 * either way. A name declared as a variable (the oldest `BASE_URL` form)
 * is left to the variable.
 */
function withImplicitDomain(
  domains: TestCaseDomain[],
  variables: TestCaseVariable[],
  text: string,
): TestCaseDomain[] {
  const declared = new Set([...domains.map((d) => d.name), ...variables.map((v) => v.name)]);
  const implicit: TestCaseDomain[] = [];
  for (const name of IMPLICIT_DOMAIN_NAMES) {
    if (declared.has(name) || !text.includes(`%${name}%`)) continue;
    implicit.push({ name, description: IMPLICIT_DOMAIN_DESCRIPTION, implicit: true });
  }
  if (implicit.length === 0) return domains;
  return domains.length === 0 ? implicit : [...domains, ...implicit];
}

function splitTopSections(
  text: string,
  level: number,
): { preamble: string; sections: Array<{ heading: string; content: string }> } {
  const marker = "#".repeat(level) + " ";
  const lines = text.split("\n");
  const preambleLines: string[] = [];
  const sections: Array<{ heading: string; content: string[] }> = [];
  let current: { heading: string; content: string[] } | null = null;

  for (const line of lines) {
    if (line.startsWith(marker)) {
      if (current) sections.push(current);
      current = { heading: line.slice(marker.length).trim(), content: [] };
    } else if (current) {
      current.content.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (current) sections.push(current);

  return {
    preamble: preambleLines.join("\n"),
    sections: sections.map((s) => ({ heading: s.heading, content: s.content.join("\n").trim() })),
  };
}

function parseDomains(sectionBody: string): TestCaseDomain[] {
  const { sections } = splitTopSections(sectionBody, 2);
  return sections.map((s) => parseOneDomain(s.heading, s.content));
}

/** A domain's body is a description plus `Default:` and `Match:` lines —
 * the variable grammar minus `Generator:`. Parsed by the variable reader
 * and narrowed, so the two line syntaxes cannot drift apart. */
function parseOneDomain(name: string, body: string): TestCaseDomain {
  const v = parseOneVariable(name, body);
  return { name: v.name, description: v.description, defaultValue: v.defaultValue, match: v.match };
}

function parseVariables(sectionBody: string): TestCaseVariable[] {
  const { sections } = splitTopSections(sectionBody, 2);
  return sections.map((s) => parseOneVariable(s.heading, s.content));
}

const VARIABLE_DEFAULT_RE = /^Default:\s*(.*)$/i;
const VARIABLE_GENERATOR_RE = /^Generator:\s*(\S+)(?:\s+(.*))?$/i;
const VARIABLE_MATCH_RE = /^Match:\s*(.*)$/i;

function parseOneVariable(name: string, body: string): TestCaseVariable {
  const descriptionLines: string[] = [];
  let defaultValue: string | undefined;
  let generator: VariableGenerator | undefined;
  let generatorArg: string | undefined;
  let match: string | undefined;

  for (const line of body.split("\n")) {
    const defaultMatch = VARIABLE_DEFAULT_RE.exec(line);
    const generatorMatch = VARIABLE_GENERATOR_RE.exec(line);
    const matchMatch = VARIABLE_MATCH_RE.exec(line);
    if (defaultMatch) {
      defaultValue = defaultMatch[1].trim() || undefined;
      continue;
    }
    if (generatorMatch) {
      const candidate = generatorMatch[1].trim().toLowerCase();
      if ((VARIABLE_GENERATORS as readonly string[]).includes(candidate)) {
        generator = candidate as VariableGenerator;
        generatorArg = generatorMatch[2]?.trim() || undefined;
      }
      continue;
    }
    if (matchMatch) {
      match = matchMatch[1].trim() || undefined;
      continue;
    }
    descriptionLines.push(line);
  }

  return {
    name: name.trim(),
    description: descriptionLines.join("\n").trim(),
    defaultValue,
    generator,
    generatorArg,
    match,
  };
}

const PLACEHOLDER_RE = /%([A-Za-z_][A-Za-z0-9_]*)%/g;

/** `%PHOTO_n%` — where the n-th `### Photo` of the step lands on export.
 * Reserved: never a variable (see `isPhotoPlaceholder`). */
export const PHOTO_PLACEHOLDER_RE = /%PHOTO_(\d+)%/g;

export function isPhotoPlaceholder(name: string): boolean {
  return /^PHOTO_\d+$/.test(name);
}

/** The distinct `n`s of every `%PHOTO_n%` in `text`, in order of first use. */
export function photoPlaceholders(text: string): number[] {
  const seen: number[] = [];
  for (const m of text.matchAll(PHOTO_PLACEHOLDER_RE)) {
    const n = Number(m[1]);
    if (n > 0 && !seen.includes(n)) seen.push(n);
  }
  return seen;
}

/** Replaces every `%NAME%` placeholder in `text` with its resolved value.
 *
 * A variable is only used when it actually has a value. A placeholder with
 * no matching entry in `values` — or whose value is blank — is left as
 * `%NAME%`, because the alternative is worse in both directions: blanking
 * it turns `Where: %BASE_URL%/admin` into `Where: /admin`, an instruction
 * that looks complete and is wrong, and there is no way for the tester
 * reading the run to tell that a value was ever meant to be there. Leaving
 * the placeholder says exactly what happened. */
export function substituteVariables(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (match, name: string, offset: number, whole: string) => {
    if (isPhotoPlaceholder(name)) return match;
    const value = values[name];
    if (!value?.trim()) return match;
    // One slash at the seam, never two — see `joinResolvedValue`.
    return joinResolvedValue(value, whole.slice(offset + match.length));
  });
}

/**
 * The items of a `# Dependencies` / `# Prerequisites` section, one string per
 * item, continuation lines included.
 *
 * A top-level item is a flush-left(-ish, <2 spaces — CommonMark allows up to
 * three) `- ` or `* ` bullet. Everything else that is not blank belongs to
 * the item above it: wrapped prose, and nested bullets, which arrive indented
 * and stay part of their parent. Continuations are stored with the standard
 * two-space item indent stripped and real newlines kept, so an item is plain
 * Markdown relative to its own margin — `renderBulletList` puts the indent
 * back. The old version of this function kept only the bullet lines, which
 * silently truncated every item that wrapped.
 */
function parseBulletList(text: string): string[] {
  const items: string[] = [];
  for (const line of text.split("\n")) {
    const indent = /^[ \t]*/.exec(line)![0].length;
    const trimmed = line.trim();
    if (indent < 2 && (trimmed.startsWith("- ") || trimmed.startsWith("* "))) {
      items.push(trimmed.slice(2).trim());
    } else if (items.length > 0 && trimmed !== "") {
      items[items.length - 1] += "\n" + line.replace(/^(?: {1,2}|\t)/, "").trimEnd();
    }
  }
  return items;
}

/** `parseBulletList`'s inverse: items back out as one Markdown list, each
 * item's continuation lines indented two spaces so they stay inside their
 * bullet. Every renderer that shows these lists goes through here — a
 * renderer that writes `- ${item}` flat breaks a multiline item back out of
 * its bullet, which is the truncation bug in a second form. */
export function renderBulletList(items: string[]): string {
  return items.map((item) => `- ${item.trim().replace(/\n/g, "\n  ")}`).join("\n");
}

const FENCE_RE = /```([^\n]*)\n([\s\S]*?)```/;
const SUBSECTION_RE = /^###\s+(Expected|Note|Photo)\s*$/i;
const PHOTO_KEY_RE = /^([A-Za-z]+):\s*(.*)$/;
const SELECTOR_RE = /^Selector:\s*(.*)$/i;
const WHERE_RE = /^Where:\s*(.*)$/i;
const VIA_RE = /^Via:\s*(.*)$/i;

/** The `Via:` values that say "the UI offers no path to this page" — an
 * explicit answer, not a missing one. */
export const VIA_LINK_ONLY_RE = /^(link only|direct link( only)?|url only|none|no ui path)$/i;
const KIND_RE = /^Kind:\s*(.*)$/i;

/** Splits a step body into its lead text and any `### Expected` / `### Note`
 * subsections. They may appear in either order, and either may be absent. */
function splitStepSubsections(text: string): {
  lead: string;
  expected?: string;
  note?: string;
  photos: PhotoSpec[];
} {
  const lead: string[] = [];
  const expected: string[] = [];
  const note: string[] = [];
  const photoBlocks: string[][] = [];
  let current = lead;
  let sawExpected = false;
  let sawNote = false;

  for (const line of text.split("\n")) {
    const match = SUBSECTION_RE.exec(line);
    if (match) {
      const which = match[1].toLowerCase();
      if (which === "expected") {
        current = expected;
        sawExpected = true;
      } else if (which === "photo") {
        current = [];
        photoBlocks.push(current);
      } else {
        current = note;
        sawNote = true;
      }
      continue;
    }
    current.push(line);
  }

  return {
    lead: lead.join("\n").trim(),
    expected: sawExpected ? expected.join("\n").trim() || undefined : undefined,
    note: sawNote ? note.join("\n").trim() || undefined : undefined,
    photos: photoBlocks.map(parsePhotoBlock),
  };
}

/** Splits `#email — The address` into selector and legend text; the dash
 * may be an em dash or ` - ` with spaces, so a plain-keyboard author is
 * not punished. A selector never contains either surrounded by spaces. */
function splitCalloutLine(value: string): { selector: string; text: string } {
  const m = /^(.*?)\s+(?:—|–|-)\s+(.*)$/.exec(value);
  return m ? { selector: m[1].trim(), text: m[2].trim() } : { selector: value.trim(), text: "" };
}

/** One `### Photo` block's `Key: value` lines into a spec. Unknown keys
 * and bad values throw — a photo spec the runner would misread is worse
 * than a parse error at authoring time. */
function parsePhotoBlock(lines: string[]): PhotoSpec {
  const spec: PhotoSpec = {
    crop: "",
    pad: DEFAULT_PHOTO_PAD,
    marks: [],
    points: [],
    callouts: [],
    blurs: [],
    take: "after",
    mode: "confirm",
    color: DEFAULT_SHOT_COLOR,
    caption: "",
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = PHOTO_KEY_RE.exec(line);
    if (!m) throw new Error(`A \`### Photo\` block holds only \`Key: value\` lines, not "${line}".`);
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    switch (key) {
      case "crop":
        spec.crop = value;
        break;
      case "pad": {
        // A blank value means the default, not zero.
        if (!value) break;
        if (!/^\d+$/.test(value)) throw new Error(`\`Pad:\` must be a whole number of pixels, not "${value}".`);
        spec.pad = Number(value);
        break;
      }
      case "mark":
        if (value) spec.marks.push(value);
        break;
      case "point":
        if (value) spec.points.push(value);
        break;
      case "callout":
        if (value) spec.callouts.push(splitCalloutLine(value));
        break;
      case "blur":
        if (value) spec.blurs.push(value);
        break;
      case "take": {
        const take = value.toLowerCase();
        if (!(PHOTO_TAKE as readonly string[]).includes(take)) {
          throw new Error(`\`Take:\` must be before, after or manual, not "${value}".`);
        }
        spec.take = take as PhotoSpec["take"];
        break;
      }
      case "mode": {
        const mode = value.toLowerCase();
        if (!(PHOTO_MODE as readonly string[]).includes(mode)) {
          throw new Error(`\`Mode:\` must be auto or confirm, not "${value}".`);
        }
        spec.mode = mode as PhotoSpec["mode"];
        break;
      }
      case "color":
      case "colour":
        spec.color = value.toUpperCase();
        break;
      case "caption":
        spec.caption = value;
        break;
      default:
        throw new Error(`Unknown \`### Photo\` key "${m[1]}" — the keys are Crop, Pad, Mark, Point, Callout, Blur, Take, Mode, Color, Caption.`);
    }
  }
  return spec;
}

/** `parsePhotoBlock`'s inverse: only the keys that differ from defaults. */
function renderPhotoBlock(spec: PhotoSpec): string[] {
  const out = ["### Photo"];
  if (spec.crop.trim()) out.push(`Crop: ${spec.crop.trim()}`);
  if (spec.pad !== DEFAULT_PHOTO_PAD) out.push(`Pad: ${spec.pad}`);
  for (const s of spec.marks) if (s.trim()) out.push(`Mark: ${s.trim()}`);
  for (const s of spec.points) if (s.trim()) out.push(`Point: ${s.trim()}`);
  for (const c of spec.callouts) {
    if (!c.selector.trim()) continue;
    out.push(`Callout: ${c.selector.trim()}${c.text.trim() ? ` — ${c.text.trim()}` : ""}`);
  }
  for (const s of spec.blurs) if (s.trim()) out.push(`Blur: ${s.trim()}`);
  if (spec.take !== "after") out.push(`Take: ${spec.take}`);
  if (spec.mode !== "confirm") out.push(`Mode: ${spec.mode}`);
  if (spec.color.toUpperCase() !== DEFAULT_SHOT_COLOR) out.push(`Color: ${spec.color.toUpperCase()}`);
  if (spec.caption.trim()) out.push(`Caption: ${spec.caption.trim()}`);
  return out;
}

function parseOneStep(title: string, body: string, index: number, group?: string): Step {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;

  // `Selector:`/`Where:`/`Kind:` form a small header block at the top of a
  // step, in any order. The first line that is none of them ends the header.
  // `Selector:` may repeat: each line is one candidate, kept in document
  // order, and the highlighter walks them until one matches.
  const selectors: string[] = [];
  let where: string | undefined;
  let via: string | undefined;
  let quick = false;
  let extra = false;
  for (; i < lines.length; i++) {
    const selectorMatch = SELECTOR_RE.exec(lines[i]);
    const whereMatch = WHERE_RE.exec(lines[i]);
    const viaMatch = VIA_RE.exec(lines[i]);
    const kindMatch = KIND_RE.exec(lines[i]);
    if (selectorMatch) {
      const candidate = selectorMatch[1].trim();
      if (candidate) selectors.push(candidate);
    } else if (whereMatch) where = whereMatch[1].trim() || undefined;
    else if (viaMatch) via = viaMatch[1].trim() || undefined;
    else if (kindMatch) {
      // One `Kind:` per step — a later line replaces an earlier one, so the
      // two marks stay mutually exclusive however the header is edited.
      const kind = kindMatch[1].trim().toLowerCase();
      quick = kind === "quick";
      extra = kind === "extra";
    } else break;
  }
  const bodyAfterHeader = lines.slice(i).join("\n");

  let script: string | undefined;
  let remaining = bodyAfterHeader;

  const fenceMatch = FENCE_RE.exec(bodyAfterHeader);
  if (fenceMatch) {
    script = fenceMatch[2].replace(/\n$/, "");
    remaining = (
      bodyAfterHeader.slice(0, fenceMatch.index) +
      bodyAfterHeader.slice(fenceMatch.index + fenceMatch[0].length)
    ).trim();
  }

  const { lead, expected, note, photos } = splitStepSubsections(remaining);

  const type: StepType = script !== undefined ? "automated" : "manual";

  return {
    id: `step-${index + 1}`,
    order: index,
    title: title.trim(),
    type,
    instructions: lead || undefined,
    expected,
    script,
    selectors,
    where,
    via,
    quick,
    extra,
    note,
    group,
    photos,
  };
}

/**
 * Display numbers for a step list where `Kind: extra` steps count as minor
 * increments under the ordinary step before them:
 *
 *   1  Open accounts page
 *   2  Create account
 *   2.1  Check account picture is set     (extra)
 *   2.2  Check "test connection" button   (extra)
 *   3  Create X in account
 *
 * One function, used by the run screen, the report, the feedback file and
 * the console log alike — two renderers numbering the same run differently
 * would make "step 2.1" unfindable in one of them. An extra step before any
 * ordinary step numbers from 0 (0.1), which reads as odd because it is: the
 * case has an optional check ahead of its first real step.
 */
export function stepNumberLabels(steps: Array<{ extra: boolean }>): string[] {
  let major = 0;
  let minor = 0;
  return steps.map((step) => {
    if (step.extra) {
      minor += 1;
      return `${major}.${minor}`;
    }
    major += 1;
    minor = 0;
    return `${major}`;
  });
}

/**
 * A parsed case back out as grammar-valid Markdown — the inverse of
 * `parseCaseDocument`.
 *
 * This exists for the builder in the viewer, where someone assembles a case
 * from form fields and needs a real `.md` file at the end of it. It lives
 * here, beside the parser and under the same doc comment that specifies the
 * grammar, because a serializer that drifts from its parser produces files
 * that look right and do not load.
 *
 * The property that must hold, and the one worth testing:
 * `parseCaseDocument(renderCaseMarkdown(doc))` returns `doc` again, for
 * everything the grammar can express. Fields the grammar has nowhere to put
 * — `version`, `createdAt`, which are derived from the filename and mtime —
 * are the deliberate exceptions.
 */
export function renderCaseMarkdown(doc: TestCaseVersion): string {
  const out: string[] = [];

  out.push(`# ${doc.title.trim() || "Untitled case"}`);
  out.push(`@version ${doc.formatVersion || CURRENT_FORMAT_VERSION}`);
  if (doc.author.trim()) out.push(`@author ${doc.author.trim()}`);
  if (doc.project.trim()) out.push(`@project ${doc.project.trim()}`);
  if (doc.kind === "guide") out.push("@kind guide");
  if (doc.tags.length > 0) out.push(`Tags: ${doc.tags.join(", ")}`);
  if (doc.locations.length > 0) out.push(`@locations: ${doc.locations.join(", ")}`);
  if (doc.goal.trim()) out.push(`Goal: ${doc.goal.trim()}`);
  if (doc.youWill.trim()) out.push(`You will: ${doc.youWill.trim()}`);
  if (doc.changeNote.trim()) out.push(`Change note: ${doc.changeNote.trim()}`);

  if (doc.description.trim()) {
    out.push("");
    out.push(doc.description.trim());
  }

  // The implicit entry was never in the text; writing it out would turn
  // every save into a `# Domains` section the author did not write.
  const declaredDomains = doc.domains.filter((d) => !d.implicit);
  if (declaredDomains.length > 0) {
    out.push("");
    out.push("# Domains");
    for (const domain of declaredDomains) {
      out.push("");
      out.push(`## ${domain.name.trim()}`);
      if (domain.description.trim()) out.push(domain.description.trim());
      if (domain.defaultValue?.trim()) out.push(`Default: ${domain.defaultValue.trim()}`);
      if (domain.match?.trim()) out.push(`Match: ${domain.match.trim()}`);
    }
  }

  if (doc.variables.length > 0) {
    out.push("");
    out.push("# Variables");
    for (const variable of doc.variables) {
      out.push("");
      out.push(`## ${variable.name.trim()}`);
      if (variable.description.trim()) out.push(variable.description.trim());
      if (variable.defaultValue?.trim()) out.push(`Default: ${variable.defaultValue.trim()}`);
      if (variable.generator) {
        out.push(
          `Generator: ${variable.generator}${
            variable.generatorArg?.trim() ? ` ${variable.generatorArg.trim()}` : ""
          }`,
        );
      }
      if (variable.match?.trim()) out.push(`Match: ${variable.match.trim()}`);
    }
  }

  for (const [heading, items] of [
    ["You will need", doc.youWillNeed],
    ["Dependencies", doc.dependencies],
    ["Prerequisites", doc.prerequisites],
  ] as const) {
    if (items.length === 0) continue;
    out.push("");
    out.push(`# ${heading}`);
    out.push(renderBulletList(items));
  }

  // A group heading opens wherever the group changes, and a plain `# Steps`
  // reopens for steps that follow a group without one — so the text says
  // exactly what the parser will read back, wherever the groups sit.
  let openGroup: string | undefined | null = null;
  for (const step of doc.steps) {
    const group = step.group?.trim() || undefined;
    if (openGroup === null || group !== openGroup) {
      out.push("");
      if (group) {
        out.push(`# Steps: ${group}`);
        const goal = doc.groups.find((g) => g.title === group)?.goal.trim();
        if (goal) {
          out.push("");
          out.push(goal);
        }
      } else out.push("# Steps");
      openGroup = group;
    }
    out.push("");
    out.push(`## ${step.title.trim() || "Untitled step"}`);
    // `Where:`/`Selector:`/`Kind:` are a header block in any order; this
    // order is the one the grammar's own examples use.
    if (step.where?.trim()) out.push(`Where: ${step.where.trim()}`);
    if (step.via?.trim()) out.push(`Via: ${step.via.trim()}`);
    for (const selector of step.selectors) {
      if (selector.trim()) out.push(`Selector: ${selector.trim()}`);
    }
    if (step.quick) out.push("Kind: quick");
    else if (step.extra) out.push("Kind: extra");
    if (step.instructions?.trim()) out.push(step.instructions.trim());
    if (step.script !== undefined) {
      // A fenced block in place of instructions is what makes a step
      // automated — see `parseOneStep`.
      out.push("```js");
      out.push(step.script.replace(/\n$/, ""));
      out.push("```");
    }
    if (step.expected?.trim()) {
      out.push("");
      out.push("### Expected");
      out.push(step.expected.trim());
    }
    for (const photo of step.photos ?? []) {
      out.push("");
      out.push(...renderPhotoBlock(photo));
    }
    if (step.note?.trim()) {
      out.push("");
      out.push("### Note");
      out.push(step.note.trim());
    }
  }
  if (doc.steps.length === 0) {
    out.push("");
    out.push("# Steps");
  }

  return out.join("\n") + "\n";
}

/** Starter text for a brand new test case, shown in an empty editor. */
export function starterCaseTemplate(): string {
  return `# New test case
@version ${CURRENT_FORMAT_VERSION}
@author
@project
Tags:
@locations:
Goal: One line: what a tester proves by finishing this case
You will: One line: the shape of the work — log in twice, change a setting

Describe why this test case exists.

# You will need
-

# Dependencies
-

# Prerequisites
- Open %DOMAIN%/

# Steps

## First step
Where: %DOMAIN%/
Via: the menu path that reaches this page, or "link only"
Selector:
Describe the single action the tester should take.

### Expected
Describe the observable result that makes this step pass.
`;
}

/** Starter text for a brand new suite, shown in an empty suite editor.
 * Steps are optional for a suite (shared preparation only), but the
 * template includes one example since most suites have at least one. */
export function starterSuiteTemplate(): string {
  return `# New suite
@version ${CURRENT_FORMAT_VERSION}
@author
@project
Tags:

Describe what this suite of test cases covers and shares.

# Steps

## Log in as the test user
Shared preparation all cases in this suite start from.
`;
}

const STATUS_ICON: Record<string, string> = {
  success: "✅",
  failed: "❌",
  warning: "⚠️",
  skipped: "⏭️",
  running: "🔄",
  pending: "⬜",
};

/** What each audience is called on screen and in the files. */
export const AUDIENCE_LABELS: Record<CommentAudience, string> = {
  developer: "Developer",
  product: "Product",
  "test-writer": "Test writer",
  docs: "Docs",
  ops: "Ops",
};

/**
 * Comments common enough to deserve a button. Each is a full, ordinary
 * comment — text and audience — that the panel adds in one tap and that is
 * indistinguishable on disk from one typed by hand. The wording is fixed
 * here so the check skill can recognise it by text alone; keep the two in
 * step.
 *
 * "Combine with previous step" is the first because it is the most common
 * thing a tester says about a case that was authored screen by screen: an
 * "open the page, see the field" step followed by "enter the value, save,
 * verify" step is one test that got split, and the tester who notices does
 * not want to change the case mid-run, only to tell the writer.
 */
export const QUICK_COMMENTS: ReadonlyArray<{
  id: "combine-with-previous";
  label: string;
  text: string;
  audiences: CommentAudience[];
  /** False on the first step: there is no previous step to combine with. */
  needsPreviousStep: boolean;
}> = [
  {
    id: "combine-with-previous",
    label: "Combine with previous step",
    text: "This step needs to be combined with the previous step — they are one test that was split in two.",
    audiences: ["test-writer"],
    needsPreviousStep: true,
  },
];

/** When to pick each one. Shown next to the checkbox in the panel, so the
 * choice is made from the description rather than from the word — "Product"
 * means nothing to a tester mid-run; "works, but should work differently"
 * does. */
export const AUDIENCE_HINTS: Record<CommentAudience, string> = {
  developer: "the app did something wrong",
  product: "it works, but should work differently",
  "test-writer": "the case was wrong, unclear, or missing something",
  docs: "the documentation is wrong or missing",
  ops: "environment or test data, not the app itself",
};

/** The heading each audience gets in `feedback.md`, addressed rather than
 * categorised: whoever picks the file up should be able to find their own
 * name in it. */
export const AUDIENCE_SECTIONS: Record<CommentAudience, string> = {
  developer: "For the developer",
  product: "For product",
  "test-writer": "For the test writer",
  docs: "For the docs writer",
  ops: "For ops",
};

/** `[Developer · Docs] ` — the prefix a comment carries in a rendered file.
 * Empty for an untagged comment, which is context and not addressed to
 * anyone. */
function audiencePrefix(comment: RunComment): string {
  if (comment.audiences.length === 0) return "";
  return `[${comment.audiences.map((a) => AUDIENCE_LABELS[a]).join(" · ")}] `;
}

/**
 * Everything the tester wrote on a step, including whatever was still in the
 * box.
 *
 * A comment that was typed but never Added is finished work as far as its
 * author is concerned — they said the thing. Dropping it because a button went
 * unpressed loses exactly the observation the run existed to collect, and
 * loses it silently, which is the worst way. So every reader goes through
 * here, and `Add` is only how you start writing the next one.
 */
export function stepComments(state: {
  comments: RunComment[];
  draft: RunCommentDraft | null;
}): RunComment[] {
  const draft = state.draft?.text.trim();
  if (!draft) return state.comments;
  return [
    ...state.comments,
    { id: DRAFT_COMMENT_ID, text: draft, audiences: state.draft!.audiences },
  ];
}

/** Marks the comment that came out of the box rather than the list. Stable, so
 * promoting a draft twice cannot produce two of it. */
export const DRAFT_COMMENT_ID = "comment-unsent";

/** The counts a step carries, as the report and feedback both phrase them. */
function stepCounts(state: RunStepState): CaptureCounts {
  return {
    consoleErrors: state.consoleErrors,
    consoleWarnings: state.consoleWarnings,
    networkFailures: state.networkFailures,
    requests: state.requests,
  };
}

/** "step 3 — Sync the contact", for cross-referencing a digest item back into
 * the step list above it. Returns "" for an entry that arrived outside any
 * step, which reads better than "step none". */
function stepLabeller(doc: TestCaseVersion): (stepId: string | null) => string {
  const labels = stepNumberLabels(doc.steps);
  const numbers = new Map(doc.steps.map((step, index) => [step.id, labels[index]]));
  return (stepId) => {
    if (!stepId) return "";
    const number = numbers.get(stepId);
    return number ? `step ${number}` : stepId;
  };
}

/**
 * Human-readable summary of a finished (or in-progress) run — meant to be
 * shared outside the extension, e.g. emailed. Written as `report.md`
 * alongside `run.json` whenever a run finishes.
 *
 * `digest` is the captured console/network output, and is passed **only when
 * the tester ticked the box at finish**. Per-step counts are printed either
 * way — knowing a step logged three errors is not the same as reading them,
 * and the count is what makes the un-attached case visible rather than silent.
 */
/**
 * One line per group — its title, goal and how its steps ended — for the
 * report and the feedback file. This is the level a reader wants first
 * when a case has groups: "restore password: 1 failed" says where to look
 * before any step does. Empty for a case without groups.
 */
function renderGroupSummary(doc: TestCaseVersion, run: RunFile): string[] {
  if (doc.groups.length === 0) return [];
  const byId = new Map(run.steps.map((s) => [s.stepId, s]));
  const lines: string[] = [];
  for (const group of doc.groups) {
    const states = doc.steps
      .filter((step) => step.group === group.title)
      .map((step) => byId.get(step.id)?.status ?? "pending");
    const tally = (
      [
        ["success", "passed"],
        ["failed", "failed"],
        ["warning", "with warnings"],
        ["skipped", "skipped"],
        ["pending", "not run"],
        ["running", "running"],
      ] as const
    )
      .map(([status, word]) => [word, states.filter((s) => s === status).length] as const)
      .filter(([, n]) => n > 0)
      .map(([word, n]) => `${n} ${word}`)
      .join(", ");
    // The icon is the group's verdict at a glance: any failure fails it,
    // any warning warns, anything still open leaves it open, and a group
    // whose run steps all passed passed — skipped extras do not dilute it.
    const worst = states.includes("failed")
      ? "failed"
      : states.includes("warning")
        ? "warning"
        : states.some((s) => s === "pending" || s === "running")
          ? "pending"
          : states.includes("success")
            ? "success"
            : states.length > 0
              ? "skipped"
              : "pending";
    const goal = group.goal.trim();
    lines.push(
      `- ${STATUS_ICON[worst] ?? ""} **${group.title}**${goal ? ` — ${goal}` : ""}` +
        `${tally ? ` (${tally})` : " (no steps)"}`,
    );
  }
  return lines;
}

/** The file stem of a screenshot — `01`, `02`, … — shared by every
 * writer and reader of `screenshots/`. */
export function screenshotStem(shot: { seq: number }): string {
  return String(shot.seq).padStart(2, "0");
}

/** A screenshot's alt text: its caption, else which photo it is. */
export function screenshotAlt(shot: RunScreenshot): string {
  if (shot.caption.trim()) return shot.caption.trim();
  return shot.slot ? `Photo ${shot.slot}` : `Screenshot ${shot.seq}`;
}

/** One `![…](screenshots/NN.png)` line per screenshot, in capture order —
 * relative paths, since the report sits beside the folder. */
function screenshotLines(shots: RunScreenshot[]): string[] {
  return [...shots]
    .sort((a, b) => a.seq - b.seq)
    .map((s) => `![${screenshotAlt(s)}](screenshots/${screenshotStem(s)}.png)`);
}

export function renderRunReport(
  doc: TestCaseVersion,
  run: RunFile,
  digest?: CaptureDigest | null,
): string {
  const byId = new Map(run.steps.map((s) => [s.stepId, s]));
  const labelStep = stepLabeller(doc);
  const lines: string[] = [];

  lines.push(`# ${doc.title} — Run Report`);
  lines.push("");
  if (doc.project) lines.push(`- Project: ${doc.project}`);
  if (doc.kind === "guide") lines.push("- Kind: guide");
  lines.push(`- Version: v${run.testCaseVersion}`);
  // A quick run and a full run are not the same evidence — a report that
  // does not say which one it was invites "but it passed" about a pass that
  // only ever covered the happy path.
  lines.push(`- Coverage: ${run.tier === "quick" ? "quick (core steps only)" : "full"}`);
  // "Failed on staging" and "failed on local" are different findings; a
  // report that cannot tell them apart sends someone debugging the wrong
  // deployment. Omitted entirely when no environment was chosen — the
  // values may still have pointed anywhere, and naming none is honest.
  if (run.environment.trim()) lines.push(`- Environment: ${run.environment.trim()}`);
  // The addresses the run actually hit, one per declared domain. An
  // environment name says which deployment was meant; this says which one
  // was used, which is what matters when the two disagree.
  for (const domain of doc.domains) {
    const value = (run.variables[domain.name] ?? "").trim();
    if (value) lines.push(`- ${domain.name}: ${value}`);
  }
  lines.push(`- Status: ${run.status}`);
  // The tester's opinion of the case as test writing — kept apart from
  // Status on purpose, since a five-star case can fail and a chore can pass.
  if (run.rating != null) lines.push(`- Case rating: ${describeRating(run.rating)}`);
  lines.push(`- Started: ${run.startedAt}`);
  lines.push(`- Finished: ${run.finishedAt ?? "—"}`);
  lines.push("");
  if (run.comment.trim()) {
    // Above the steps, because it is context for all of them.
    lines.push("## Tester's note on this run");
    lines.push("");
    lines.push(run.comment.trim());
    lines.push("");
  }
  // Above the steps for the same reason as the comment: it is evidence about
  // the whole run, and a reader who stops after the first screen should have
  // seen it.
  if (digest) {
    lines.push(renderCaptureDigest(digest, labelStep));
  }
  const runShots = screenshotLines(run.screenshots.filter((s) => s.stepId === null));
  if (runShots.length > 0) {
    lines.push("## Screenshots of the run");
    lines.push("");
    lines.push(...runShots);
    lines.push("");
  }
  const groupSummary = renderGroupSummary(doc, run);
  if (groupSummary.length > 0) {
    lines.push("## By group");
    lines.push("");
    lines.push(...groupSummary);
    lines.push("");
  }
  lines.push("## Steps");
  lines.push("");

  const numberLabels = stepNumberLabels(doc.steps);
  doc.steps.forEach((step, index) => {
    const state = byId.get(step.id);
    const status = state?.status ?? "pending";
    // A group's heading opens once, above its first step, at the level the
    // steps sit under — so a reader scrolling the report sees the concern
    // before the verdicts that make it up.
    if (step.group && doc.steps[index - 1]?.group !== step.group) {
      lines.push(`**Group: ${step.group}**`);
      lines.push("");
    }
    lines.push(
      `### ${STATUS_ICON[status] ?? ""} ${numberLabels[index]}. ${step.title} (${status}${
        step.extra ? ", extra" : ""
      }${state?.jumpedOver ? ", jumped over" : ""})`,
    );
    if (state?.rating != null) {
      lines.push("");
      lines.push(`Rating: ${describeRating(state.rating)}`);
    }
    const comments = state ? stepComments(state) : [];
    if (comments.length) {
      lines.push("");
      lines.push("Comments:");
      for (const comment of comments) {
        lines.push(`- ${audiencePrefix(comment)}${comment.text}`);
      }
    }
    const stepShots = screenshotLines(run.screenshots.filter((s) => s.stepId === step.id));
    if (stepShots.length > 0) {
      lines.push("");
      lines.push(...stepShots);
    }
    if (state?.automatedResult?.error) {
      lines.push("");
      lines.push(`Error: ${state.automatedResult.error}`);
    }
    if (state?.automatedResult?.warnings.length) {
      lines.push("");
      lines.push("Warnings:");
      for (const w of state.automatedResult.warnings) lines.push(`- ${w}`);
    }
    if (state && hasCaptureSignal(stepCounts(state))) {
      lines.push("");
      lines.push(`Console: ${describeCounts(stepCounts(state))}`);
      // The step's own findings in one line each, so a reader stopped at a
      // failed step sees what the page said without scrolling back up to the
      // digest. The full text and stacks stay up there, deduplicated once.
      const own = digest?.items.filter((item) => item.firstStepId === step.id) ?? [];
      for (const item of own) lines.push(`- ${summarizeDigestItem(item)}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

function hasStepSignal(step: Step, state: RunStepState): boolean {
  return (
    state.status === "failed" ||
    state.status === "warning" ||
    // A skip the tester chose is a small vote against the step — repeated
    // across runs it is the test writer's cue to drop it or mark it
    // `Kind: extra`. An extra step arriving skipped is the default doing its
    // job, and says nothing; neither does a step jumped over on the way to
    // a later one.
    (state.status === "skipped" && !step.extra && !state.jumpedOver) ||
    stepComments(state).some((c) => c.text.trim().length > 0) ||
    !!state.automatedResult?.error ||
    // A console error during a step the tester marked passed is signal in its
    // own right, on the same argument as the run comment below: a green run
    // with a stack trace in it is exactly the finding that used to disappear.
    state.consoleErrors > 0 ||
    // Stars are feedback for the test writer whichever way they point: the
    // step to write the next ones like, or the one to rewrite.
    state.rating != null
  );
}

/**
 * Human-in-the-loop handoff artifact addressed to the LLM that built the
 * feature: what a human tester found while verifying it. Written as
 * `feedback.md` alongside `report.md` whenever a run finishes — but only
 * when there's something to act on. A clean silent pass returns `null` so
 * callers skip the write rather than producing empty-handoff noise.
 *
 * A run-level comment counts as something to act on by itself. "Passed, but
 * the whole flow felt slow" is exactly the kind of finding that never
 * attaches to one step, and before the run comment existed it had nowhere
 * to go — so a run that passed while worrying the tester produced no
 * handoff at all.
 *
 * `digest` follows the same rule as in `renderRunReport`: passed only when the
 * tester agreed to attach captured output. Without it this file still says how
 * much was captured — a count is not content, and a reader that knows a log
 * exists can ask for it instead of assuming the page was quiet.
 */
export function renderRunFeedback(
  doc: TestCaseVersion,
  run: RunFile,
  digest?: CaptureDigest | null,
): string | null {
  const byId = new Map(run.steps.map((s) => [s.stepId, s]));
  const labelStep = stepLabeller(doc);
  const numberLabels = stepNumberLabels(doc.steps);
  const signalSteps = doc.steps
    .map((step, index) => ({ step, index, state: byId.get(step.id) }))
    .filter(
      (s): s is { step: Step; index: number; state: RunStepState } =>
        !!s.state && hasStepSignal(s.step, s.state),
    );

  const runComment = run.comment.trim();
  if (signalSteps.length === 0 && !runComment && run.rating == null) return null;

  const failedCount = run.steps.filter((s) => s.status === "failed").length;
  const warningCount = run.steps.filter((s) => s.status === "warning").length;
  const skippedCount = signalSteps.filter(({ state }) => state.status === "skipped").length;
  const jumpedCount = run.steps.filter((s) => s.status === "skipped" && s.jumpedOver).length;
  const noteCount = run.steps.reduce((n, s) => n + stepComments(s).length, 0);

  const captured: CaptureCounts = {
    consoleErrors: run.steps.reduce((n, s) => n + s.consoleErrors, 0),
    consoleWarnings: run.steps.reduce((n, s) => n + s.consoleWarnings, 0),
    networkFailures: run.steps.reduce((n, s) => n + s.networkFailures, 0),
    requests: run.steps.reduce((n, s) => n + s.requests, 0),
  };

  // One bucket per audience, in the order the checkboxes appear, so a reader
  // scanning for their own section finds it in the same place every time.
  const addressed = new Map<CommentAudience, string[]>(COMMENT_AUDIENCES.map((a) => [a, []]));
  const failedItems: string[] = [];
  const skippedItems: string[] = [];
  const consoleItems: string[] = [];
  const exemplaryItems: string[] = [];
  const poorItems: string[] = [];

  for (const { step, index, state } of signalSteps) {
    const stepNum = numberLabels[index];
    const comments = stepComments(state);
    // Four and five stars go to one list, one and two to the other; a three
    // is "nothing to say" with a number on it and stays in the step detail.
    // The step's own comments ride along, since "excellent" without a reason
    // teaches less than "excellent — the Expected line names the exact toast".
    if (state.rating != null && (isExemplaryRating(state.rating) || isPoorRating(state.rating))) {
      const why = comments
        .map((c) => c.text.trim())
        .filter(Boolean)
        .join("; ");
      (isExemplaryRating(state.rating) ? exemplaryItems : poorItems).push(
        `- **${step.title}** (step ${stepNum}): ${describeRating(state.rating)}${why ? ` — ${why}` : ""}`,
      );
    }
    const toDeveloper = comments.some((c) => c.audiences.includes("developer"));
    for (const comment of comments) {
      for (const audience of comment.audiences) {
        addressed
          .get(audience)!
          .push(`- **${step.title}** (step ${stepNum}, ${state.status}): ${comment.text}`);
      }
    }
    // A failure the tester did not address to anyone still has to reach the
    // developer — silence about a red step is not a decision to ignore it.
    if (state.status === "failed" && !toDeveloper) {
      const detail = [
        comments
          .map((c) => c.text.trim())
          .filter(Boolean)
          .join("; "),
        state.automatedResult?.error,
      ]
        .filter((s): s is string => !!s)
        .join(" — ");
      failedItems.push(`- **${step.title}** (step ${stepNum})${detail ? `: ${detail}` : ""}`);
    }
    // An extra step skipped is the default; an ordinary step skipped is the
    // tester declining work the case asked for, and the test writer is the
    // one who can act on that. A step jumped over is neither — it was done
    // in the run before this one.
    if (state.status === "skipped" && !step.extra && !state.jumpedOver) {
      const detail = comments
        .map((c) => c.text.trim())
        .filter(Boolean)
        .join("; ");
      skippedItems.push(`- **${step.title}** (step ${stepNum})${detail ? `: ${detail}` : ""}`);
    }
    // The page throwing and the step failing are different statements, and
    // when they disagree the console one is the more precise: it names what
    // broke rather than what the tester could see of it. A request that came
    // back 500 is the same kind of statement — often the only one that names
    // the endpoint behind a button that "did nothing".
    for (const item of digest?.items ?? []) {
      if (item.firstStepId !== step.id) continue;
      if (item.level !== "error" && item.level !== "uncaught" && item.level !== "network") continue;
      consoleItems.push(
        `- **${step.title}** (step ${stepNum}, tester marked it ${state.status}): ` +
          summarizeDigestItem(item),
      );
    }
  }

  const lines: string[] = [];
  lines.push(`# Feedback: ${doc.title} (v${run.testCaseVersion}, run ${run.id})`);
  lines.push("");
  if (doc.project) lines.push(`Project: **${doc.project}**`);
  lines.push(
    `Human verification run finished ${run.finishedAt ?? "—"} with status **${run.status}**` +
      `${run.tier === "quick" ? ", covering the quick (core) steps only" : ""}.`,
  );
  lines.push(
    `${failedCount} failed, ${warningCount} warnings, ${noteCount} tester comments` +
      `${skippedCount > 0 ? `, ${skippedCount} ${skippedCount === 1 ? "step" : "steps"} skipped` : ""}` +
      // Said so the reader does not go looking for the missing verdicts:
      // the tester started at a later step on purpose.
      `${jumpedCount > 0 ? `, ${jumpedCount} jumped over to start further in` : ""}.`,
  );
  if (run.rating != null) {
    lines.push(
      `The tester rated the case as a piece of test writing: **${describeRating(run.rating)}**.`,
    );
  }
  if (hasCaptureSignal(captured)) {
    lines.push(
      digest
        ? `The page itself produced ${describeCounts(captured)} during the run; they are listed below.`
        : `The page itself produced ${describeCounts(captured)} during the run. The tester did ` +
            "not attach them, so they are **not** in this file or in `report.md`. `console.md` in " +
            "this run's folder holds them and is not yours to read — treat the omission as the " +
            "tester's decision, and ask if you need it.",
    );
  }
  lines.push("");
  const addressedCount = [...addressed.values()].reduce((n, items) => n + items.length, 0);
  const hasActionItems =
    addressedCount +
      failedItems.length +
      skippedItems.length +
      consoleItems.length +
      exemplaryItems.length +
      poorItems.length >
    0;
  lines.push(
    hasActionItems
      ? "This file was written by a human tester reviewing the feature. Each section below " +
          "is addressed to whoever the tester marked the comment for — take the ones that " +
          "are yours. Step-by-step detail follows for context."
      : "This file was written by a human tester reviewing the feature. Nothing " +
          "failed; what follows is what they wanted you to know anyway.",
  );

  if (runComment) {
    lines.push("");
    lines.push("## The tester's own words on this run");
    lines.push("");
    lines.push(runComment);
  }

  // Before the addressed sections: a case with groups was written as a set
  // of concerns, and "which concern broke" is the first thing every reader
  // wants — the developer to know where to look, the test writer to know
  // which goal the failing steps were serving.
  const groupSummary = renderGroupSummary(doc, run);
  if (groupSummary.length > 0) {
    lines.push("");
    lines.push("## By group");
    lines.push("");
    lines.push("Each group's goal, and how the steps written to prove it ended:");
    lines.push("");
    lines.push(...groupSummary);
  }

  const actionSections: Array<{ heading: string; items: string[]; lead?: string }> = [
    ...COMMENT_AUDIENCES.map((audience) => ({
      heading: AUDIENCE_SECTIONS[audience],
      items: addressed.get(audience)!,
      // The one audience whose feedback is not only about this run: a tester
      // saying the case was unclear is sometimes reporting a defect in one
      // case and sometimes stating how cases for this app should always be
      // written. Only a reader can tell which, so the file asks rather than
      // deciding — see the check skill, which promotes the standing ones.
      lead:
        audience === "test-writer"
          ? "Fix the case where this is a one-off. Where it is how cases for this " +
            "project should *always* be written, promote it to a project rule instead."
          : undefined,
    })),
    { heading: "Failed steps the tester left uncommented", items: failedItems },
    {
      heading: "Steps the tester skipped",
      items: skippedItems,
      // Addressed to the test writer even without a comment: a skip is a
      // small vote against the step, and only across runs does it become a
      // verdict — which is why the lead asks for a pattern, not a reaction.
      lead:
        "For the test writer. One skip may be circumstance. A step that arrives skipped " +
        "run after run is not earning its place — mark it `Kind: extra` so it stops " +
        "demanding a verdict, or remove it.",
    },
    { heading: "Errors and failed requests from the page", items: consoleItems },
    {
      heading: "Steps the tester rated highly",
      items: exemplaryItems,
      // Addressed to the test writer, and to the next case rather than this
      // one: a star is not an action item on the step it sits on. The
      // aggregate command is named because one tester's five is a data
      // point and five testers' fives are a style.
      lead:
        "For the test writer. These are the steps to write the next ones like — the shape, " +
        "the level of detail, what the Expected line names. `enloop-case.mjs ratings` " +
        "collects them across every run of this project.",
    },
    {
      heading: "Steps the tester rated poorly",
      items: poorItems,
      lead:
        "For the test writer. Rewrite these in the next version — the comment beside each " +
        "says why when the tester said; when they did not, judge the step against the " +
        "contract and say in your report what you changed. A shape that earns one star " +
        "in several cases is a project rule waiting to be written.",
    },
  ];
  // A comment-only handoff has nothing to list, and an empty "Action items"
  // heading reads as a bug in this renderer rather than as an all-clear.
  if (hasActionItems) {
    lines.push("");
    lines.push("## Action items");
    for (const { heading, items, lead } of actionSections) {
      if (items.length === 0) continue;
      lines.push("");
      lines.push(`### ${heading}`);
      if (lead) {
        lines.push("");
        lines.push(lead);
        lines.push("");
      }
      lines.push(...items);
    }
  }

  // The trace, when the tester asked for every request rather than only the
  // broken ones. Context rather than an action item: nothing here is wrong by
  // definition, and the value is in answering "what does this actually call"
  // without anyone having to reproduce the run with DevTools open.
  if (digest && digest.requests.length > 0) {
    lines.push("");
    lines.push("## What the page called");
    lines.push("");
    lines.push(
      "Every request made during the run, in the order they first happened, identical ones " +
        "collapsed. Query strings are redacted; no headers or bodies were captured.",
    );
    lines.push("");
    for (const item of digest.requests) {
      const where = labelStep(item.firstStepId);
      lines.push(
        `- ${item.text}${item.count > 1 ? ` ×${item.count}` : ""}${where ? ` (${where})` : ""}`,
      );
    }
    if (digest.omittedRequests > 0) {
      lines.push("");
      lines.push(
        `${digest.omittedRequests} further distinct ${
          digest.omittedRequests === 1 ? "request" : "requests"
        } not listed; \`console.md\` in this run's folder has them all.`,
      );
    }
  }

  if (signalSteps.length > 0) {
    lines.push("");
    lines.push("## Step detail");
  }

  for (const { step, index, state } of signalSteps) {
    lines.push("");
    lines.push(
      `### ${STATUS_ICON[state.status] ?? ""} ${numberLabels[index]}. ${step.title} (${state.status})`,
    );
    if (step.expected) lines.push(`Expected: ${step.expected}`);
    if (state.rating != null) lines.push(`Rating: ${describeRating(state.rating)}`);
    const detailComments = stepComments(state);
    if (detailComments.length > 0) {
      lines.push("Comments:");
      for (const comment of detailComments) {
        lines.push(`- ${audiencePrefix(comment)}${comment.text}`);
      }
    }
    if (state.automatedResult?.error) lines.push(`Automated error: ${state.automatedResult.error}`);
    if (hasCaptureSignal(stepCounts(state))) {
      lines.push(`Console: ${describeCounts(stepCounts(state))}`);
      for (const item of digest?.items ?? []) {
        if (item.firstStepId === step.id) lines.push(`- ${summarizeDigestItem(item)}`);
      }
    }
  }
  lines.push("");

  return lines.join("\n");
}

/** Derives the `feedback.md` handoff artifact for a free run from its raw
 * `notes.md` textarea content — regenerated in full on every save. */
export function renderFreeRunFeedback(freeRun: FreeRunFile, notes: string): string {
  return `# Free run feedback: ${freeRun.title}\n\nSession started ${freeRun.startedAt}, captured live (demo/unscripted testing).\n\n${notes}`;
}

/** Raw inner text of one top-level (`# `) section of a document, found with
 * the same splitting logic `parseCaseDocument` itself uses — `null` if the
 * heading isn't present. Operates on the whole raw text (title heading and
 * all), which is harmless: the title just becomes an unmatched section. */
function extractSectionRaw(markdown: string, headingName: string): string | null {
  const { sections } = splitTopSections(markdown, 1);
  const match = sections.find((s) => s.heading.trim().toLowerCase() === headingName.toLowerCase());
  return match ? match.content : null;
}

/** Start/end offsets of a top-level section's content — from right after
 * its heading line to right before the next top-level (`# `) heading, or
 * end of string. `null` if the heading isn't present. */
function sectionRange(markdown: string, headingName: string): { start: number; end: number } | null {
  const headingRe = new RegExp(`^# ${headingName}[ \\t]*\\r?\\n`, "im");
  const match = headingRe.exec(markdown);
  if (!match) return null;
  const start = match.index + match[0].length;
  const nextHeading = /^# /m.exec(markdown.slice(start));
  const end = nextHeading ? start + nextHeading.index : markdown.length;
  return { start, end };
}

/** Merges `content` into `markdown`'s top-level `headingName` section —
 * "prepend" inserts right after the heading (used for prep steps and
 * suite dependencies/prerequisites, which come "before" the case's own);
 * "append" inserts at the section's end (used for variables, so a case's
 * own duplicate-named variable declaration stays the one that's seen
 * first when re-parsed). Creates the section (placed right before
 * `# Steps`) if the case document doesn't already declare it. */
function mergeTopLevelSection(
  markdown: string,
  headingName: string,
  content: string,
  position: "prepend" | "append",
): string {
  const trimmed = content.trim();
  if (!trimmed) return markdown;
  const range = sectionRange(markdown, headingName);
  if (range) {
    if (position === "prepend") {
      return markdown.slice(0, range.start) + trimmed + "\n\n" + markdown.slice(range.start);
    }
    const before = markdown.slice(0, range.end).replace(/[ \t]*\n?$/, "");
    return `${before}\n\n${trimmed}\n\n${markdown.slice(range.end)}`;
  }
  const insertAt = stepsSections(markdown)[0]?.headingStart ?? markdown.length;
  return markdown.slice(0, insertAt) + `# ${headingName}\n\n${trimmed}\n\n` + markdown.slice(insertAt);
}

function prefixStepHeadings(stepsRaw: string): string {
  return stepsRaw.replace(/^##\s+/gm, "## Prep: ");
}

/**
 * A Markdown link whose href is a selector rather than a place to go —
 * `[the Sync button](#sync-crm-btn)`, `[the row](selector:[data-testid=row])`.
 * In the panel these are Highlight controls; in a file someone reads, they
 * are links to nowhere, so the label is all that survives.
 */
const SELECTOR_LINK_RE = /\[([^\]\n]+)\]\((?:#[A-Za-z_-][\w-]*|selector:[^)\n]+)\)/g;

function proseForReader(text: string, values: Record<string, string>): string {
  return substituteVariables(text, values).replace(SELECTOR_LINK_RE, "$1");
}

/**
 * The case as a document for a person, rather than as something the
 * extension executes.
 *
 * A case file is written for two audiences at once and the second one has
 * always come off worse: hand `v3.md` to a manual tester, a reviewer, or a
 * ticket, and they get `Selector: [data-testid="sync"]` lines, `Kind: quick`
 * markers, `%BASE_URL%` placeholders, and steps whose entire content is a
 * block of JavaScript. None of that is wrong — it is just addressed to the
 * panel, not to them.
 *
 * What this strips, and why each one:
 *
 * - **Automated steps.** A fenced script is not an instruction; a person
 *   cannot carry it out. They are listed by title at the end instead of
 *   vanishing, because "this was checked, by a script" is worth knowing and
 *   a silently shortened case reads as if the coverage was never there.
 * - **`Selector:` and `Kind:`.** Both address the panel — one is what
 *   Highlight flashes, the other picks the quick subset. A reader executing
 *   by hand needs the step's words, not its handles.
 * - **`@version`**, the grammar's format version, which says nothing about
 *   the case.
 * - **`%VAR%` placeholders that have a literal default**, substituted so
 *   the reader sees the address they should open rather than a variable
 *   name. Variables with a generator, or with no value at all, cannot be
 *   resolved outside a run and are listed as things to decide first.
 *
 * What it deliberately keeps: `"**quoted values**"`, which read as quoted
 * emphasis in any Markdown viewer, and selectors written as inline code in
 * prose, since removing those mid-sentence leaves a sentence with a hole in
 * it — the one place where being addressed to the panel costs a reader
 * nothing.
 */
export function renderReadableCase(
  doc: TestCaseVersion,
  opts: { exportedAt?: string } = {},
): string {
  const runnable = doc.steps.filter((s) => s.type !== "automated");
  const automated = doc.steps.filter((s) => s.type === "automated");

  const resolved: Record<string, string> = {};
  const undecided: Array<Pick<TestCaseVariable, "name" | "description">> = [];
  for (const entry of [...doc.domains, ...doc.variables]) {
    const cold =
      entry.defaultValue?.trim() ||
      (isMainDomainName(entry.name) ? coldLocation(doc.locations) : "");
    if (cold) resolved[entry.name] = cold;
    else undecided.push(entry);
  }
  const prose = (text: string) => proseForReader(text, resolved);

  const lines: string[] = [];
  lines.push(`# ${prose(doc.title)}`);
  lines.push("");
  if (doc.goal.trim()) {
    lines.push(`**Goal:** ${prose(doc.goal.trim())}`);
    lines.push("");
  }
  if (doc.project) lines.push(`- Project: ${doc.project}`);
  if (doc.author) lines.push(`- Author: ${doc.author}`);
  if (doc.tags.length > 0) lines.push(`- Tags: ${doc.tags.join(", ")}`);
  lines.push(
    `- Case version: v${doc.version}${
      opts.exportedAt ? ` (exported ${opts.exportedAt.slice(0, 10)})` : ""
    }`,
  );
  lines.push("");

  if (doc.description.trim()) {
    lines.push(prose(doc.description.trim()));
    lines.push("");
  }

  if (doc.youWill.trim() || doc.youWillNeed.length > 0) {
    lines.push("## What to expect");
    lines.push("");
    if (doc.youWill.trim()) {
      lines.push(`**You will:** ${prose(doc.youWill.trim())}`);
      lines.push("");
    }
    if (doc.youWillNeed.length > 0) {
      lines.push("**You will need:**");
      lines.push("");
      lines.push(renderBulletList(doc.youWillNeed.map(prose)));
      lines.push("");
    }
  }

  if (doc.dependencies.length > 0 || doc.prerequisites.length > 0) {
    lines.push("## Before you start");
    lines.push("");
    if (doc.prerequisites.length > 0) {
      lines.push(renderBulletList(doc.prerequisites.map(prose)));
      lines.push("");
    }
    if (doc.dependencies.length > 0) {
      lines.push("These must already be true, and are not yours to arrange:");
      lines.push("");
      lines.push(renderBulletList(doc.dependencies.map(prose)));
      lines.push("");
    }
  }

  if (undecided.length > 0) {
    lines.push("## Decide these first");
    lines.push("");
    for (const variable of undecided) {
      const description = variable.description.trim();
      lines.push(`- **${variable.name}** — ${description || "no description given"}`);
    }
    lines.push("");
    lines.push(
      "They appear below as `%NAME%`. Write down what you used, so a rerun means the same thing.",
    );
    lines.push("");
  }

  lines.push("## Steps");
  lines.push("");

  if (runnable.length === 0) {
    lines.push("*Every step in this case is automated — there is nothing here to do by hand.*");
    lines.push("");
  }

  const runnableLabels = stepNumberLabels(runnable);
  runnable.forEach((step, index) => {
    if (step.group && runnable[index - 1]?.group !== step.group) {
      const goal = doc.groups.find((g) => g.title === step.group)?.goal.trim();
      lines.push(`**${prose(step.group)}**${goal ? ` — ${prose(goal)}` : ""}`);
      lines.push("");
    }
    lines.push(`### ${runnableLabels[index]}. ${prose(step.title)}`);
    lines.push("");
    if (step.extra) {
      lines.push("*Optional — a run skips this by default; do it if it applies and time allows.*");
      lines.push("");
    }
    if (step.where) {
      lines.push(`**Where:** ${prose(step.where)}`);
      if (step.via) lines.push(`**Via:** ${prose(step.via)}`);
      lines.push("");
    }
    if (step.instructions?.trim()) {
      lines.push(prose(step.instructions.trim()));
      lines.push("");
    }
    if (step.expected?.trim()) {
      lines.push("**Expected**");
      lines.push("");
      lines.push(prose(step.expected.trim()));
      lines.push("");
    }
    if (step.note?.trim()) {
      lines.push("**Note**");
      lines.push("");
      lines.push(prose(step.note.trim()));
      lines.push("");
    }
  });

  if (automated.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push(
      `*${automated.length} automated step${automated.length === 1 ? "" : "s"} ` +
        `omitted — ${automated.length === 1 ? "it runs" : "they run"} as a script in the Enloop ` +
        `extension rather than by hand:*`,
    );
    lines.push("");
    for (const step of automated) lines.push(`- *${prose(step.title)}*`);
    lines.push("");
  }

  return lines.join("\n");
}

/** True when a step body's header block carries `Kind: quick`. Reads only
 * the header — the same lines `parseOneStep` reads — so a `Kind:` line in
 * the instructions prose is not a marker. */
function stepBodyIsQuick(body: string): boolean {
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    const kindMatch = KIND_RE.exec(line);
    if (kindMatch) return kindMatch[1].trim().toLowerCase() === "quick";
    if (!SELECTOR_RE.test(line) && !WHERE_RE.test(line) && !VIA_RE.test(line)) return false;
  }
  return false;
}

/** Number of steps a quick run of this document would execute. */
export function countQuickSteps(markdown: string): number {
  const normalized = stripViewerComment(markdown).replace(/\r\n/g, "\n");
  return stepsSections(normalized).reduce(
    (n, range) =>
      n +
      splitTopSections(normalized.slice(range.start, range.end), 2).sections.filter((s) =>
        stepBodyIsQuick(s.content),
      ).length,
    0,
  );
}

/**
 * Drops every step not marked `Kind: quick`, returning the document a quick
 * run should freeze.
 *
 * This is text surgery on purpose, applied **before** the case is parsed and
 * before a suite is merged in. Filtering the text rather than the parsed
 * steps keeps two properties that matter:
 *
 * - The frozen `case.md` is exactly what was executed. A run never carries
 *   definitions for steps it skipped, so nothing downstream has to know that
 *   a step was filtered out.
 * - Step ids stay contiguous. Ids are positional (`step-${index + 1}`), so
 *   removing steps after parsing would leave gaps between the run's step ids
 *   and the frozen document's, and every join between `run.json` and
 *   `case.md` goes through those ids.
 *
 * Called before `buildRunSource`, so a suite's prep steps are never filtered
 * — a quick run that skips logging in is not a run.
 */
export function filterToQuickSteps(markdown: string): string {
  // Stripped before the surgery, not after: the comment sits past the last
  // step, so it would otherwise ride along inside that step's body and be
  // kept or dropped depending on whether that step happened to be quick.
  const normalized = stripViewerComment(markdown).replace(/\r\n/g, "\n");
  const ranges = stepsSections(normalized);
  if (ranges.length === 0) return normalized;

  // Last section first, so earlier offsets stay valid while later text moves.
  let result = normalized;
  for (const range of [...ranges].reverse()) {
    const { preamble, sections } = splitTopSections(normalized.slice(range.start, range.end), 2);
    const kept = sections
      .filter((s) => stepBodyIsQuick(s.content))
      .map((s) => `## ${s.heading}\n${s.content}`.trim());
    // A group none of whose steps is quick leaves the quick run whole —
    // heading and goal too. A heading over nothing would parse as an empty
    // group, and the linter would rightly refuse the document it was in.
    if (kept.length === 0 && range.group) {
      result = result.slice(0, range.headingStart) + result.slice(range.end);
      continue;
    }
    const goal = range.group && preamble.trim() ? preamble.trim() + "\n\n" : "";
    result =
      result.slice(0, range.start) + goal + kept.join("\n\n") + "\n\n" + result.slice(range.end);
  }
  return result;
}

/**
 * Every section that holds steps — `# Steps` and each `# Steps: <group>` —
 * in document order. `headingStart` is the offset of the heading line
 * itself, `start`/`end` bracket the content under it (as `sectionRange`),
 * and `group` is the title after the colon, or `null` for the plain form.
 * Text surgery on steps goes through this rather than `sectionRange`,
 * which finds one section by exact name and so would see only the plain
 * `# Steps` of a grouped case.
 */
function stepsSections(
  markdown: string,
): Array<{ group: string | null; headingStart: number; start: number; end: number }> {
  const out: Array<{ group: string | null; headingStart: number; start: number; end: number }> = [];
  const headingRe = /^# Steps(?::[ \t]*([^\r\n]*?))?[ \t]*(?:\r?\n|$)/gim;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(markdown)) !== null) {
    const start = match.index + match[0].length;
    const nextHeading = /^# /m.exec(markdown.slice(start));
    const end = nextHeading ? start + nextHeading.index : markdown.length;
    out.push({
      group: (match[1] ?? "").trim() || null,
      headingStart: match.index,
      start,
      end,
    });
    if (match[0].length === 0) headingRe.lastIndex++;
  }
  return out;
}

/**
 * Merges a suite's shared preparation (from its `suite.md`) into a case's
 * raw Markdown before it's parsed for a run — the run engine and `case.md`
 * freezing stay untouched; this just makes prep steps ordinary tracked
 * steps of the run. `suiteMarkdown: null` (standalone case) passes through
 * unchanged. Prep steps are prefixed `Prep: ` and inserted before the
 * case's own steps; suite variables are appended after the case's own
 * (case wins on a name clash); dependencies/prerequisites are concatenated
 * with the suite's first.
 */
export function buildRunSource(caseMarkdown: string, suiteMarkdown: string | null): string {
  if (!suiteMarkdown) return caseMarkdown;
  const normalizedCase = stripViewerComment(caseMarkdown).replace(/\r\n/g, "\n");
  const normalizedSuite = stripViewerComment(suiteMarkdown).replace(/\r\n/g, "\n");

  // A suite's prep steps are taken from every steps section it has, group
  // headings and goals dropped: prep is shared setup, and it joins the case
  // ungrouped, ahead of whatever the case groups.
  const suiteSteps = stepsSections(normalizedSuite)
    .flatMap(
      (range) =>
        splitTopSections(normalizedSuite.slice(range.start, range.end), 2).sections,
    )
    .map((s) => `## ${s.heading}\n${s.content}`.trim())
    .join("\n\n");
  const suiteDomains = extractSectionRaw(normalizedSuite, "Domains");
  const suiteVariables = extractSectionRaw(normalizedSuite, "Variables");
  const suiteDependencies = extractSectionRaw(normalizedSuite, "Dependencies");
  const suitePrerequisites = extractSectionRaw(normalizedSuite, "Prerequisites");
  const suiteYouWillNeed = extractSectionRaw(normalizedSuite, "You will need");

  let result = normalizedCase;

  if (suiteSteps.trim()) {
    const prep = prefixStepHeadings(suiteSteps);
    const first = stepsSections(result)[0];
    if (!first) {
      result = mergeTopLevelSection(result, "Steps", prep, "prepend");
    } else if (first.group) {
      // The case opens with a group: prep gets a plain `# Steps` of its own
      // in front of it rather than being read as the group's first steps.
      result =
        result.slice(0, first.headingStart) +
        `# Steps\n\n${prep}\n\n` +
        result.slice(first.headingStart);
    } else {
      result = result.slice(0, first.start) + prep + "\n\n" + result.slice(first.start);
    }
  }

  // Suite domains follow the variable rule: appended after the case's own,
  // so a case that redeclares `APP` keeps its own entry — and its own main
  // domain, since the case's first declaration stays first.
  if (suiteDomains?.trim()) {
    const caseDomainSection = extractSectionRaw(result, "Domains");
    const caseDomainNames = new Set(
      caseDomainSection ? parseDomains(caseDomainSection).map((d) => d.name) : [],
    );
    const suiteDomainSubsections = splitTopSections(suiteDomains, 2).sections.filter(
      (s) => !caseDomainNames.has(s.heading.trim()),
    );
    if (suiteDomainSubsections.length > 0) {
      const suiteDomainText = suiteDomainSubsections
        .map((s) => `## ${s.heading}\n${s.content}`.trim())
        .join("\n\n");
      result = mergeTopLevelSection(result, "Domains", suiteDomainText, "append");
    }
  }

  if (suiteVariables?.trim()) {
    const caseVarSection = extractSectionRaw(result, "Variables");
    const caseVarNames = new Set(
      caseVarSection ? parseVariables(caseVarSection).map((v) => v.name) : [],
    );
    const suiteVarSubsections = splitTopSections(suiteVariables, 2).sections.filter(
      (s) => !caseVarNames.has(s.heading.trim()),
    );
    if (suiteVarSubsections.length > 0) {
      const suiteVarText = suiteVarSubsections
        .map((s) => `## ${s.heading}\n${s.content}`.trim())
        .join("\n\n");
      result = mergeTopLevelSection(result, "Variables", suiteVarText, "append");
    }
  }

  if (suiteDependencies?.trim()) {
    result = mergeTopLevelSection(result, "Dependencies", suiteDependencies, "prepend");
  }

  if (suitePrerequisites?.trim()) {
    result = mergeTopLevelSection(result, "Prerequisites", suitePrerequisites, "prepend");
  }

  if (suiteYouWillNeed?.trim()) {
    result = mergeTopLevelSection(result, "You will need", suiteYouWillNeed, "prepend");
  }

  return result;
}
