import { describeError, isFolderAccessError } from "../lib/errors.js";
import { useDataStore } from "../sidepanel/store/DataStoreProvider.js";

/**
 * The one place a caught error becomes something on screen. Screens keep the
 * error they caught rather than a string, so this can look at it: a folder
 * whose permission lapsed is not just a different sentence from a parse
 * failure, it comes with a button that fixes it.
 */
export function ErrorNotice({ error, className = "" }: { error: unknown; className?: string }) {
  const { reconnect } = useDataStore();
  if (error == null) return null;

  return (
    <div className={`space-y-1.5 ${className}`}>
      <p className="text-sm text-red-600">{describeError(error)}</p>
      {isFolderAccessError(error) && (
        <button
          type="button"
          onClick={() => void reconnect()}
          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          Reconnect folder
        </button>
      )}
    </div>
  );
}
