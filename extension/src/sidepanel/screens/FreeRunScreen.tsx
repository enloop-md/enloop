import { useEffect, useRef, useState } from "react";
import type { FreeRun } from "@tcm/shared";
import { Header } from "../../components/Header.js";
import { useReadyStore } from "../store/DataStoreProvider.js";

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
  const [error, setError] = useState<string | null>(null);
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
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [store, freeRunId]);

  const readOnly = !freeRun || freeRun.finishedAt != null;

  async function save(patch: { title?: string; notes?: string }) {
    try {
      const updated = await store.updateFreeRun(freeRunId, patch);
      setFreeRun(updated);
    } catch (e) {
      setError(String(e));
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
      await save({ title, notes });
      const updated = await store.finishFreeRun(freeRunId);
      setFreeRun(updated);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!freeRun) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Free run" onBack={onBack} onSettings={onSettings} />
        <p className="p-3 text-sm text-slate-400">{error ?? "Loading…"}</p>
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
      {error && <p className="px-3 pt-2 text-sm text-red-600">{error}</p>}
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
        <div className="border-t border-slate-200 p-3">
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
