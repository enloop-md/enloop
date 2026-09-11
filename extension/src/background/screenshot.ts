/**
 * Screenshots from a gesture the page owns.
 *
 * `captureVisibleTab` accepts only `activeTab` or all-sites access, and a
 * side-panel button is neither a gesture Chrome counts nor a thing that
 * can ask for all sites without the install prompt this extension was
 * built to avoid. The keyboard shortcut and the context-menu item are
 * gestures Chrome does count: each grants `activeTab` to the tab it is
 * used on, so the worker can capture right here and hand the bytes to the
 * panel, which attaches them to the step the tester is on. The grant
 * outlives the gesture — until the tab leaves its origin — so from then on
 * the panel's own buttons and the runner's photos work on that tab too.
 */

export const SCREENSHOT_MESSAGE = "enloop:screenshot";
const MENU_ID = "enloop-take-screenshot";
const COMMAND = "take-screenshot";

export interface ScreenshotMessage {
  type: typeof SCREENSHOT_MESSAGE;
  dataUrl: string;
  url: string;
  tabId: number;
  windowId: number;
  /** When the capture failed: Chrome's reason, and no `dataUrl`. */
  error?: string;
}

async function captureAndSend(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!tab || tab.id === undefined || tab.windowId === undefined) return;
  const base = { type: SCREENSHOT_MESSAGE, url: tab.url ?? "", tabId: tab.id, windowId: tab.windowId } as const;
  let message: ScreenshotMessage;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    message = { ...base, dataUrl };
  } catch (e) {
    message = { ...base, dataUrl: "", error: e instanceof Error ? e.message : String(e) };
  }
  // Nobody listening (no panel open) is not an error worth surfacing.
  chrome.runtime.sendMessage(message).catch(() => {});
}

export function installScreenshotGestures(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Take an Enloop screenshot",
      contexts: ["page", "frame", "selection", "image", "link"],
    });
  });
}

export function installScreenshotListeners(): void {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === COMMAND) void captureAndSend(tab);
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID) void captureAndSend(tab);
  });
}
