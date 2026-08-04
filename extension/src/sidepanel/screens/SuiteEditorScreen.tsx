import { useEffect, useState } from "react";
import { parseCaseDocument, starterSuiteTemplate } from "@tcm/shared";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Header } from "../../components/Header.js";
import { useReadyStore } from "../store/DataStoreProvider.js";

export function SuiteEditorScreen({
  suiteId,
  onBack,
  onSaved,
}: {
  suiteId?: string;
  onBack: () => void;
  onSaved: (suiteId: string) => void;
}) {
  const store = useReadyStore();
  const isNew = !suiteId;

  const [text, setText] = useState(isNew ? starterSuiteTemplate() : "");
  const [loaded, setLoaded] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!suiteId) return;
    let cancelled = false;
    store
      .getSuiteSource(suiteId)
      .then((source) => {
        if (cancelled) return;
        setText(source);
        setLoaded(true);
      })
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [store, suiteId]);

  const preview = (() => {
    try {
      const parsed = parseCaseDocument(
        text,
        { version: 1, createdAt: new Date().toISOString() },
        { requireSteps: false },
      );
      const stepSummary =
        parsed.steps.length > 0
          ? `${parsed.steps.length} prep step${parsed.steps.length === 1 ? "" : "s"}`
          : "no prep steps";
      const varSummary =
        parsed.variables.length > 0
          ? `, ${parsed.variables.length} variable${parsed.variables.length === 1 ? "" : "s"}`
          : "";
      return { ok: true as const, summary: stepSummary + varSummary };
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
        const suite = await store.createSuite(text);
        onSaved(suite.id);
      } else {
        await store.saveSuite(suiteId, text);
        onSaved(suiteId);
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
      <Header title={isNew ? "New suite" : "Edit suite"} onBack={onBack} />
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
        <p className={`text-xs ${preview.ok ? "text-slate-500" : "text-amber-600"}`}>
          {preview.summary}
        </p>
        <button
          onClick={save}
          disabled={busy || !preview.ok}
          className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {isNew ? "Create suite" : "Save suite"}
        </button>
      </div>
    </div>
  );
}
