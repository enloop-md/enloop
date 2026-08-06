# Enloop multi-storage — implementation plan

## 1. Goal

One connected folder is the whole product's storage today. `DataStoreProvider`
holds a single `FsaDataStore` built from a single persisted handle, and every
screen reaches it through `useReadyStore()`.

That forces a choice nobody should have to make: cases either live in one
personal folder — where they are invisible to the repo they test, and lost to
everyone who clones it — or the folder moves into an app repo and every *other*
project's cases disappear from the panel.

After this work:

- **Several storages are connected at once.** The Library lists all of them,
  grouped by storage, with a filter to narrow to one. Switching is filtering;
  nothing is disconnected to look at something else.
- **A storage can live inside an app repo**, so cases are committed with the
  code they test and arrive with a clone. Runs stay local, via a `.gitignore`
  the extension writes.
- **Storage kind is pluggable.** `FsaDataStore` is one implementation of a
  child store; `ApiDataStore` (PLAN-BACKEND section 7) becomes another, with
  no further change to screens.

### Non-goals for this pass

- **The API store itself.** PLAN-BACKEND owns it. This plan only makes room.
- **Moving a case between storages.** Export the Markdown and create it in the
  other storage. A move is a delete plus a create with a new id, and the run
  history does not follow it.
- **Cross-storage suites.** A suite and its cases live in one storage. The
  merged Library shows suites from several storages; it never composes one
  suite out of two.
- **Sync, dedup, conflict resolution.** Two storages holding the same case are
  two cases. Nothing reconciles them.
- **Ordering beyond a manual `order` field.** No pinning, no favourites.

---

## 2. Decisions

Locked in before execution; do not relitigate mid-flight.

| # | Decision | Consequence |
|---|---|---|
| S1 | **A `WorkspaceStore implements DataStore` fans out to N child stores** | Screens keep calling `useReadyStore()` and never learn that storages exist. The alternative — a storage id threaded through every screen — touches every file and was rejected. |
| S2 | **Ids are namespaced `<storageId>:<localId>` at the workspace boundary only** | The workspace prefixes ids on the way out and strips them on the way in. A child store never sees a namespaced id. |
| S3 | **Nothing on disk changes** | No file gains a storage id. A folder cloned by a colleague is registered under *their* storage id and works unchanged. This is what makes committing cases to a repo viable, and it is the reason S2 says "boundary only". |
| S4 | **A failing storage degrades, never throws** | Every fan-out uses `Promise.allSettled`. A folder whose permission lapsed, was deleted, or was renamed contributes nothing and raises a banner. One bad storage must never empty the Library. |
| S5 | **All storages are live; the filter is a view** | No "active storage" concept. Anything else re-creates the problem: a run in one storage while reading a case in another. |
| S6 | **Runs are written to the storage their case came from** | Routing by the case id's namespace makes this automatic. A case and its history stay together — including inside a repo, where `runs/` is gitignored. |
| S7 | **The registry lives in IndexedDB, not `chrome.storage`** | `FileSystemDirectoryHandle` survives structured clone but not the JSON serialization `chrome.storage` performs. `idb-keyval` is already a dependency and already holds the handle. |
| S8 | **Permission is per storage, and the panel no longer gates on it** | Handles lapse independently on Chrome restart. The Connect screen appears only when *zero* storages are registered; otherwise the Library renders with per-storage reconnect banners. |
| S9 | **Namespaced ids are branded types, not `string`** | A missed namespace is otherwise invisible: both forms are `string`, so it compiles and fails at click time. Branding moves that whole bug class to compile time. Section 3.3. |

---

## 3. Identity

### 3.1 The scheme

```
<storageId>:<localId>
st_9f3a2b71:sign-in-with-sso-4c2e1a08
```

- `storageId` is `st_` + `shortId()` (`shared/src/id.ts`), assigned when a
  storage is registered. Never derived from the folder name — two folders can
  share a name, and renaming one must not re-identify its cases.
- `localId` is exactly what `FsaDataStore` uses today: the case, suite, run or
  free-run directory name.
- `:` is the separator because every existing id is `slugify`d
  (`[a-z0-9-]` plus a hex suffix) and cannot contain one. **Assert this**: the
  registry rejects a storage id containing `:`, and `splitId` throws on an id
  with more than one.

New module, `shared/src/storage-id.ts`. The return types are branded — see
3.3, which defines `Namespaced` and is the reason these signatures look the
way they do:

```ts
export function joinId<K extends string>(storageId: string, localId: string): Namespaced<K>;
export function splitId(id: Namespaced<string>): { storageId: string; localId: string };
/** True for an id that carries a namespace — for migration paths and guards. */
export function isNamespaced(id: string): boolean;
```

`splitId` throws a typed `MalformedIdError` rather than returning null: every
call site is a lookup that cannot proceed, and a silent null becomes a
"not found" that hides the real cause.

### 3.2 Every field that must be namespaced

The workspace rewrites these on the way out. With S9 in force the compiler
catches a miss, so this table is the map of what to annotate in 3.3 rather
than a list to police by hand:

| Type | Fields |
|---|---|
| `TestCaseSummary` | `id`, `suiteId` |
| `TestCaseMeta` | `id`, `suiteId` |
| `SuiteSummary` | `id` |
| `RunSummary` | `id`, `testCaseId` |
| `Run` | `id`, `testCaseId` |
| `FreeRunSummary` / `FreeRun` | `id` — both split out of `FreeRunFile`, see 3.3 |

Not namespaced, deliberately: `Step.id` (`step-1`, scoped to its case),
`RunStepState.stepId`, and every id **inside a file on disk** — `run.json`'s
`testCaseId`, `meta.json`, `free-run.json`. Per S3 the workspace strips the
namespace before a child store writes, and re-applies it on read.

`RunFile.testCaseId` is the trap: it is read from disk (local) and surfaced in
`RunSummary.testCaseId` (namespaced). The mapping happens in the workspace's
`listRuns`/`getRun` wrappers, not in `FsaDataStore`.

### 3.3 Branding (S9)

A namespaced id and a local id are both `string`. Every mistake this refactor
can make is therefore invisible to `tsc` and shows up as a "not found" when
somebody clicks a row. Branding is what converts that into a build error, and
it is worth the ceremony precisely because a cheaper model executes this plan
without a human reading every line.

In `shared/src/storage-id.ts`:

```ts
declare const BRAND: unique symbol;
export type Namespaced<K extends string> = string & { readonly [BRAND]: K };

export type CaseId = Namespaced<"case">;
export type SuiteId = Namespaced<"suite">;
export type RunId = Namespaced<"run">;
export type FreeRunId = Namespaced<"freeRun">;
```

A distinct brand per kind, not one shared `Namespaced` — it costs nothing here
and additionally stops a `SuiteId` being passed where a `CaseId` belongs,
which is a real mistake in a codebase where both are directory names.

**Casts live in exactly two functions**, `joinId` and `splitId`. A cast to a
branded id anywhere else — a screen, a store, a test — is a bug, not a
shortcut. That rule is the whole value of the exercise; without it the brand
becomes decoration.

#### What to annotate, and what must stay plain

| Declaration | Change |
|---|---|
| `TestCaseSummary`, `SuiteSummary`, `RunSummary`, `VersionSummary` | Plain interfaces in `types.ts` — annotate the fields from 3.2 directly. |
| `TestCaseMeta`, `Run` | Currently `z.infer` of `testCaseMetaSchema` / `runSchema`. **Both schemas are type-only — verified: zero runtime uses outside `schemas.ts`.** Delete them and hand-write the interfaces in `types.ts` with branded ids. |
| `RunFile`, `FreeRunFile`, `CaseBookkeeping` | On-disk shapes, parsed with zod at runtime. **Ids stay plain `string`.** Per S3 nothing on disk is namespaced, and keeping them plain is what makes the compiler reject assigning `RunFile.testCaseId` straight into `Run.testCaseId`. |

That last row is the point of the whole scheme: the one place this refactor
is most likely to go wrong — surfacing a disk-local id as a workspace id —
stops being a code review problem and becomes a type error.

#### The `FreeRun` wrinkle

`listFreeRuns(): Promise<FreeRunFile[]>` hands the *on-disk* type straight to
screens, and `FreeRun extends FreeRunFile`. Those cannot both hold a branded
and a plain `id`. Split them:

```ts
/** On disk. Local id, plain string. */
export type FreeRunFile = z.infer<typeof freeRunFileSchema>;

/** What the workspace returns. */
export interface FreeRunSummary extends Omit<FreeRunFile, "id"> { id: FreeRunId }
export interface FreeRun extends FreeRunSummary { notes: string }
```

and change `FreeRunStore.listFreeRuns` to return `FreeRunSummary[]`.

#### Child stores vs. the workspace

`FsaDataStore` implements the same `DataStore` interface but is handed *local*
ids by the workspace. Two ways to express that:

1. A second `ChildDataStore` interface typed with plain `string` — nominally
   correct, and it would make "no screen may hold an `FsaDataStore`" a
   compile error rather than the grep in section 12. Costs 25 duplicated
   method signatures.
2. One `DataStore` typed with branded ids; the workspace re-brands each local
   id as it delegates.

**Take (2).** The re-brand is a lie confined to `workspace-store.ts`, always
on the line after a `splitId`, and ten contained casts read better than a
duplicated 25-method interface that must be kept in sync forever. Give it a
named helper so the intent is legible and greppable:

```ts
/** The local half of a namespaced id, re-branded for the child store — which
 * implements the same interface but is addressed in its own local ids. The
 * brand is true outside a child and a fiction inside one. */
function forChild<K extends string>(id: Namespaced<K>): Namespaced<K> {
  return splitId(id).localId as Namespaced<K>;
}
```

Keep the section 12 grep anyway. It catches a screen importing the concrete
store, which (2) does not.

### 3.4 Persisted screen state

`nav-state.ts` `Screen` objects hold `testCaseId`, `suiteId`, `runId`,
`freeRunId` and are written to `chrome.storage.session`. They will hold
namespaced ids. No schema change — `isScreen` already validates "is a string".

A stale id (storage removed while the panel was closed) resolves to a
`NotFoundError` — defined in `extension/src/lib/fs-utils.ts`, not in shared —
which the detail screens already render through `ErrorNotice`. Extend
`describeError` (`extension/src/lib/errors.ts`) with a case for an unknown
storage id: *"That case is in a storage that is no longer connected."* — plus
a button back to the Library. Leave `isFolderAccessError` in that file alone;
it classifies the permission failures section 7.1 turns into banners, and its
current behaviour is what those banners depend on.

---

## 4. The registry

New module: `extension/src/lib/storage-registry.ts`. It owns the list of
storages and their handles, and nothing else.

```ts
export type StorageKind = "fsa";           // "api" arrives with PLAN-BACKEND

export interface StorageEntry {
  id: string;                              // "st_" + shortId()
  kind: StorageKind;
  /** Editable; defaults to the folder name. Chrome only reports the name,
   * not the path, so two folders called `test-cases` are indistinguishable
   * without this. */
  label: string;
  addedAt: string;                         // ISO
  order: number;                           // ascending; ties broken by addedAt
}

export type StoragePermission = "granted" | "prompt" | "denied" | "missing";

export interface StorageStatus extends StorageEntry {
  permission: StoragePermission;
  /** Set when the last access failed — shown on the storage's banner. */
  error?: string;
}
```

Keys in IndexedDB (`idb-keyval`):

| Key | Value |
|---|---|
| `enloop:storages` | `StorageEntry[]` |
| `enloop:storage-handle:<id>` | `FileSystemDirectoryHandle` |
| `tcm-root-dir-handle` | **legacy**, single handle — see section 8 |

API:

```ts
listStorages(): Promise<StorageEntry[]>;
addFsaStorage(): Promise<StorageEntry>;        // shows the picker; user gesture
renameStorage(id: string, label: string): Promise<void>;
removeStorage(id: string): Promise<void>;      // forgets; never touches files
reorderStorage(id: string, order: number): Promise<void>;
getHandle(id: string): Promise<FileSystemDirectoryHandle | null>;
permissionOf(id: string): Promise<StoragePermission>;
requestAccess(id: string): Promise<boolean>;   // user gesture
```

`removeStorage` deletes the registry entry and the handle, and **never deletes
a file**. Say so in the confirm dialog: *"Enloop forgets this folder. Nothing
in it is deleted."*

`addFsaStorage` rejects a folder already registered — compare with
`handle.isSameEntry()` against every stored handle, not by name. Adding the
same folder twice would show every case in it twice under two ids.

---

## 5. `WorkspaceStore`

New module: `extension/src/lib/workspace-store.ts`.

```ts
export class WorkspaceStore implements DataStore {
  constructor(private readonly children: Map<string, DataStore>) {}
}
```

### 5.1 Three method shapes

**Fan-out** — `listTestCases`, `listSuites`, `listRuns()` (no argument),
`listFreeRuns`. Query every child, namespace the results, concatenate, and
re-sort with the same comparator the child used (`byRecentlyUpdated` for
cases, title for suites, `startedAt` desc for runs). Sorting after the merge
is required: each child sorted only its own rows.

**Routed** — everything taking an id: `getTestCase`, `getVersion`,
`createVersion`, `createRun`, `updateStep`, `getRun`, `archiveSuite`, … Split
the id, look up the child, call it with the local id, namespace what comes
back. An unknown storage id throws `NotFoundError` naming the storage.

**Targeted** — creation without an id to route on: `createTestCase`,
`createSuite`, `createFreeRun`. `DataStore`'s signature has no storage
parameter, so `WorkspaceStore` adds sibling methods and implements the
interface method as "use the default target":

```ts
createTestCaseIn(storageId: string, body: string, suiteId?: string): Promise<TestCaseMeta>;
createSuiteIn(storageId: string, body: string): Promise<SuiteSummary>;
createFreeRunIn(storageId: string, title: string): Promise<FreeRun>;
```

Screens that create call the `…In` form through `useWorkspace()` (section 7.3).
The bare `DataStore` methods stay implemented — they target the default
storage — so nothing that already compiles breaks.

### 5.2 Failure isolation (S4)

```ts
const results = await Promise.allSettled(
  [...this.children].map(([id, store]) => store.listTestCases().then(rows => ({ id, rows }))),
);
```

Rejected entries are recorded on the workspace as
`degraded: Array<{ storageId: string; message: string }>` and exposed through
the provider so the Library can show one banner per broken storage. Fulfilled
entries render normally. **A rejected child never rejects the fan-out.**

Do not cache the degraded list beyond the current call — a reconnect must
clear it without a reload.

### 5.3 Capabilities — deferred, deliberately

`StoreCapabilities` does not exist in the code today; it is a PLAN-BACKEND 7.2
proposal. **Do not build it in this pass.** Every child store here is an
`FsaDataStore`, so a union of identical capability sets would gate nothing and
would be dead structure written against an interface that has no second
implementation yet.

What this plan owes that one is a shape it can slot into. When PLAN-BACKEND
lands `capabilities`, `WorkspaceStore` exposes two things rather than one:

- `capabilities` — the **union** across children, for global chrome ("New
  suite" is offered if any storage supports suites).
- `capabilitiesFor(storageId)` — for anything acting on one item, which is
  most of the UI once storages can differ.

`FsaDataStore` will report `projects: false`: a folder is one library. The
workspace is what provides more than one, which is precisely the amendment
section 9 makes to D2.

### 5.4 Suite ↔ case coupling

`createTestCaseIn(storageId, body, suiteId)` must reject when `suiteId`'s
namespace is not `storageId` — a case cannot join a suite in another storage
(non-goal). Message: *"That suite is in a different storage."*

---

## 6. `FsaDataStore` changes

Small, and all additive.

1. **`.gitignore` on registration.** When a storage is added, ensure a
   `.gitignore` at its root contains `runs/` and `free-runs/`:

   ```
   # Enloop — cases are meant to be committed; run history is local.
   runs/
   free-runs/
   ```

   Idempotent and non-destructive: if the file exists, append only the lines
   that are missing, preserving everything already there. If it does not
   exist, create it with the comment above. Never rewrite or reorder a
   `.gitignore` a human wrote. A folder outside a repo gets a harmless file.

2. **No other change.** Paths, layout and behaviour are untouched, which is
   what keeps section 8's migration a no-op for existing data.

`FsaDataStore` is constructed per storage, exactly as today — one handle in,
one store out. The registry decides how many exist.

---

## 7. Extension UI

### 7.1 `DataStoreProvider`

Replaces the single-handle connection state with a workspace:

```ts
type WorkspaceState =
  | { status: "loading" }
  | { status: "empty" }                       // no storages registered
  | { status: "ready"; storages: StorageStatus[]; degraded: Degraded[] };
```

- Builds one `FsaDataStore` per storage whose permission is `granted`.
- A storage at `prompt` is registered but not mounted: it appears in the list
  with a **Reconnect** button and contributes no cases until granted.
- `store` is the `WorkspaceStore` over the mounted children. It exists as soon
  as one storage is mounted — `useReadyStore()` keeps its contract.
- Re-mounting after a permission grant rebuilds the workspace and triggers a
  re-render; screens re-query on the new store identity.

### 7.2 App gate (S8)

`App.tsx` currently renders `ConnectScreen` unless `connection.status ===
"connected"`. New rule:

- `status === "empty"` → `ConnectScreen` (onboarding, unchanged copy).
- `status === "ready"` → the normal stack, **even if every storage is at
  `prompt`**. The Library then shows reconnect banners instead of the panel
  hiding its own contents behind a wall.

### 7.3 `useWorkspace()`

A second hook beside `useReadyStore()`, for the handful of screens that need
to know storages exist:

```ts
interface WorkspaceValue {
  storages: StorageStatus[];
  degraded: Degraded[];
  defaultStorageId: string | null;
  setDefaultStorageId(id: string): void;
  addStorage(): Promise<void>;
  removeStorage(id: string): Promise<void>;
  renameStorage(id: string, label: string): Promise<void>;
  reconnect(id: string): Promise<void>;
  createTestCaseIn(storageId: string, body: string, suiteId?: string): Promise<TestCaseMeta>;
  createSuiteIn(storageId: string, body: string): Promise<SuiteSummary>;
  createFreeRunIn(storageId: string, title: string): Promise<FreeRun>;
}
```

Only `LibraryScreen`, `EditorScreen`, `SuiteEditorScreen`, `FreeRunScreen`
(creation) and `SettingsScreen` use it. **Verify with a grep**: no other
screen imports `useWorkspace`, and no screen at all imports `FsaDataStore`,
`WorkspaceStore` or `storage-registry`.

### 7.4 Library

Grouping gains an outer level. Today: project → suite → case. After:
**storage → project → suite → case**.

```
[All ▾]                                   ← filter, in the header

── my-app (repo) ─────────────────  3 cases
   CHECKOUT
     Sign in with SSO
     …
── careerminds ───────────────────  8 cases
   …
```

- The storage band reuses `ProjectHeader`'s sticky treatment one level up,
  visually heavier than the project band. With exactly one storage
  registered, **the storage band is not rendered at all** — a single-folder
  user must see the Library they see today.
- The filter is a `<select>` in the header: *All storages* plus one entry per
  storage. Persist the choice in `chrome.storage.session` beside the nav
  stack, so it survives the panel closing but resets on restart.
- `matchesQuery` also matches the storage label.
- One banner per degraded or `prompt` storage, above the list, with
  **Reconnect** (a user gesture, so it must be a real button) or the failure
  message.

### 7.5 Creating things

`EditorScreen` (new case), `SuiteEditorScreen` (new suite) and the free-run
start gain a storage picker:

- Preselected from the Library filter when it names one storage, else the
  default storage, else the first.
- Hidden entirely when only one storage is registered.
- Shown as *"Save to: [my-app (repo) ▾]"* directly above the save button —
  where a decision about where something lands belongs.
- The chosen storage becomes the new default (`setDefaultStorageId`).

Editing an existing case has no picker: its storage is fixed by its id.

### 7.6 Settings

A **Storages** section listing each entry with label, folder name, permission
state, and case count. Per row: rename, reconnect (when not granted), remove
(with the "nothing is deleted" confirm). Below the list, **Add a storage…**.

Keep the existing version/build stamp section as is.

---

## 8. Migration

The one thing that must be invisible. An existing install has
`tcm-root-dir-handle` in IndexedDB and no registry.

On provider boot:

1. If `enloop:storages` exists → it is authoritative. Done.
2. Else if `tcm-root-dir-handle` exists → create a registry with one entry:
   `id = "st_" + shortId()`, `kind: "fsa"`, `label = handle.name`,
   `order: 0`, `addedAt: now`. Copy the handle to
   `enloop:storage-handle:<id>`.
3. Else → `status: "empty"`, onboarding as today.

Leave `tcm-root-dir-handle` in place for one release rather than deleting it:
it costs one key and makes a downgrade survivable. Remove it in the release
after.

**The same handle object is reused, so permission carries over — the user must
not be re-prompted.** This is the acceptance test for the phase: upgrade an
install with a connected folder and confirm the Library renders its cases with
no Connect screen, no reconnect prompt, and no storage band.

---

## 9. Reconciliation with PLAN-BACKEND

PLAN-BACKEND D2 reads: *"Keep both storage modes; backend is the default …
The UI needs a mode picker."* That assumed one active store. Amend it:

> **D2 (amended by PLAN-STORAGES).** `DataStore` gains further
> implementations; `FsaDataStore` stays. There is no mode picker and no active
> mode — `WorkspaceStore` holds any number of child stores of mixed kinds, and
> the UI groups by storage. `ApiDataStore` is registered as a storage of kind
> `"api"` alongside local folders, not instead of them.

Consequences for that plan:

- **7.1 Scope** is unchanged and now load-bearing: `ApiDataStore` is
  constructed with `{ baseUrl, token, projectId }`, so one remote project is
  one storage. Several remote projects are several storages, which is exactly
  how the workspace already thinks.
- **7.4 Extension changes** is superseded. `DataStoreProvider` does not gain a
  `mode`; `ConnectScreen` offers *"Add a folder"* and *"Sign in"* as two ways
  to add a storage; `ProjectPickerScreen` becomes the picker shown while
  adding an account storage.
- **7.2 Capabilities** stands, with section 5.3's `capabilitiesFor`.
- **7.3** stands unchanged.

Update PLAN-BACKEND.md's D2 row and section 7.4 in the same commit that lands
this plan, so the two documents never disagree in the repo.

---

## 10. Skills and the data folder

`plugins/enloop/references/data-folder.md` resolves one folder by detection.
A per-repo storage makes this easier, not harder — the folder is *in* the repo
the skill is already running in.

- `/enloop:setup` creates `<repo>/enloop/` with the three subfolders and the
  `.gitignore` from section 6, and records `ENLOOP_DATA_DIR=enloop` in the
  repo's `CLAUDE.md`.
- `data-folder.md` gains a first detection branch: **a repo-relative
  `enloop/` (or the recorded `ENLOOP_DATA_DIR`) with the expected layout wins
  over any absolute fallback.** The existing branches stay for installs that
  keep one central folder.
- State plainly in that reference: **the skill can create the folder, but a
  human must add it as a storage once** — the File System Access API requires
  a user gesture, and nothing the skill writes can grant it. Symptom if
  skipped: cases exist in the repo and the panel does not list them.

---

## 11. Testing

No test runner exists in this repo yet; this work is verified the way the rest
of it is — `npm run typecheck`, `npm run build`, and driving the panel. Where
a phase below says *Verify*, it means exactly those steps, performed before
moving on.

Pure logic worth covering if a runner is added: `joinId`/`splitId` round-trip
and rejection of malformed ids; the fan-out merge order; and the `.gitignore`
append being idempotent against a file that already has one of the two lines.

---

## 12. Phases

Each phase compiles, runs, and is independently verifiable. Do them in order.

### Phase 1 — id helpers and brands

`shared/src/storage-id.ts` (sections 3.1 and 3.3) plus its export from
`shared/src/index.ts`. Then the type surgery from 3.3: annotate the plain
interfaces, replace the two type-only schemas (`testCaseMetaSchema`,
`runSchema`) with hand-written interfaces, and split `FreeRunSummary` out of
`FreeRunFile`.

This phase has no runtime effect and no caller, but it is **not** free: every
id-carrying signature in `storage.ts` becomes branded, so `FsaDataStore` and
every screen now typecheck against branded ids while still passing local
ones. Expect a wave of errors and resolve them by annotation, never by
casting — a cast here is the bug this phase exists to prevent. The wave ends
when `WorkspaceStore` arrives in Phase 3 and becomes the only thing that
brands anything.

*Verify:* `npm run typecheck` clean across all three workspaces, and
`git grep -n "as CaseId\|as SuiteId\|as RunId\|as FreeRunId\|as Namespaced"`
returns hits only in `shared/src/storage-id.ts`.

### Phase 2 — registry and migration, still single-storage

`storage-registry.ts` (section 4) and the migration (section 8).
`DataStoreProvider` reads the registry, mounts the one storage it finds, and
builds a plain `FsaDataStore` exactly as today. No UI change.

*Verify:* an install with a connected folder shows its cases with no prompt.
A fresh install still onboards through `ConnectScreen`.

### Phase 3 — `WorkspaceStore` with one child

Introduce the workspace (section 5) between the provider and the child store,
with namespacing live. Everything downstream now sees namespaced ids.

*Verify:* every screen still works — open a case, run it quick and full, add
notes, finish, read the report, edit, archive, export all four formats, copy
a viewer link, create a suite, run a case inside it, start and finish a free
run. Then `grep -rn "FsaDataStore" extension/src | grep -v provider` returns
nothing.

Before S9 this was the phase that broke things quietly, because a missed field
in 3.2 only showed up on click. Branding moves almost all of that to `tsc` —
so treat a type error here as the plan working, and fix it by routing the
value through `joinId`/`splitId` rather than by widening a type or adding a
cast.

Two things the compiler still cannot see, so check them by hand:

- **`forChild` applied twice**, or not at all, on a path that delegates
  through two methods — both ends are branded, so it typechecks either way.
- **The fan-out sort** (5.1): merging pre-sorted lists without re-sorting
  yields a Library ordered by storage rather than by recency, which looks
  deliberate and is not.

### Phase 4 — many storages

Registry UI in Settings (7.6), per-storage permission and banners (7.1, 7.2),
`useWorkspace()` (7.3).

*Verify:* add a second folder; both appear in Settings; cases from both list
together; remove one and its cases vanish while the other's remain; restart
Chrome and confirm each storage prompts independently and the Library still
renders.

### Phase 5 — Library grouping, filter, creation targets

Sections 7.4 and 7.5.

*Verify:* with two storages, the band and filter appear and narrow correctly;
with one, neither is rendered. A new case lands in the chosen storage and
opens from it.

### Phase 6 — repo ergonomics

`.gitignore` writing (section 6), skills and `data-folder.md` (section 10).

*Verify:* add a storage inside a git repo, author a case, run it, then
`git status` — the case is tracked, `runs/` is not.

### Phase 7 — documentation

README: a storages section (add, switch, remove, what lands in a repo).
PLAN-BACKEND.md: the D2 amendment and 7.4 supersession from section 9.

*Verify:* README describes what the built panel actually does, with no
reference to a single connected folder left anywhere.
