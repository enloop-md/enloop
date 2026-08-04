import { useEffect, useState } from "react";
import {
  generateVariableValue,
  parseCaseDocument,
  VARIABLE_GENERATOR_LABELS,
  type RunTier,
  type TestCaseMeta,
  type TestCaseVariable,
  type TestCaseVersion,
  type VersionSummary,
} from "@tcm/shared";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Header } from "../../components/Header.js";
import { Markdown } from "../../components/Markdown.js";
import { useReadyStore } from "../store/DataStoreProvider.js";
import { getActivePageUrl } from "../../lib/automation.js";

export function CaseDetailScreen({
  testCaseId,
  onBack,
  onEdit,
  onRunStarted,
  onHistory,
  onSettings,
}: {
  testCaseId: string;
  onBack: () => void;
  onEdit: () => void;
  onRunStarted: (runId: string) => void;
  onHistory: () => void;
  onSettings: () => void;
}) {
  const store = useReadyStore();
  const [meta, setMeta] = useState<TestCaseMeta | null>(null);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [version, setVersion] = useState<TestCaseVersion | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // What a run of the current version would actually execute: the case
  // merged with its suite. Loaded here so starting a run never has to stop
  // and ask — the values are already resolved and on screen.
  const [variables, setVariables] = useState<TestCaseVariable[]>([]);
  const [runStepCounts, setRunStepCounts] = useState({ total: 0, quick: 0 });
  // Previews only. Nothing here is passed to `createRun` unless the tester
  // typed it: a generated value regenerates at start, so a %TIMESTAMP% is
  // the moment the run began rather than the moment this screen opened.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [valuesOpen, setValuesOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([store.getTestCase(testCaseId), store.listVersions(testCaseId)])
      .then(([m, v]) => {
        if (cancelled) return;
        setMeta(m);
        setVersions(v);
        setSelectedVersion(m.currentVersion);
      })
      .catch((e) => !cancelled && setError(e));
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
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId, selectedVersion]);

  // Resolve what the run would use, for display. A separate effect from the
  // metadata load because it depends on the current version being known.
  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    (async () => {
      const [runSource, pageUrl] = await Promise.all([
        store.getRunSource(testCaseId, meta.currentVersion),
        getActivePageUrl().catch(() => undefined),
      ]);
      if (cancelled) return;
      const doc = parseCaseDocument(runSource, {
        version: meta.currentVersion,
        createdAt: new Date().toISOString(),
      });
      setVariables(doc.variables);
      setRunStepCounts({ total: doc.steps.length, quick: doc.steps.filter((s) => s.quick).length });
      const seeded: Record<string, string> = {};
      for (const v of doc.variables) seeded[v.name] = generateVariableValue(v, { pageUrl });
      setPreviews(seeded);
    })().catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId, meta?.currentVersion]);

  async function startRun(tier: RunTier) {
    if (!meta) return;
    setBusy(true);
    setError(null);
    try {
      // Generators run now, not when the screen opened, and page-url ones
      // read the tab as it is at this moment — the store resolves variables
      // without any page context, so anything needing it is resolved here.
      const pageUrl = await getActivePageUrl().catch(() => undefined);
      const values: Record<string, string> = {};
      for (const v of variables) {
        values[v.name] = edited[v.name] ?? generateVariableValue(v, { pageUrl });
      }
      const run = await store.createRun(testCaseId, meta.currentVersion, values, tier);
      onRunStarted(run.id);
    } catch (e) {
      setError(e);
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
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!meta) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Test case" onBack={onBack} onSettings={onSettings} />
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
      <Header title={meta.title} onBack={onBack} onSettings={onSettings} />
      <div className="flex-1 overflow-y-auto p-3">
        <ErrorNotice error={error} className="mb-2" />
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
                {s.type === "automated" && (
                  <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700">
                    automated
                  </span>
                )}
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

      <div className="border-t border-slate-200">
        {variables.length > 0 && (
          <RunValues
            variables={variables}
            previews={previews}
            edited={edited}
            open={valuesOpen}
            onToggle={() => setValuesOpen((o) => !o)}
            onChange={(name, value) => setEdited((prev) => ({ ...prev, [name]: value }))}
            onReset={(name) =>
              setEdited((prev) => {
                const next = { ...prev };
                delete next[name];
                return next;
              })
            }
          />
        )}
        <div className="space-y-2 p-3">
          <div className="flex gap-2">
            <button
              onClick={() => startRun("full")}
              disabled={busy || meta.archived}
              className="flex-1 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Start run
            </button>
            {/* Only a choice when the case draws the distinction: with no
                quick steps, or with every step quick, the two tiers run the
                same thing and the second button is a decision about nothing. */}
            {runStepCounts.quick > 0 && runStepCounts.quick < runStepCounts.total && (
              <button
                onClick={() => startRun("quick")}
                disabled={busy || meta.archived}
                title={`Runs only the ${runStepCounts.quick} steps marked Kind: quick. A quick pass is not a full pass.`}
                className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                Quick ({runStepCounts.quick})
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onEdit}
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Edit
            </button>
            <button
              onClick={onHistory}
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Runs
            </button>
            <button
              onClick={toggleArchive}
              disabled={busy}
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {meta.archived ? "Unarchive" : "Archive"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The values a run will substitute for `%NAME%`, folded into the screen you
 * start the run from. This used to be a screen of its own between "Start
 * run" and step 1, which made every variable a gate: a form to read and
 * agree to before the run could begin, on cases where the pre-filled values
 * were right every time. Here it is collapsed by default and the run starts
 * without it — the values are still editable, they just no longer stand in
 * the way of the thing the tester came to do.
 */
function RunValues({
  variables,
  previews,
  edited,
  open,
  onToggle,
  onChange,
  onReset,
}: {
  variables: TestCaseVariable[];
  previews: Record<string, string>;
  edited: Record<string, string>;
  open: boolean;
  onToggle: () => void;
  onChange: (name: string, value: string) => void;
  onReset: (name: string) => void;
}) {
  const missing = variables.filter((v) => !(edited[v.name] ?? previews[v.name] ?? "").trim());

  return (
    <div className="border-b border-slate-100 bg-slate-50">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-slate-500 hover:bg-slate-100"
      >
        <span
          className={`text-[10px] transition-transform duration-200 ${
            open ? "rotate-90 text-slate-500" : "text-slate-300"
          }`}
          aria-hidden="true"
        >
          ▸
        </span>
        <span className="flex-1">
          {variables.length} value{variables.length === 1 ? "" : "s"} for this run
          {missing.length > 0 && (
            <span className="text-amber-600"> · {missing.length} with no value</span>
          )}
        </span>
        <span className="text-sky-600">{open ? "Hide" : "Edit"}</span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden" inert={!open}>
          <div className="space-y-2.5 px-3 pb-3">
            {variables.map((v) => {
              const isEdited = v.name in edited;
              const value = edited[v.name] ?? previews[v.name] ?? "";
              return (
                <div key={v.name} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-slate-600">%{v.name}%</label>
                    {isEdited ? (
                      <button
                        onClick={() => onReset(v.name)}
                        className="shrink-0 text-[10px] text-sky-600 hover:underline"
                      >
                        ↺ back to auto
                      </button>
                    ) : (
                      v.generator && (
                        <span className="shrink-0 text-[10px] text-slate-400">
                          {VARIABLE_GENERATOR_LABELS[v.generator]} · fresh at start
                        </span>
                      )
                    )}
                  </div>
                  {v.description && <p className="text-[11px] text-slate-400">{v.description}</p>}
                  <input
                    value={value}
                    onChange={(e) => onChange(v.name, e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                  />
                  {!value.trim() && (
                    <p className="text-[10px] text-amber-600">
                      No value — steps keep the literal %{v.name}% rather than a blank.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
