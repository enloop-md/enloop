import { useEffect, useRef } from "react";
import { SCREENSHOT_MESSAGE, type ScreenshotMessage } from "../background/screenshot.js";
import { photoFromDataUrl, type TakenPhoto } from "./photo-runner.js";

/**
 * Hands the panel the screenshots the background worker takes on a
 * gesture (the shortcut, the context-menu item). The callback attaches
 * the photo wherever the screen decides — the current step, the run, the
 * free run — and is read through a ref so the listener never goes stale
 * while the run state changes underneath it.
 */
export function useGestureScreenshot(
  onPhoto: ((photo: TakenPhoto) => void | Promise<void>) | null,
  onError?: (message: string) => void,
): void {
  const handler = useRef(onPhoto);
  handler.current = onPhoto;
  const failed = useRef(onError);
  failed.current = onError;

  useEffect(() => {
    const listener = (raw: unknown) => {
      const message = raw as Partial<ScreenshotMessage> | undefined;
      if (!message || message.type !== SCREENSHOT_MESSAGE) return;
      if (!handler.current) return;
      if (message.error || !message.dataUrl) {
        failed.current?.(message.error ?? "Chrome refused the capture");
        return;
      }
      void photoFromDataUrl(message.dataUrl, message.url ?? "").then((photo) => handler.current?.(photo));
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
}
