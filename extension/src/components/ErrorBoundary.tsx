import { Component, type ErrorInfo, type ReactNode } from "react";
import { clearNavStack } from "../lib/nav-state.js";

/**
 * The last line of defence for the panel as a whole.
 *
 * Without one, a single render-time throw — a case file with a shape no
 * component expected, a version that fails to load — leaves the side panel
 * blank with no controls at all, and no way back short of reinstalling.
 * Everything a run produces is already written to disk step by step, so the
 * honest recovery is also the simplest: say so, and offer to start again
 * from the Library.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Not user-facing, but the only record of what happened — the panel's
    // console is where a bug report starts.
    console.error("Enloop panel crashed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
        <h1 className="text-sm font-semibold text-slate-800">Something in the panel broke</h1>
        <p className="text-xs text-slate-500">
          Nothing was lost: runs are written to your folder as you go, so whatever you had marked
          is already on disk.
        </p>
        <pre className="max-h-40 overflow-auto rounded bg-slate-100 p-2 text-[11px] text-slate-600">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <button
            onClick={() => void clearNavStack().then(() => location.reload())}
            className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Back to Test Cases
          </button>
          <button
            onClick={() => location.reload()}
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Reload
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          If it keeps happening, the panel's console (right-click → Inspect) has the full stack.
        </p>
      </div>
    );
  }
}
