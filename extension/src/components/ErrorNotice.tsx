import { describeError, isFolderAccessError } from "../lib/errors.js";

/**
 * The one place a caught error becomes something on screen. Screens keep the
 * error they caught rather than a string, so this can look at it: a folder
 * whose permission lapsed is not just a different sentence from a parse
 * failure, so it says which one it is and where the fix lives — which, now
 * that several folders can be connected at once, is a per-storage control in
 * the Library or Settings rather than a button here that could not say which
 * folder it meant.
 */
export function ErrorNotice({ error, className = "" }: { error: unknown; className?: string }) {
  if (error == null) return null;

  return (
    <div className={`space-y-1.5 ${className}`}>
      <p className="text-sm text-red-600">{describeError(error)}</p>
      {isFolderAccessError(error) && (
        <p className="text-xs text-red-500">
          Reconnect that folder from Settings → Storages, or from the banner in the Library.
        </p>
      )}
    </div>
  );
}
