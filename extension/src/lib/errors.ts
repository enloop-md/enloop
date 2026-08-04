import { NotFoundError } from "./fs-utils.js";

/**
 * Turning what the File System Access API throws into something a tester can
 * act on.
 *
 * Every screen used to render `String(e)` straight into the panel, which
 * means a folder whose permission lapsed announced itself as
 * `NotAllowedError: Failed to execute 'getFileHandle' on
 * 'FileSystemDirectoryHandle'`. The failures here are not exotic — the
 * folder moved, Chrome forgot the grant, a file was hand-edited into
 * something the schema rejects — and each has an obvious next step. Saying
 * the next step is the entire job of this module.
 */

/** Errors that mean the connected folder itself is the problem, so the panel
 * can offer to reconnect it rather than only describing the failure. */
export function isFolderAccessError(e: unknown): boolean {
  if (e instanceof NotFoundError) return true;
  if (e instanceof DOMException) {
    return ["NotAllowedError", "NotFoundError", "SecurityError", "InvalidStateError"].includes(
      e.name,
    );
  }
  return false;
}

function isZodError(e: unknown): e is { name: string; issues: Array<{ path: Array<string | number>; message: string }> } {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { name?: string }).name === "ZodError" &&
    Array.isArray((e as { issues?: unknown }).issues)
  );
}

export function describeError(e: unknown): string {
  if (typeof e === "string") return e;

  if (e instanceof NotFoundError) {
    // Thrown by fs-utils with the missing name already in the message, which
    // is worth keeping — it says which file, and half the time that alone
    // explains what happened.
    return `${e.message}. The connected folder may have been moved, renamed, or edited outside Enloop.`;
  }

  if (e instanceof DOMException) {
    switch (e.name) {
      case "NotAllowedError":
        return "Chrome's permission for the connected folder has lapsed. Reconnect the folder and try again.";
      case "NotFoundError":
        return "A file or folder Enloop expected is missing — the connected folder may have been moved, renamed, or deleted.";
      case "SecurityError":
        return "Chrome refused access to the connected folder. Reconnect it and try again.";
      case "InvalidStateError":
        return "The connected folder changed underneath Enloop. Reconnect it and try again.";
      case "NoModificationAllowedError":
        return "Another program is holding that file open. Close it and try again.";
      case "QuotaExceededError":
        return "There is no room left to write to — the disk is full.";
      case "AbortError":
        return "Cancelled.";
    }
  }

  if (isZodError(e)) {
    const first = e.issues[0];
    const where = first?.path?.length ? ` (${first.path.join(".")}: ${first.message})` : "";
    return `A file in the connected folder is not in the format Enloop expects${where}. It may have been hand-edited, or written by a newer version.`;
  }

  if (e instanceof SyntaxError) {
    return `A file in the connected folder contains invalid JSON: ${e.message}`;
  }

  if (e instanceof Error) return e.message;
  return String(e);
}
