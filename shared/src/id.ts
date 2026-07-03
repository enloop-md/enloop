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

export function newTaskId(): string {
  return `task-${shortId()}`;
}
