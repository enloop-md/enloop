/**
 * Remembering which tab a question was asked from, and getting back to it.
 *
 * An answer takes a minute or more, and a tester who has asked one does not
 * sit and watch the dot pulse — they go to another tab, and by the time the
 * answer lands the page the question was about is three tabs back. The
 * question file carries the page's URL, but a URL is not a tab: the same
 * page may be open twice, and the one with the tester's half-filled form in
 * it is the one they want. So the tab id is kept, per question, in
 * `chrome.storage.session` — it is a browser-session fact and belongs to no
 * file — and the URL is the fallback for a panel that was not the one to ask.
 */

const QUESTION_TABS_KEY = "enloop:question-tabs";

export interface TabRef {
  tabId: number;
  windowId: number;
}

type Stored = Record<string, TabRef>;

async function readStored(): Promise<Stored> {
  try {
    const raw = await chrome.storage.session.get(QUESTION_TABS_KEY);
    const value = raw[QUESTION_TABS_KEY];
    return value && typeof value === "object" ? (value as Stored) : {};
  } catch {
    return {};
  }
}

/** The tab the panel is beside right now — what a question is "from". */
export async function currentTabRef(): Promise<TabRef | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || tab.windowId === undefined) return null;
    return { tabId: tab.id, windowId: tab.windowId };
  } catch {
    return null;
  }
}

export async function rememberQuestionTab(questionId: string, ref: TabRef): Promise<void> {
  try {
    const stored = await readStored();
    await chrome.storage.session.set({ [QUESTION_TABS_KEY]: { ...stored, [questionId]: ref } });
  } catch {
    // Session storage unavailable — the URL fallback still works.
  }
}

/** A URL as a tab shows it, for matching: the fragment is navigation within
 * one page and is the part most likely to have moved since the ask. */
function withoutHash(url: string): string {
  return url.split("#")[0];
}

/**
 * The tab a question was asked from, if it is still open: the remembered
 * one when it still exists, else any tab showing the page the question
 * named. Null when neither is around — the tester closed it, or restarted
 * the browser — and then there is nowhere to bring them.
 */
export async function findQuestionTab(question: {
  id: string;
  pageUrl: string;
}): Promise<TabRef | null> {
  const remembered = (await readStored())[question.id];
  if (remembered) {
    try {
      const tab = await chrome.tabs.get(remembered.tabId);
      if (tab.id !== undefined && tab.windowId !== undefined) {
        return { tabId: tab.id, windowId: tab.windowId };
      }
    } catch {
      // Closed since. Fall through to the URL.
    }
  }
  if (!question.pageUrl) return null;
  try {
    const wanted = withoutHash(question.pageUrl);
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((t) => t.url && withoutHash(t.url) === wanted);
    if (match?.id !== undefined && match.windowId !== undefined) {
      return { tabId: match.id, windowId: match.windowId };
    }
  } catch {
    // No tabs permission, or a query that failed — no link.
  }
  return null;
}

/** Whether `ref` is the tab in front of the tester in this window. Only
 * this window: the side panel is per window, so "the tab I am looking at"
 * is always one of this window's. */
export async function isCurrentTab(ref: TabRef): Promise<boolean> {
  const current = await currentTabRef();
  return current !== null && current.tabId === ref.tabId;
}

/** Brings the tab forward: active in its window, and that window focused,
 * in case the tester wandered further than one window. */
export async function focusTab(ref: TabRef): Promise<void> {
  await chrome.tabs.update(ref.tabId, { active: true });
  await chrome.windows.update(ref.windowId, { focused: true });
}
