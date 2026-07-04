import { useEffect, useState } from "react";
import { parseCaseDocument, starterCaseTemplate } from "@tcm/shared";
import { Header } from "../../components/Header.js";
import { useReadyStore } from "../store/DataStoreProvider.js";

export function EditorScreen({
  testCaseId,
  onBack,
  onSaved,
}: {
  testCaseId?: string;
  onBack: () => void;
  onSaved: (testCaseId: string) => void;
}) {
  const store = useReadyStore();
  const isNew = !testCaseId;

  const [text, setText] = useState(isNew ? starterCaseTemplate() : "");
  const [loaded, setLoaded] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!testCaseId) return;
    let cancelled = false;
    (async () => {
      const meta = await store.getTestCase(testCaseId);
      const source = await store.getVersionSource(testCaseId, meta.currentVersion);
      if (cancelled) return;
      setText(source);
      setLoaded(true);
    })().catch((e) => !cancelled && setError(String(e)));
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
        const meta = await store.createTestCase(text);
        onSaved(meta.id);
      } else {
        await store.createVersion(testCaseId, text);
        onSaved(testCaseId);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Loading…" onBack={onBack} />
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
        {error && <p className="text-sm text-red-600">{error}</p>}
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
