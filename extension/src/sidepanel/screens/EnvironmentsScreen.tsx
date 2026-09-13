import { useEffect, useMemo, useState } from "react";
import {
  describeReach,
  endOfDayIso,
  isLayoutFolderName,
  missingEnvironmentValues,
  newEnvironmentId,
  type Environment,
  type EnvironmentsFile,
} from "@tcm/shared";
import { ErrorNotice } from "../../components/ErrorNotice.js";
import { Header } from "../../components/Header.js";
import { useWorkspace } from "../store/DataStoreProvider.js";

/**
 * One storage's environments: the domains and variables the project agrees
 * to provide, and each deployment's values for them.
 *
 * The names are edited once, at the top, and every environment below shows
 * the same rows — that is the point. An environment missing a value shows an
 * empty input, not an absent row, so "staging never got the admin console's
 * address" is a visible hole here instead of a surprise mid-run.
 *
 * Deployments that exist for an afternoon — a Shipyard preview, a
 * colleague's tunnel — go under *Temporary*: they are written to
 * `environments.local.json`, which is git-ignored, and each carries an
 * expiry, so a committed file never learns about them and the list does
 * not grow a graveyard of dead previews.
 *
 * A deployment's *reach* — how an agent gets to its data — is shown but
 * never edited here. Only the validator opens a tunnel or runs a probe; the
 * panel has no business holding that much of a developer's machine.
 *
 * The authoring skills write this same file (`enloop-case.mjs environments`)
 * when they derive a deployment from the repo, so what shows up here is
 * often already filled in by the time anyone opens it.
 */
export function EnvironmentsScreen({
  storageId,
  onBack,
}: {
  storageId: string;
  onBack: () => void;
}) {
  const { storages, getEnvironmentsIn, saveEnvironmentsIn } = useWorkspace();
  const storage = storages.find((s) => s.id === storageId);
  const storageLabel = storage?.label ?? "storage";
  /** The label is the folder's `project.json` name once the registry has
   * resolved one; until then it is the directory name, which is only a
   * project name when it is not a layout name like `enloop.md`. */
  const projectName =
    storage?.kind === "fsa" && !isLayoutFolderName(storage.label) ? storage.label : "";

  const [file, setFile] = useState<EnvironmentsFile | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [newDomain, setNewDomain] = useState("");
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

  function addName(kind: "domains" | "variables", raw: string) {
    if (!file) return;
    const name = normalizeVariableName(raw);
    if (!name || file.domains.includes(name) || file.variables.includes(name)) return;
    (kind === "domains" ? setNewDomain : setNewVariable)("");
    void update({ ...file, [kind]: [...file[kind], name] });
  }

  function removeName(kind: "domains" | "variables", name: string) {
    if (!file) return;
    // The name leaves the contract; stored values stay in each environment
    // untouched, so re-adding the name later brings them back.
    void update({ ...file, [kind]: file[kind].filter((v) => v !== name) });
  }

  function addEnvironment() {
    if (!file) return;
    const name = nextEnvironmentName(file.environments);
    void update({
      ...file,
      environments: [
        ...file.environments,
        { id: newEnvironmentId(), name, domains: {}, values: {} },
      ],
    });
  }

  /** A temporary environment: this machine only, gone at the end of today
   * unless its date is moved. It takes the storage's project so the picker
   * offers it to this folder's cases without anyone typing the name. */
  function addTemporaryEnvironment() {
    if (!file) return;
    const name = nextEnvironmentName(file.environments);
    void update({
      ...file,
      environments: [
        ...file.environments,
        {
          id: newEnvironmentId(),
          name,
          project: projectName || undefined,
          local: true,
          expires: endOfDayIso(),
          domains: {},
          values: {},
        },
      ],
    });
  }

  function patchEnvironment(id: string, patch: Partial<Environment>) {
    if (!file) return;
    void update({
      ...file,
      environments: file.environments.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }

  /** One default per project scope: flagging this one unflags its
   * siblings — the ones a case of the same project would also be offered. */
  function makeDefault(id: string, on: boolean) {
    if (!file) return;
    const target = file.environments.find((e) => e.id === id);
    if (!target) return;
    const scope = (target.project ?? "").trim().toLowerCase();
    void update({
      ...file,
      environments: file.environments.map((e) => {
        if (e.id === id) return { ...e, default: on || undefined };
        const theirs = (e.project ?? "").trim().toLowerCase();
        return on && (theirs === scope || !theirs || !scope) ? { ...e, default: undefined } : e;
      }),
    });
  }

  function removeEnvironment(id: string) {
    if (!file) return;
    void update({ ...file, environments: file.environments.filter((e) => e.id !== id) });
  }

  // `local` is what the store stamped on read from which file an entry
  // came; the split on save follows the same flag, so the two lists here
  // are the two files.
  const shared = file?.environments.filter((e) => !e.local) ?? [];
  const temporary = file?.environments.filter((e) => e.local) ?? [];

  return (
    <div className="flex h-full flex-col">
      <Header title={`Environments — ${storageLabel}`} onBack={onBack} />
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <p className="text-xs text-slate-400">
          An environment is a deployment of the app this folder tests — local, staging, prod, a
          customer's instance — as the addresses of the domains a case declares, plus any values
          that differ between deployments. Picking one before a run sets all of them at once; the
          values stay editable, and a run can always go without one and follow the tab you have
          open.
        </p>
        {error != null && <ErrorNotice error={error} />}
        {file && (
          <>
            <NameContract
              title="Domains every environment provides"
              empty={
                <>
                  None yet. Add the domain names your cases declare — <code>APP</code>,{" "}
                  <code>ADMIN</code> — and each environment below gains an address field for
                  them. The first is the main domain.
                </>
              }
              names={file.domains}
              value={newDomain}
              placeholder="APP"
              onValue={setNewDomain}
              onAdd={() => addName("domains", newDomain)}
              onRemove={(name) => removeName("domains", name)}
              canAdd={!!normalizeVariableName(newDomain)}
            />
            <NameContract
              title="Variables every environment provides"
              empty={
                <>
                  None yet. Add the names that differ per deployment — <code>QA_EMAIL</code>,{" "}
                  <code>TENANT_ID</code> — and each environment below gains a field for them.
                </>
              }
              names={file.variables}
              value={newVariable}
              placeholder="QA_EMAIL"
              onValue={setNewVariable}
              onAdd={() => addName("variables", newVariable)}
              onRemove={(name) => removeName("variables", name)}
              canAdd={!!normalizeVariableName(newVariable)}
            />

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase text-slate-400">
                Environments ({shared.length})
              </h2>
              {shared.map((env) => (
                <EnvironmentCard
                  key={env.id}
                  env={env}
                  domains={file.domains}
                  variables={file.variables}
                  missing={missingEnvironmentValues(file, env)}
                  onPatch={(patch) => patchEnvironment(env.id, patch)}
                  onDefault={(on) => makeDefault(env.id, on)}
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

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase text-slate-400">
                Temporary ({temporary.length})
              </h2>
              <p className="text-xs text-slate-400">
                This machine only, never committed. Each one expires; expired ones disappear.
              </p>
              {temporary.map((env) => (
                <EnvironmentCard
                  key={env.id}
                  env={env}
                  domains={file.domains}
                  variables={file.variables}
                  missing={missingEnvironmentValues(file, env)}
                  onPatch={(patch) => patchEnvironment(env.id, patch)}
                  onRemove={() => removeEnvironment(env.id)}
                />
              ))}
              <button
                onClick={addTemporaryEnvironment}
                className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Add temporary…
              </button>
            </section>

            {savedAt != null && (
              <p className="text-center text-[10px] text-slate-300">
                Saved to environments.json in this folder
                {temporary.length > 0 ? "; temporary ones to environments.local.json" : ""}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** One of the two name lists at the top — the shape every environment has. */
function NameContract({
  title,
  empty,
  names,
  value,
  placeholder,
  canAdd,
  onValue,
  onAdd,
  onRemove,
}: {
  title: string;
  empty: React.ReactNode;
  names: string[];
  value: string;
  placeholder: string;
  canAdd: boolean;
  onValue: (v: string) => void;
  onAdd: () => void;
  onRemove: (name: string) => void;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase text-slate-400">{title}</h2>
      {names.length === 0 && <p className="text-xs text-slate-400">{empty}</p>}
      <div className="flex flex-wrap gap-1.5">
        {names.map((name, index) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700"
          >
            %{name}%
            {placeholder === "APP" && index === 0 && (
              <span className="font-sans text-[9px] text-slate-400">main</span>
            )}
            <button
              onClick={() => onRemove(name)}
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
          value={value}
          onChange={(e) => onValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAdd()}
          placeholder={placeholder}
          className="flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
        />
        <button
          onClick={onAdd}
          disabled={!canAdd}
          className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </section>
  );
}

/** One deployment's card: its name, which project it belongs to, whether
 * it is the default, and a value per declared domain and variable.
 *
 * A temporary card (no `onDefault`) trades the default toggle for an
 * expiry date: a preview that lasts an afternoon is never what a run
 * should start on by itself, and the date is the only thing about it that
 * changes after it is written. */
function EnvironmentCard({
  env,
  domains,
  variables,
  missing,
  onPatch,
  onDefault,
  onRemove,
}: {
  env: Environment;
  domains: string[];
  variables: string[];
  missing: string[];
  onPatch: (patch: Partial<Environment>) => void;
  /** Absent on a temporary environment, which can never be the default. */
  onDefault?: (on: boolean) => void;
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
      <div className="flex items-center gap-2">
        <input
          value={env.project ?? ""}
          onChange={(e) => onPatch({ project: e.target.value || undefined })}
          placeholder="every project in this folder"
          title="The @project this environment belongs to. Leave empty to offer it to every case in the folder."
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
        />
        {onDefault ? (
          <>
            <label
              className="flex shrink-0 items-center gap-1 text-[11px] text-slate-600"
              title="Pre-selected for a run when nothing was remembered, and the addresses the authoring skills write into each domain's Default:"
            >
              <input
                type="checkbox"
                checked={!!env.default}
                onChange={(e) => onDefault(e.target.checked)}
              />
              default
            </label>
            <label
              className="flex shrink-0 items-center gap-1 text-[11px] text-slate-600"
              title="Real people's data. The skills only look values up here when told to, and never record what they find."
            >
              <input
                type="checkbox"
                checked={!!env.production}
                onChange={(e) => onPatch({ production: e.target.checked || undefined })}
              />
              production
            </label>
          </>
        ) : (
          <label
            className="flex shrink-0 items-center gap-1 text-[11px] text-slate-600"
            title="Gone after the end of this day, local time. Move the date to keep it longer."
          >
            until
            <input
              type="date"
              value={(env.expires ?? "").slice(0, 10)}
              onChange={(e) => onPatch({ expires: endOfDayIso(e.target.value || undefined) })}
              className="rounded border border-slate-300 px-1 py-0.5 text-[11px]"
            />
          </label>
        )}
      </div>
      {env.reach && (
        <div className="space-y-0.5">
          <p
            className="truncate font-mono text-[11px] text-slate-600"
            title={env.reach.verifyError ?? describeReach(env.reach)}
          >
            {describeReach(env.reach)}
          </p>
          <p className="text-[10px] text-slate-400">
            Set from the repo with /enloop:setup environments; the panel never opens tunnels.
          </p>
        </div>
      )}
      {domains.map((name, index) => (
        <div key={`d-${name}`} className="space-y-0.5">
          <label className="font-mono text-[11px] text-slate-500">
            %{name}%{" "}
            <span className="font-sans text-[10px] text-slate-400">
              {index === 0 ? "main domain" : "domain"}
            </span>
          </label>
          <input
            value={env.domains[name] ?? ""}
            onChange={(e) => onPatch({ domains: { ...env.domains, [name]: e.target.value } })}
            placeholder="https://… — no value: runs fall back to the case's default"
            className={`w-full rounded border px-2 py-1 text-sm ${
              missingSet.has(name) ? "border-amber-300 bg-amber-50/40" : "border-slate-300"
            }`}
          />
        </div>
      ))}
      {variables.map((name) => (
        <div key={`v-${name}`} className="space-y-0.5">
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

/** Names follow the case grammar's convention — `%LIKE_THIS%`. Uppercased
 * here so the same name typed twice differently cannot create two entries
 * that look identical in prose. */
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
