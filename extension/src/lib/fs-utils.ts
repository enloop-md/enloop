import type { ZodType } from "zod";

export class NotFoundError extends Error {}

export async function getDir(
  parent: FileSystemDirectoryHandle,
  name: string,
  opts: { create?: boolean } = {},
): Promise<FileSystemDirectoryHandle> {
  try {
    return await parent.getDirectoryHandle(name, { create: opts.create ?? false });
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") {
      throw new NotFoundError(`Directory not found: ${name}`);
    }
    throw e;
  }
}

export async function tryGetDir(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name, { create: false });
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return null;
    throw e;
  }
}

export async function listDirNames(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") names.push(name);
  }
  return names;
}

export async function listFileNames(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") names.push(name);
  }
  return names;
}

export async function readJson<T>(
  dir: FileSystemDirectoryHandle,
  filename: string,
  schema: ZodType<T>,
): Promise<T> {
  const { text } = await readTextFile(dir, filename);
  return schema.parse(JSON.parse(text));
}

export async function tryReadJson<T>(
  dir: FileSystemDirectoryHandle,
  filename: string,
  schema: ZodType<T>,
): Promise<T | null> {
  try {
    return await readJson(dir, filename, schema);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

export async function writeJson(
  dir: FileSystemDirectoryHandle,
  filename: string,
  data: unknown,
): Promise<void> {
  await writeTextFile(dir, filename, JSON.stringify(data, null, 2));
}

export interface TextFile {
  text: string;
  /** ISO timestamp of the file's mtime — used as a version's createdAt. */
  lastModified: string;
}

export async function readTextFile(
  dir: FileSystemDirectoryHandle,
  filename: string,
): Promise<TextFile> {
  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await dir.getFileHandle(filename, { create: false });
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") {
      throw new NotFoundError(`File not found: ${filename}`);
    }
    throw e;
  }
  const file = await fileHandle.getFile();
  const text = await file.text();
  return { text, lastModified: new Date(file.lastModified).toISOString() };
}

export async function tryReadTextFile(
  dir: FileSystemDirectoryHandle,
  filename: string,
): Promise<TextFile | null> {
  try {
    return await readTextFile(dir, filename);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

export async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  filename: string,
  text: string,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

export function nowIso(): string {
  return new Date().toISOString();
}
