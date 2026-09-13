import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ScreenshotEditor } from "../components/ScreenshotEditor.js";
import { finishFrameEditor, readFrameJob, type EditorJob } from "../lib/editor-host.js";
import "../sidepanel/index.css";
import { applyTheme, readTheme } from "../lib/theme.js";

/**
 * The editor as a page: what the panel injects into the app's tab as a
 * full-viewport iframe. It reads its job from session storage by the
 * token in the URL, and hands the result back the same way.
 */
function FramedEditor({ token }: { token: string }) {
  const [job, setJob] = useState<EditorJob | null | undefined>(undefined);
  useEffect(() => {
    void readFrameJob(token).then(setJob);
  }, [token]);
  if (job === undefined) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (job === null) {
    return <p className="p-6 text-sm text-slate-600">This editor session has expired.</p>;
  }
  return <ScreenshotEditor job={job} fit="window" onDone={(result) => void finishFrameEditor(token, result)} />;
}

applyTheme(readTheme());

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <FramedEditor token={location.hash.replace(/^#/, "")} />
  </StrictMode>,
);
