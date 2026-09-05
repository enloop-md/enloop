import type { ReactNode } from "react";
import { ThemePicker } from "./ThemePicker.js";

export function Header({
  title,
  onBack,
  onSettings,
  actions,
}: {
  title: string;
  onBack?: () => void;
  onSettings?: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
      {onBack && (
        <button
          onClick={onBack}
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
          aria-label="Back"
        >
          ←
        </button>
      )}
      <h1 className="flex-1 truncate text-sm font-semibold text-slate-800">{title}</h1>
      {actions}
      {onSettings && (
        // Hovering the cog (or focusing it) opens the colour picker in
        // place; clicking still goes to Settings. The popover is padded
        // rather than offset so the pointer never crosses a gap that would
        // close it on the way down.
        <span className="group relative">
          <button
            onClick={onSettings}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Settings"
            aria-haspopup="true"
          >
            ⚙
          </button>
          <div className="invisible absolute right-0 top-full z-30 pt-1 opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
            <div className="w-56 rounded border border-slate-200 bg-white p-2 shadow-lg">
              <ThemePicker />
              <p className="mt-1.5 text-[10px] text-slate-400">Click ⚙ for all settings.</p>
            </div>
          </div>
        </span>
      )}
    </div>
  );
}
