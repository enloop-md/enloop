import { useEffect, useMemo, useState } from "react";
import {
  exampleCaseSource,
  type FreeRunFile,
  type RunSummary,
  type SuiteSummary,
  type TestCaseSummary,
} from "@tcm/shared";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Header } from "../../components/Header.js";
import { useReadyStore } from "../store/DataStoreProvider.js";
import { relativeTime } from "../../lib/time.js";

const DOCS_URL = "https://github.com/enloop-me/enloop#readme";

function matchesQuery(query: string, title: string, tags: string[], project = ""): boolean {
  if (!query) return true;
  return (
    title.toLowerCase().includes(query) ||
    project.toLowerCase().includes(query) ||
    tags.some((t) => t.toLowerCase().includes(query))
  );
}

interface SuiteGroup {
  suite: SuiteSummary;
  cases: TestCaseSummary[];
  suiteMatches: boolean;
  project: string;
  updatedAt: string;
}

interface ProjectGroup {
  /** `@project`, or `""` for everything that declares none. */
  project: string;
  suiteGroups: SuiteGroup[];
  /** Cases in this project that are not in one of its suites. */
  ungrouped: TestCaseSummary[];
  caseCount: number;
  updatedAt: string;
}

/**
 * Which project a suite belongs to.
 *
 * `@project` in `suite.md` is the answer when it is there. A suite written
 * before the tag existed still belongs somewhere, though, and its cases know:
 * if every one of them declares the same project, so does the suite. Cases
 * that disagree are left alone rather than guessed at — a suite that spans
 * two apps is unusual enough to be worth seeing as unfiled.
 */
function suiteProject(suite: SuiteSummary, cases: TestCaseSummary[]): string {
  if (suite.project) return suite.project;
  const declared = new Set(cases.map((c) => c.project).filter(Boolean));
  return declared.size === 1 ? [...declared][0] : "";
}

/**
 * The band that separates one app's cases from another's.
 *
 * Sticky, because the whole point is knowing which app the row under your
 * cursor belongs to after scrolling past the header that said so. Quiet,
 * because it is a divider and not a destination: there is no project screen
 * to open, and nothing here should look like it offers one.
 */
function ProjectHeader({ group }: { group: ProjectGroup }) {
  return (
    <div className="sticky top-0 z-10 flex items-baseline gap-2 border-y border-slate-200 bg-slate-100/95 px-3 py-1 backdrop-blur">
      <span
        className={`truncate text-[11px] font-semibold uppercase tracking-wide ${
          group.project ? "text-slate-600" : "text-slate-400"
        }`}
      >
        {group.project || "No project"}
      </span>
      <span className="ml-auto shrink-0 text-[10px] text-slate-400">
        {group.caseCount} case{group.caseCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}

/** One case. Identical inside a suite and outside one but for the indent,
 * which is the only thing that was ever different about the two copies of
 * this markup. */
function CaseRow({
  testCase,
  indented = false,
  onOpen,
}: {
  testCase: TestCaseSummary;
  indented?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className={`flex w-full flex-col gap-1 py-2 pr-3 text-left hover:bg-slate-50 ${
        indented ? "pl-8" : "pl-3"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium text-slate-800">{testCase.title}</span>
        {testCase.archived && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
            archived
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>v{testCase.currentVersion}</span>
        <span className="whitespace-nowrap">{relativeTime(testCase.updatedAt)}</span>
        {testCase.tags.length > 0 && <span className="truncate">{testCase.tags.join(", ")}</span>}
      </div>
    </button>
  );
}

type Unfinished =
  | { kind: "run"; id: string; testCaseId: string; title: string; done: number; total: number }
  | { kind: "freeRun"; id: string; title: string };

/**
 * The run the tester walked away from, if there is one.
 *
 * The panel's document dies whenever the panel closes, and a restored
 * navigation stack only survives until Chrome restarts — so the case that
 * this exists for is the tester who marked four steps yesterday, closed the
 * laptop, and now has no idea that the run is sitting there half-finished.
 * Only the most recent is offered: older abandoned runs are history, and
 * belong on the history screen.
 */
function mostRecentUnfinished(runs: RunSummary[], freeRuns: FreeRunFile[]): Unfinished | null {
  const open = [
    ...runs
      .filter((r) => r.status === "in_progress")
      .map((r) => ({
        startedAt: r.startedAt,
        entry: {
          kind: "run" as const,
          id: r.id,
          testCaseId: r.testCaseId,
          title: r.testCaseTitle,
          done: r.passCount + r.failCount,
          total: r.stepCount,
        },
      })),
    ...freeRuns
      .filter((f) => !f.finishedAt)
      .map((f) => ({
        startedAt: f.startedAt,
        entry: { kind: "freeRun" as const, id: f.id, title: f.title },
      })),
  ].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return open[0]?.entry ?? null;
}

function ResumeBanner({
  unfinished,
  onResume,
}: {
  unfinished: Unfinished;
  onResume: () => void;
}) {
  return (
    <button
      onClick={onResume}
      className="flex w-full items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-left hover:bg-amber-100"
    >
      <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
        in progress
      </span>
      <span className="flex-1 truncate text-xs font-medium text-amber-900">
        {unfinished.title}
      </span>
      <span className="shrink-0 text-[11px] text-amber-700">
        {unfinished.kind === "run" && `${unfinished.done}/${unfinished.total} · `}Resume →
      </span>
    </button>
  );
}

/**
 * What a connected-but-empty folder says.
 *
 * It used to say "No test cases yet.", which is true and useless: the two
 * doors out of it are a Markdown editor for a grammar the tester has not
 * read, and a set of Claude Code skills they may not have installed. The
 * example is here so the first thing anyone does with Enloop is watch a run
 * work, rather than author one blind.
 */
function FirstRun({ busy, onLoadExample }: { busy: boolean; onLoadExample: () => void }) {
  return (
    <div className="space-y-3 p-4 text-sm">
      <h2 className="font-medium text-slate-800">Nothing here yet</h2>
      <p className="text-slate-500">
        Cases are Markdown files in the folder you connected. Start with the example — it runs
        against a public demo site and shows every control the panel has: Go, Highlight, values
        that type themselves in, and a step that runs a script in the page.
      </p>
      <button
        onClick={onLoadExample}
        disabled={busy}
        className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        Load an example case
      </button>
      <p className="text-xs text-slate-400">
        For your own app, cases are written from its repo with the Claude Code skill{" "}
        <code className="text-slate-500">/enloop:write</code>, which reads the code and derives
        the routes and selectors.{" "}
        <a href={DOCS_URL} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">
          Setting that up ↗
        </a>
      </p>
    </div>
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
  onOpenRun,
  onOpenFreeRun,
}: {
  onOpenCase: (id: string) => void;
  onOpenSuite: (suiteId: string) => void;
  onNewCase: () => void;
  onNewSuite: () => void;
  onNewFreeRun: (freeRunId: string) => void;
  onSettings: () => void;
  onHistory: () => void;
  onOpenRun: (testCaseId: string, runId: string) => void;
  onOpenFreeRun: (freeRunId: string) => void;
}) {
  const store = useReadyStore();
  const [cases, setCases] = useState<TestCaseSummary[] | null>(null);
  const [suites, setSuites] = useState<SuiteSummary[] | null>(null);
  const [unfinished, setUnfinished] = useState<Unfinished | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function startFreeRun() {
    setBusy(true);
    setError(null);
    try {
      const freeRun = await store.createFreeRun(`Free run ${new Date().toLocaleDateString()}`);
      onNewFreeRun(freeRun.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function loadExample() {
    setBusy(true);
    setError(null);
    try {
      const meta = await store.createTestCase(exampleCaseSource());
      onOpenCase(meta.id);
    } catch (e) {
      setError(e);
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
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [store]);

  // A run left open. Loaded separately from the library itself so a slow or
  // broken runs folder cannot keep the case list from rendering.
  useEffect(() => {
    let cancelled = false;
    Promise.all([store.listRuns(), store.listFreeRuns()])
      .then(([runs, freeRuns]) => {
        if (!cancelled) setUnfinished(mostRecentUnfinished(runs, freeRuns));
      })
      .catch(() => {
        // Not worth an error banner: the library is still perfectly usable
        // without the shortcut, and Runs shows the same thing.
      });
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
        return {
          suite: s,
          cases: shownCases,
          suiteMatches,
          project: suiteProject(s, allCases),
          updatedAt: newestCaseAt(allCases),
        };
      })
      .filter((g) => g.suiteMatches || g.cases.length > 0)
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.suite.title.localeCompare(b.suite.title),
      );

    const shownUngrouped = ungrouped.filter((c) => matchesQuery(q, c.title, c.tags, c.project));

    const byProject = new Map<string, ProjectGroup>();
    const bucket = (project: string): ProjectGroup => {
      const existing = byProject.get(project);
      if (existing) return existing;
      const created: ProjectGroup = { project, suiteGroups: [], ungrouped: [], caseCount: 0, updatedAt: "" };
      byProject.set(project, created);
      return created;
    };
    // Suites first within a project, then its loose cases — the same order
    // the screen had before there were projects to nest them under.
    for (const g of suiteGroups) {
      const group = bucket(g.project);
      group.suiteGroups.push(g);
      group.caseCount += g.cases.length;
      if (g.updatedAt > group.updatedAt) group.updatedAt = g.updatedAt;
    }
    for (const c of shownUngrouped) {
      const group = bucket(c.project);
      group.ungrouped.push(c);
      group.caseCount += 1;
      if (c.updatedAt > group.updatedAt) group.updatedAt = c.updatedAt;
    }

    const projects = [...byProject.values()].sort((a, b) => {
      // Whatever declares no project sorts last however recent it is: it is
      // the leftovers pile, and a pile that jumps to the top every time
      // something lands in it is worse than one that stays where you left it.
      if (!a.project !== !b.project) return a.project ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt) || a.project.localeCompare(b.project);
    });

    // One bucket labels nothing — a folder holding a single project, or one
    // holding none, would gain a header that every row is already under.
    return { projects, showProjectHeaders: projects.length > 1 };
  }, [cases, suites, query, showArchived]);

  // "Nothing here yet" and "nothing matches that search" are different
  // situations with different answers, and the onboarding one must not fire
  // for a tester who mistyped a tag.
  const libraryEmpty = cases !== null && suites !== null && cases.length === 0 && suites.length === 0;
  const noMatches = !libraryEmpty && groups !== null && groups.projects.length === 0;

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

      {unfinished && (
        <ResumeBanner
          unfinished={unfinished}
          onResume={() =>
            unfinished.kind === "run"
              ? onOpenRun(unfinished.testCaseId, unfinished.id)
              : onOpenFreeRun(unfinished.id)
          }
        />
      )}

      <div className="flex-1 overflow-y-auto">
        <ErrorNotice error={error} className="p-3" />
        {error == null && groups === null && <p className="p-3 text-sm text-slate-400">Loading…</p>}
        {error == null && noMatches && (
          <p className="p-3 text-sm text-slate-400">Nothing matches that search.</p>
        )}
        {error == null && libraryEmpty && <FirstRun busy={busy} onLoadExample={loadExample} />}

        {groups?.projects.map((project) => (
          // Prefixed so the no-project group has a key of its own that no
          // real project name can collide with.
          <div key={`project:${project.project}`}>
            {groups.showProjectHeaders && <ProjectHeader group={project} />}

            {project.suiteGroups.map(({ suite, cases: suiteCases }) => (
              <div key={suite.id} className="border-b border-slate-100">
                <button
                  onClick={() => onOpenSuite(suite.id)}
                  className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2 text-left hover:bg-slate-100"
                >
                  <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                    suite
                  </span>
                  <span className="flex-1 truncate text-sm font-medium text-slate-800">
                    {suite.title}
                  </span>
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
                      <CaseRow testCase={c} indented onOpen={() => onOpenCase(c.id)} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {project.suiteGroups.length > 0 && project.ungrouped.length > 0 && (
              <div className="bg-slate-50 px-3 py-1 text-xs font-semibold uppercase text-slate-400">
                Ungrouped
              </div>
            )}

            <ul className="divide-y divide-slate-100">
              {project.ungrouped.map((c) => (
                <li key={c.id}>
                  <CaseRow testCase={c} onOpen={() => onOpenCase(c.id)} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
