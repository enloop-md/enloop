import { useState } from "react";
import { PANEL_THEMES, readTheme, saveTheme } from "../lib/theme.js";

/**
 * The colour swatches: one tap applies and remembers a theme. Lives in the
 * header's settings popover rather than on the Settings screen, because
 * the moment someone wants a different colour is mid-run, and a run is
 * not a screen to leave.
 */
export function ThemePicker() {
  const [current, setCurrent] = useState(readTheme);
  const selected = PANEL_THEMES.find((t) => t.id === current);
  return (
    <div className="space-y-1.5" role="radiogroup" aria-label="Panel colour">
      <div className="flex items-center justify-between text-[10px] uppercase text-slate-400">
        <span>Panel colour</span>
        <span className="normal-case text-slate-500">{selected?.label}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PANEL_THEMES.map((theme) => {
          const active = theme.id === current;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={theme.label}
              title={theme.label}
              onClick={() => {
                saveTheme(theme.id);
                setCurrent(theme.id);
              }}
              className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                active ? "ring-2 ring-sky-500 ring-offset-1" : ""
              }`}
              style={{ backgroundColor: theme.swatch.bg, borderColor: theme.swatch.fg }}
            />
          );
        })}
      </div>
    </div>
  );
}
