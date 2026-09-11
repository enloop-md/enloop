/**
 * The list of connected storages, and the handles behind them.
 *
 * One folder used to be the whole story: a single handle under a single key.
 * This owns the list instead — what is connected, what it is called, and
 * whether Chrome will still let us read it — and nothing else. Building a
 * store out of a handle is `DataStoreProvider`'s job; fanning out across
 * several is `WorkspaceStore`'s.
 *
 * IndexedDB rather than `chrome.storage`, for one hard reason: a
 * `FileSystemDirectoryHandle` survives structured clone but not the JSON
 * serialization `chrome.storage` performs. `idb-keyval` is already here and
 * already held the single handle.
 */

import { get, set, del, keys } from "idb-keyval";
import {
  PROJECT_FILE,
  isLayoutFolderName,
  latestVersionId,
  projectFileSchema,
  shortId,
  versionFileName,
  versionIdFromFileName,
} from "@tcm/shared";
import { listFileNames, readTextFile, tryGetDir, tryReadJson, writeTextFile } from "./fs-utils.js";

/** `fsa`: a folder the user picked. `opfs`: the browser's own storage — the
 * origin-private file system — which needs no picker and no permission,
 * and is where a case dropped on the panel lands when no folder is
 * connected. The same `FsaDataStore` runs on both: OPFS hands out an
 * ordinary `FileSystemDirectoryHandle`. */
export type StorageKind = "fsa" | "opfs";

export interface StorageEntry {
  /** `st_` + 8 hex. Never derived from the folder name: two folders can share
   * a name, and renaming one must not re-identify its cases. */
  id: string;
  kind: StorageKind;
  /** What the panel shows. Comes from the folder's own `project.json` when
   * it has one, and is kept in step with that file on every refresh —
   * Chrome reports a folder's name and never its path, so four repos each
   * holding an `enloop.md/` are otherwise four identical rows. Falls back
   * to the folder name. */
  label: string;
  /** Set when the user renamed the storage *and* the new name could not be
   * written back to `project.json` (a read-only folder, a lapsed grant).
   * It stops the next refresh from reverting their rename to the stale
   * name still on disk. When the write succeeds there is nothing to
   * remember: the file is the name. */
  renamed?: boolean;
  addedAt: string;
  order: number;
}

export type StoragePermission = "granted" | "prompt" | "denied" | "missing";

export interface StorageStatus extends StorageEntry {
  permission: StoragePermission;
  /** Folder name as Chrome reports it — shown under the label so a renamed
   * storage can still be matched to a directory. */
  folderName: string;
}

const LIST_KEY = "enloop:storages";
const handleKey = (id: string) => `enloop:storage-handle:${id}`;

/** The single-folder key this replaces. Left in place for one release: it
 * costs one entry and makes a downgrade survivable. */
const LEGACY_HANDLE_KEY = "tcm-root-dir-handle";

function newStorageId(): string {
  return `st_${shortId()}`;
}

async function readList(): Promise<StorageEntry[]> {
  return (await get<StorageEntry[]>(LIST_KEY)) ?? [];
}

async function writeList(entries: StorageEntry[]): Promise<void> {
  await set(LIST_KEY, entries);
}

/**
 * Brings a pre-multi-storage install forward: the one connected folder
 * becomes storage #1.
 *
 * The *same handle object* is carried over, so the permission Chrome already
 * granted comes with it and nobody is re-prompted. Runs once — the presence
 * of the list is what marks it done.
 */
export async function migrateLegacyStorage(): Promise<void> {
  if ((await get<StorageEntry[]>(LIST_KEY)) !== undefined) return;
  const legacy = await get<FileSystemDirectoryHandle>(LEGACY_HANDLE_KEY);
  if (!legacy) return;

  const entry: StorageEntry = {
    id: newStorageId(),
    kind: "fsa",
    label: legacy.name,
    addedAt: new Date().toISOString(),
    order: 0,
  };
  await set(handleKey(entry.id), legacy);
  await writeList([entry]);
}

export async function listStorages(): Promise<StorageEntry[]> {
  const entries = await readList();
  return [...entries].sort((a, b) => a.order - b.order || a.addedAt.localeCompare(b.addedAt));
}

const INBOX_DIR = "inbox";
export const INBOX_LABEL = "Inbox (this browser)";

/** The directory dropped cases live in, inside the origin-private file
 * system. Created on first use; never picked, never asked for. */
async function opfsInbox(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(INBOX_DIR, { create: true });
}

async function entryOf(id: string): Promise<StorageEntry | undefined> {
  return (await readList()).find((e) => e.id === id);
}

export async function getHandle(id: string): Promise<FileSystemDirectoryHandle | null> {
  if ((await entryOf(id))?.kind === "opfs") {
    try {
      return await opfsInbox();
    } catch {
      return null;
    }
  }
  return (await get<FileSystemDirectoryHandle>(handleKey(id))) ?? null;
}

/** The built-in storage, created the first time something needs it. */
export async function ensureInboxStorage(): Promise<StorageEntry> {
  const entries = await readList();
  const existing = entries.find((e) => e.kind === "opfs");
  if (existing) return existing;
  const entry: StorageEntry = {
    id: newStorageId(),
    kind: "opfs",
    label: INBOX_LABEL,
    addedAt: new Date().toISOString(),
    order: entries.length,
  };
  await writeList([...entries, entry]);
  return entry;
}

export async function permissionOf(id: string): Promise<StoragePermission> {
  // The browser's own storage is never asked for permission.
  if ((await entryOf(id))?.kind === "opfs") return (await getHandle(id)) ? "granted" : "missing";
  const handle = await getHandle(id);
  if (!handle) return "missing";
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return "missing";
  }
}

/** Must be called from a user gesture — Chrome refuses otherwise. */
export async function requestAccess(id: string): Promise<boolean> {
  if ((await entryOf(id))?.kind === "opfs") return (await getHandle(id)) !== null;
  const handle = await getHandle(id);
  if (!handle) return false;
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}

export class DuplicateStorageError extends Error {}

/**
 * Adds a folder. Must be called from a user gesture.
 *
 * Rejects a folder that is already connected, compared with `isSameEntry`
 * rather than by name — the same directory added twice would list every case
 * in it twice, under two ids, with two independent run histories.
 */
export async function addFsaStorage(): Promise<StorageEntry> {
  const picked = await window.showDirectoryPicker({ mode: "readwrite" });
  const handle = await caseFolderWithin(picked);
  const entries = await readList();

  for (const entry of entries) {
    const existing = await getHandle(entry.id);
    if (existing && (await existing.isSameEntry(handle))) {
      throw new DuplicateStorageError(
        `“${handle.name}” is already connected as “${entry.label}”.`,
      );
    }
  }

  // The folder the user actually picked is the last moment its name is
  // knowable: `handle` may be an `enloop.md/` two levels inside it, and the
  // file-system API never hands back a parent. So the repo directory is
  // offered to the naming as a fallback here and nowhere else.
  const descendedFrom = (await picked.isSameEntry(handle)) ? null : picked.name;

  const entry: StorageEntry = {
    id: newStorageId(),
    kind: "fsa",
    label: (await resolveProjectName(handle, descendedFrom)) ?? handle.name,
    addedAt: new Date().toISOString(),
    order: entries.length,
  };
  await set(handleKey(entry.id), handle);
  await writeList([...entries, entry]);
  await ensureGitignore(handle);
  return entry;
}

// ---- what a folder is called ----

/**
 * The name recorded in the folder's own `project.json`, or `null`.
 *
 * Never throws: an unreadable or malformed file means "no name recorded",
 * which is a fallback, not a failure. A folder is still perfectly usable
 * under its directory name.
 */
async function readProjectName(root: FileSystemDirectoryHandle): Promise<string | null> {
  try {
    const file = await tryReadJson(root, PROJECT_FILE, projectFileSchema);
    return file?.name.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Records the folder's name in `project.json`, keeping anything else the
 * file holds. Returns whether it was written — a read-only checkout or a
 * grant that lapsed mid-session is not a reason to refuse the rename, only
 * a reason to remember it locally instead.
 */
async function writeProjectName(root: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    // Re-read as raw JSON rather than through the schema: a hand-written
    // file may carry keys this version has never heard of, and a rename
    // must not be the thing that deletes them.
    let existing: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse((await readTextFile(root, PROJECT_FILE)).text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // No file yet, or one that is not JSON at all. Either way it is about
      // to become a valid one.
    }
    await writeTextFile(
      root,
      PROJECT_FILE,
      `${JSON.stringify({ ...existing, name }, null, 2)}\n`,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * What this folder should be called, recording the answer so it is asked
 * once.
 *
 * `project.json` settles it when it exists — that is the whole point of the
 * file, and it costs one small read. Otherwise the name is inferred, in the
 * order of how much the source actually knows about the project:
 *
 * 1. **The cases** — every case carries `@project`, and when a folder's
 *    cases agree on one, that is the project's name as its author typed it.
 * 2. **The picked directory**, when the pick was the repo and we descended
 *    into an `enloop.md/` inside it: the repo directory is what the user
 *    calls this project on their disk.
 * 3. **The folder name**, unless it is a layout name (`enloop.md`,
 *    `test-cases`, …) — those are exactly the names that collide.
 *
 * An inferred name is written back, so the folder names itself for the next
 * refresh, for the next machine, and for whoever clones the repo. A folder
 * whose cases name two projects infers nothing: the Library groups those by
 * `@project` already, and inventing one name for them would be a lie.
 */
async function resolveProjectName(
  root: FileSystemDirectoryHandle,
  descendedFrom: string | null = null,
): Promise<string | null> {
  const recorded = await readProjectName(root);
  if (recorded) return recorded;

  const inferred =
    (await projectNameFromCases(root)) ??
    descendedFrom ??
    (isLayoutFolderName(root.name) ? null : root.name);
  if (!inferred) return null;

  await writeProjectName(root, inferred);
  return inferred;
}

/** How many case directories are opened looking for an `@project` before
 * giving up. A folder that disagrees in its first dozen cases is a
 * multi-project folder whichever way the rest votes. */
const PROJECT_SCAN_LIMIT = 12;

/**
 * The one `@project` this folder's cases agree on, or `null`.
 *
 * Reads the newest version of each case and greps its front matter rather
 * than parsing it: this runs before anything is displayed, the answer is a
 * label, and a case whose Markdown the full parser would reject still has a
 * perfectly good `@project` line.
 */
async function projectNameFromCases(root: FileSystemDirectoryHandle): Promise<string | null> {
  try {
    const casesDir = await tryGetDir(root, "test-cases");
    if (!casesDir) return null;

    const found = new Set<string>();
    let scanned = 0;
    for await (const entry of casesDir.values()) {
      if (entry.kind !== "directory") continue;
      if (scanned >= PROJECT_SCAN_LIMIT || found.size > 1) break;
      scanned++;
      const versions = await tryGetDir(entry as FileSystemDirectoryHandle, "versions");
      if (!versions) continue;
      const ids = (await listFileNames(versions))
        .map(versionIdFromFileName)
        .filter((id): id is string => id !== null);
      const newest = latestVersionId(ids);
      if (!newest) continue;
      const { text } = await readTextFile(versions, versionFileName(newest));
      const match = /^@project[ \t]+(.+)$/im.exec(text.slice(0, 2000));
      const name = match?.[1].trim();
      if (name) found.add(name);
    }
    return found.size === 1 ? [...found][0] : null;
  } catch {
    return null;
  }
}

/**
 * The Enloop folder inside a picked directory, when the pick was the repo
 * rather than the folder. A QA engineer told "install the extension and
 * point it at the repo" should not also have to know that the cases sit
 * in `enloop.md/` two levels down: if the picked directory has no
 * `test-cases/` of its own, the first subdirectory (two levels deep,
 * skipping the usual noise) that has one is the folder they meant. A
 * directory with nothing recognisable is returned as picked — an empty
 * folder is a fine place to start.
 */
async function caseFolderWithin(root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  const SKIP = new Set(["node_modules", ".git", "vendor", "dist", "build", "target", ".next"]);
  const hasCases = async (dir: FileSystemDirectoryHandle) => {
    try {
      await dir.getDirectoryHandle("test-cases");
      return true;
    } catch {
      return false;
    }
  };
  if (await hasCases(root)) return root;
  const subdirs = async (dir: FileSystemDirectoryHandle) => {
    const out: FileSystemDirectoryHandle[] = [];
    for await (const entry of dir.values()) {
      if (entry.kind === "directory" && !SKIP.has(entry.name) && !entry.name.startsWith(".")) {
        out.push(entry as FileSystemDirectoryHandle);
      }
    }
    return out;
  };
  const children = await subdirs(root);
  for (const child of children) if (await hasCases(child)) return child;
  for (const child of children) {
    for (const grandchild of await subdirs(child)) if (await hasCases(grandchild)) return grandchild;
  }
  return root;
}

/**
 * Renames a storage, in the folder as well as in the panel.
 *
 * The name belongs to the folder, so a rename is written to its
 * `project.json` — otherwise the next refresh reads the old name back and
 * quietly undoes the user's edit, and the new name never reaches the
 * teammate who clones the repo. `renamed` is only set when that write
 * failed, and is exactly what stops the revert in that case.
 */
export async function renameStorage(id: string, label: string): Promise<void> {
  const entries = await readList();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  const name = label.trim() || entry.label;

  let written = false;
  if (entry.kind === "fsa") {
    const handle = await getHandle(id);
    if (handle) written = await writeProjectName(handle, name);
  }

  await writeList(
    entries.map((e) => (e.id === id ? { ...e, label: name, renamed: !written } : e)),
  );
}

/**
 * Brings every connected folder's label in line with its `project.json`,
 * and names the ones that have none.
 *
 * Called on each workspace refresh. For a folder that already records its
 * name this is one small file read; only a folder with no name recorded
 * pays for the inference, and it pays once, because the answer is written
 * back. Folders that are not readable right now are skipped in silence —
 * a lapsed grant is the reconnect banner's business, not this function's.
 */
export async function syncProjectNames(): Promise<void> {
  const entries = await readList();
  const next = [...entries];
  let changed = false;

  for (let i = 0; i < next.length; i++) {
    const entry = next[i];
    if (entry.kind !== "fsa" || entry.renamed) continue;
    const handle = await getHandle(entry.id);
    if (!handle) continue;
    try {
      if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted") continue;
    } catch {
      continue;
    }
    const name = await resolveProjectName(handle);
    if (name && name !== entry.label) {
      next[i] = { ...entry, label: name };
      changed = true;
    }
  }

  if (changed) await writeList(next);
}

/** Forgets a storage. **Never deletes a file** — the folder and everything in
 * it is left exactly as it was. */
export async function removeStorage(id: string): Promise<void> {
  await writeList((await readList()).filter((e) => e.id !== id));
  await del(handleKey(id));
}

export async function reorderStorage(id: string, order: number): Promise<void> {
  const entries = await readList();
  await writeList(entries.map((e) => (e.id === id ? { ...e, order } : e)));
}

/** Handles left behind by a registry entry that vanished — belt and braces
 * against a half-finished remove. */
export async function pruneOrphanHandles(): Promise<void> {
  const live = new Set((await readList()).map((e) => handleKey(e.id)));
  for (const key of await keys()) {
    if (typeof key === "string" && key.startsWith("enloop:storage-handle:") && !live.has(key)) {
      await del(key);
    }
  }
}

/**
 * Cases are meant to be committed; run history is not.
 *
 * A storage inside an app repo is the point of all this, and without a
 * `.gitignore` the first run drops a folder of JSON into the user's next
 * commit. Written on registration, idempotently: an existing file gains only
 * the lines it is missing, and nothing already in it is reordered or removed.
 * In a folder that is not a repo it is inert.
 */
async function ensureGitignore(root: FileSystemDirectoryHandle): Promise<void> {
  const NEEDED = ["runs/", "free-runs/", "agent/", "test-cases/**/context.json"];
  const HEADER = "# Enloop — cases are meant to be committed; run history is local.";
  try {
    let existing = "";
    try {
      const file = await root.getFileHandle(".gitignore");
      existing = await (await file.getFile()).text();
    } catch {
      // No .gitignore yet — created below.
    }
    const lines = existing.split("\n").map((l) => l.trim());
    const missing = NEEDED.filter((n) => !lines.includes(n));
    if (missing.length === 0) return;

    const addition = (existing.trim() ? `${existing.replace(/\s*$/, "")}\n\n` : "") +
      `${HEADER}\n${missing.join("\n")}\n`;
    const handle = await root.getFileHandle(".gitignore", { create: true });
    const writable = await handle.createWritable();
    await writable.write(addition);
    await writable.close();
  } catch {
    // A read-only folder, or a picker that granted less than we asked for.
    // Not being able to write .gitignore is not a reason to refuse the
    // storage — the user can add the two lines themselves.
  }
}
