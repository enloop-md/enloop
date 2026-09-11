import { useCallback, useEffect, useRef, useState } from "react";
import { describeCounts, type CapturedEntry, type FreeRun } from "@tcm/shared";
import { CaptureToggles } from "../../components/CaptureToggles.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Header } from "../../components/Header.js";
import { freeRunCaptureKey } from "../../lib/capture.js";
import { canDownloadGuide, downloadFreeRunGuide } from "../../lib/guide-download.js";
import { useReadyStore } from "../store/DataStoreProvider.js";
import { useCaptureRecorder } from "../useCapture.js";
import { RunScreenshots } from "./RunScreenshots.js";
import { useGestureScreenshot } from "../../lib/use-gesture-screenshot.js";

const AUTOSAVE_DEBOUNCE_MS = 2000;

export function FreeRunScreen({
  freeRunId,
  onBack,
  onSettings,
}: {
  freeRunId: string;
  onBack: () => void;
  onSettings: () => void;
}) {
  const store = useReadyStore();
  const [freeRun, setFreeRun] = useState<FreeRun | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  // Where the tester last was in the notes. Every button in the panel takes
  // focus off the textarea before its click lands, so "at the caret" has to
  // mean the caret as it was — null until they have clicked into the box.
  const caretRef = useRef<number | null>(null);
  const [guideWarnings, setGuideWarnings] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    store
      .getFreeRun(freeRunId)
      .then((f) => {
        if (cancelled) return;
        setFreeRun(f);
        setTitle(f.title);
        setNotes(f.notes);
      })
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [store, freeRunId]);

  const readOnly = !freeRun || freeRun.finishedAt != null;

  const appendConsole = useCallback(
    async (entries: CapturedEntry[]) => {
      await store.appendFreeRunConsole(freeRunId, entries);
    },
    [store, freeRunId],
  );
  // An unscripted session is exactly where an unexplained console error is
  // worth having, and there is no step for it to hang off — entries attach to
  // the session and land in console.md next to notes.md.
  const capture = useCaptureRecorder({
    key: freeRunCaptureKey(freeRunId),
    stepId: null,
    active: !!freeRun && freeRun.finishedAt == null,
    append: appendConsole,
  });

  async function save(patch: { title?: string; notes?: string }) {
    try {
      const updated = await store.updateFreeRun(freeRunId, patch);
      setFreeRun(updated);
    } catch (e) {
      setError(e);
    }
  }

  function scheduleNotesSave(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save({ notes: value }), AUTOSAVE_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useGestureScreenshot(
    readOnly
      ? null
      : async (photo) => {
          try {
            const { freeRun: next, screenshot } = await store.addFreeRunScreenshot(freeRunId, {
              stepId: null,
              slot: null,
              pageUrl: photo.pageUrl,
              width: photo.width,
              height: photo.height,
              sourcePng: photo.sourcePng,
              ops: [],
              renderedPng: null,
              missing: [],
              caption: "",
            });
            setFreeRun(next);
            insertPlaceholder(screenshot.seq);
          } catch (e) {
            setError(e);
          }
        },
    (message) => setError(new Error(`Cannot capture: ${message}`)),
  );

  /**
   * `%PHOTO_<seq>%` into the notes for a screenshot just taken (G21): at
   * the caret when there is one, on its own line at the end otherwise.
   * Goes through the same autosave as typing, so the placeholder is on
   * disk before the panel can be closed.
   */
  function insertPlaceholder(seq: number) {
    const token = `%PHOTO_${seq}%`;
    const box = notesRef.current;
    const at = caretRef.current;
    let next: string;
    let caret: number;
    if (at !== null && at <= notes.length) {
      const before = notes.slice(0, at);
      const after = notes.slice(at);
      const lead = before === "" || before.endsWith("\n") ? "" : before.endsWith(" ") ? "" : " ";
      const trail = after === "" || after.startsWith("\n") ? "" : after.startsWith(" ") ? "" : " ";
      next = `${before}${lead}${token}${trail}${after}`;
      caret = before.length + lead.length + token.length + trail.length;
    } else {
      const trimmed = notes.replace(/\s+$/, "");
      next = trimmed === "" ? `${token}\n` : `${trimmed}\n\n${token}\n`;
      caret = next.length;
    }
    caretRef.current = caret;
    setNotes(next);
    scheduleNotesSave(next);
    if (box) {
      box.value = next;
      box.setSelectionRange(caret, caret);
    }
  }

  async function downloadGuide() {
    if (!freeRun) return;
    setError(null);
    try {
      setGuideWarnings(await downloadFreeRunGuide(store, freeRun, notes));
    } catch (e) {
      setError(e);
    }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      // console.md is rendered by finishFreeRun, so the last batch has to be
      // on disk before it runs.
      await capture.flush();
      await save({ title, notes });
      const updated = await store.finishFreeRun(freeRunId);
      setFreeRun(updated);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!freeRun) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Free run" onBack={onBack} onSettings={onSettings} />
        {error == null ? (
          <p className="p-3 text-sm text-slate-400">Loading…</p>
        ) : (
          <ErrorNotice error={error} className="p-3" />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="Free run" onBack={onBack} onSettings={onSettings} />
      <div className="space-y-2 border-b border-slate-200 p-3">
        <input
          value={title}
          disabled={readOnly}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title !== freeRun.title) save({ title });
          }}
          placeholder="Free run title"
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-medium disabled:bg-slate-50"
        />
      </div>
      <ErrorNotice error={error} className="px-3 pt-2" />
      {/* A free run has no screen in front of it to put these on — it starts
          from one click in the Library — so they live here, at the top of the
          session they apply to. */}
      {!readOnly && (
        <CaptureToggles
          settings={capture.settings}
          wrapper={capture.wrapper}
          onChange={capture.set}
          compact
          className="border-b border-slate-100 bg-slate-50 px-3 py-2"
        />
      )}
      <div className="flex flex-1 flex-col gap-2 overflow-hidden p-3">
        <textarea
          ref={notesRef}
          value={notes}
          disabled={readOnly}
          onChange={(e) => {
            caretRef.current = e.target.selectionStart;
            setNotes(e.target.value);
            scheduleNotesSave(e.target.value);
          }}
          onSelect={(e) => {
            caretRef.current = e.currentTarget.selectionStart;
          }}
          onBlur={(e) => {
            caretRef.current = e.currentTarget.selectionStart;
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (notes !== freeRun.notes) save({ notes });
          }}
          placeholder="Capture reactions, comments, anything worth relaying back — plain markdown. A screenshot puts its %PHOTO_n% where you are."
          spellCheck={false}
          className="min-h-0 flex-1 w-full resize-none rounded border border-slate-300 p-2 font-mono text-xs leading-relaxed disabled:bg-slate-50"
        />
        {/* Under the notes, not in them: the pictures of the session, each
            standing where its %PHOTO_n% says in the text above. */}
        <div className="max-h-[45%] shrink-0 overflow-y-auto">
          <RunScreenshots
            owner={{ kind: "free", freeRunId }}
            step={null}
            screenshots={freeRun.screenshots}
            readOnly={readOnly}
            onChanged={(next) => setFreeRun(next as FreeRun)}
            onInsertPlaceholder={readOnly ? undefined : insertPlaceholder}
            editorTitle={freeRun.title || "Free run"}
            compact
          />
        </div>
      </div>
      {!readOnly && (
        <div className="space-y-2 border-t border-slate-200 p-3">
          {capture.on && capture.total > 0 && (
            <p className="text-[11px] text-slate-400">
              Captured {describeCounts(capture.counts) || `${capture.total} entries`} from the
              page — kept in <code>console.md</code> next to these notes, and not copied into the
              handoff.
            </p>
          )}
          <button
            onClick={finish}
            disabled={busy}
            className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Finish
          </button>
        </div>
      )}
      {readOnly && canDownloadGuide(freeRun) && (
        <div className="space-y-1 border-t border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void downloadGuide()}
              className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500"
              title="These notes as a page, with every screenshot inlined where its %PHOTO_n% stands"
            >
              ⬇ Download guide
            </button>
            <span className="text-[11px] text-slate-400">
              {freeRun.screenshots.length} screenshot{freeRun.screenshots.length === 1 ? "" : "s"}
            </span>
          </div>
          {guideWarnings && guideWarnings.length > 0 && (
            <p className="text-[11px] text-amber-700" title={guideWarnings.join("\n")}>
              {guideWarnings.length === 1
                ? guideWarnings[0]
                : `${guideWarnings.length} placeholders named no screenshot and were dropped`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
