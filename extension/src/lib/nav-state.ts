/**
 * Remembering which screen the panel was on.
 *
 * The side panel's document is destroyed every time the panel closes, and it
 * closes whenever the tester clicks away from it — which, in a product whose
 * whole job is "read the step, then go do it in the page", is constantly.
 * With the navigation stack held only in React state, that meant a run in
 * progress vanished from view on the first click into the app being tested,
 * and getting back to it meant Library → Runs → find it by timestamp.
 *
 * `chrome.storage.session` rather than `local` on purpose: it survives the
 * panel closing, which is the case worth fixing, and clears when Chrome
 * restarts, which gives "where was I" a natural expiry instead of dropping
 * someone into a three-day-old run screen. The Library's resume banner
 * covers the after-restart case, where a stale stack would be a worse answer
 * than a deliberate one.
 */

export type Screen =
  | { kind: "library" }
  | { kind: "caseDetail"; testCaseId: string }
  | { kind: "editor"; testCaseId?: string; suiteId?: string }
  | { kind: "suiteDetail"; suiteId: string }
  | { kind: "suiteEditor"; suiteId?: string }
  | { kind: "run"; testCaseId: string; runId: string }
  | { kind: "freeRun"; freeRunId: string }
  | { kind: "history"; testCaseId?: string }
  | { kind: "settings" };

export const HOME: Screen = { kind: "library" };

/** Panels in different windows are different places; keying the stack by
 * window keeps a second window from inheriting the first one's screen. */
async function storageKey(): Promise<string> {
  try {
    const win = await chrome.windows.getCurrent();
    if (typeof win.id === "number") return `nav:${win.id}`;
  } catch {
    // No windows API answer — one shared key is still better than none.
  }
  return "nav:default";
}

function isScreen(value: unknown): value is Screen {
  if (typeof value !== "object" || value === null) return false;
  const screen = value as { kind?: unknown; [key: string]: unknown };
  const str = (key: string) => typeof screen[key] === "string";
  const optionalStr = (key: string) => screen[key] === undefined || typeof screen[key] === "string";

  switch (screen.kind) {
    case "library":
    case "settings":
      return true;
    case "caseDetail":
      return str("testCaseId");
    case "editor":
      return optionalStr("testCaseId") && optionalStr("suiteId");
    case "suiteDetail":
      return str("suiteId");
    case "suiteEditor":
      return optionalStr("suiteId");
    case "run":
      return str("testCaseId") && str("runId");
    case "freeRun":
      return str("freeRunId");
    case "history":
      return optionalStr("testCaseId");
    default:
      return false;
  }
}

/**
 * An editor at the top of a restored stack is dropped: its unsaved text died
 * with the document, so reopening it would present an empty form as if it
 * were the work in progress. Everything under it is a place, not a draft,
 * and restores fine.
 */
function withoutDeadDrafts(stack: Screen[]): Screen[] {
  const trimmed = [...stack];
  while (
    trimmed.length > 1 &&
    (trimmed[trimmed.length - 1].kind === "editor" ||
      trimmed[trimmed.length - 1].kind === "suiteEditor")
  ) {
    trimmed.pop();
  }
  return trimmed;
}

export async function loadNavStack(): Promise<Screen[] | null> {
  try {
    const key = await storageKey();
    const stored = await chrome.storage.session.get(key);
    const stack = stored[key];
    if (!Array.isArray(stack) || stack.length === 0 || !stack.every(isScreen)) return null;
    return withoutDeadDrafts(stack as Screen[]);
  } catch {
    return null;
  }
}

export async function saveNavStack(stack: Screen[]): Promise<void> {
  try {
    const key = await storageKey();
    await chrome.storage.session.set({ [key]: stack });
  } catch {
    // Losing the breadcrumb is not worth failing a render over.
  }
}

export async function clearNavStack(): Promise<void> {
  try {
    await chrome.storage.session.remove(await storageKey());
  } catch {
    // Same.
  }
}
