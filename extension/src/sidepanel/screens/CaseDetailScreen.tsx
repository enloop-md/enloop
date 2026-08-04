import { useEffect, useState } from "react";
import { parseCaseDocument, type TestCaseMeta, type TestCaseVersion, type VersionSummary } from "@tcm/shared";
import { Header } from "../../components/Header.js";
import { Markdown } from "../../components/Markdown.js";
import { useReadyStore } from "../store/DataStoreProvider.js";

export function CaseDetailScreen({
  testCaseId,
  onBack,
  onEdit,
  onRunStarted,
  onRunSetup,
  onHistory,
  onSettings,
}: {
  testCaseId: string;
  onBack: () => void;
  onEdit: () => void;
  onRunStarted: (runId: string) => void;
  onRunSetup: (version: number) => void;
  onHistory: () => void;
  onSettings: () => void;
}) {
  const store = useReadyStore();
  const [meta, setMeta] = useState<TestCaseMeta | null>(null);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [version, setVersion] = useState<TestCaseVersion | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([store.getTestCase(testCaseId), store.listVersions(testCaseId)])
      .then(([m, v]) => {
        if (cancelled) return;
        setMeta(m);
        setVersions(v);
        setSelectedVersion(m.currentVersion);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId]);

  useEffect(() => {
    if (selectedVersion == null) return;
    let cancelled = false;
    store
      .getVersion(testCaseId, selectedVersion)
      .then((v) => !cancelled && setVersion(v))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId, selectedVersion]);

  async function startRun() {
    if (!meta) return;
    setBusy(true);
    setError(null);
    try {
      const runSource = await store.getRunSource(testCaseId, meta.currentVersion);
      const doc = parseCaseDocument(runSource, {
        version: meta.currentVersion,
        createdAt: new Date().toISOString(),
      });
      if (doc.variables.length > 0) {
        onRunSetup(meta.currentVersion);
        return;
      }
      const run = await store.createRun(testCaseId, meta.currentVersion);
      onRunStarted(run.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!meta) return;
    setBusy(true);
    try {
      await store.archiveTestCase(testCaseId, !meta.archived);
      setMeta({ ...meta, archived: !meta.archived });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!meta) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Test case" onBack={onBack} onSettings={onSettings} />
        <p className="p-3 text-sm text-slate-400">{error ?? "Loading…"}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={meta.title} onBack={onBack} onSettings={onSettings} />
      <div className="flex-1 overflow-y-auto p-3">
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        {(version?.project || meta.project) && (
          <div className="mb-2 flex items-baseline gap-1.5 text-xs">
            <span className="font-medium text-slate-500">Project:</span>
            <span className="text-slate-600">{version?.project || meta.project}</span>
          </div>
        )}
        {(version?.author || version?.formatVersion) && (
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 text-[11px] text-slate-400">
            {version.author && <span>by {version.author}</span>}
            {version.formatVersion && <span>grammar {version.formatVersion}</span>}
          </div>
        )}
        {meta.description && (
          <Markdown text={meta.description} className="mb-3 text-sm text-slate-600" />
        )}
        {meta.tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {meta.tags.map((t) => (
              <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="mb-3 flex items-center gap-2 text-sm">
          <label className="text-slate-500">Version</label>
          <select
            value={selectedVersion ?? meta.currentVersion}
            onChange={(e) => setSelectedVersion(Number(e.target.value))}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {versions?.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
                {v.version === meta.currentVersion ? " (current)" : ""} — {v.changeNote}
              </option>
            ))}
          </select>
        </div>

        {version && version.dependencies.length > 0 && (
          <div className="mb-3">
            <h2 className="mb-1 text-xs font-semibold uppercase text-slate-400">Dependencies</h2>
            <Markdown
              text={version.dependencies.map((d) => `- ${d}`).join("\n")}
              className="text-sm text-slate-600"
            />
          </div>
        )}

        {version && version.prerequisites.length > 0 && (
          <div className="mb-3">
            <h2 className="mb-1 text-xs font-semibold uppercase text-slate-400">Prerequisites</h2>
            <Markdown
              text={version.prerequisites.map((p) => `- ${p}`).join("\n")}
              className="text-sm text-slate-600"
            />
          </div>
        )}

        {version && version.steps.length > 0 && (
          <h2 className="mb-1 flex items-baseline gap-2 text-xs font-semibold uppercase text-slate-400">
            <span>Steps</span>
            <span className="font-normal normal-case text-slate-400">
              {version.steps.length} total
              {version.steps.some((s) => s.quick) &&
                ` · ${version.steps.filter((s) => s.quick).length} quick`}
            </span>
          </h2>
        )}

        <ol className="space-y-2">
          {version?.steps.map((s, i) => (
            <li key={s.id} className="rounded border border-slate-200 p-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">#{i + 1}</span>
                <span className="flex-1 font-medium text-slate-800">{s.title}</span>
                {s.quick && (
                  <span
                    className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                    title="Runs in a quick run as well as a full one"
                  >
                    quick
                  </span>
                )}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    s.type === "automated"
                      ? "bg-violet-100 text-violet-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {s.type}
                </span>
              </div>
              {s.selectors.map((sel, si) => (
                <code
                  key={`${si}-${sel}`}
                  className={`mt-1 block text-[10px] ${
                    si === 0 ? "text-amber-600" : "text-amber-600/60"
                  }`}
                >
                  {s.selectors.length > 1 ? `${si + 1}. ${sel}` : sel}
                </code>
              ))}
              {s.instructions && (
                <Markdown text={s.instructions} className="mt-1 text-xs text-slate-500" />
              )}
              {s.type === "automated" && s.script && (
                <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">
                  {s.script}
                </pre>
              )}
              {s.expected && (
                <div className="mt-1 text-xs text-slate-500">
                  <span className="font-medium text-slate-600">Expected:</span>
                  <Markdown text={s.expected} className="text-xs text-slate-500" />
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="flex gap-2 border-t border-slate-200 p-3">
        <button
          onClick={startRun}
          disabled={busy || meta.archived}
          className="flex-1 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Start run
        </button>
        <button
          onClick={onEdit}
          className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Edit
        </button>
        <button
          onClick={onHistory}
          className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Runs
        </button>
        <button
          onClick={toggleArchive}
          disabled={busy}
          className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          {meta.archived ? "Unarchive" : "Archive"}
        </button>
      </div>
    </div>
  );
}
