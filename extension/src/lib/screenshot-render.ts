/**
 * Drawing a screenshot's operation list onto its source.
 *
 * One module for the three places a shape is drawn — the editor's live
 * preview, the final render that becomes `<NN>.png`, and the runner that
 * generates ops from element rects — so what the tester sees while dragging
 * is what is saved, and what the runner draws is what the editor would have.
 *
 * Every size derives from the source width: a 4K capture and a phone-sized
 * one get strokes that look the same at the same display size, and the
 * numbers are the same on every machine, so a re-render of an old
 * screenshot from its ops reproduces the file byte for byte.
 *
 * Coordinates are source pixels — device pixels as Chrome captured them —
 * and the crop is applied last, so shapes are addressed against the
 * uncropped capture and survive the crop being changed (decision G7 in
 * PLAN-GUIDES.md).
 */

import { SHOT_COLORS, type CropOp, type ScreenshotOp } from "@tcm/shared";

export { SHOT_COLORS };

export interface StrokeMetrics {
  lineWidth: number;
  /** Arrow-head length. */
  head: number;
  /** Callout disc radius. */
  radius: number;
  font: string;
  /** Gaussian blur radius, in source px. */
  blur: number;
}

export function metrics(sourceWidth: number): StrokeMetrics {
  const lineWidth = Math.max(3, Math.round(sourceWidth / 480));
  const radius = lineWidth * 5;
  return {
    lineWidth,
    head: lineWidth * 5,
    radius,
    font: `bold ${Math.round(radius * 1.3)}px system-ui, sans-serif`,
    blur: Math.max(5, Math.round(sourceWidth / 260)),
  };
}

/** The palette's one light colour needs dark ink on it. */
function inkOn(color: string): string {
  return color.toUpperCase() === "#FFFFFF" ? "#1C2024" : "#FFFFFF";
}

export function cropOf(ops: ScreenshotOp[]): CropOp | null {
  for (const op of ops) if (op.tool === "crop") return op;
  return null;
}

/** `ops` with the crop replaced in place, appended when there was none,
 * or removed when `crop` is null — there is only ever one. */
export function withCrop(ops: ScreenshotOp[], crop: CropOp | null): ScreenshotOp[] {
  const index = ops.findIndex((op) => op.tool === "crop");
  if (crop === null) return index < 0 ? ops : ops.filter((_, i) => i !== index);
  if (index < 0) return [...ops, crop];
  return ops.map((op, i) => (i === index ? crop : op));
}

/** A crop clamped to the image and to a minimum size a reader can see. */
export function clampCrop(crop: CropOp, width: number, height: number): CropOp {
  const x = Math.max(0, Math.min(crop.x, width - 8));
  const y = Math.max(0, Math.min(crop.y, height - 8));
  const w = Math.max(8, Math.min(crop.w, width - x));
  const h = Math.max(8, Math.min(crop.h, height - y));
  return { tool: "crop", x, y, w, h };
}

/** The number the next hand-drawn callout gets — dense, since undo pops
 * the last op and the count follows. */
export function nextCalloutNumber(ops: ScreenshotOp[]): number {
  return ops.filter((op) => op.tool === "callout").length + 1;
}

function drawBlur(ctx: CanvasRenderingContext2D, op: Extract<ScreenshotOp, { tool: "blur" }>, m: StrokeMetrics): void {
  const w = Math.max(1, Math.round(op.w));
  const h = Math.max(1, Math.round(op.h));
  const x = Math.round(op.x);
  const y = Math.round(op.y);
  // A Gaussian blur, not a pixelation: it takes the letters out of a field
  // and leaves the field — its edges, its size, its place in the layout —
  // so the reader still sees what the picture is of. The radius follows
  // the capture width the way strokes do, sized to smear text of the
  // usual size and no more.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.filter = `blur(${m.blur}px)`;
  // The canvas drawn onto itself is snapshotted first, so this reads the
  // unblurred pixels; the clip keeps the effect inside the region while
  // the filter still samples across its edge, which is what makes the
  // edge soft rather than a hard-cut box.
  ctx.drawImage(ctx.canvas, 0, 0);
  ctx.restore();
}

function drawLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, m: StrokeMetrics): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = m.lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, op: Extract<ScreenshotOp, { tool: "arrow" }>, m: StrokeMetrics): void {
  const angle = Math.atan2(op.y2 - op.y1, op.x2 - op.x1);
  // The shaft stops short of the tip so it does not poke through the head.
  const back = m.head * 0.6;
  const sx = op.x2 - back * Math.cos(angle);
  const sy = op.y2 - back * Math.sin(angle);
  drawLine(ctx, op.x1, op.y1, sx, sy, op.color, m);
  ctx.save();
  ctx.fillStyle = op.color;
  ctx.strokeStyle = op.color;
  ctx.lineWidth = m.lineWidth;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(op.x2, op.y2);
  ctx.lineTo(op.x2 - m.head * Math.cos(angle - Math.PI / 7), op.y2 - m.head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(op.x2 - m.head * Math.cos(angle + Math.PI / 7), op.y2 - m.head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawRect(ctx: CanvasRenderingContext2D, op: Extract<ScreenshotOp, { tool: "rect" }>, m: StrokeMetrics): void {
  ctx.save();
  ctx.strokeStyle = op.color;
  ctx.lineWidth = m.lineWidth;
  ctx.lineJoin = "miter";
  ctx.strokeRect(op.x, op.y, op.w, op.h);
  ctx.restore();
}

function drawCallout(ctx: CanvasRenderingContext2D, op: Extract<ScreenshotOp, { tool: "callout" }>, m: StrokeMetrics): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(op.x, op.y, m.radius, 0, Math.PI * 2);
  ctx.fillStyle = op.color;
  ctx.fill();
  ctx.lineWidth = m.lineWidth / 2;
  ctx.strokeStyle = inkOn(op.color);
  ctx.stroke();
  ctx.fillStyle = inkOn(op.color);
  ctx.font = m.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(op.n), op.x, op.y + m.radius * 0.05);
  ctx.restore();
}

/**
 * Draws every op but the crop onto `ctx`, which must already show the
 * source at 1:1. Blurs first whatever their position in the list, so a
 * mark over a blurred field stays crisp.
 */
export function drawOps(ctx: CanvasRenderingContext2D, ops: ScreenshotOp[], sourceWidth: number): void {
  const m = metrics(sourceWidth);
  for (const op of ops) if (op.tool === "blur") drawBlur(ctx, op, m);
  for (const op of ops) {
    switch (op.tool) {
      case "line":
        drawLine(ctx, op.x1, op.y1, op.x2, op.y2, op.color, m);
        break;
      case "arrow":
        drawArrow(ctx, op, m);
        break;
      case "rect":
        drawRect(ctx, op, m);
        break;
      case "callout":
        drawCallout(ctx, op, m);
        break;
      default:
        break;
    }
  }
}

/** The dimmed outside and dashed border the editor shows for a crop. Not
 * part of the render; the render cuts. */
export function drawCropOverlay(ctx: CanvasRenderingContext2D, crop: CropOp, width: number, height: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.rect(crop.x, crop.y, crop.w, crop.h);
  ctx.fill("evenodd");
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = Math.max(1, metrics(width).lineWidth / 2);
  ctx.setLineDash([ctx.lineWidth * 4, ctx.lineWidth * 3]);
  ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
  ctx.restore();
}

/** Full render: source, ops, then the crop. PNG bytes. */
export async function renderScreenshot(source: ImageBitmap, ops: ScreenshotOp[]): Promise<Uint8Array> {
  const full = document.createElement("canvas");
  full.width = source.width;
  full.height = source.height;
  const ctx = full.getContext("2d")!;
  ctx.drawImage(source, 0, 0);
  drawOps(ctx, ops, source.width);

  const crop = cropOf(ops);
  let out: HTMLCanvasElement = full;
  if (crop) {
    const c = clampCrop(crop, source.width, source.height);
    out = document.createElement("canvas");
    out.width = Math.round(c.w);
    out.height = Math.round(c.h);
    out.getContext("2d")!.drawImage(full, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
  }
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode the screenshot.");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Bytes to an `ImageBitmap`, and its size — what every caller needs
 * after a capture. Close the bitmap when done. */
export async function decodePng(png: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([new Uint8Array(png).buffer], { type: "image/png" }));
}

export function bytesToDataUrl(png: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < png.length; i += chunk) {
    binary += String.fromCharCode(...png.subarray(i, i + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bytes = atob(base64);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
  return out;
}
