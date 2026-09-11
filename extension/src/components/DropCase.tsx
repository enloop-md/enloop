import { useRef, useState } from "react";
import { parseCaseDocument } from "@tcm/shared";

/**
 * The one door into Enloop that needs nothing set up: a case file dropped
 * on the panel, or picked from disk. Present on the Connect screen — where
 * there is no folder yet and the file lands in the browser's own storage —
 * and at the top of the Library, where it lands in the connected folder.
 *
 * The file is parsed before it is handed over, so a file that is not a
 * case says so here, by name, instead of arriving in the Library broken.
 * Several files at once are fine; each is its own case.
 */
export function DropCase({
  onImport,
  compact = false,
}: {
  /** Receives the Markdown of one parsed case. Throws to report a failure. */
  onImport: (markdown: string, fileName: string) => Promise<void>;
  /** A one-line strip for a screen that has other things to show. */
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  async function take(files: FileList | File[]) {
    const list = Array.from(files).filter(
      (f) => /\.(md|markdown|txt)$/i.test(f.name) || f.type.startsWith("text/") || !f.type,
    );
    if (list.length === 0) {
      setMessage({ tone: "error", text: "That is not a Markdown file." });
      return;
    }
    setBusy(true);
    setMessage(null);
    let landed = 0;
    for (const file of list) {
      try {
        const text = await file.text();
        // Parse first: a file that is not a case is refused here by name,
        // not discovered later as a broken row in the Library.
        parseCaseDocument(text, { version: "1", createdAt: new Date().toISOString() });
        await onImport(text, file.name);
        landed++;
      } catch (e) {
        setMessage({
          tone: "error",
          text: `${file.name}: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
    if (landed > 0 && list.length > 1) {
      setMessage({ tone: "ok", text: `${landed} of ${list.length} files added.` });
    }
    setBusy(false);
    if (input.current) input.current.value = "";
  }

  return (
    <div className={compact ? "px-3 pt-2" : "w-full"}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") input.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files);
        }}
        className={`cursor-pointer rounded border-2 border-dashed text-center transition-colors ${
          compact ? "px-2 py-1.5 text-[11px]" : "px-3 py-4 text-sm"
        } ${
          over
            ? "border-emerald-400 bg-emerald-50 text-emerald-800"
            : "border-slate-300 bg-slate-50 text-slate-500 hover:border-slate-400 hover:bg-slate-100"
        } ${busy ? "opacity-60" : ""}`}
      >
        {busy
          ? "Adding…"
          : compact
            ? "Drop a case file here, or click to choose one"
            : "Drop a case file here — or click to choose one"}
        {!compact && (
          <p className="mt-1 text-xs text-slate-400">
            A <code className="text-slate-500">.md</code> written by the skills, exported from
            another Enloop, or handed to you. It lands here as a case you can run right away.
          </p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        multiple
        hidden
        onChange={(e) => e.target.files && void take(e.target.files)}
      />
      {message && (
        <p
          className={`mt-1 text-xs ${message.tone === "error" ? "text-red-600" : "text-emerald-700"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
