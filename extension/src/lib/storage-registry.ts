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
import { shortId } from "@tcm/shared";

export type StorageKind = "fsa";

export interface StorageEntry {
  /** `st_` + 8 hex. Never derived from the folder name: two folders can share
   * a name, and renaming one must not re-identify its cases. */
  id: string;
  kind: StorageKind;
  /** Editable, defaults to the folder name. Chrome reports a folder's name
   * and never its path, so two directories both called `test-cases` are
   * indistinguishable without this. */
  label: string;
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

export async function getHandle(id: string): Promise<FileSystemDirectoryHandle | null> {
  return (await get<FileSystemDirectoryHandle>(handleKey(id))) ?? null;
}

export async function permissionOf(id: string): Promise<StoragePermission> {
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
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  const entries = await readList();

  for (const entry of entries) {
    const existing = await getHandle(entry.id);
    if (existing && (await existing.isSameEntry(handle))) {
      throw new DuplicateStorageError(
        `“${handle.name}” is already connected as “${entry.label}”.`,
      );
    }
  }

  const entry: StorageEntry = {
    id: newStorageId(),
    kind: "fsa",
    label: handle.name,
    addedAt: new Date().toISOString(),
    order: entries.length,
  };
  await set(handleKey(entry.id), handle);
  await writeList([...entries, entry]);
  await ensureGitignore(handle);
  return entry;
}

export async function renameStorage(id: string, label: string): Promise<void> {
  const entries = await readList();
  await writeList(entries.map((e) => (e.id === id ? { ...e, label: label.trim() || e.label } : e)));
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
  const NEEDED = ["runs/", "free-runs/", "agent/"];
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
