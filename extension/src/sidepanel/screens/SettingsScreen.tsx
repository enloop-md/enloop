import { Header } from "../../components/Header.js";
import { useDataStore } from "../store/DataStoreProvider.js";

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { connection, connect, disconnect } = useDataStore();

  return (
    <div className="flex h-full flex-col">
      <Header title="Settings" onBack={onBack} />
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase text-slate-400">Storage</h2>
          <div className="rounded border border-slate-200 p-3 text-sm">
            <p className="text-slate-500">Mode</p>
            <p className="font-medium text-slate-800">Local folder (File System Access)</p>
          </div>
          {connection.status === "connected" && (
            <div className="rounded border border-slate-200 p-3 text-sm">
              <p className="text-slate-500">Connected folder</p>
              <p className="font-medium text-slate-800">{connection.folderName}</p>
              <button
                onClick={disconnect}
                className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Disconnect
              </button>
            </div>
          )}
          {connection.status !== "connected" && (
            <button
              onClick={connect}
              className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              Connect folder…
            </button>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase text-slate-400">Remote (coming later)</h2>
          <div className="rounded border border-dashed border-slate-300 p-3 text-sm text-slate-400">
            Point at a server URL to share data across machines. Not built yet — the storage
            layer is written against a swappable interface so this can be added without changing
            the rest of the app.
          </div>
        </section>
      </div>
    </div>
  );
}
