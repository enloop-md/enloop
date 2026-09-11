import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CropOp, ScreenshotOp } from "@tcm/shared";
import { finishEditor, readEditorJob, type EditorJob } from "../lib/editor-handoff.js";
import {
  SHOT_COLORS,
  bytesToDataUrl,
  clampCrop,
  cropOf,
  drawCropOverlay,
  drawOps,
  nextCalloutNumber,
  renderScreenshot,
  withCrop,
  metrics,
} from "../lib/screenshot-render.js";

/**
 * The screenshot editor: a source image, an append-only list of ops, and
 * undo. No selection, no moving a shape after the fact — a wrong shape is
 * undone and redrawn, which is faster than grabbing a handle at the sizes
 * these images are viewed at.
 *
 * Two canvases: the base shows the source with every committed op and the
 * crop's dimming; the overlay shows only the shape being dragged, so a
 * drag never redraws the whole image. Both have the source's pixel size
 * as their backing store and are CSS-scaled to fit the window; pointer
 * positions are divided by that scale to land in source pixels.
 */

type Tool = "crop" | "blur" | "line" | "arrow" | "rect" | "callout";
const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "crop", label: "Crop", key: "1" },
  { tool: "blur", label: "Blur", key: "2" },
  { tool: "line", label: "Line", key: "3" },
  { tool: "arrow", label: "Arrow", key: "4" },
  { tool: "rect", label: "Rect", key: "5" },
  { tool: "callout", label: "Callout", key: "6" },
];
const COLOR_KEY = "enloop.shot.color";
/** A drag shorter than this is a click that slipped, not a shape. */
const MIN_DRAG = 4;

function readColor(): string {
  try {
    const stored = localStorage.getItem(COLOR_KEY);
    if (stored && (SHOT_COLORS as readonly string[]).includes(stored)) return stored;
  } catch {
    // no storage; the default is fine
  }
  return SHOT_COLORS[0];
}

interface Point {
  x: number;
  y: number;
}

export function Editor({ token }: { token: string }) {
  const [job, setJob] = useState<EditorJob | null | undefined>(undefined);
  const [source, setSource] = useState<ImageBitmap | null>(null);
  const [ops, setOps] = useState<ScreenshotOp[]>([]);
  const [tool, setTool] = useState<Tool>("rect");
  const [color, setColor] = useState<string>(readColor);
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null);
  const [scale, setScale] = useState(1);
  const [saving, setSaving] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await readEditorJob(token);
      if (cancelled) return;
      setJob(loaded);
      if (!loaded) return;
      document.title = `${loaded.title} — Enloop`;
      setOps(loaded.ops);
      const blob = await (await fetch(loaded.sourceDataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      if (cancelled) bitmap.close();
      else setSource(bitmap);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Fit the image to the window, and refit when the window changes.
  useLayoutEffect(() => {
    if (!source) return;
    const fit = () => {
      const frame = frameRef.current;
      if (!frame) return;
      // Minus the frame's own padding, or a wide image always overflows by it.
      const maxW = frame.clientWidth - 32;
      const maxH = window.innerHeight - frame.getBoundingClientRect().top - 48;
      setScale(Math.min(1, maxW / source.width, maxH / source.height));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [source]);

  // Base: source + committed ops + crop dimming.
  useEffect(() => {
    const canvas = baseRef.current;
    if (!canvas || !source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(source, 0, 0);
    drawOps(ctx, ops, source.width);
    const crop = cropOf(ops);
    if (crop) drawCropOverlay(ctx, clampCrop(crop, source.width, source.height), source.width, source.height);
  }, [source, ops]);

  // Overlay: the drag in progress.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!drag) return;
    const preview = opFromDrag(tool, drag, color, ops, source.width, source.height);
    if (!preview) return;
    if (preview.tool === "crop") {
      drawCropOverlay(ctx, preview, source.width, source.height);
    } else if (preview.tool === "blur") {
      // The overlay is transparent, so the blur is previewed on a copy of
      // the base and only that region is shown — what Save will produce.
      const base = baseRef.current;
      if (base) {
        ctx.drawImage(base, 0, 0);
        drawOps(ctx, [preview], source.width);
        ctx.save();
        ctx.globalCompositeOperation = "destination-in";
        ctx.fillRect(preview.x, preview.y, preview.w, preview.h);
        ctx.restore();
      }
      ctx.save();
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = Math.max(1, metrics(source.width).lineWidth / 2);
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(preview.x, preview.y, preview.w, preview.h);
      ctx.restore();
    } else {
      drawOps(ctx, [preview], source.width);
    }
  }, [drag, tool, color, ops, source]);

  const commit = useCallback(
    (d: { from: Point; to: Point }) => {
      if (!source) return;
      const op = opFromDrag(tool, d, color, ops, source.width, source.height);
      if (!op) return;
      setOps((current) => (op.tool === "crop" ? withCrop(current, op) : [...current, op]));
    },
    [tool, color, ops, source],
  );

  const undo = useCallback(() => setOps((current) => current.slice(0, -1)), []);

  const save = useCallback(async () => {
    if (!job || !source || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const png = await renderScreenshot(source, ops);
      await finishEditor(job, { cancelled: false, ops, renderedDataUrl: bytesToDataUrl(png) });
    } catch (e) {
      // Usually the session-storage quota on a very large capture; the
      // attachment in the run is untouched either way.
      setSaveError(`Could not hand the image back to the panel (${e instanceof Error ? e.message : String(e)}). Try a tighter crop, or Cancel to keep the unedited screenshot.`);
    } finally {
      setSaving(false);
    }
  }, [job, source, ops, saving]);

  const cancel = useCallback(async () => {
    if (!job) {
      window.close();
      return;
    }
    await finishEditor(job, { cancelled: true });
  }, [job]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        e.preventDefault();
        void cancel();
      } else if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (meta && (e.key === "Enter" || e.key.toLowerCase() === "s")) {
        e.preventDefault();
        void save();
      } else if (!meta) {
        const hit = TOOLS.find((t) => t.key === e.key);
        if (hit) setTool(hit.tool);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, undo, save]);

  function pointOf(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  }

  if (job === undefined) return <p className="p-6 text-sm text-slate-500">Loading…</p>;
  if (job === null) {
    return (
      <div className="p-6 text-sm text-slate-600">
        <p>This editor session has expired — the screenshot it was opened for is no longer waiting.</p>
        <button onClick={() => window.close()} className="mt-3 rounded border px-3 py-1 text-xs">
          Close
        </button>
      </div>
    );
  }

  const crop = source ? cropOf(ops) : null;
  const clamped = crop && source ? clampCrop(crop, source.width, source.height) : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-800">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs">
        <span className="mr-2 truncate text-sm font-medium" title={job.title}>
          {job.title}
        </span>
        <div className="flex gap-1" role="radiogroup" aria-label="Tool">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              onClick={() => setTool(t.tool)}
              aria-pressed={tool === t.tool}
              title={`${t.label} (${t.key})`}
              className={`rounded border px-2 py-1 ${
                tool === t.tool
                  ? "border-sky-500 bg-sky-50 text-sky-800"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-2 flex items-center gap-1" aria-label="Colour">
          {SHOT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                try {
                  localStorage.setItem(COLOR_KEY, c);
                } catch {
                  // fine
                }
              }}
              aria-pressed={color === c}
              title={c}
              style={{ backgroundColor: c }}
              className={`h-5 w-5 rounded-full border-2 ${
                color === c ? "border-slate-800" : "border-slate-300"
              }`}
            />
          ))}
        </div>
        <button
          onClick={undo}
          disabled={ops.length === 0}
          className="ml-2 rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        {ops.length > 0 && (
          <button
            onClick={() => {
              if (!confirmRevert) {
                setConfirmRevert(true);
                setTimeout(() => setConfirmRevert(false), 3000);
                return;
              }
              setOps([]);
              setConfirmRevert(false);
            }}
            className={`rounded border px-2 py-1 ${
              confirmRevert
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
            title="Drop every change and go back to the capture as taken"
          >
            {confirmRevert ? "Drop all changes?" : "↺ Original"}
          </button>
        )}
        <span className="flex-1" />
        <button
          onClick={() => void cancel()}
          className="rounded border border-slate-200 bg-white px-3 py-1 hover:bg-slate-50"
          title="Cancel (Esc)"
        >
          Cancel
        </button>
        <button
          onClick={() => void save()}
          disabled={saving || !source}
          className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          title="Save (Ctrl+Enter)"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {saveError && (
        <p className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{saveError}</p>
      )}
      <div ref={frameRef} className="flex flex-1 items-start justify-center overflow-auto p-4">
        {source && (
          <div
            className="relative shadow-lg"
            style={{ width: source.width * scale, height: source.height * scale }}
          >
            <canvas
              ref={baseRef}
              className="absolute left-0 top-0"
              style={{ width: source.width * scale, height: source.height * scale }}
            />
            <canvas
              ref={overlayRef}
              className="absolute left-0 top-0 touch-none"
              style={{
                width: source.width * scale,
                height: source.height * scale,
                cursor: tool === "callout" ? "pointer" : "crosshair",
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const p = pointOf(e);
                setDrag({ from: p, to: p });
              }}
              onPointerMove={(e) => {
                if (!drag) return;
                setDrag({ from: drag.from, to: pointOf(e) });
              }}
              onPointerUp={(e) => {
                if (!drag) return;
                const final = { from: drag.from, to: pointOf(e) };
                setDrag(null);
                commit(final);
              }}
              onPointerCancel={() => setDrag(null)}
            />
          </div>
        )}
      </div>
      {source && (
        <p className="border-t border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-500">
          {source.width}×{source.height}
          {clamped && ` → ${Math.round(clamped.w)}×${Math.round(clamped.h)}`}
          <span className="ml-3 text-slate-400">
            Drag to draw · click for a callout · 1–6 pick a tool · Ctrl+Z undo · Ctrl+Enter save · Esc cancel
          </span>
        </p>
      )}
    </div>
  );
}

/** The op a drag would commit, or null for a drag too short to mean it. */
function opFromDrag(
  tool: Tool,
  d: { from: Point; to: Point },
  color: string,
  ops: ScreenshotOp[],
  width: number,
  height: number,
): ScreenshotOp | null {
  const x = Math.max(0, Math.min(d.from.x, d.to.x));
  const y = Math.max(0, Math.min(d.from.y, d.to.y));
  const w = Math.min(width, Math.max(d.from.x, d.to.x)) - x;
  const h = Math.min(height, Math.max(d.from.y, d.to.y)) - y;
  const short = Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y) < MIN_DRAG;
  switch (tool) {
    case "callout":
      return { tool: "callout", x: d.from.x, y: d.from.y, n: nextCalloutNumber(ops), color };
    case "line":
      return short ? null : { tool: "line", x1: d.from.x, y1: d.from.y, x2: d.to.x, y2: d.to.y, color };
    case "arrow":
      return short ? null : { tool: "arrow", x1: d.from.x, y1: d.from.y, x2: d.to.x, y2: d.to.y, color };
    case "rect":
      return short || w <= 0 || h <= 0 ? null : { tool: "rect", x, y, w, h, color };
    case "blur":
      return short || w <= 0 || h <= 0 ? null : { tool: "blur", x, y, w, h };
    case "crop": {
      if (short || w <= 0 || h <= 0) return null;
      const crop: CropOp = { tool: "crop", x, y, w, h };
      return clampCrop(crop, width, height);
    }
    default:
      return null;
  }
}
