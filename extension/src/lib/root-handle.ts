import { get, set, del } from "idb-keyval";

const ROOT_HANDLE_KEY = "tcm-root-dir-handle";

export type PermissionState = "granted" | "prompt" | "denied";

async function queryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return handle.queryPermission({ mode: "readwrite" });
}

/** Must be called from a user gesture (e.g. a button click handler). */
export async function connectFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await set(ROOT_HANDLE_KEY, handle);
  return handle;
}

export async function getPersistedHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await get<FileSystemDirectoryHandle>(ROOT_HANDLE_KEY);
  return handle ?? null;
}

export async function forgetFolder(): Promise<void> {
  await del(ROOT_HANDLE_KEY);
}

export async function checkPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  return queryPermission(handle);
}

/** Must be called from a user gesture — re-prompts if permission lapsed. */
export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const state = await handle.requestPermission({ mode: "readwrite" });
  return state === "granted";
}
