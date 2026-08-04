import { getActiveTabId } from "./automation.js";
import { getPageAccess, type PageAccess } from "./page-access.js";

export type InsertOutcome =
  | { status: "inserted"; field: string }
  | { status: "cancelled" }
  | { status: "timeout" }
  | { status: "no-option"; field: string }
  | { status: "unsupported"; field: string }
  /** The page could not be typed into at all — see `access` for which of the
   * reasons it was, and whether the tester can do something about it. */
  | { status: "blocked"; access: PageAccess }
  | { status: "unavailable" };

/**
 * Arms the page to receive a value: the next form field the tester clicks
 * gets it. Injected via `func`, so it is static extension code and not
 * subject to the page's CSP.
 *
 * Runs in MAIN world deliberately. Setting `.value` is not enough for a
 * framework-controlled field — React installs a value tracker on the
 * element and swallows an `input` event whose value it believes it already
 * set. Going through the *native* prototype setter bypasses that tracker,
 * which leaves its cached value stale, which is exactly what makes the
 * change register. That trick needs the page's own prototypes, hence MAIN.
 *
 * Returns a promise that settles when the tester clicks a field, presses
 * Escape, the panel cancels, or the arming times out — `executeScript`
 * awaits it, so one call covers the whole interaction.
 */
function armValueInsertion(value: string, timeoutMs: number): Promise<InsertOutcome> {
  return new Promise((resolve) => {
    const FIELDS = "input, textarea, select, [contenteditable=''], [contenteditable='true']";

    const style = document.createElement("style");
    // Show what is clickable while armed. Without this the tester is told to
    // "click a field" with no indication of which elements count.
    style.textContent = `${FIELDS} { outline: 2px dashed rgba(37, 99, 235, 0.9) !important; outline-offset: 1px !important; }`;
    document.head.appendChild(style);

    let settled = false;
    const finish = (outcome: InsertOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("enloop:cancel-insert", onCancel);
      style.remove();
      resolve(outcome);
    };

    function setNativeValue(el: HTMLElement, next: string): void {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, next);
      else (el as HTMLInputElement).value = next;
    }

    function fire(el: HTMLElement): void {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    /** A select is filled by picking an option, not by assigning text. Match
     * on the option's value first, then its visible label — an author writing
     * an example value is quoting what they see in the dropdown, not the
     * value attribute behind it. */
    function selectOption(el: HTMLSelectElement, wanted: string): boolean {
      const target = wanted.trim().toLowerCase();
      const options = Array.from(el.options);
      const match =
        options.find((o) => o.value === wanted) ??
        options.find((o) => o.text.trim().toLowerCase() === target) ??
        options.find((o) => o.value.trim().toLowerCase() === target) ??
        options.find((o) => o.text.trim().toLowerCase().includes(target));
      if (!match) return false;
      el.selectedIndex = match.index;
      return true;
    }

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const field = target?.closest?.(FIELDS) as HTMLElement | null;
      if (!field) return;

      // Swallow the click: it was aimed at this extension, not at the page.
      event.preventDefault();
      event.stopPropagation();

      const tag = field.tagName.toLowerCase();

      if (field instanceof HTMLSelectElement) {
        if (!selectOption(field, value)) {
          finish({ status: "no-option", field: tag });
          return;
        }
        field.focus();
        fire(field);
        finish({ status: "inserted", field: tag });
        return;
      }

      if (field instanceof HTMLInputElement) {
        const type = field.type.toLowerCase();
        // Toggles and pickers do not take arbitrary text; saying so beats
        // silently writing a value the control ignores.
        if (["checkbox", "radio", "file", "range", "color", "submit", "button"].includes(type)) {
          finish({ status: "unsupported", field: `${tag}[type=${type}]` });
          return;
        }
      }

      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        field.focus();
        setNativeValue(field, value);
        fire(field);
        finish({ status: "inserted", field: tag });
        return;
      }

      // contenteditable
      field.focus();
      field.textContent = value;
      fire(field);
      finish({ status: "inserted", field: "contenteditable" });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish({ status: "cancelled" });
    };
    const onCancel = () => finish({ status: "cancelled" });

    const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("enloop:cancel-insert", onCancel);
  });
}

/** Dispatched into the page to release an arming the panel started. */
function cancelValueInsertion(): void {
  window.dispatchEvent(new Event("enloop:cancel-insert"));
}

/** Arms the active tab and resolves with what the tester did. Never throws:
 * a page that cannot be scripted reports `blocked` with the reason, so the
 * chip can offer a grant where that is what is missing rather than claiming
 * there is nothing to type into. */
export async function insertValueInActiveTab(
  value: string,
  timeoutMs = 60_000,
): Promise<InsertOutcome> {
  const access = await getPageAccess();
  if (access.status !== "ready") return { status: "blocked", access };

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: access.tabId },
      world: "MAIN",
      func: armValueInsertion,
      args: [value, timeoutMs],
    });
    return injection?.result ?? { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Releases an arming from the panel side. Best-effort: if the page has
 * navigated away the listener is already gone. */
export async function cancelInsertInActiveTab(): Promise<void> {
  try {
    const tabId = await getActiveTabId();
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: cancelValueInsertion,
    });
  } catch {
    // Nothing to cancel.
  }
}
