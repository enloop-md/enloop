import { useEffect, useState } from "react";
import type { RunSummary, TestCaseSummary, TestCaseVersion } from "@tcm/shared";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Header } from "../../components/Header.js";
import { Markdown } from "../../components/Markdown.js";
import { RunStatusBadge } from "../../components/StatusBadge.js";
import { useReadyStore } from "../store/DataStoreProvider.js";
import { relativeTime } from "../../lib/time.js";

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
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await store.getSuite(suiteId);
      if (cancelled) return;
      setDoc(s.doc);
      setCases(s.cases);
      setArchived(s.archived);
      // Runs are stored per case, so a suite's history is the union of its
      // cases' histories. One listRuns walk is cheaper than one call per
      // case, and it is already sorted newest-first.
      const caseIds = new Set(s.cases.map((c) => c.id));
      const all = await store.listRuns();
      if (cancelled) return;
      setRuns(all.filter((r) => caseIds.has(r.testCaseId)));
    })().catch((e) => !cancelled && setError(e));
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
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!doc || !cases) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Suite" onBack={onBack} onSettings={onSettings} />
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
      <Header title={doc.title} onBack={onBack} onSettings={onSettings} />
      <div className="flex-1 overflow-y-auto p-3">
        <ErrorNotice error={error} className="mb-2" />
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

        <div className="mb-4">
          <h2 className="mb-1 text-xs font-semibold uppercase text-slate-400">Runs</h2>
          {!runs && <p className="text-xs text-slate-400">Loading…</p>}
          {runs && runs.length === 0 && (
            <p className="text-xs text-slate-400">No runs yet for the cases in this suite.</p>
          )}
          {runs && runs.length > 0 && <SuiteRuns runs={runs} />}
        </div>

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

/**
 * How the suite has been doing, in the two resolutions that get asked for:
 * the tally across every run of every case in it, and the last run in
 * enough detail to say what happened without opening it. Step counts rather
 * than just the verdict, because a passed run with two warnings and a
 * passed run with none are different facts, and the badge alone hides that.
 */
function SuiteRuns({ runs }: { runs: RunSummary[] }) {
  const tally = {
    passed: runs.filter((r) => r.status === "passed").length,
    failed: runs.filter((r) => r.status === "failed").length,
    aborted: runs.filter((r) => r.status === "aborted").length,
    inProgress: runs.filter((r) => r.status === "in_progress").length,
  };
  // listRuns sorts newest-first and filtering preserves that order.
  const last = runs[0];
  const undecided = last.stepCount - last.passCount - last.failCount - last.warnCount;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-slate-500">
        <span className="font-medium text-slate-700">
          {runs.length} run{runs.length === 1 ? "" : "s"}
        </span>
        <Tally count={tally.passed} label="passed" className="text-emerald-600" />
        <Tally count={tally.failed} label="failed" className="text-red-600" />
        <Tally count={tally.aborted} label="aborted" className="text-slate-400" />
        <Tally count={tally.inProgress} label="in progress" className="text-sky-600" />
      </div>

      <div className="rounded border border-slate-200 p-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase text-slate-400">Last run</span>
          <span className="flex-1 text-[11px] text-slate-400">
            {relativeTime(last.finishedAt ?? last.startedAt) || last.startedAt}
          </span>
          {last.tier === "quick" && (
            <span
              className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
              title="Only the steps marked Kind: quick were run"
            >
              quick
            </span>
          )}
          <RunStatusBadge status={last.status} />
        </div>
        <p className="mt-1 truncate text-sm text-slate-800">{last.testCaseTitle}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
          <span>
            {last.stepCount} step{last.stepCount === 1 ? "" : "s"}
          </span>
          <Tally count={last.passCount} label="passed" className="text-emerald-600" />
          <Tally count={last.warnCount} label="warning" className="text-amber-600" />
          <Tally count={last.failCount} label="failed" className="text-red-600" />
          {/* Pending or skipped. Worth naming: on an aborted run this is the
              difference between "nothing went wrong" and "nobody got to it". */}
          <Tally count={undecided} label="not run" className="text-slate-400" />
        </div>
      </div>
    </div>
  );
}

/** Zero counts are left out rather than shown as "0 failed" — in a strip
 * this narrow, the absence is the message. */
function Tally({
  count,
  label,
  className,
}: {
  count: number;
  label: string;
  className: string;
}) {
  if (count <= 0) return null;
  return (
    <span className={className}>
      · {count} {label}
    </span>
  );
}
