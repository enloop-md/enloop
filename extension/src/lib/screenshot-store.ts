/**
 * One face over the two screenshot stores.
 *
 * A run's screenshots and a free run's live behind different method names
 * (`addScreenshot` / `addFreeRunScreenshot`) because they are addressed
 * differently — a run by case and run id, a free run by its own id. The
 * panel component that shows thumbnails, captions and the editor does not
 * care which it is talking to, so the owner is decided once, here, and the
 * component gets four verbs.
 *
 * The editor round-trip lives here too, since both the capture UI and the
 * runner's confirm sheet open it: read the untouched source, hand it over,
 * write back whatever ops the tester saved.
 */

import type { DataStore, FreeRun, Run, RunScreenshot, ScreenshotInput, ScreenshotOp, ScreenshotPatch, ScreenshotVariant } from "@tcm/shared";
import { EditorTooLargeError, newEditorToken, openEditor } from "./editor-handoff.js";
import { currentTabRef } from "./question-tab.js";
import { bytesToDataUrl, dataUrlToBytes } from "./screenshot-render.js";

export type ScreenshotOwner =
  | { kind: "run"; testCaseId: string; runId: string }
  | { kind: "free"; freeRunId: string };

/** What the store hands back after a change — the panel keeps whichever
 * one it is showing. */
export type ScreenshotHolder = Run | FreeRun;

export interface ScreenshotApi {
  add(input: ScreenshotInput): Promise<{ next: ScreenshotHolder; screenshot: RunScreenshot }>;
  update(id: string, patch: ScreenshotPatch): Promise<ScreenshotHolder>;
  remove(id: string): Promise<ScreenshotHolder>;
  read(id: string, which: ScreenshotVariant): Promise<Uint8Array>;
}

export function screenshotApi(store: DataStore, owner: ScreenshotOwner): ScreenshotApi {
  if (owner.kind === "run") {
    const { testCaseId, runId } = owner;
    return {
      add: async (input) => {
        const { run, screenshot } = await store.addScreenshot(testCaseId, runId, input);
        return { next: run, screenshot };
      },
      update: (id, patch) => store.updateScreenshot(testCaseId, runId, id, patch),
      remove: (id) => store.removeScreenshot(testCaseId, runId, id),
      read: (id, which) => store.readScreenshot(testCaseId, runId, id, which),
    };
  }
  const { freeRunId } = owner;
  return {
    add: async (input) => {
      const { freeRun, screenshot } = await store.addFreeRunScreenshot(freeRunId, input);
      return { next: freeRun, screenshot };
    },
    update: (id, patch) => store.updateFreeRunScreenshot(freeRunId, id, patch),
    remove: (id) => store.removeFreeRunScreenshot(freeRunId, id),
    read: (id, which) => store.readFreeRunScreenshot(freeRunId, id, which),
  };
}

/** A stable identity for an owner, for effect dependencies. */
export function ownerKey(owner: ScreenshotOwner): string {
  return owner.kind === "run" ? `run:${owner.testCaseId}:${owner.runId}` : `free:${owner.freeRunId}`;
}

/**
 * Opens the editor on a stored screenshot and writes back what the tester
 * saved. Resolves with the updated holder, or null when they cancelled.
 * `ops` is what the editor starts from — the screenshot's own, or a crop
 * the caller proposes for a fresh capture. `sourcePng` skips the read when
 * the caller still holds the bytes it just captured.
 *
 * Throws `EditorTooLargeError` when the capture cannot fit through the
 * session-storage hand-off; every other failure is the store's.
 */
export async function editScreenshot(
  api: ScreenshotApi,
  shot: RunScreenshot,
  title: string,
  ops: ScreenshotOp[],
  sourcePng?: Uint8Array,
): Promise<ScreenshotHolder | null> {
  const source = sourcePng ?? (await api.read(shot.id, "source"));
  // Read before the editor opens: the tester lands back on this tab when
  // they save, and a tab switch while the editor is up must not change it.
  const returnTo = await currentTabRef();
  const result = await openEditor({
    token: newEditorToken(),
    title,
    sourceDataUrl: bytesToDataUrl(source),
    ops,
    width: shot.width,
    height: shot.height,
    returnTo,
  });
  if (result.cancelled || !result.ops || !result.renderedDataUrl) return null;
  return api.update(shot.id, { ops: result.ops, renderedPng: dataUrlToBytes(result.renderedDataUrl) });
}

export { EditorTooLargeError };
