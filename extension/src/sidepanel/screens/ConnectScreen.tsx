import type { ReactNode } from "react";
import { useDataStore } from "../store/DataStoreProvider.js";

const DOCS_URL = "https://github.com/enloop-me/enloop#readme";

/**
 * The first thing anyone sees, and — because Chrome drops File System Access
 * grants when it restarts — a screen regulars come back to often. Those are
 * two different audiences, so they get two different screens rather than one
 * that hedges: a first-timer is being asked to hand a browser extension
 * write access to a directory and deserves to know what lands in it, while
 * someone returning tomorrow morning needs to know that nothing is wrong and
 * that one click fixes it.
 */
export function ConnectScreen() {
  const { connection, connect, reconnect } = useDataStore();

  if (connection.status === "checking") {
    return <Centered>Loading…</Centered>;
  }

  if (connection.status === "needs-permission") {
    return (
      <Centered>
        <h1 className="text-lg font-semibold text-slate-800">Welcome back</h1>
        <p className="text-sm text-slate-600">
          Chrome asks for folder permission again each time it restarts.
        </p>
        <button
          onClick={reconnect}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Reconnect <span className="font-mono">{connection.folderName}</span>
        </button>
        <p className="text-xs text-slate-400">
          Your cases and runs are untouched — this only restores Enloop's access to them.
        </p>
      </Centered>
    );
  }

  return (
    <Centered>
      <h1 className="text-lg font-semibold text-slate-800">Enloop</h1>
      <p className="text-sm text-slate-600">
        Pick a folder on this machine. Enloop keeps your test cases and run reports there as
        plain Markdown — no server, no account, nothing uploaded.
      </p>
      <div className="w-full rounded border border-slate-200 bg-slate-50 p-2.5 text-left text-xs text-slate-500">
        <p className="mb-1 font-medium text-slate-600">It creates three folders inside:</p>
        <ul className="space-y-0.5 font-mono text-[11px]">
          <li>test-cases/ — cases and suites</li>
          <li>runs/ — one folder per run</li>
          <li>free-runs/ — unscripted sessions</li>
        </ul>
        <p className="mt-1.5 font-sans">An empty folder is a fine place to start.</p>
      </div>
      {connection.status === "error" && (
        <p className="text-sm text-red-600">{connection.message}</p>
      )}
      <button
        onClick={connect}
        className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
      >
        Connect folder…
      </button>
      <p className="text-xs text-slate-400">
        Cases are written by the Claude Code skills, and run here. You can load an example case
        once a folder is connected.{" "}
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-sky-600 hover:underline"
        >
          How Enloop works ↗
        </a>
      </p>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto p-6 text-center">
      {children}
    </div>
  );
}
