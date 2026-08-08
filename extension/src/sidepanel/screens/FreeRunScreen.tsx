import { useCallback, useEffect, useRef, useState } from "react";
import { describeCounts, type CapturedEntry, type FreeRun } from "@tcm/shared";
import { CaptureNotice } from "../../components/CaptureNotice.js";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Header } from "../../components/Header.js";
import { freeRunCaptureKey } from "../../lib/capture.js";
import { useReadyStore } from "../store/DataStoreProvider.js";
import { useCaptureRecorder } from "../useCapture.js";

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
      {!readOnly && <CaptureNotice wrapper={capture.wrapper} className="mx-3 mt-2" />}
      <div className="flex-1 overflow-hidden p-3">
        <textarea
          value={notes}
          disabled={readOnly}
          onChange={(e) => {
            setNotes(e.target.value);
            scheduleNotesSave(e.target.value);
          }}
          onBlur={() => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            if (notes !== freeRun.notes) save({ notes });
          }}
          placeholder="Capture reactions, comments, anything worth relaying back — plain markdown."
          spellCheck={false}
          className="h-full w-full resize-none rounded border border-slate-300 p-2 font-mono text-xs leading-relaxed disabled:bg-slate-50"
        />
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
    </div>
  );
}
