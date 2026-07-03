import type { ReactNode } from "react";

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
        <button
          onClick={onSettings}
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
          aria-label="Settings"
        >
          ⚙
        </button>
      )}
    </div>
  );
}
