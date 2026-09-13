import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CropOp, ScreenshotOp } from "@tcm/shared";
import type { EditorJob, EditorResult } from "../lib/editor-host.js";
import {
  SHOT_COLORS,
  clampCrop,
  decodePng,
  cropOf,
  drawCropOverlay,
  drawOps,
  nextCalloutNumber,
  renderScreenshot,
  withCrop,
  metrics,
} from "../lib/screenshot-render.js";
import {
  boundsOf,
  clampedToImage,
  cursorFor,
  handlesOf,
  hitHandle,
  hitTest,
  moved,
  renumberCallouts,
  resized,
  tolerance,
  type Handle,
  type Point,
} from "../lib/screenshot-edit.js";

/**
 * The screenshot editor: a source image and a list of ops, every one of
 * which can be drawn, then selected, moved, resized, recoloured or
 * deleted, with undo and redo over the whole history. The ops are the
 * same records the runner writes, so a photo the case took itself is
 * edited exactly like one drawn here.
 *
 * Two canvases: the base shows the source with every committed op and the
 * crop's dimming; the overlay shows only the shape being drawn and the
 * selection outline with its handles, so a drag never redraws the whole
 * image. Both have the source's pixel size as their backing store and are
 * CSS-scaled to fit the window; pointer positions are divided by that
 * scale to land in source pixels.
 */

type Tool = "select" | "crop" | "blur" | "line" | "arrow" | "rect" | "callout";
const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "select", label: "Select", key: "1" },
  { tool: "crop", label: "Crop", key: "2" },
  { tool: "blur", label: "Blur", key: "3" },
  { tool: "line", label: "Line", key: "4" },
  { tool: "arrow", label: "Arrow", key: "5" },
  { tool: "rect", label: "Rect", key: "6" },
  { tool: "callout", label: "Callout", key: "7" },
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

/** What the pointer is doing between down and up. */
type Drag =
  | { kind: "draw"; from: Point; to: Point }
  | { kind: "move"; index: number; from: Point; original: ScreenshotOp }
  | { kind: "resize"; index: number; handle: Handle; original: ScreenshotOp };

export function ScreenshotEditor({
  job,
  fit = "width",
  onDone,
}: {
  job: EditorJob;
  /** `window`: fit the whole picture into the frame (the page overlay);
   * `width`: fit the width and scroll for the rest (the side panel). */
  fit?: "width" | "window";
  onDone: (result: EditorResult) => void;
}) {
  const [source, setSource] = useState<ImageBitmap | null>(null);
  const [ops, setOps] = useState<ScreenshotOp[]>(job.ops);
  // Undo is a history of whole lists, not "pop the last op": moving a
  // shape or recolouring it changes an op in place, and that has to be
  // undoable too.
  const [past, setPast] = useState<ScreenshotOp[][]>([]);
  const [future, setFuture] = useState<ScreenshotOp[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<string>(readColor);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{ handle: Handle | null; overOp: boolean }>({ handle: null, overOp: false });
  const [scale, setScale] = useState(1);
  /** 1 = fit the panel's width; the zoom buttons multiply it. */
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let bitmap: ImageBitmap | null = null;
    void decodePng(job.sourcePng).then((decoded) => {
      if (cancelled) decoded.close();
      else {
        bitmap = decoded;
        setSource(decoded);
      }
    });
    return () => {
      cancelled = true;
      bitmap?.close();
    };
  }, [job]);

  // Fit the image to the panel's width, and refit when the panel is
  // resized — its edge is draggable, and widening it is how a tester gets
  // a bigger picture. Height is free: the frame scrolls.
  useLayoutEffect(() => {
    if (!source) return;
    const frame = frameRef.current;
    if (!frame) return;
    const refit = () => {
      // Minus the frame's own padding, or a wide image always overflows by it.
      const maxW = frame.clientWidth - 16;
      const maxH = frame.clientHeight - 16;
      const base = fit === "window" ? Math.min(1, maxW / source.width, maxH / source.height) : Math.min(1, maxW / source.width);
      setScale(base * zoom);
    };
    refit();
    const observer = new ResizeObserver(refit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [source, zoom, fit]);

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

  // Overlay: the shape being drawn, or the selection.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || !source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (drag?.kind === "draw") {
      const preview = opFromDrag(tool, drag, color, ops, source.width, source.height);
      if (!preview) return;
      if (preview.tool === "crop") {
        drawCropOverlay(ctx, preview, source.width, source.height);
      } else if (preview.tool === "blur") {
        // The overlay is transparent, so the blur is previewed on a copy
        // of the base and only that region is shown — what Save produces.
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
      return;
    }

    const op = selected !== null ? ops[selected] : undefined;
    if (!op) return;
    const b = boundsOf(op, source.width);
    const pad = metrics(source.width).lineWidth;
    const hs = Math.max(8, 10 / scale);
    ctx.save();
    ctx.strokeStyle = "#0090FF";
    ctx.lineWidth = Math.max(1, 1.5 / scale);
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
    ctx.setLineDash([]);
    ctx.fillStyle = "#FFFFFF";
    for (const { at } of handlesOf(op, source.width)) {
      ctx.fillRect(at.x - hs / 2, at.y - hs / 2, hs, hs);
      ctx.strokeRect(at.x - hs / 2, at.y - hs / 2, hs, hs);
    }
    ctx.restore();
  }, [drag, tool, color, ops, source, selected, scale]);

  /** A new list, with the old one kept for undo and redo cleared. */
  const commit = useCallback((next: ScreenshotOp[]) => {
    setOps((current) => {
      setPast((p) => [...p, current]);
      return next;
    });
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1];
      setOps((current) => {
        setFuture((f) => [current, ...f]);
        return previous;
      });
      return p.slice(0, -1);
    });
    setSelected(null);
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setOps((current) => {
        setPast((p) => [...p, current]);
        return next;
      });
      return f.slice(1);
    });
    setSelected(null);
  }, []);

  const deleteSelected = useCallback(() => {
    if (selected === null) return;
    commit(renumberCallouts(ops.filter((_, i) => i !== selected)));
    setSelected(null);
  }, [selected, ops, commit]);

  const pickColor = useCallback(
    (c: string) => {
      setColor(c);
      try {
        localStorage.setItem(COLOR_KEY, c);
      } catch {
        // fine
      }
      // With something selected, the swatch recolours it rather than only
      // setting the colour of the next shape.
      if (selected !== null && "color" in ops[selected]) {
        commit(ops.map((op, i) => (i === selected && "color" in op ? { ...op, color: c } : op)));
      }
    },
    [selected, ops, commit],
  );

  const save = useCallback(async () => {
    if (!source || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const png = await renderScreenshot(source, ops);
      onDone({ cancelled: false, ops, renderedPng: png });
    } catch (e) {
      setSaveError(`Could not render the picture (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      setSaving(false);
    }
  }, [source, ops, saving, onDone]);

  const cancel = useCallback(async () => {
    onDone({ cancelled: true });
  }, [onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        e.preventDefault();
        // First Escape drops the selection; a second one leaves.
        if (selected !== null) setSelected(null);
        else void cancel();
      } else if (meta && e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (meta && (e.key === "Enter" || e.key.toLowerCase() === "s")) {
        e.preventDefault();
        void save();
      } else if (!meta && (e.key === "Delete" || e.key === "Backspace")) {
        if (selected !== null) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (!meta && e.key.toLowerCase() === "v") {
        setTool("select");
      } else if (!meta) {
        const hit = TOOLS.find((t) => t.key === e.key);
        if (hit) setTool(hit.tool);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, undo, redo, save, selected, deleteSelected]);

  function pointOf(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!source) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointOf(e);
    const t = tolerance(source.width, scale);

    // A handle of the selected shape wins over everything under it,
    // whatever tool is active — grabbing a corner should never start a
    // new rectangle instead.
    const current = selected !== null ? ops[selected] : undefined;
    if (current) {
      const handle = hitHandle(current, p, source.width, t);
      if (handle) {
        setPast((past) => [...past, ops]);
        setFuture([]);
        setDrag({ kind: "resize", index: selected!, handle, original: current });
        return;
      }
    }
    if (tool === "select") {
      const index = hitTest(ops, p, source.width, t);
      setSelected(index >= 0 ? index : null);
      if (index >= 0) {
        setPast((past) => [...past, ops]);
        setFuture([]);
        setDrag({ kind: "move", index, from: p, original: ops[index] });
      }
      return;
    }
    setSelected(null);
    setDrag({ kind: "draw", from: p, to: p });
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!source) return;
    const p = pointOf(e);
    if (!drag) {
      if (tool !== "select" && selected === null) return;
      const t = tolerance(source.width, scale);
      const current = selected !== null ? ops[selected] : undefined;
      const handle = current ? hitHandle(current, p, source.width, t) : null;
      const overOp = tool === "select" && !handle && hitTest(ops, p, source.width, t) >= 0;
      setHover({ handle, overOp });
      return;
    }
    if (drag.kind === "draw") {
      setDrag({ ...drag, to: p });
      return;
    }
    const next =
      drag.kind === "move"
        ? moved(drag.original, p.x - drag.from.x, p.y - drag.from.y)
        : resized(drag.original, drag.handle, p);
    const clamped = clampedToImage(next, source.width, source.height);
    setOps((list) => list.map((op, i) => (i === drag.index ? clamped : op)));
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag || !source) return;
    if (drag.kind === "draw") {
      const final = { from: drag.from, to: pointOf(e) };
      setDrag(null);
      const op = opFromDrag(tool, final, color, ops, source.width, source.height);
      if (!op) return;
      const next = op.tool === "crop" ? withCrop(ops, op) : [...ops, op];
      commit(next);
      // The shape just drawn is the one most likely to need a nudge.
      setSelected(op.tool === "crop" ? next.findIndex((o) => o.tool === "crop") : next.length - 1);
      return;
    }
    // A move or resize that ended where it began is not a change worth an
    // undo step.
    const unchanged = JSON.stringify(ops[drag.index]) === JSON.stringify(drag.original);
    if (unchanged) setPast((past) => past.slice(0, -1));
    setDrag(null);
  }

  const crop = source ? cropOf(ops) : null;
  const clamped = crop && source ? clampCrop(crop, source.width, source.height) : null;
  const selectedOp = selected !== null ? ops[selected] : undefined;
  const cursor =
    drag?.kind === "move"
      ? "move"
      : drag?.kind === "resize"
        ? cursorFor(drag.handle, true)
        : tool === "select" || hover.handle
          ? cursorFor(hover.handle, hover.overOp)
          : tool === "callout"
            ? "pointer"
            : "crosshair";

  return (
    <div className="flex h-full flex-col bg-slate-100 text-slate-800">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5 text-xs">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={job.title}>
          {job.title}
        </span>
        <span className="text-[10px] text-slate-400" title="Widen the panel by dragging its edge for a bigger picture">
          zoom
        </span>
        <button
          onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 4) / 4))}
          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 hover:bg-slate-50"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={() => setZoom(1)}
          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 hover:bg-slate-50"
          title="Fit the panel's width"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 4) / 4))}
          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 hover:bg-slate-50"
          title="Zoom in"
        >
          +
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-1.5 text-xs">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Tool">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              onClick={() => setTool(t.tool)}
              aria-pressed={tool === t.tool}
              title={`${t.label} (${t.key}${t.tool === "select" ? " or V" : ""})`}
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
              onClick={() => pickColor(c)}
              aria-pressed={color === c}
              title={selectedOp && "color" in selectedOp ? `Recolour the selected shape ${c}` : c}
              style={{ backgroundColor: c }}
              className={`h-5 w-5 rounded-full border-2 ${
                color === c ? "border-slate-800" : "border-slate-300"
              }`}
            />
          ))}
        </div>
        <button
          onClick={undo}
          disabled={past.length === 0}
          className="ml-2 rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          onClick={redo}
          disabled={future.length === 0}
          className="rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo
        </button>
        {selectedOp && (
          <button
            onClick={deleteSelected}
            className="rounded border border-red-200 bg-white px-2 py-1 text-red-700 hover:bg-red-50"
            title="Delete the selected shape (Delete)"
          >
            Delete
          </button>
        )}
        {ops.length > 0 && (
          <button
            onClick={() => {
              if (!confirmRevert) {
                setConfirmRevert(true);
                setTimeout(() => setConfirmRevert(false), 3000);
                return;
              }
              commit([]);
              setSelected(null);
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
      <div ref={frameRef} className={`flex-1 overflow-auto p-2 ${fit === "window" ? "flex items-start justify-center" : ""}`}>
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
              style={{ width: source.width * scale, height: source.height * scale, cursor }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
            />
          </div>
        )}
      </div>
      {source && (
        <p className="border-t border-slate-200 bg-white px-3 py-1 text-[10px] leading-snug text-slate-500">
          {source.width}×{source.height}
          {clamped && ` → ${Math.round(clamped.w)}×${Math.round(clamped.h)}`}
          <span className="ml-2 text-slate-400">
            Select: click a shape, drag it or its handles, Delete removes it, a swatch recolours it ·
            drag to draw · click for a callout · 1–7 or V pick a tool · Ctrl+Z / Ctrl+Shift+Z · Ctrl+Enter save · Esc
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
