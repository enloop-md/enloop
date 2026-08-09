import { useState } from "react";
import { CaptureToggles } from "../../components/CaptureToggles.js";
import { Header } from "../../components/Header.js";
import { useWorkspace } from "../store/DataStoreProvider.js";
import { useCaptureSettings } from "../useCapture.js";
import { getBuildInfo } from "../../lib/build-info.js";
import { relativeTime } from "../../lib/time.js";

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { storages, addStorage, removeStorage, renameStorage, reconnect } = useWorkspace();
  const build = getBuildInfo();

  return (
    <div className="flex h-full flex-col">
      <Header title="Settings" onBack={onBack} />
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase text-slate-400">
            Storages ({storages.length})
          </h2>
          <p className="text-xs text-slate-400">
            Every connected folder is live at once — the Library lists them all and lets you
            filter. A folder inside an app repo keeps its cases with the code; Enloop writes a{" "}
            <code>.gitignore</code> so run history stays local.
          </p>
          {storages.map((storage) => (
            <StorageRow
              key={storage.id}
              storage={storage}
              onRename={(label) => void renameStorage(storage.id, label)}
              onReconnect={() => void reconnect(storage.id)}
              onRemove={() => void removeStorage(storage.id)}
            />
          ))}
          <button
            onClick={() => void addStorage()}
            className="w-full rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Add a folder…
          </button>
        </section>

        <CaptureSection />

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase text-slate-400">Remote (coming later)</h2>
          <div className="rounded border border-dashed border-slate-300 p-3 text-sm text-slate-400">
            Point at a server URL to share data across machines. Not built yet — the storage
            layer is written against a swappable interface so this can be added without changing
            the rest of the app.
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase text-slate-400">About</h2>
          <dl className="rounded border border-slate-200 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-slate-500">Enloop</dt>
              <dd className="font-medium text-slate-800">v{build.version}</dd>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <dt className="text-slate-500">Built</dt>
              {/* The field to check after reloading at chrome://extensions:
                  relative for the glance, exact on hover for when it matters. */}
              <dd className="font-medium text-slate-800" title={build.builtAt}>
                {relativeTime(build.builtAt) || build.builtAt}
              </dd>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <dt className="text-slate-500">Case grammar</dt>
              <dd className="font-mono text-xs text-slate-600">{build.formatVersion}</dd>
            </div>
          </dl>
          <p className="text-xs text-slate-400">
            After rebuilding, reload the extension at <code>chrome://extensions</code> and reopen
            this panel — if <em>Built</em> has not changed, the reload did not take.
          </p>
        </section>
      </div>
    </div>
  );
}

/**
 * What the page says about itself, kept with the run.
 *
 * The same two checkboxes stand in front of every run, which is where they are
 * actually decided; this is where they can be read about. Off by default,
 * because console output can contain tokens and customer data and runs are
 * written to a folder people commit.
 */
function CaptureSection() {
  const capture = useCaptureSettings();

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase text-slate-400">Capture during runs</h2>
      <CaptureToggles
        settings={capture.settings}
        wrapper={capture.wrapper}
        onChange={capture.set}
        className="rounded border border-slate-200 p-3 text-sm"
      />
    </section>
  );
}

/**
 * One connected folder. The folder name sits under the label because Chrome
 * reports a name and never a path — with two directories both called
 * `test-cases`, the label you gave it is the only thing that tells them apart.
 */
function StorageRow({
  storage,
  onRename,
  onReconnect,
  onRemove,
}: {
  storage: { id: string; label: string; folderName: string; permission: string };
  onRename: (label: string) => void;
  onReconnect: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(storage.label);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="rounded border border-slate-200 p-3 text-sm">
      {editing ? (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            onClick={() => {
              onRename(draft);
              setEditing(false);
            }}
            className="rounded bg-slate-800 px-2 py-1 text-xs text-white"
          >
            Save
          </button>
        </div>
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="flex-1 truncate font-medium text-slate-800">{storage.label}</span>
          {storage.permission !== "granted" && (
            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
              {storage.permission === "missing" ? "not found" : "needs permission"}
            </span>
          )}
        </div>
      )}
      <p className="mt-0.5 font-mono text-[11px] text-slate-400">{storage.folderName}/</p>

      <div className="mt-2 flex flex-wrap gap-2">
        {storage.permission !== "granted" && (
          <button
            onClick={onReconnect}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Reconnect
          </button>
        )}
        <button
          onClick={() => setEditing((e) => !e)}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Rename
        </button>
        {confirming ? (
          <>
            <button
              onClick={onRemove}
              className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
            >
              Forget it
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
            >
              Cancel
            </button>
            <p className="w-full text-[11px] text-slate-500">
              Enloop forgets this folder. Nothing inside it is deleted.
            </p>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
