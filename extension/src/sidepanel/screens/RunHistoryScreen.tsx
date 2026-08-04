import { useEffect, useMemo, useState } from "react";
import type { FreeRunFile, RunSummary } from "@tcm/shared";
import { Header } from "../../components/Header.js";
import { RunStatusBadge } from "../../components/StatusBadge.js";
import { useReadyStore } from "../store/DataStoreProvider.js";

type HistoryEntry =
  | { kind: "run"; startedAt: string; run: RunSummary }
  | { kind: "freeRun"; startedAt: string; freeRun: FreeRunFile };

export function RunHistoryScreen({
  testCaseId,
  onBack,
  onSettings,
  onOpenRun,
  onOpenFreeRun,
}: {
  testCaseId?: string;
  onBack: () => void;
  onSettings: () => void;
  onOpenRun: (testCaseId: string, runId: string) => void;
  onOpenFreeRun: (freeRunId: string) => void;
}) {
  const store = useReadyStore();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [freeRuns, setFreeRuns] = useState<FreeRunFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([store.listRuns(testCaseId), testCaseId ? Promise.resolve([]) : store.listFreeRuns()])
      .then(([r, f]) => {
        if (cancelled) return;
        setRuns(r);
        setFreeRuns(f);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId]);

  const entries = useMemo<HistoryEntry[] | null>(() => {
    if (runs === null || freeRuns === null) return null;
    const combined: HistoryEntry[] = [
      ...runs.map((run): HistoryEntry => ({ kind: "run", startedAt: run.startedAt, run })),
      ...freeRuns.map((freeRun): HistoryEntry => ({ kind: "freeRun", startedAt: freeRun.startedAt, freeRun })),
    ];
    combined.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return combined;
  }, [runs, freeRuns]);

  return (
    <div className="flex h-full flex-col">
      <Header title={testCaseId ? "Runs for this case" : "All runs"} onBack={onBack} onSettings={onSettings} />
      <div className="flex-1 overflow-y-auto">
        {error && <p className="p-3 text-sm text-red-600">{error}</p>}
        {!error && entries === null && <p className="p-3 text-sm text-slate-400">Loading…</p>}
        {!error && entries !== null && entries.length === 0 && (
          <p className="p-3 text-sm text-slate-400">No runs yet.</p>
        )}
        <ul className="divide-y divide-slate-100">
          {entries?.map((entry) =>
            entry.kind === "run" ? (
              <li key={`run-${entry.run.id}`}>
                <button
                  onClick={() => onOpenRun(entry.run.testCaseId, entry.run.id)}
                  className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm font-medium text-slate-800">
                      {entry.run.testCaseTitle}
                    </span>
                    {entry.run.tier === "quick" && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        quick
                      </span>
                    )}
                    <RunStatusBadge status={entry.run.status} />
                  </div>
                  <div className="text-xs text-slate-400">
                    v{entry.run.testCaseVersion} · {new Date(entry.run.startedAt).toLocaleString()} ·{" "}
                    {entry.run.passCount}/{entry.run.stepCount} passed
                    {entry.run.failCount > 0 && (
                      <span className="text-red-500"> · {entry.run.failCount} failed</span>
                    )}
                  </div>
                </button>
              </li>
            ) : (
              <li key={`free-${entry.freeRun.id}`}>
                <button
                  onClick={() => onOpenFreeRun(entry.freeRun.id)}
                  className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm font-medium text-slate-800">
                      {entry.freeRun.title}
                    </span>
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700">
                      free
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {new Date(entry.freeRun.startedAt).toLocaleString()} ·{" "}
                    {entry.freeRun.finishedAt ? "finished" : "in progress"}
                  </div>
                </button>
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}
