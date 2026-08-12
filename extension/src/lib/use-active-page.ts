import { useEffect, useState } from "react";
import { getActivePageUrl } from "./automation.js";

/**
 * The active tab's URL, kept current while the component is mounted.
 *
 * A value read once at mount describes the tab the panel happened to open
 * beside, not the one the tester is on by the time they act — and a values
 * panel seeded from that shows an address no run would use. Resolution at
 * run start stays authoritative (the start button re-reads the tab at the
 * click); this hook only keeps what the tester is looking at truthful in
 * between.
 */
export function useActivePageUrl(): string | undefined {
  const [pageUrl, setPageUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      getActivePageUrl()
        .then((url) => !cancelled && setPageUrl(url))
        .catch(() => !cancelled && setPageUrl(undefined));
    };
    read();
    const onUpdated = (
      _tabId: number,
      change: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (tab.active && (change.url || change.status === "complete")) read();
    };
    chrome.tabs.onActivated.addListener(read);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(read);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return pageUrl;
}
