import type { ReactNode } from "react";
import { useDataStore } from "../store/DataStoreProvider.js";

const DOCS_URL = "https://github.com/enloop-me/enloop#readme";

/**
 * The screen for having nothing to show yet, in the two ways that happens.
 *
 * A first-timer is being asked to hand a browser extension write access to a
 * directory and deserves to know what lands in it. Someone returning the
 * morning after a Chrome restart needs to know that nothing is wrong and that
 * a click fixes it — and now that several folders can be connected, that they
 * lapse *independently*, so the reconnect is per folder.
 *
 * Once even one storage is granted this screen steps aside: the Library
 * renders what it can and raises a banner for the rest, which beats hiding
 * three working folders behind one stale grant.
 */
export function ConnectScreen() {
  const { state, storages, addStorage, reconnect } = useDataStore();

  if (state.status === "loading") {
    return <Centered>Loading…</Centered>;
  }

  const lapsed = storages.filter((s) => s.permission !== "granted");

  if (storages.length > 0) {
    return (
      <Centered>
        <h1 className="text-lg font-semibold text-slate-800">Welcome back</h1>
        <p className="text-sm text-slate-600">
          Chrome asks for folder permission again each time it restarts.
          {lapsed.length > 1 ? " Each folder is asked for separately." : ""}
        </p>
        <div className="w-full space-y-1.5">
          {lapsed.map((storage) => (
            <button
              key={storage.id}
              onClick={() => void reconnect(storage.id)}
              className="flex w-full items-center justify-between gap-2 rounded bg-slate-800 px-3 py-2 text-left text-sm font-medium text-white hover:bg-slate-700"
            >
              <span className="truncate">
                Reconnect <span className="font-mono">{storage.label}</span>
              </span>
              {storage.permission === "missing" && (
                <span className="shrink-0 text-[10px] font-normal text-slate-300">not found</span>
              )}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400">
          Your cases and runs are untouched — this only restores Enloop's access to them.
        </p>
        <button
          onClick={() => void addStorage()}
          className="text-xs text-sky-600 hover:underline"
        >
          Connect another folder…
        </button>
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
        <p className="mt-1.5 font-sans">
          An empty folder is a fine place to start — including one inside the repo you are
          testing, so cases are committed with the code. You can connect more later.
        </p>
      </div>
      {state.status === "error" && <p className="text-sm text-red-600">{state.message}</p>}
      <button
        onClick={() => void addStorage()}
        className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
      >
        Connect folder…
      </button>
      <p className="text-xs text-slate-400">
        Cases are written by the Enloop skills in Claude Code or Codex, and run here. You can
        load an example case once a folder is connected.{" "}
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
