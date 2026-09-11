/**
 * Getting a screenshot into the editor tab and the result back.
 *
 * The side panel is ~400 px wide; a viewport capture needs the whole
 * window. So the editor is an extension page in its own tab, and the two
 * talk through `chrome.storage.session` — a browser-session fact, like the
 * question tabs — rather than through messages: a key that is set can be
 * read whenever the other side gets to it, so neither has to be listening
 * at the moment the other writes.
 *
 * The panel writes a job under `enloop:editor:<token>`, opens
 * `editor.html#<token>`, and waits for `enloop:editor-result:<token>` — or
 * for the tab to go away, which counts as Cancel. The editor writes the
 * result and closes itself, activating the tab it was opened beside so
 * the tester lands back on the page they were testing.
 */

import type { ScreenshotOp } from "@tcm/shared";
import type { TabRef } from "./question-tab.js";

export interface EditorJob {
  token: string;
  /** Names the tab: "<case> — step 3: <title>", or the free run's title. */
  title: string;
  /** The SOURCE png — the editor always starts from the untouched capture
   * and re-applies `ops`. */
  sourceDataUrl: string;
  ops: ScreenshotOp[];
  width: number;
  height: number;
  returnTo: TabRef | null;
}

export interface EditorResult {
  token: string;
  cancelled: boolean;
  ops?: ScreenshotOp[];
  renderedDataUrl?: string;
}

const JOB_PREFIX = "enloop:editor:";
const RESULT_PREFIX = "enloop:editor-result:";

export function newEditorToken(): string {
  return crypto.randomUUID().slice(0, 12);
}

export class EditorTooLargeError extends Error {}

/**
 * Opens the editor on `job` and resolves with what the tester did. Never
 * rejects for a closed tab — that is `{ cancelled: true }`.
 */
export async function openEditor(job: EditorJob): Promise<EditorResult> {
  try {
    await chrome.storage.session.set({ [JOB_PREFIX + job.token]: job });
  } catch (e) {
    // The session area has a quota (10 MB by default); a 4K capture as a
    // data URL can pass it. The attachment is kept, only editing is lost.
    throw new EditorTooLargeError(String(e));
  }
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html#${job.token}`) });
  const resultKey = RESULT_PREFIX + job.token;

  return new Promise<EditorResult>((resolve) => {
    let done = false;
    const finish = (result: EditorResult) => {
      if (done) return;
      done = true;
      chrome.storage.session.onChanged.removeListener(onChanged);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      void chrome.storage.session.remove([JOB_PREFIX + job.token, resultKey]);
      resolve(result);
    };
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      const change = changes[resultKey];
      if (change?.newValue) finish(change.newValue as EditorResult);
    };
    const onRemoved = (tabId: number) => {
      if (tabId === tab.id) {
        // The result may have landed a tick before the tab closed itself.
        void chrome.storage.session.get(resultKey).then((raw) => {
          const result = raw[resultKey] as EditorResult | undefined;
          finish(result ?? { token: job.token, cancelled: true });
        });
      }
    };
    chrome.storage.session.onChanged.addListener(onChanged);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

// ---- the editor's side ----------------------------------------------------

export async function readEditorJob(token: string): Promise<EditorJob | null> {
  try {
    const raw = await chrome.storage.session.get(JOB_PREFIX + token);
    return (raw[JOB_PREFIX + token] as EditorJob | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Writes the result, brings the origin tab forward, and closes this tab. */
export async function finishEditor(job: EditorJob, result: Omit<EditorResult, "token">): Promise<void> {
  // The job carried the source image; the result carries the rendered one.
  // Both at once can pass the session quota, and the panel no longer needs
  // the job, so it goes first.
  await chrome.storage.session.remove(JOB_PREFIX + job.token);
  await chrome.storage.session.set({ [RESULT_PREFIX + job.token]: { token: job.token, ...result } });
  if (job.returnTo) {
    try {
      await chrome.tabs.update(job.returnTo.tabId, { active: true });
      await chrome.windows.update(job.returnTo.windowId, { focused: true });
    } catch {
      // The tab is gone; the panel still gets the result.
    }
  }
  const self = await chrome.tabs.getCurrent();
  if (self?.id !== undefined) await chrome.tabs.remove(self.id);
}
