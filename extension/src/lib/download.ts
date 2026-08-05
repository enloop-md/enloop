/**
 * Saving text out of the panel as a file.
 *
 * A blob URL and a synthetic anchor click, rather than the `chrome.downloads`
 * API: the API would add a permission to the install prompt for something an
 * ordinary web page can already do, and the whole point of the current
 * permission set is that installing asks for as little as possible.
 */
export function downloadTextFile(filename: string, text: string, type = "text/markdown"): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately races the download in Chrome; a delay costs one
  // blob's worth of memory in a panel that is about to be closed anyway.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** A case title as a filename: lowercase, punctuation collapsed to dashes,
 * and short enough that the version suffix stays visible in a downloads
 * list. Falls back to `case` so an untitled document still saves. */
export function fileSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "case";
}
