import { useEffect, useMemo, useState } from "react";
import type { TestCaseSummary } from "@tcm/shared";
import { Header } from "../../components/Header.js";
import { useReadyStore } from "../store/DataStoreProvider.js";

export function LibraryScreen({
  onOpenCase,
  onNewCase,
  onNewFreeRun,
  onSettings,
  onHistory,
}: {
  onOpenCase: (id: string) => void;
  onNewCase: () => void;
  onNewFreeRun: (freeRunId: string) => void;
  onSettings: () => void;
  onHistory: () => void;
}) {
  const store = useReadyStore();
  const [cases, setCases] = useState<TestCaseSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startFreeRun() {
    setBusy(true);
    setError(null);
    try {
      const freeRun = await store.createFreeRun(`Free run ${new Date().toLocaleDateString()}`);
      onNewFreeRun(freeRun.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    store
      .listTestCases()
      .then((result) => {
        if (!cancelled) setCases(result);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [store]);

  const filtered = useMemo(() => {
    if (!cases) return [];
    const q = query.trim().toLowerCase();
    return cases
      .filter((c) => showArchived || !c.archived)
      .filter(
        (c) =>
          !q ||
          c.title.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q)),
      );
  }, [cases, query, showArchived]);

  return (
    <div className="flex h-full flex-col">
      <Header
        title="Test Cases"
        onSettings={onSettings}
        actions={
          <button
            onClick={onHistory}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            Runs
          </button>
        }
      />
      <div className="space-y-2 border-b border-slate-200 p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or tag…"
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
          <div className="flex gap-2">
            <button
              onClick={startFreeRun}
              disabled={busy}
              className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Free run
            </button>
            <button
              onClick={onNewCase}
              className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"
            >
              + New test case
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && <p className="p-3 text-sm text-red-600">{error}</p>}
        {!error && cases === null && <p className="p-3 text-sm text-slate-400">Loading…</p>}
        {!error && cases !== null && filtered.length === 0 && (
          <p className="p-3 text-sm text-slate-400">No test cases yet.</p>
        )}
        <ul className="divide-y divide-slate-100">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onOpenCase(c.id)}
                className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-slate-50"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-800">{c.title}</span>
                  {c.archived && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                      archived
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>v{c.currentVersion}</span>
                  {c.tags.length > 0 && <span>{c.tags.join(", ")}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
