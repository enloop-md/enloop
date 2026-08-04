import { useEffect, useState } from "react";
import {
  generateVariableValue,
  parseCaseDocument,
  VARIABLE_GENERATOR_LABELS,
  type RunTier,
  type TestCaseVariable,
} from "@tcm/shared";
import { Header } from "../../components/Header.js";
import { useReadyStore } from "../store/DataStoreProvider.js";
import { getActivePageUrl } from "../../lib/automation.js";

export function RunSetupScreen({
  testCaseId,
  version,
  onBack,
  onRunStarted,
  onSettings,
}: {
  testCaseId: string;
  version: number;
  onBack: () => void;
  onRunStarted: (runId: string) => void;
  onSettings: () => void;
}) {
  const store = useReadyStore();
  const [variables, setVariables] = useState<TestCaseVariable[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [pageUrl, setPageUrl] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepCounts, setStepCounts] = useState({ total: 0, quick: 0 });
  const [tier, setTier] = useState<RunTier>("full");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [runSource, url] = await Promise.all([
        store.getRunSource(testCaseId, version),
        getActivePageUrl().catch(() => undefined),
      ]);
      if (cancelled) return;
      const doc = parseCaseDocument(runSource, { version, createdAt: new Date().toISOString() });
      setPageUrl(url);
      setVariables(doc.variables);
      setStepCounts({ total: doc.steps.length, quick: doc.steps.filter((s) => s.quick).length });
      const initial: Record<string, string> = {};
      for (const v of doc.variables) {
        initial[v.name] = v.generator
          ? generateVariableValue(v, { pageUrl: url })
          : (v.defaultValue ?? "");
      }
      setValues(initial);
    })().catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [store, testCaseId, version]);

  function regenerate(v: TestCaseVariable) {
    setValues((prev) => ({ ...prev, [v.name]: generateVariableValue(v, { pageUrl }) }));
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const run = await store.createRun(testCaseId, version, values, tier);
      onRunStarted(run.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!variables) {
    return (
      <div className="flex h-full flex-col">
        <Header title="Run setup" onBack={onBack} onSettings={onSettings} />
        <p className="p-3 text-sm text-slate-400">{error ?? "Loading…"}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header title="Run setup" onBack={onBack} onSettings={onSettings} />
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {/* Only worth a choice when the case actually distinguishes the two.
            A case with no quick steps, or one where every step is quick, has
            a single meaningful coverage level and picking is busywork. */}
        {stepCounts.quick > 0 && stepCounts.quick < stepCounts.total && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-600">Coverage</p>
            <div className="grid grid-cols-2 gap-2">
              <TierChoice
                selected={tier === "quick"}
                onSelect={() => setTier("quick")}
                label="Quick"
                detail={`${stepCounts.quick} core step${stepCounts.quick === 1 ? "" : "s"}`}
              />
              <TierChoice
                selected={tier === "full"}
                onSelect={() => setTier("full")}
                label="Full"
                detail={`all ${stepCounts.total} steps`}
              />
            </div>
            {tier === "quick" && (
              <p className="text-[11px] text-slate-400">
                Suite prep steps still run. A quick pass is not a full pass — the report says
                which this was.
              </p>
            )}
          </div>
        )}
        {variables.length > 0 && (
          <p className="text-xs text-slate-500">
            These values replace every matching %NAME% placeholder in this run.
          </p>
        )}
        {variables.map((v) => (
          <div key={v.name} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-slate-600">%{v.name}%</label>
              {v.generator && (
                <button
                  onClick={() => regenerate(v)}
                  className="shrink-0 text-[10px] text-violet-600 hover:underline"
                >
                  ↻ {VARIABLE_GENERATOR_LABELS[v.generator]}
                </button>
              )}
            </div>
            {v.description && <p className="text-[11px] text-slate-400">{v.description}</p>}
            <input
              value={values[v.name] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 p-3">
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <button
          onClick={start}
          disabled={busy}
          className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Start {tier === "quick" ? "quick " : ""}run
        </button>
      </div>
    </div>
  );
}

function TierChoice({
  selected,
  onSelect,
  label,
  detail,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  detail: string;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded border px-2 py-1.5 text-left text-xs transition-colors ${
        selected
          ? "border-emerald-400 bg-emerald-50 text-emerald-800"
          : "border-slate-300 text-slate-600 hover:bg-slate-50"
      }`}
    >
      <span className="block font-medium">{label}</span>
      <span className={selected ? "text-emerald-700" : "text-slate-400"}>{detail}</span>
    </button>
  );
}
