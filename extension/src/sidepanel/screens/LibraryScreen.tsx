import { useEffect, useMemo, useState } from "react";
import type { SuiteSummary, TestCaseSummary } from "@tcm/shared";
import { Header } from "../../components/Header.js";
import { useReadyStore } from "../store/DataStoreProvider.js";
import { relativeTime } from "../../lib/time.js";

function matchesQuery(query: string, title: string, tags: string[], project = ""): boolean {
  if (!query) return true;
  return (
    title.toLowerCase().includes(query) ||
    project.toLowerCase().includes(query) ||
    tags.some((t) => t.toLowerCase().includes(query))
  );
}

/** A suite is as recent as its most recently updated case. Sorting groups by
 * that keeps the whole Library in one recency order — the store already
 * returns cases newest-first, so a suite whose case was just rewritten does
 * not stay buried under alphabetically earlier ones. A suite with no cases
 * has nothing to date, and sorts last. */
function newestCaseAt(cases: TestCaseSummary[]): string {
  return cases.reduce((newest, c) => (c.updatedAt > newest ? c.updatedAt : newest), "");
}

export function LibraryScreen({
  onOpenCase,
  onOpenSuite,
  onNewCase,
  onNewSuite,
  onNewFreeRun,
  onSettings,
  onHistory,
}: {
  onOpenCase: (id: string) => void;
  onOpenSuite: (suiteId: string) => void;
  onNewCase: () => void;
  onNewSuite: () => void;
  onNewFreeRun: (freeRunId: string) => void;
  onSettings: () => void;
  onHistory: () => void;
}) {
  const store = useReadyStore();
  const [cases, setCases] = useState<TestCaseSummary[] | null>(null);
  const [suites, setSuites] = useState<SuiteSummary[] | null>(null);
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
    Promise.all([store.listTestCases(), store.listSuites()])
      .then(([c, s]) => {
        if (cancelled) return;
        setCases(c);
        setSuites(s);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [store]);

  const groups = useMemo(() => {
    if (!cases || !suites) return null;
    const q = query.trim().toLowerCase();
    const archivedOk = (archived: boolean) => showArchived || !archived;

    const casesBySuite = new Map<string, TestCaseSummary[]>();
    const ungrouped: TestCaseSummary[] = [];
    for (const c of cases) {
      if (!archivedOk(c.archived)) continue;
      if (c.suiteId) {
        const list = casesBySuite.get(c.suiteId) ?? [];
        list.push(c);
        casesBySuite.set(c.suiteId, list);
      } else {
        ungrouped.push(c);
      }
    }

    const suiteGroups = suites
      .filter((s) => archivedOk(s.archived))
      .map((s) => {
        const suiteMatches = matchesQuery(q, s.title, s.tags, s.project);
        const allCases = casesBySuite.get(s.id) ?? [];
        const shownCases = suiteMatches
          ? allCases
          : allCases.filter((c) => matchesQuery(q, c.title, c.tags, c.project));
        return { suite: s, cases: shownCases, suiteMatches, updatedAt: newestCaseAt(allCases) };
      })
      .filter((g) => g.suiteMatches || g.cases.length > 0)
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.suite.title.localeCompare(b.suite.title),
      );

    const shownUngrouped = ungrouped.filter((c) => matchesQuery(q, c.title, c.tags, c.project));

    return { suiteGroups, ungrouped: shownUngrouped };
  }, [cases, suites, query, showArchived]);

  const isEmpty = groups !== null && groups.suiteGroups.length === 0 && groups.ungrouped.length === 0;

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
          placeholder="Search title, project or tag…"
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
              onClick={onNewSuite}
              className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              + New suite
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
        {!error && groups === null && <p className="p-3 text-sm text-slate-400">Loading…</p>}
        {!error && isEmpty && <p className="p-3 text-sm text-slate-400">No test cases yet.</p>}

        {groups?.suiteGroups.map(({ suite, cases: suiteCases }) => (
          <div key={suite.id} className="border-b border-slate-100">
            <button
              onClick={() => onOpenSuite(suite.id)}
              className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2 text-left hover:bg-slate-100"
            >
              <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                suite
              </span>
              <span className="flex-1 truncate text-sm font-medium text-slate-800">{suite.title}</span>
              {suite.archived && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                  archived
                </span>
              )}
              <span className="text-xs text-slate-400">
                {suite.caseCount} case{suite.caseCount === 1 ? "" : "s"}
              </span>
            </button>
            <ul className="divide-y divide-slate-100">
              {suiteCases.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => onOpenCase(c.id)}
                    className="flex w-full flex-col gap-1 py-2 pl-8 pr-3 text-left hover:bg-slate-50"
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
                      <span className="whitespace-nowrap">{relativeTime(c.updatedAt)}</span>
                      {c.tags.length > 0 && <span className="truncate">{c.tags.join(", ")}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {groups && groups.suiteGroups.length > 0 && groups.ungrouped.length > 0 && (
          <div className="bg-slate-50 px-3 py-1 text-xs font-semibold uppercase text-slate-400">
            Ungrouped
          </div>
        )}

        <ul className="divide-y divide-slate-100">
          {groups?.ungrouped.map((c) => (
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
                  <span className="whitespace-nowrap">{relativeTime(c.updatedAt)}</span>
                  {c.tags.length > 0 && <span className="truncate">{c.tags.join(", ")}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
