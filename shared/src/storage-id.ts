/**
 * Addressing a case, suite, run or free run when there is more than one
 * storage connected.
 *
 * A local id — `sign-in-with-sso-4c2e1a08` — is only unique inside the folder
 * it lives in. Two projects can each hold a case with the same slug, and once
 * the Library shows both at once, "open this case" needs to say *which* one.
 * So ids gain a storage prefix as they cross out of `WorkspaceStore`, and lose
 * it again as they cross back in.
 *
 *     st_9f3a2b71:sign-in-with-sso-4c2e1a08
 *     └ storage    └ what the child store actually calls it
 *
 * **Nothing on disk is ever namespaced.** The prefix exists in memory, above
 * the child stores, and no file gains one — which is what lets a folder be
 * committed to a repo, cloned by a colleague, registered under a different
 * storage id on their machine, and still work.
 */

/** Separator. Safe because every id the stores generate is `slugify`d
 * (`[a-z0-9-]` plus a hex suffix) and cannot contain a colon. */
const SEP = ":";

export class MalformedIdError extends Error {}

/** A namespaced id from its two halves. */
export function joinId(storageId: string, localId: string): string {
  return `${storageId}${SEP}${localId}`;
}

/**
 * The two halves of a namespaced id.
 *
 * Throws rather than returning null: every call site is a lookup that cannot
 * proceed without an answer, and a silent null becomes a "not found" that
 * hides what actually went wrong.
 */
export function splitId(id: string): { storageId: string; localId: string } {
  const at = id.indexOf(SEP);
  if (at <= 0 || at === id.length - 1) {
    throw new MalformedIdError(
      `"${id}" is not a storage-qualified id. Expected "<storageId>:<localId>".`,
    );
  }
  const localId = id.slice(at + 1);
  if (localId.includes(SEP)) {
    throw new MalformedIdError(`"${id}" has more than one ":" — ids may not contain one.`);
  }
  return { storageId: id.slice(0, at), localId };
}

/** True for an id that already carries a namespace. For guards and for
 * migration paths that may still hold bare ids. */
export function isNamespaced(id: string): boolean {
  try {
    splitId(id);
    return true;
  } catch {
    return false;
  }
}
