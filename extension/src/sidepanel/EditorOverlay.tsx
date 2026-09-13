import { ScreenshotEditor } from "../components/ScreenshotEditor.js";
import { finishEditor, useEditorJob } from "../lib/editor-host.js";

/** The screenshot editor over the whole panel while a job is open. */
export function EditorOverlay() {
  const job = useEditorJob();
  if (!job) return null;
  return (
    <div className="absolute inset-0 z-50">
      <ScreenshotEditor job={job} onDone={finishEditor} />
    </div>
  );
}
