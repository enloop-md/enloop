import type { ScreenshotPrefs } from "../sidepanel/useScreenshotPrefs.js";

/**
 * The one screenshot checkbox, wherever the tester meets it: Settings, in
 * front of a test run, and on the run itself. Same key everywhere — see
 * useScreenshotPrefs.ts for why a guide never asks.
 */
export function ScreenshotToggle({
  prefs,
  onChange,
  compact = false,
  className = "",
}: {
  prefs: ScreenshotPrefs;
  onChange: (next: ScreenshotPrefs) => void;
  /** The version that fits above a Start run button: short label, no blurb. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <label className={`${compact ? "flex items-center gap-1.5" : "flex items-start gap-2"} ${className}`}>
      <input
        type="checkbox"
        checked={prefs.onTests}
        onChange={(e) => onChange({ ...prefs, onTests: e.target.checked })}
        className={compact ? "" : "mt-0.5"}
      />
      {compact ? (
        <span className="text-xs text-slate-700">Screenshot tools on this run</span>
      ) : (
        <span>
          <span className="font-medium text-slate-800">Show screenshot tools on test runs</span>
          <span className="mt-0.5 block text-xs text-slate-500">
            Guides always show them — pictures are what a guide is made of. On a test they are
            hidden unless you tick this: the capture buttons, the delayed capture and the
            runner's photo slots under every step. Pictures already taken are always shown, and
            the keyboard shortcut and the page's context-menu capture keep working either way.
          </span>
        </span>
      )}
    </label>
  );
}
