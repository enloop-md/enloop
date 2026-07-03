import { useEffect, useState } from "react";
import type { RunSummary } from "@tcm/shared";
import { Header } from "../../components/Header.js";
import { RunStatusBadge } from "../../components/StatusBadge.js";
import { useReadyStore } from "../store/DataStoreProvider.js";

export function RunHistoryScreen({
  testCaseId,
  onBack,
  onSettings,
  onOpenRun,
}: {
  testCaseId?: string;
  onBack: () => void;
  onSettings: () => void;
  onOpenRun: (testCaseId: string, runId: string) => void;
}) {
  const store = useReadyStore();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    store
      .listRuns(testCaseId)
      .then((r) => !cancelled && setRuns(r))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId]);

  return (
    <div className="flex h-full flex-col">
      <Header title={testCaseId ? "Runs for this case" : "All runs"} onBack={onBack} onSettings={onSettings} />
      <div className="flex-1 overflow-y-auto">
        {error && <p className="p-3 text-sm text-red-600">{error}</p>}
        {!error && runs === null && <p className="p-3 text-sm text-slate-400">Loading…</p>}
        {!error && runs !== null && runs.length === 0 && (
          <p className="p-3 text-sm text-slate-400">No runs yet.</p>
        )}
        <ul className="divide-y divide-slate-100">
          {runs?.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onOpenRun(r.testCaseId, r.id)}
                className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-slate-50"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm font-medium text-slate-800">
                    {r.testCaseTitle}
                  </span>
                  <RunStatusBadge status={r.status} />
                </div>
                <div className="text-xs text-slate-400">
                  v{r.testCaseVersion} · {new Date(r.startedAt).toLocaleString()} · {r.passCount}/
                  {r.stepCount} passed
                  {r.failCount > 0 && <span className="text-red-500"> · {r.failCount} failed</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
