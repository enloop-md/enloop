import { requestSiteAccess, type PageAccess } from "../lib/page-access.js";

/**
 * Why the panel cannot act on the page, and — when that is fixable — the
 * button that fixes it.
 *
 * The grant call must be the first thing the click handler does, so nothing
 * is awaited in front of it: Chrome only honours `permissions.request`
 * while a user gesture is live, and an `await` beforehand spends it. That is
 * also why the access state is worked out earlier, by whatever action needed
 * it, and merely rendered here.
 *
 * Built from `span`s with display classes rather than `div`s so it can also
 * be rendered inline, inside the value chip that sits in a step's prose.
 */
export function PageAccessNotice({
  access,
  onGranted,
  className = "",
}: {
  access: PageAccess | null;
  onGranted: () => void;
  className?: string;
}) {
  if (!access || access.status === "ready") return null;

  if (access.status === "needs-grant") {
    return (
      <span
        className={`flex flex-wrap items-center gap-2 rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] text-sky-900 ${className}`}
      >
        <span className="flex-1">
          Enloop needs your permission to act on{" "}
          <span className="font-medium">{access.host}</span>. It is asked per site, and only
          once.
        </span>
        <button
          type="button"
          onClick={() => {
            void requestSiteAccess(access.origin).then((granted) => {
              if (granted) onGranted();
            });
          }}
          className="shrink-0 rounded bg-sky-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-500"
        >
          Grant access
        </button>
      </span>
    );
  }

  return (
    <span
      className={`block rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500 ${className}`}
    >
      {access.status === "no-tab"
        ? "No page open to act on — open the app in a tab first."
        : access.reason}
    </span>
  );
}
