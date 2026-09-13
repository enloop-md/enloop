import { GESTURE_HINT } from "../../lib/page-capture.js";
import { HOVER_HINT, useDelayedTrigger, useHoverTrigger } from "../../lib/hover-trigger.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PhotoSpec, RunScreenshot, RunStep } from "@tcm/shared";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { PageAccessNotice } from "../../components/PageAccessNotice.js";
import { getPageAccess, type PageAccess } from "../../lib/page-access.js";
import { elementCrop, takePhoto, takePlainScreenshot, type TakenPhoto } from "../../lib/photo-runner.js";
import { bytesToDataUrl } from "../../lib/screenshot-render.js";
import {
  editScreenshot,
  ownerKey,
  screenshotApi,
  type ScreenshotHolder,
  type ScreenshotOwner,
} from "../../lib/screenshot-store.js";
import { useThumbnailUrls } from "../../lib/thumbnail-cache.js";
import { useReadyStore } from "../store/DataStoreProvider.js";

/**
 * The screenshots of one step (or of the run as a whole, or of a free
 * run): what the step asked the runner to take, the two buttons for taking
 * one by hand, and the thumbnails of what exists — each with its caption,
 * the way into the editor, the way back to the untouched capture, and the
 * way to another step.
 *
 * The runner's own captures (`Take: before` / `after`) are fired by the run
 * screen, which knows when a step opens and when it is marked; this
 * component only shows their state. What it does fire itself is the
 * `manual` spec's Take button and the hand captures, because both are the
 * tester's own click.
 */

/** How long a caption sits before it is written. Matches the comment boxes. */
const CAPTION_DEBOUNCE_MS = 700;

/** What the runner could not do for a slot — an error or a missing grant —
 * worded for the spec row. Keyed by 1-based slot. */
export type SpecNotices = Record<number, string>;

export function RunScreenshots({
  owner,
  step,
  screenshots,
  readOnly,
  onChanged,
  onInsertPlaceholder,
  matchedSelector = null,
  moveTargets,
  editorTitle,
  specNotices = {},
  compact = false,
  tools = true,
}: {
  owner: ScreenshotOwner;
  /** The step these belong to; null for the run itself and for free runs. */
  step: RunStep | null;
  /** Only this step's (or the run's) screenshots. */
  screenshots: RunScreenshot[];
  readOnly: boolean;
  /** The run or free run as the store returned it after a change. */
  onChanged: (next: ScreenshotHolder) => void;
  /** Free runs: put `%PHOTO_<seq>%` into the notes for a fresh capture. */
  onInsertPlaceholder?: (seq: number) => void;
  /** The selector the step's Highlight found, if any — `& edit` opens
   * cropped to it. */
  matchedSelector?: string | null;
  /** Where a screenshot can be moved: every step, labelled. Absent hides
   * the control (free runs). */
  moveTargets?: Array<{ stepId: string; label: string }>;
  /** Names the editor tab. */
  editorTitle: string;
  /** Errors the run screen's runner hit on this step's slots. */
  specNotices?: SpecNotices;
  /** The run-level strip: no spec rows, tighter spacing. */
  compact?: boolean;
  /** False hides the capture tools — the buttons, the delayed capture, the
   * runner's unfilled photo slots — while pictures already taken stay
   * editable. A test run's default; see useScreenshotPrefs.ts. */
  tools?: boolean;
}) {
  const store = useReadyStore();
  const key = ownerKey(owner);
  // Rebuilt only when the owner changes; a new object per render would
  // re-run the thumbnail effect every time the run state moves.
  const api = useMemo(() => screenshotApi(store, owner), [store, key]);

  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<PageAccess | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Chrome wants a gesture on this tab before it will photograph it. */
  const [needsGesture, setNeedsGesture] = useState(false);
  const [localNotices, setLocalNotices] = useState<SpecNotices>({});

  const read = useCallback((id: string) => api.read(id, "rendered"), [api]);
  const sorted = [...screenshots].sort((a, b) => a.seq - b.seq);
  const urls = useThumbnailUrls(sorted, read);

  /** The grant check every capture starts with: a missing grant is a
   * notice with a button, not a failed capture. */
  async function ready(): Promise<boolean> {
    const current = await getPageAccess();
    if (current.status !== "ready") {
      setAccess(current);
      return false;
    }
    setAccess(null);
    return true;
  }

  async function addTaken(photo: TakenPhoto, slot: number | null): Promise<RunScreenshot | null> {
    const { next, screenshot } = await api.add({
      stepId: step?.stepId ?? null,
      slot,
      pageUrl: photo.pageUrl,
      width: photo.width,
      height: photo.height,
      sourcePng: photo.sourcePng,
      ops: photo.ops,
      renderedPng: photo.ops.length > 0 ? photo.renderedPng : null,
      missing: photo.missing,
      caption: "",
    });
    onChanged(next);
    onInsertPlaceholder?.(screenshot.seq);
    return screenshot;
  }

  async function capture(edit: boolean) {
    if (!(await ready())) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await takePlainScreenshot();
      if (!result.ok) {
        if (result.needsGesture) setNeedsGesture(true);
        else setNotice(result.error);
        return;
      }
      setNeedsGesture(false);
      const shot = await addTaken(result.photo, null);
      if (!shot || !edit) return;
      // A matched Highlight says what the step is about; start the editor
      // cropped to it, and let the tester widen from there.
      const crop = matchedSelector ? await elementCrop(matchedSelector, shot.width, shot.height) : null;
      await openEditorOn(shot, crop ? [crop] : [], result.photo.sourcePng);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /** The `manual` spec's Take, and the retry after a runner error. */
  async function takeSpec(spec: PhotoSpec, slot: number) {
    if (!step) return;
    if (!(await ready())) return;
    setBusy(true);
    setError(null);
    try {
      const result = await takePhoto(spec, step.selectors);
      if (!result.ok) {
        if (result.needsGesture) setNeedsGesture(true);
        setLocalNotices((n) => ({ ...n, [slot]: `Photo ${slot} not taken: ${result.error}` }));
        return;
      }
      setLocalNotices((n) => {
        const { [slot]: _gone, ...rest } = n;
        return rest;
      });
      await addTaken(result.photo, slot);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function openEditorOn(shot: RunScreenshot, ops: RunScreenshot["ops"], sourcePng?: Uint8Array) {
    try {
      const next = await editScreenshot(api, shot, editorTitle, ops, sourcePng);
      if (next) onChanged(next);
    } catch (e) {
      setError(e);
    }
  }

  async function patch(id: string, p: Parameters<typeof api.update>[1]) {
    setError(null);
    try {
      onChanged(await api.update(id, p));
    } catch (e) {
      setError(e);
    }
  }

  async function revert(shot: RunScreenshot) {
    setError(null);
    try {
      // Ops back to nothing means the rendered file is the source again;
      // the store needs the bytes since it never renders.
      const source = await api.read(shot.id, "source");
      onChanged(await api.update(shot.id, { ops: [], renderedPng: source }));
    } catch (e) {
      setError(e);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      onChanged(await api.remove(id));
    } catch (e) {
      setError(e);
    }
  }

  function openFull(shot: RunScreenshot) {
    const url = urls[shot.id];
    if (!url) return;
    void chrome.tabs.create({ url });
  }

  const notices: SpecNotices = { ...specNotices, ...localNotices };
  const filledSlots = new Set(sorted.filter((s) => s.slot !== null).map((s) => s.slot as number));
  // With the tools hidden, only slots that hold a picture are rows.
  const specRows = (step?.photos ?? [])
    .map((spec, i) => ({ spec, slot: i + 1 }))
    .filter(({ slot }) => tools || filledSlots.has(slot));
  const hasSpecs = specRows.length > 0;

  const hoverPlain = useHoverTrigger(() => void capture(false), busy || readOnly);
  const hoverEdit = useHoverTrigger(() => void capture(true), busy || readOnly);
  const delayed = useDelayedTrigger(() => void capture(false));

  if ((readOnly || !tools) && sorted.length === 0 && !hasSpecs) return null;

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      {hasSpecs && (
        <ul className="space-y-1">
          {specRows.map(({ spec, slot }) => (
            <SpecRow
              key={slot}
              spec={spec}
              slot={slot}
              filled={filledSlots.has(slot)}
              shot={sorted.find((s) => s.slot === slot) ?? null}
              notice={filledSlots.has(slot) ? null : (notices[slot] ?? null)}
              readOnly={readOnly}
              busy={busy}
              onTake={() => void takeSpec(spec, slot)}
            />
          ))}
        </ul>
      )}

      {!readOnly && tools && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void capture(false)}
              {...hoverPlain}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title={`${step ? "Capture the page for this step" : "Capture the page for the run as a whole"}, ${HOVER_HINT}`}
            >
              📷 Screenshot
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void capture(true)}
              {...hoverEdit}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              title={`Capture, then crop and mark it up, ${HOVER_HINT}`}
            >
              📷 Screenshot &amp; edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={delayed.start}
              className={`rounded border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                delayed.counting
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              title="Capture in three seconds — time to click into the page and open what the picture needs. Press again to cancel."
            >
              {delayed.counting ? `⏱ ${delayed.left}…` : "⏱ 3 s"}
            </button>
            {busy && <span className="text-[10px] text-slate-400">capturing…</span>}
            {notice && <span className="text-[10px] text-amber-700">{notice}</span>}
          </div>
          {/* Also for a runner photo the run screen reported refused — its
              notice carries Chrome's wording, and the fix is the same. */}
          {(needsGesture || Object.values(notices).some((t) => /activeTab|all_urls/.test(t))) && (
            <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
              {GESTURE_HINT}
            </p>
          )}
          <PageAccessNotice access={access} onGranted={() => setAccess(null)} />
        </div>
      )}
      <ErrorNotice error={error} />

      {sorted.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {sorted.map((shot) => (
            <Thumbnail
              key={shot.id}
              shot={shot}
              url={urls[shot.id]}
              spec={step && shot.slot !== null ? (step.photos[shot.slot - 1] ?? null) : null}
              readOnly={readOnly}
              moveTargets={moveTargets}
              onOpen={() => openFull(shot)}
              onCaption={(caption) => void patch(shot.id, { caption })}
              onEdit={() => void openEditorOn(shot, shot.ops)}
              onRevert={() => void revert(shot)}
              onMove={(stepId) => void patch(shot.id, { stepId })}
              onRemove={() => void remove(shot.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One `### Photo` of the step: which it is, and where it stands. A spec the
 * runner will take on its own says so in grey; one it took says nothing
 * beyond the thumbnail's `slot n`; one the tester takes gets its button.
 */
function SpecRow({
  spec,
  slot,
  filled,
  shot,
  notice,
  readOnly,
  busy,
  onTake,
}: {
  spec: PhotoSpec;
  slot: number;
  filled: boolean;
  shot: RunScreenshot | null;
  notice: string | null;
  readOnly: boolean;
  busy: boolean;
  onTake: () => void;
}) {
  const label = spec.caption.trim() || spec.crop || "";
  const missing = shot?.missing ?? [];
  const hoverTake = useHoverTrigger(onTake, busy || readOnly || filled);
  const delayedTake = useDelayedTrigger(onTake);
  const pending = !filled && !notice && spec.take !== "manual";
  return (
    <li className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
          filled
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
        }`}
        title={`Photo ${slot}: ${describeSpec(spec)}`}
      >
        📷 Photo {slot}
        {label && <span className="max-w-[10rem] truncate font-normal opacity-80">{label}</span>}
      </span>
      {/* Always offered while the slot is empty: a runner photo the tester
          deleted, or one the runner never got to, has no other way back. */}
      {!readOnly && !filled && (
        <button
          type="button"
          disabled={busy}
          onClick={onTake}
          {...hoverTake}
          title={`Take photo ${slot} now, ${HOVER_HINT}`}
          className="rounded bg-sky-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          Take
        </button>
      )}
      {!readOnly && !filled && (
        <button
          type="button"
          disabled={busy}
          onClick={delayedTake.start}
          title={`Take photo ${slot} in three seconds — time to open what it needs on the page. Press again to cancel.`}
          className={`rounded border px-1.5 py-0.5 text-[11px] font-medium disabled:opacity-50 ${
            delayedTake.counting
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-sky-300 bg-white text-sky-700 hover:bg-sky-50"
          }`}
        >
          {delayedTake.counting ? `⏱ ${delayedTake.left}…` : "⏱ 3 s"}
        </button>
      )}
      {!readOnly && pending && (
        <span className="text-slate-400">
          {spec.take === "before" ? "takes itself when the step opens" : "takes itself when you mark it"}
        </span>
      )}
      {notice && <span className="text-amber-700">{notice}</span>}
      {missing.length > 0 && (
        <span
          className="rounded bg-amber-100 px-1 text-[10px] text-amber-800"
          title={`Matched nothing on the page:\n${missing.join("\n")}`}
        >
          {missing.length} not found
        </span>
      )}
    </li>
  );
}

function describeSpec(spec: PhotoSpec): string {
  const parts = [
    spec.crop ? `crop to ${spec.crop}` : "whole viewport",
    spec.marks.length > 0 && `${spec.marks.length} marked`,
    spec.points.length > 0 && `${spec.points.length} pointed at`,
    spec.callouts.length > 0 && `${spec.callouts.length} numbered`,
    spec.blurs.length > 0 && `${spec.blurs.length} blurred`,
    `${spec.take}${spec.take === "manual" ? "" : `, ${spec.mode}`}`,
  ].filter((p): p is string => !!p);
  return parts.join(" · ");
}

/**
 * One screenshot: the picture, and everything that can be done to the
 * record. Destructive actions (revert, remove) ask twice — a second click
 * on the same control, not a dialog — because the thumbnails sit next to
 * each other and a slip costs a capture that cannot be retaken later.
 */
function Thumbnail({
  shot,
  url,
  spec,
  readOnly,
  moveTargets,
  onOpen,
  onCaption,
  onEdit,
  onRevert,
  onMove,
  onRemove,
}: {
  shot: RunScreenshot;
  url: string | undefined;
  /** The spec the screenshot fills, for the caption placeholder. */
  spec: PhotoSpec | null;
  readOnly: boolean;
  moveTargets?: Array<{ stepId: string; label: string }>;
  onOpen: () => void;
  onCaption: (caption: string) => void;
  onEdit: () => void;
  onRevert: () => void;
  onMove: (stepId: string | null) => void;
  onRemove: () => void;
}) {
  const [caption, setCaption] = useState(shot.caption);
  const [confirming, setConfirming] = useState<"revert" | "remove" | null>(null);

  // Written while typing, like every other box in the run: the panel can
  // close mid-word.
  useEffect(() => {
    if (readOnly || caption === shot.caption) return;
    const timer = setTimeout(() => onCaption(caption), CAPTION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [caption, shot.caption]);

  // A confirm left hanging is a trap for the next click; it clears itself.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const edited = shot.ops.length > 0;

  return (
    <li className="w-[min(100%,14rem)] space-y-1">
      <button
        type="button"
        onClick={onOpen}
        title={`${shot.width}×${shot.height} — ${shot.pageUrl}\nopen full size`}
        className="relative block h-[120px] w-fit max-w-full overflow-hidden rounded border border-slate-200 bg-slate-50"
      >
        {url ? (
          <img src={url} alt={shot.caption || `Screenshot ${shot.seq}`} className="h-full w-auto max-w-full object-contain" />
        ) : (
          <span className="flex h-full w-32 items-center justify-center text-[10px] text-slate-400">loading…</span>
        )}
        {shot.slot !== null && (
          <span className="absolute left-1 top-1 rounded bg-emerald-600/90 px-1 text-[10px] font-medium text-white">
            slot {shot.slot}
          </span>
        )}
        {edited && (
          <span className="absolute right-1 top-1 rounded bg-slate-900/70 px-1 text-[10px] text-white" title="Marked up">
            ✎
          </span>
        )}
      </button>
      {readOnly ? (
        (shot.caption.trim() || spec?.caption.trim()) && (
          <p className="text-[11px] text-slate-500">{shot.caption.trim() || spec?.caption.trim()}</p>
        )
      ) : (
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder={spec?.caption.trim() || "Caption (optional)"}
          className="w-full rounded border border-slate-300 px-1.5 py-0.5 text-[11px]"
        />
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          <button type="button" onClick={onEdit} className="rounded border border-slate-300 px-1.5 py-0.5 text-slate-700 hover:bg-slate-50">
            ✎ Edit
          </button>
          {edited && (
            <button
              type="button"
              onClick={() => {
                if (confirming === "revert") {
                  setConfirming(null);
                  onRevert();
                } else setConfirming("revert");
              }}
              className={`rounded border px-1.5 py-0.5 ${
                confirming === "revert"
                  ? "border-amber-400 bg-amber-50 text-amber-800"
                  : "border-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
              title="Drop every mark and crop; the capture itself is untouched"
            >
              {confirming === "revert" ? "Drop marks?" : "↺ Original"}
            </button>
          )}
          {moveTargets && (
            <select
              value={shot.stepId ?? ""}
              onChange={(e) => onMove(e.target.value || null)}
              className="max-w-[9rem] rounded border border-slate-300 bg-white px-1 py-0.5 text-[10px] text-slate-700"
              title="Move to another step, or to the run as a whole"
              aria-label="Move to"
            >
              <option value="">Run</option>
              {moveTargets.map((t) => (
                <option key={t.stepId} value={t.stepId}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => {
              if (confirming === "remove") {
                setConfirming(null);
                onRemove();
              } else setConfirming("remove");
            }}
            className={`ml-auto rounded border px-1.5 py-0.5 ${
              confirming === "remove"
                ? "border-red-400 bg-red-50 text-red-700"
                : "border-slate-300 text-slate-500 hover:text-red-600"
            }`}
            aria-label="Remove screenshot"
          >
            {confirming === "remove" ? "Remove?" : "✕"}
          </button>
        </div>
      )}
    </li>
  );
}

// ---- the runner's confirm sheet and toast ----------------------------------

export type PhotoDecision = "keep" | "retake" | "edit" | "discard";

/**
 * What a `Mode: confirm` photo shows before it is kept: the picture as the
 * runner rendered it, the spec's caption, and the four choices. Fixed over
 * the panel rather than inline in the step so the picture gets the whole
 * width — a 400 px panel has no room for a preview beside a step body.
 * Keep is the default and takes Enter: in the common case the runner got
 * it right and the tester should be one key from moving on.
 */
export function PhotoConfirmSheet({
  slot,
  spec,
  photo,
  onDecide,
}: {
  slot: number;
  spec: PhotoSpec;
  photo: TakenPhoto;
  onDecide: (decision: PhotoDecision) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // A data URL rather than an object URL: the bytes are already in hand,
    // and the sheet is short-lived.
    setUrl(bytesToDataUrl(photo.renderedPng));
  }, [photo]);

  return (
    <div
      role="dialog"
      aria-label={`Photo ${slot}`}
      className="absolute inset-0 z-40 flex flex-col bg-white"
      onKeyDown={(e) => {
        // Enter anywhere but on a button is Keep; on a button it is that
        // button, which the browser handles.
        if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          onDecide("keep");
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs">
        <span className="font-medium text-slate-800">📷 Photo {slot}</span>
        <span className="text-slate-400">
          {photo.width}×{photo.height}
        </span>
        {photo.missing.length > 0 && (
          <span
            className="rounded bg-amber-100 px-1 text-[10px] text-amber-800"
            title={`Matched nothing on the page:\n${photo.missing.join("\n")}`}
          >
            {photo.missing.length} not found
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto bg-slate-100 p-2">
        {url && <img src={url} alt={spec.caption || `Photo ${slot}`} className="w-full rounded border border-slate-200 bg-white" />}
        {spec.caption.trim() && <p className="mt-1.5 text-xs italic text-slate-600">{spec.caption}</p>}
        {spec.callouts.some((c) => !photo.missing.includes(c.selector)) && (
          <ol className="mt-1 list-decimal pl-5 text-[11px] text-slate-600">
            {/* Numbered as the discs are: a callout that matched nothing has
                no disc and takes no number. */}
            {spec.callouts
              .filter((c) => !photo.missing.includes(c.selector))
              .map((c, i) => (
                <li key={i}>{c.text.trim() || <code>{c.selector}</code>}</li>
              ))}
          </ol>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1.5 border-t border-slate-200 p-2">
        <button
          type="button"
          autoFocus
          onClick={() => onDecide("keep")}
          className="rounded bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
          title="Keep this photo (Enter)"
        >
          Keep
        </button>
        <button
          type="button"
          onClick={() => onDecide("retake")}
          className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          title="Take it again from the page as it is now"
        >
          Retake
        </button>
        <button
          type="button"
          onClick={() => onDecide("edit")}
          className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          title="Keep it and open the editor"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDecide("discard")}
          className="rounded border border-red-200 px-2 py-1.5 text-xs text-red-700 hover:bg-red-50"
          title="Drop it; the step goes on without this photo"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

/** The two-second "Photo n taken" of `Mode: auto` — the only trace an
 * auto photo leaves on screen while the tester is busy elsewhere. */
export function PhotoToast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="pointer-events-none absolute bottom-16 left-1/2 z-30 -translate-x-1/2 rounded bg-slate-900/85 px-3 py-1.5 text-xs text-white shadow">
      {text}
    </div>
  );
}
