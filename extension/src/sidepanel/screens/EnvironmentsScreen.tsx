import { useEffect, useMemo, useState } from "react";
import {
  missingEnvironmentValues,
  newEnvironmentId,
  type Environment,
  type EnvironmentsFile,
} from "@tcm/shared";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Header } from "../../components/Header.js";
import { useWorkspace } from "../store/DataStoreProvider.js";

/**
 * One storage's environments: the variable names the project agrees to
 * provide, and each deployment's values for them.
 *
 * The names are edited once, at the top, and every environment below shows
 * the same rows — that is the point. An environment missing a value shows an
 * empty input, not an absent row, so "staging never got the new service's
 * URL" is a visible hole here instead of a surprise mid-run. Deployments
 * whose values exist only per-PR (a Shipyard preview, a colleague's tunnel)
 * deliberately have no home on this screen: they are the "no environment,
 * type it in" path on the run screen.
 */
export function EnvironmentsScreen({
  storageId,
  onBack,
}: {
  storageId: string;
  onBack: () => void;
}) {
  const { storages, getEnvironmentsIn, saveEnvironmentsIn } = useWorkspace();
  const storageLabel = storages.find((s) => s.id === storageId)?.label ?? "storage";

  const [file, setFile] = useState<EnvironmentsFile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [newVariable, setNewVariable] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEnvironmentsIn(storageId)
      .then((f) => !cancelled && setFile(f))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per storage
  }, [storageId]);

  /** Every edit writes through — a 400px side panel is closed without
   * warning too often for an unsaved-changes model to survive contact. */
  async function update(next: EnvironmentsFile) {
    setFile(next);
    setError(null);
    try {
      await saveEnvironmentsIn(storageId, next);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e);
    }
  }

  function addVariable() {
    if (!file) return;
    const name = normalizeVariableName(newVariable);
    if (!name || file.variables.includes(name)) return;
    setNewVariable("");
    void update({ ...file, variables: [...file.variables, name] });
  }

  function removeVariable(name: string) {
    if (!file) return;
    // The name leaves the contract; stored values stay in each environment's
    // `values` untouched, so re-adding the name later brings them back.
    void update({ ...file, variables: file.variables.filter((v) => v !== name) });
  }

  function addEnvironment() {
    if (!file) return;
    const name = nextEnvironmentName(file.environments);
    void update({
      ...file,
      environments: [...file.environments, { id: newEnvironmentId(), name, values: {} }],
    });
  }

  function patchEnvironment(id: string, patch: Partial<Environment>) {
    if (!file) return;
    void update({
      ...file,
      environments: file.environments.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }

  function removeEnvironment(id: string) {
    if (!file) return;
    void update({ ...file, environments: file.environments.filter((e) => e.id !== id) });
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={`Environments — ${storageLabel}`} onBack={onBack} />
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <p className="text-xs text-slate-400">
          An environment is a named set of values — one per deployment of the app this folder
          tests. Picking one before a run fills the run's variables; the values stay editable,
          and a run can always go without one (a per-PR preview domain, for example, is typed
          in by hand).
        </p>
        {error != null && <ErrorNotice error={error} />}
        {file && (
          <>
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase text-slate-400">
                Variables every environment provides
              </h2>
              {file.variables.length === 0 && (
                <p className="text-xs text-slate-400">
                  None yet. Add the names your cases already use — <code>%DOMAIN%</code>,{" "}
                  <code>%API_URL%</code> — and each environment below gains a field for them.
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {file.variables.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700"
                  >
                    %{name}%
                    <button
                      onClick={() => removeVariable(name)}
                      title={`Remove ${name} from every environment's form (stored values are kept)`}
                      className="text-slate-400 hover:text-red-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newVariable}
                  onChange={(e) => setNewVariable(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addVariable()}
                  placeholder="DOMAIN"
                  className="flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
                />
                <button
                  onClick={addVariable}
                  disabled={!normalizeVariableName(newVariable)}
                  className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase text-slate-400">
                Environments ({file.environments.length})
              </h2>
              {file.environments.map((env) => (
                <EnvironmentCard
                  key={env.id}
                  env={env}
                  variables={file.variables}
                  missing={missingEnvironmentValues(file, env)}
                  onPatch={(patch) => patchEnvironment(env.id, patch)}
                  onRemove={() => removeEnvironment(env.id)}
                />
              ))}
              <button
                onClick={addEnvironment}
                className="w-full rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
              >
                Add an environment…
              </button>
            </section>

            {savedAt != null && (
              <p className="text-center text-[10px] text-slate-300">
                Saved to environments.json in this folder.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** One deployment's card: its name and a value per declared variable. */
function EnvironmentCard({
  env,
  variables,
  missing,
  onPatch,
  onRemove,
}: {
  env: Environment;
  variables: string[];
  missing: string[];
  onPatch: (patch: Partial<Environment>) => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const missingSet = useMemo(() => new Set(missing), [missing]);

  return (
    <div className="space-y-2 rounded border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <input
          value={env.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm font-medium"
        />
        {missing.length > 0 && (
          <span
            className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800"
            title={`No value for: ${missing.join(", ")}. A run can still pick this environment; the holes fall back to the case's own defaults.`}
          >
            {missing.length} empty
          </span>
        )}
        {confirming ? (
          <>
            <button
              onClick={onRemove}
              className="shrink-0 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Remove
          </button>
        )}
      </div>
      {variables.map((name) => (
        <div key={name} className="space-y-0.5">
          <label className="font-mono text-[11px] text-slate-500">%{name}%</label>
          <input
            value={env.values[name] ?? ""}
            onChange={(e) => onPatch({ values: { ...env.values, [name]: e.target.value } })}
            placeholder="no value — runs fall back to the case's default"
            className={`w-full rounded border px-2 py-1 text-sm ${
              missingSet.has(name) ? "border-amber-300 bg-amber-50/40" : "border-slate-300"
            }`}
          />
        </div>
      ))}
    </div>
  );
}

/** Variable names follow the case grammar's convention — `%LIKE_THIS%`.
 * Uppercased here so the same name typed twice differently cannot create
 * two variables that look identical in prose. */
function normalizeVariableName(raw: string): string {
  return raw
    .trim()
    .replace(/^%|%$/g, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

/** 'Environment 1', 'Environment 2', … — a placeholder the user renames. */
function nextEnvironmentName(existing: Environment[]): string {
  const taken = new Set(existing.map((e) => e.name));
  for (let i = 1; ; i++) {
    const name = `Environment ${i}`;
    if (!taken.has(name)) return name;
  }
}
