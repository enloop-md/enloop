/**
 * Object URLs for screenshot thumbnails, shared across the panel.
 *
 * Bytes come through the store (G19), so every thumbnail is a read plus a
 * `createObjectURL`. Both are cached at module level, keyed by
 * `${id}:${updatedAt}` — an edit bumps `updatedAt`, which is what makes a
 * re-rendered PNG show up without anyone invalidating anything. The cache
 * counts users: a step body and the run-level strip can show the same
 * screenshot after a Move, and the URL is revoked only when the last one
 * lets go.
 */

import { useEffect, useState } from "react";
import type { RunScreenshot } from "@tcm/shared";

interface Entry {
  url: string;
  refs: number;
}

const entries = new Map<string, Entry>();
const loading = new Map<string, Promise<string>>();

export function thumbnailKey(shot: RunScreenshot): string {
  return `${shot.id}:${shot.updatedAt}`;
}

async function acquire(key: string, load: () => Promise<Uint8Array>): Promise<string> {
  const hit = entries.get(key);
  if (hit) {
    hit.refs += 1;
    return hit.url;
  }
  let pending = loading.get(key);
  if (!pending) {
    pending = load().then((bytes) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: "image/png" }));
      entries.set(key, { url, refs: 0 });
      loading.delete(key);
      return url;
    });
    // A failed read must not be remembered as the answer: the next mount
    // reads again, which is what a transient handle hiccup needs.
    pending.catch(() => loading.delete(key));
    loading.set(key, pending);
  }
  const url = await pending;
  const entry = entries.get(key);
  if (entry) entry.refs += 1;
  return url;
}

function release(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  // Not revoked on the spot: an effect re-running over the same list lets
  // go of every key and takes them all back in the same tick, and a URL
  // revoked in between would mean re-reading every PNG for a caption
  // keystroke. Revoke once nothing has picked it up again.
  setTimeout(() => {
    const later = entries.get(key);
    if (!later || later.refs > 0) return;
    URL.revokeObjectURL(later.url);
    entries.delete(key);
  }, 0);
}

/**
 * URLs for the rendered PNG of each screenshot, by screenshot id. Missing
 * entries are still loading (or failed — a broken image is the honest
 * rendering of a file that is not there). Holds a reference per key while
 * mounted and lets go of every one on unmount or when the list changes.
 */
export function useThumbnailUrls(
  shots: RunScreenshot[],
  read: (id: string) => Promise<Uint8Array>,
): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const keys = shots.map(thumbnailKey).join("|");

  useEffect(() => {
    let cancelled = false;
    const held: string[] = [];
    for (const shot of shots) {
      const key = thumbnailKey(shot);
      acquire(key, () => read(shot.id))
        .then((url) => {
          if (cancelled) {
            release(key);
            return;
          }
          held.push(key);
          setUrls((prev) => (prev[shot.id] === url ? prev : { ...prev, [shot.id]: url }));
        })
        .catch(() => {
          // Nothing to show; the caller renders the record without a picture.
        });
    }
    return () => {
      cancelled = true;
      for (const key of held) release(key);
    };
    // `keys` stands in for the list: same ids and timestamps, same URLs.
  }, [keys, read]);

  return urls;
}
