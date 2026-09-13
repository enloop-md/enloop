/**
 * Where the editor opens, and how the result comes back.
 *
 * The page under test is the big surface, so the editor opens *there*: a
 * full-viewport iframe of `editor.html`, injected into the tab. It used to
 * be a tab of its own, and that broke saving — Chrome ties an origin's
 * File System Access grants to the tabs whose top-level page is that
 * origin, and closing the editor tab took the connected folder's grant
 * with it. An iframe inside the app's tab is not such a tab; closing it
 * leaves the grant where it was.
 *
 * When the page cannot be scripted — no grant for the site, a restricted
 * page — the editor opens over the side panel instead, narrower but
 * always available.
 *
 * Hand-off with the framed editor goes through `chrome.storage.session`:
 * a job under `enloop:editor:<token>`, a result under
 * `enloop:editor-result:<token>`. Bytes travel as data URLs, since the
 * session area stores JSON.
 */

import { useEffect, useState } from "react";
import type { ScreenshotOp } from "@tcm/shared";
import { getPageAccess } from "./page-access.js";
import { bytesToDataUrl, dataUrlToBytes } from "./screenshot-render.js";

export interface EditorJob {
  /** Names the view: "<case> — step 3: <title>", or the free run's title. */
  title: string;
  /** The SOURCE png — the editor always starts from the untouched capture
   * and re-applies `ops`. */
  sourcePng: Uint8Array;
  ops: ScreenshotOp[];
  width: number;
  height: number;
}

export interface EditorResult {
  cancelled: boolean;
  ops?: ScreenshotOp[];
  renderedPng?: Uint8Array;
}

// ---- in the page ------------------------------------------------------------

const JOB_PREFIX = "enloop:editor:";
const RESULT_PREFIX = "enloop:editor-result:";
const FRAME_ID = "enloop-screenshot-editor";

interface FrameJob {
  title: string;
  sourceDataUrl: string;
  ops: ScreenshotOp[];
  width: number;
  height: number;
}

interface FrameResult {
  cancelled: boolean;
  ops?: ScreenshotOp[];
  renderedDataUrl?: string;
}

/** Injected: a fixed, full-viewport iframe above everything on the page. */
function mountFrame(url: string, id: string): void {
  document.getElementById(id)?.remove();
  const frame = document.createElement("iframe");
  frame.id = id;
  frame.src = url;
  frame.setAttribute(
    "style",
    "position:fixed;inset:0;width:100vw;height:100vh;border:0;margin:0;padding:0;z-index:2147483647;background:#f1f5f9;",
  );
  frame.setAttribute("allow", "clipboard-write");
  // Keys go to the focused document; the editor's shortcuts need it to be
  // this one, not the page behind it.
  frame.addEventListener("load", () => frame.contentWindow?.focus());
  document.documentElement.appendChild(frame);
}

function unmountFrame(id: string): void {
  document.getElementById(id)?.remove();
}

async function openInPage(job: EditorJob): Promise<EditorResult | null> {
  const access = await getPageAccess();
  if (access.status !== "ready") return null;
  const token = crypto.randomUUID().slice(0, 12);
  const frameJob: FrameJob = {
    title: job.title,
    sourceDataUrl: bytesToDataUrl(job.sourcePng),
    ops: job.ops,
    width: job.width,
    height: job.height,
  };
  try {
    await chrome.storage.session.set({ [JOB_PREFIX + token]: frameJob });
  } catch {
    // Over the session quota — a very large capture. The panel editor
    // takes the bytes directly and has no such limit.
    return null;
  }
  const tabId = access.tabId;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: mountFrame,
      args: [chrome.runtime.getURL(`editor.html#${token}`), FRAME_ID],
    });
  } catch {
    await chrome.storage.session.remove(JOB_PREFIX + token);
    return null;
  }

  const resultKey = RESULT_PREFIX + token;
  return new Promise<EditorResult>((resolve) => {
    let done = false;
    const finish = (result: FrameResult) => {
      if (done) return;
      done = true;
      chrome.storage.session.onChanged.removeListener(onChanged);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      void chrome.storage.session.remove([JOB_PREFIX + token, resultKey]);
      void chrome.scripting
        .executeScript({ target: { tabId }, world: "ISOLATED", func: unmountFrame, args: [FRAME_ID] })
        .catch(() => {});
      resolve({
        cancelled: result.cancelled,
        ops: result.ops,
        renderedPng: result.renderedDataUrl ? dataUrlToBytes(result.renderedDataUrl) : undefined,
      });
    };
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      const change = changes[resultKey];
      if (change?.newValue) finish(change.newValue as FrameResult);
    };
    // The page going away under the editor — closed, or navigated by the
    // app itself — is a cancel; the frame is gone with it.
    const onRemoved = (removed: number) => {
      if (removed === tabId) finish({ cancelled: true });
    };
    const onUpdated = (updated: number, info: chrome.tabs.TabChangeInfo) => {
      if (updated === tabId && info.status === "loading") finish({ cancelled: true });
    };
    chrome.storage.session.onChanged.addListener(onChanged);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

/** The framed editor's side. */
export async function readFrameJob(token: string): Promise<EditorJob | null> {
  try {
    const raw = await chrome.storage.session.get(JOB_PREFIX + token);
    const job = raw[JOB_PREFIX + token] as FrameJob | undefined;
    if (!job) return null;
    return { ...job, sourcePng: dataUrlToBytes(job.sourceDataUrl) };
  } catch {
    return null;
  }
}

export async function finishFrameEditor(token: string, result: EditorResult): Promise<void> {
  const frameResult: FrameResult = {
    cancelled: result.cancelled,
    ops: result.ops,
    renderedDataUrl: result.renderedPng ? bytesToDataUrl(result.renderedPng) : undefined,
  };
  // The job goes first: it holds the source image, and job plus result at
  // once can pass the session quota.
  await chrome.storage.session.remove(JOB_PREFIX + token);
  await chrome.storage.session.set({ [RESULT_PREFIX + token]: frameResult });
}

// ---- in the panel -----------------------------------------------------------

interface Open {
  job: EditorJob;
  resolve: (result: EditorResult) => void;
}

let current: Open | null = null;
const listeners = new Set<(job: EditorJob | null) => void>();

function notify(): void {
  for (const listener of listeners) listener(current?.job ?? null);
}

function openInPanel(job: EditorJob): Promise<EditorResult> {
  if (current) current.resolve({ cancelled: true });
  return new Promise<EditorResult>((resolve) => {
    current = { job, resolve };
    notify();
  });
}

/** The panel editor's side: hands the result back and closes. */
export function finishEditor(result: EditorResult): void {
  const open = current;
  current = null;
  notify();
  open?.resolve(result);
}

/** The job the panel overlay should show, null when none. */
export function useEditorJob(): EditorJob | null {
  const [job, setJob] = useState<EditorJob | null>(current?.job ?? null);
  useEffect(() => {
    listeners.add(setJob);
    setJob(current?.job ?? null);
    return () => {
      listeners.delete(setJob);
    };
  }, []);
  return job;
}

/**
 * Opens the editor on `job` — in the page when it can be scripted, over
 * the panel otherwise — and resolves with what the tester did.
 */
export async function openEditor(job: EditorJob): Promise<EditorResult> {
  return (await openInPage(job)) ?? openInPanel(job);
}
