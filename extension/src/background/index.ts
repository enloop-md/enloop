import { installCaptureListeners, syncCaptureRegistration } from "./capture.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

installCaptureListeners();

// Also on plain worker start, not only on install/startup: the worker is woken
// by any event, and a reconcile that has already happened is a no-op. This is
// the belt to the braces of the two lifecycle listeners — the state it fixes
// (a registration left behind by a feature that is now off) is browser-wide.
void syncCaptureRegistration();
