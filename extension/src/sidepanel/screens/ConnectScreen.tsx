import type { ReactNode } from "react";
import { useDataStore } from "../store/DataStoreProvider.js";

export function ConnectScreen() {
  const { connection, connect, reconnect } = useDataStore();

  if (connection.status === "checking") {
    return <Centered>Loading…</Centered>;
  }

  if (connection.status === "needs-permission") {
    return (
      <Centered>
        <p className="text-sm text-slate-600">
          Permission for <span className="font-medium">{connection.folderName}</span> needs to be
          re-granted.
        </p>
        <button
          onClick={reconnect}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Reconnect folder
        </button>
      </Centered>
    );
  }

  return (
    <Centered>
      <h1 className="text-lg font-semibold text-slate-800">Enloop</h1>
      <p className="text-sm text-slate-500">
        Pick a folder on disk to store test cases and runs as JSON files.
      </p>
      {connection.status === "error" && (
        <p className="text-sm text-red-600">{connection.message}</p>
      )}
      <button
        onClick={connect}
        className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
      >
        Connect folder…
      </button>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      {children}
    </div>
  );
}
