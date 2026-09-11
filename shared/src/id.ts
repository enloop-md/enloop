export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function newTestCaseId(title: string): string {
  const slug = slugify(title) || "test-case";
  return `${slug}-${shortId()}`;
}

export function newRunId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `run-${stamp}-${shortId()}`;
}

export function newFreeRunId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `free-${stamp}-${shortId()}`;
}

export function newCommentId(): string {
  return `comment-${shortId()}`;
}

export function newQuestionId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `q-${stamp}-${shortId()}`;
}

export function newCommandId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `cmd-${stamp}-${shortId()}`;
}

/** A title as a filename: lowercase, punctuation collapsed to dashes, and
 * short enough that a suffix stays visible in a downloads list. Falls back
 * to `case` so an untitled document still saves. Shared by the panel's
 * downloads and the validator's `export-guide`, so both name a guide's
 * folder and file the same way. */
export function fileSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "case";
}
