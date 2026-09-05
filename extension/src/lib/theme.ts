/**
 * The panel's colour, chosen from a small set and remembered per browser.
 *
 * Every theme is a re-tinted grey scale (see index.css), so the set is
 * curated for one property: nothing in it changes the contrast the panel
 * was designed with. A theme is applied as `data-theme` on <html>, read
 * back synchronously before the first render so a tinted panel never
 * flashes white. `localStorage` is the right store for it — a per-device
 * convenience, and the panel runs where storage may throw, so every access
 * is guarded and a lost preference is nothing.
 */
export interface PanelTheme {
  id: string;
  label: string;
  /** Swatch colours for the picker: the surface and the mid grey. */
  swatch: { bg: string; fg: string };
}

export const PANEL_THEMES: readonly PanelTheme[] = [
  { id: "slate", label: "Slate", swatch: { bg: "#fff", fg: "oklch(70.4% 0.04 256.8)" } },
  { id: "paper", label: "Paper", swatch: { bg: "oklch(99.2% 0.012 90)", fg: "oklch(70.4% 0.06 85)" } },
  { id: "sage", label: "Sage", swatch: { bg: "oklch(99.3% 0.008 150)", fg: "oklch(70.4% 0.052 150)" } },
  { id: "sky", label: "Sky", swatch: { bg: "oklch(99.3% 0.008 235)", fg: "oklch(70.4% 0.06 235)" } },
  { id: "lavender", label: "Lavender", swatch: { bg: "oklch(99.3% 0.009 305)", fg: "oklch(70.4% 0.056 300)" } },
  { id: "rose", label: "Rose", swatch: { bg: "oklch(99.3% 0.008 15)", fg: "oklch(70.4% 0.052 15)" } },
  { id: "graphite", label: "Graphite", swatch: { bg: "#fff", fg: "oklch(70.4% 0 0)" } },
  { id: "dark", label: "Dark", swatch: { bg: "oklch(21% 0.025 260)", fg: "oklch(68% 0.02 255)" } },
];

const DEFAULT_THEME = "slate";
const STORAGE_KEY = "enloop.theme";

export function readTheme(): string {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return id && PANEL_THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Sets the theme on the document; the default clears the attribute so
 * Tailwind's own scale is what applies. */
export function applyTheme(id: string): void {
  if (id === DEFAULT_THEME) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
}

export function saveTheme(id: string): void {
  applyTheme(id);
  try {
    if (id === DEFAULT_THEME) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Applied for this document either way; it simply will not be remembered.
  }
}
