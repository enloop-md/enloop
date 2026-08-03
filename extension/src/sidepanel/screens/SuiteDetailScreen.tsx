import { useEffect, useState } from "react";
import type { TestCaseSummary, TestCaseVersion } from "@tcm/shared";
import { Header } from "../../components/Header.js";
import { Markdown } from "../../components/Markdown.js";
import { useReadyStore } from "../store/DataStoreProvider.js";

export function SuiteDetailScreen({
  suiteId,
  onBack,
  onOpenCase,
  onNewCaseInSuite,
  onEditSuite,
  onSettings,
}: {
  suiteId: string;
  onBack: () => void;
  onOpenCase: (id: string) => void;
  onNewCaseInSuite: (suiteId: string) => void;
  onEditSuite: (suiteId: string) => void;
  onSettings: () => void;
}) {
  const store = useReadyStore();
  const [doc, setDoc] = useState<TestCaseVersion | null>(null);
  const [cases, setCases] = useState<TestCaseSummary[] | null>(null);
  const [archived, setArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    store
      .getSuite(suiteId)
      .then((s) => {
        if (cancelled) return;
        setDoc(s.doc);
        setCases(s.cases);
        setArchived(s.archived);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [store, suiteId]);

  async function toggleArchive() {
    setBusy(true);
    try {
      await store.archiveSuite(suiteId, !archived);
      setArchived((a) => !a);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!doc || !cases) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Suite" onBack={onBack} onSettings={onSettings} />
        <p className="p-3 text-sm text-slate-400">{error ?? "Loading…"}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={doc.title} onBack={onBack} onSettings={onSettings} />
      <div className="flex-1 overflow-y-auto p-3">
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {doc.project && (
          <div className="mb-2 flex items-baseline gap-1.5 text-xs">
            <span className="font-medium text-slate-500">Project:</span>
            <span className="text-slate-600">{doc.project}</span>
          </div>
        )}
        {doc.description && (
          <Markdown text={doc.description} className="mb-3 text-sm text-slate-600" />
        )}
        {doc.tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {doc.tags.map((t) => (
              <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                {t}
              </span>
            ))}
          </div>
        )}

        {doc.steps.length > 0 && (
          <div className="mb-4">
            <h2 className="mb-1 text-xs font-semibold uppercase text-slate-400">
              Shared preparation
            </h2>
            <ol className="space-y-2">
              {doc.steps.map((s, i) => (
                <li key={s.id} className="rounded border border-slate-200 p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">#{i + 1}</span>
                    <span className="flex-1 font-medium text-slate-800">{s.title}</span>
                  </div>
                  {s.instructions && (
                    <Markdown text={s.instructions} className="mt-1 text-xs text-slate-500" />
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div>
          <h2 className="mb-1 text-xs font-semibold uppercase text-slate-400">
            Cases ({cases.length})
          </h2>
          {cases.length === 0 && <p className="text-sm text-slate-400">No cases yet.</p>}
          <ul className="divide-y divide-slate-100">
            {cases.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onOpenCase(c.id)}
                  className="flex w-full items-center gap-2 py-2 text-left hover:bg-slate-50"
                >
                  <span className="flex-1 truncate text-sm font-medium text-slate-800">
                    {c.title}
                  </span>
                  {c.archived && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                      archived
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex gap-2 border-t border-slate-200 p-3">
        <button
          onClick={() => onNewCaseInSuite(suiteId)}
          className="flex-1 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          New case in suite
        </button>
        <button
          onClick={() => onEditSuite(suiteId)}
          className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Edit suite
        </button>
        <button
          onClick={toggleArchive}
          disabled={busy}
          className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          {archived ? "Unarchive" : "Archive"}
        </button>
      </div>
    </div>
  );
}
