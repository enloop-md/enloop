import { useEffect, useState } from "react";
import { parseCaseDocument, starterCaseTemplate } from "@tcm/shared";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Header } from "../../components/Header.js";
import { useReadyStore, useWorkspace } from "../store/DataStoreProvider.js";
import { splitId } from "@tcm/shared";

export function EditorScreen({
  testCaseId,
  suiteId,
  onBack,
  onSaved,
}: {
  testCaseId?: string;
  /** When set and `testCaseId` is unset, the new case is created inside this suite. */
  suiteId?: string;
  onBack: () => void;
  onSaved: (testCaseId: string) => void;
}) {
  const store = useReadyStore();
  const { storages, defaultStorageId, setDefaultStorageId, createTestCaseIn } = useWorkspace();
  const isNew = !testCaseId;
  // Where a new case lands. A case inside a suite has no choice — the suite's
  // folder decides. Editing an existing case has none either: its storage is
  // fixed by its id.
  const suiteStorageId = suiteId ? splitId(suiteId).storageId : null;
  const [targetStorageId, setTargetStorageId] = useState<string>(
    suiteStorageId ?? defaultStorageId ?? storages[0]?.id ?? "",
  );
  const showStoragePicker = isNew && !suiteId && storages.length > 1;

  const [text, setText] = useState(isNew ? starterCaseTemplate() : "");
  const [loaded, setLoaded] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!testCaseId) return;
    let cancelled = false;
    (async () => {
      const meta = await store.getTestCase(testCaseId);
      const source = await store.getVersionSource(testCaseId, meta.currentVersion);
      if (cancelled) return;
      setText(source);
      setLoaded(true);
    })().catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId]);

  const preview = (() => {
    try {
      const parsed = parseCaseDocument(text, { version: 1, createdAt: new Date().toISOString() });
      const automated = parsed.steps.filter((s) => s.type === "automated").length;
      const stepSummary = `${parsed.steps.length} step${parsed.steps.length === 1 ? "" : "s"} (${automated} automated)`;
      const varSummary =
        parsed.variables.length > 0
          ? `, ${parsed.variables.length} variable${parsed.variables.length === 1 ? "" : "s"}`
          : "";
      return {
        ok: true as const,
        summary: stepSummary + varSummary,
      };
    } catch (e) {
      return { ok: false as const, summary: e instanceof Error ? e.message : String(e) };
    }
  })();

  async function save() {
    if (!preview.ok) {
      setError(preview.summary);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (isNew) {
        const meta = await createTestCaseIn(suiteStorageId ?? targetStorageId, text, suiteId);
        if (!suiteId) setDefaultStorageId(targetStorageId);
        onSaved(meta.id);
      } else {
        await store.createVersion(testCaseId, text);
        onSaved(testCaseId);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    // A load that failed leaves `loaded` false forever, so the error has to
    // be rendered here too — otherwise the screen sits on "Loading…" with
    // the reason it will never finish held in state and never shown.
    return (
      <div className="flex h-full flex-col">
        <Header title={error == null ? "Loading…" : "Could not open"} onBack={onBack} />
        <ErrorNotice error={error} className="p-3" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={isNew ? "New test case" : "Edit test case"} onBack={onBack} />
      <div className="flex-1 overflow-hidden p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="h-full w-full resize-none rounded border border-slate-300 p-2 font-mono text-xs leading-relaxed"
        />
      </div>
      <div className="space-y-2 border-t border-slate-200 p-3">
        <ErrorNotice error={error} />
        {showStoragePicker && (
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <span className="shrink-0">Save to</span>
            <select
              value={targetStorageId}
              onChange={(e) => setTargetStorageId(e.target.value)}
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm text-slate-700"
            >
              {storages.map((s) => (
                <option key={s.id} value={s.id} disabled={s.permission !== "granted"}>
                  {s.label}
                  {s.permission !== "granted" ? " (not connected)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className={`text-xs ${preview.ok ? "text-slate-500" : "text-amber-600"}`}>
          {preview.summary}
        </p>
        <button
          onClick={save}
          disabled={busy || !preview.ok}
          className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {isNew ? "Create test case" : "Save new version"}
        </button>
      </div>
    </div>
  );
}
