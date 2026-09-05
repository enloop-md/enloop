# Enloop manifesto alignment — implementation plan

Status: **written 2026-09-05; phases 1–5 built the same day, uncommitted.**
M6 landed without the schema change: a comment with no audience already
exists in the model and `feedback.md` already keeps it, so the audience
row and step rating moved under a closed disclosure and nothing on disk
changed. Not built: the panel does not yet verify visually (no side-panel
run was made); the repo-root folder search is untested against a real
pick. The audit that produced this is summarised in section 1;
`MANIFESTO.md` is the principle it serves. Phases are ordered so each one leaves the tree
buildable and shippable on its own.

Read `MANIFESTO.md` first. Every task below is one place where the current
implementation asks the human to decide, provide, look up, or wonder — and
the manifesto says they never do.

---

## 1. What the audit found

The case format already carries addresses, values, selectors, marked
literals and observable criteria, and the linter enforces the mechanical
half. The manifesto breaks at the edges of a run:

- **Before step 1** the tester is asked to pick a folder, pick an
  environment, choose quick or full, fill or override values, and start
  anyway when a value is missing. The goal of the run is nowhere on screen.
- **After each step** the tester classifies a comment into five audiences
  and may rate the step; at the end they rate the case and choose Finish
  or Abort.
- **The contract** accepts a case with prose `Where:`, no `Selector:`, no
  `### Expected`, no entry point and no stated account, because those are
  linter warnings and warnings never block a write. The shipped example
  fails its own contract.
- **Credentials** resolve to "vault item X", which is a lookup.
- **The first minute** depends on knowing things: which folder, that a
  viewer exists, that the export menu makes links.

---

## 2. Decisions

Locked in; do not relitigate mid-flight.

| # | Decision | Consequence |
|---|---|---|
| M1 | **`Goal:` and `You will:` are header lines**, beside `Tags:` — one line each | The goal is a sentence, not the description. The description stays free prose for background. Both lines are required by the linter (errors), so every new case carries them; old cases keep parsing. |
| M2 | **`# You will need` is its own section**, a bullet list | "What must be in the tester's hands" is separated from `# Prerequisites` (where the run begins, who the tester is, what to start). It renders open above Start, never collapsed. |
| M3 | **The goal is pinned in the run header** | Below the title, for the whole run. Subgoals keep their group headers. |
| M4 | **A run does not start with an unresolved value** | Start is disabled; the form says which names are empty and how each is fixed. A defective case is refused, not run with literals. |
| M5 | **Quick is the default start when the case defines it** | One primary button. "Full run" is a secondary control. With no quick steps there is one button, as today. |
| M6 | **One comment per step; audiences are not the tester's job** | The textarea stays; audience checkboxes move under a closed "Address it to someone (optional)" disclosure. A comment with no audience is already a valid comment the model keeps and `feedback.md` renders, and the check skill already reads "or none at all" — so no schema change. Step and case ratings stay where they are; they are optional and never block. |
| M7 | **Credentials are environment values** | The contract says a test account's password is a variable the environment provides, written as a typeable value in the account prerequisite. "Vault item" survives only for deployments an environment must not hold (prod), and the linter warns on it. |
| M8 | **Errors, not warnings, for what the manifesto names** | Missing `Goal:` / `You will:`; no `### Expected`; no `Selector:` on a step whose `Where:` is an address; no entry point when the case names addresses; `%DOMAIN%` without `@locations`. Prose `Where:` and "who is the tester" stay warnings — a terminal step and a login-less app are legitimate answers the grammar cannot express. |
| M9 | **Every skill run ends with a link** | The `write` command appends the viewer-link comment and prints the link; the final report gives the link first, then the two extension steps. Requires `viewerLink`/`withViewerComment` in the bundled validator. |
| M10 | **A repo root is a valid folder** | Connecting a directory with no `test-cases/` searches two levels for one (`enloop/`, `tests/enloop/`, …) and registers that. Setup writes `README.md` into the case folder with the install link. |
| M11 | **A viewer link can open simplified** | `#c=…&v=simplified`. The panel's share menu offers both. |
| M12 | **Skills derive before they ask** | Project name from the repo's manifest (`package.json` `name`, `composer.json`, `pyproject`, else directory), stated in the report; only an `AMBIGUOUS` data folder is a question. |

Grammar format version becomes `0.0.11` (new header lines and a new
section). Plugin becomes `0.17.0`.

---

## 3. Phases

### Phase 1 — goal, subgoals, what you will do and need (M1, M2, M3)

1. `shared/src/schemas.ts`: `goal: string`, `youWill: string`, `youWillNeed: string[]` on the version schema; `goal`, `youWill`, `youWillNeed` composed onto the run schema.
2. `shared/src/markdown.ts`: parse `Goal:` / `You will:` header lines and `# You will need`; render them; grammar comment; starter template; readable export shows all four above the steps; `CURRENT_FORMAT_VERSION = "0.0.11"`. Suite merge prepends suite `# You will need` like prerequisites.
3. `shared/src/lint.ts`: errors for missing `Goal:` and `You will:` (M8, first half). Goal longer than ~120 characters warns.
4. `shared/src/html.ts`: goal under the title, "You will" and "You will need" as an open block before the steps.
5. `extension`: `composeRun` passes the three fields; `RunScreen` pins the goal in the header; `CaseDetailScreen` shows goal, "You will", "You will need" and the group list above Start; `EditorScreen` needs no change (raw Markdown).
6. `viewer/src/builder.ts`: Goal, You will, You will need fields.
7. Skills: `step-contract.md` gains rule 0 (goal and subgoals, what you will do and need); `authoring.md` step 8 writes all four; `enloop-case.mjs brief` example carries them; `docs/case-format.md`; `example-case.ts`.

### Phase 2 — contract enforcement (M8, M7)

8. `lint.ts`: promote to errors per M8; "vault item" warning; `LOGIN_HINT` also satisfied by a `%…PASSWORD%` value.
9. `example-case.ts`: `Where:` on the seven panel-tour steps; passes `lintCase` with no errors.
10. `step-contract.md` 2d and 6, `authoring.md`, `setup/SKILL.md`: credentials as environment values (`--variable QA_PASSWORD --env staging --set …`).

### Phase 3 — the run never asks (M4, M5, M6)

11. `CaseDetailScreen`: Start disabled while any domain or variable resolves empty; the values block opens itself and lists the empty names with the fix for each ("open the app in this tab", "pick an environment", "this case needs a default — a defect for the check skill").
12. `CaseDetailScreen`: quick as the primary Start when `quick > 0 && quick < total`; full as a secondary link with the count.
13. `RunScreen` `StepComments`: audiences and step rating under a collapsed "More"; `commentAudienceSchema` gains `unsorted`; `renderRunFeedback` routes unsorted comments into a leading "To triage" section; `check/SKILL.md` classifies them.

### Phase 4 — the first minute (M9, M10, M11, M12)

14. `plugin-entry.ts` exports `viewerLink`, `withViewerComment`; `enloop-case.mjs write` appends the comment and prints the link; `authoring.md` final report: link, then "install the extension, connect `<folder>`".
15. `storage-registry.ts`: `addStorage` walks two levels for a `test-cases/` directory when the picked root has none; `ConnectScreen` copy says "pick the repo or the folder".
16. `setup/SKILL.md` writes `<data folder>/README.md` (install link, connect instruction, viewer note).
17. `viewer-link.ts`: `viewerLink(md, { simplified })` adds `v=simplified`; `viewer/src/main.ts` reads it; panel share menu offers "Copy link — simplified".
18. `authoring.md` step 1: derive the project name before asking; `data-folder.md` unchanged.

### Phase 5 — bookkeeping

19. `npm run build:plugin`, `npm run build`, `npm run build:viewer`, `npm run typecheck`.
20. `CHANGELOG.md` Unreleased; plugin `0.17.0`; `docs/extension.md`, `docs/skills.md`, `README.md` example.

---

## 4. Out of scope

Reading cases from a GitHub URL without a clone (needs the backend or a
read-only store with nowhere to write runs); environment studio;
environment agent; the project map. Each is named in `MANIFESTO.md` under
"Where this leads" and gets its own plan.
