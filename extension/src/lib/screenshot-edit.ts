/**
 * Selecting, moving and resizing ops after they were drawn.
 *
 * The ops stay what they were — plain records in source pixels — and this
 * module is the geometry that makes them editable: which op is under a
 * point, where its handles are, and what it becomes when a handle or the
 * whole shape is dragged. The editor owns the pointer state; nothing here
 * touches a canvas, so the same rules apply to a runner-drawn callout and
 * a hand-drawn one.
 */

import type { ScreenshotOp } from "@tcm/shared";
import { metrics } from "./screenshot-render.js";

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box op's eight handles, and a line op's two ends. */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "start" | "end";

function isBox(op: ScreenshotOp): op is Extract<ScreenshotOp, { tool: "crop" | "blur" | "rect" }> {
  return op.tool === "crop" || op.tool === "blur" || op.tool === "rect";
}

function isLine(op: ScreenshotOp): op is Extract<ScreenshotOp, { tool: "line" | "arrow" }> {
  return op.tool === "line" || op.tool === "arrow";
}

/** Everything an op covers, for the selection outline. */
export function boundsOf(op: ScreenshotOp, sourceWidth: number): Box {
  const m = metrics(sourceWidth);
  switch (op.tool) {
    case "crop":
    case "blur":
    case "rect":
      return { x: op.x, y: op.y, w: op.w, h: op.h };
    case "line":
    case "arrow": {
      const x = Math.min(op.x1, op.x2);
      const y = Math.min(op.y1, op.y2);
      return { x, y, w: Math.abs(op.x2 - op.x1), h: Math.abs(op.y2 - op.y1) };
    }
    case "callout":
      return { x: op.x - m.radius, y: op.y - m.radius, w: m.radius * 2, h: m.radius * 2 };
  }
}

/** Handle positions for a selected op. Callouts move only. */
export function handlesOf(op: ScreenshotOp, sourceWidth: number): { handle: Handle; at: Point }[] {
  if (isLine(op)) {
    return [
      { handle: "start", at: { x: op.x1, y: op.y1 } },
      { handle: "end", at: { x: op.x2, y: op.y2 } },
    ];
  }
  if (!isBox(op)) return [];
  const b = boundsOf(op, sourceWidth);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return [
    { handle: "nw", at: { x: b.x, y: b.y } },
    { handle: "n", at: { x: cx, y: b.y } },
    { handle: "ne", at: { x: b.x + b.w, y: b.y } },
    { handle: "e", at: { x: b.x + b.w, y: cy } },
    { handle: "se", at: { x: b.x + b.w, y: b.y + b.h } },
    { handle: "s", at: { x: cx, y: b.y + b.h } },
    { handle: "sw", at: { x: b.x, y: b.y + b.h } },
    { handle: "w", at: { x: b.x, y: cy } },
  ];
}

/** How close a pointer must come, in source px — generous, since the image
 * is usually shown scaled down. */
export function tolerance(sourceWidth: number, scale: number): number {
  return Math.max(metrics(sourceWidth).lineWidth * 2, 10 / scale);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function nearBorder(p: Point, b: Box, t: number): boolean {
  const inside = p.x >= b.x - t && p.x <= b.x + b.w + t && p.y >= b.y - t && p.y <= b.y + b.h + t;
  if (!inside) return false;
  const deepInside = p.x > b.x + t && p.x < b.x + b.w - t && p.y > b.y + t && p.y < b.y + b.h - t;
  return !deepInside;
}

/** Is `p` on this op — its stroke for hollow shapes, anywhere inside for
 * filled ones. */
export function hits(op: ScreenshotOp, p: Point, sourceWidth: number, t: number): boolean {
  const m = metrics(sourceWidth);
  switch (op.tool) {
    case "rect":
    case "crop":
      return nearBorder(p, op, t);
    case "blur":
      return p.x >= op.x - t && p.x <= op.x + op.w + t && p.y >= op.y - t && p.y <= op.y + op.h + t;
    case "line":
    case "arrow":
      return distanceToSegment(p, { x: op.x1, y: op.y1 }, { x: op.x2, y: op.y2 }) <= t;
    case "callout":
      return Math.hypot(p.x - op.x, p.y - op.y) <= m.radius + t;
  }
}

/** The topmost op under `p`, or -1. Later ops are drawn on top, so they
 * win; the crop, drawn as dimming rather than a shape, comes last. */
export function hitTest(ops: ScreenshotOp[], p: Point, sourceWidth: number, t: number): number {
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i].tool !== "crop" && hits(ops[i], p, sourceWidth, t)) return i;
  }
  const crop = ops.findIndex((op) => op.tool === "crop");
  return crop >= 0 && hits(ops[crop], p, sourceWidth, t) ? crop : -1;
}

export function hitHandle(op: ScreenshotOp, p: Point, sourceWidth: number, t: number): Handle | null {
  for (const { handle, at } of handlesOf(op, sourceWidth)) {
    if (Math.abs(p.x - at.x) <= t && Math.abs(p.y - at.y) <= t) return handle;
  }
  return null;
}

export function moved(op: ScreenshotOp, dx: number, dy: number): ScreenshotOp {
  switch (op.tool) {
    case "crop":
    case "blur":
    case "rect":
      return { ...op, x: op.x + dx, y: op.y + dy };
    case "line":
    case "arrow":
      return { ...op, x1: op.x1 + dx, y1: op.y1 + dy, x2: op.x2 + dx, y2: op.y2 + dy };
    case "callout":
      return { ...op, x: op.x + dx, y: op.y + dy };
  }
}

const MIN_SIDE = 4;

/** `op` with `handle` dragged to `p`. A box dragged past its opposite edge
 * stops at the minimum size rather than flipping. */
export function resized(op: ScreenshotOp, handle: Handle, p: Point): ScreenshotOp {
  if (isLine(op)) {
    return handle === "start" ? { ...op, x1: p.x, y1: p.y } : { ...op, x2: p.x, y2: p.y };
  }
  if (!isBox(op)) return op;
  let { x, y, w, h } = op;
  const right = x + w;
  const bottom = y + h;
  if (handle.includes("w")) {
    x = Math.min(p.x, right - MIN_SIDE);
    w = right - x;
  }
  if (handle.includes("e")) w = Math.max(MIN_SIDE, p.x - x);
  if (handle.includes("n")) {
    y = Math.min(p.y, bottom - MIN_SIDE);
    h = bottom - y;
  }
  if (handle.includes("s")) h = Math.max(MIN_SIDE, p.y - y);
  return { ...op, x, y, w, h };
}

/** Keeps a shape inside the picture after a move or resize. */
export function clampedToImage(op: ScreenshotOp, width: number, height: number): ScreenshotOp {
  const cx = (v: number) => Math.max(0, Math.min(v, width));
  const cy = (v: number) => Math.max(0, Math.min(v, height));
  switch (op.tool) {
    case "crop":
    case "blur":
    case "rect": {
      const x = Math.max(0, Math.min(op.x, width - MIN_SIDE));
      const y = Math.max(0, Math.min(op.y, height - MIN_SIDE));
      return { ...op, x, y, w: Math.max(MIN_SIDE, Math.min(op.w, width - x)), h: Math.max(MIN_SIDE, Math.min(op.h, height - y)) };
    }
    case "line":
    case "arrow":
      return { ...op, x1: cx(op.x1), y1: cy(op.y1), x2: cx(op.x2), y2: cy(op.y2) };
    case "callout":
      return { ...op, x: cx(op.x), y: cy(op.y) };
  }
}

/** Callouts numbered densely in list order — what a deletion or a
 * reorder leaves behind should still count 1, 2, 3. */
export function renumberCallouts(ops: ScreenshotOp[]): ScreenshotOp[] {
  let n = 0;
  return ops.map((op) => (op.tool === "callout" ? { ...op, n: ++n } : op));
}

export function cursorFor(handle: Handle | null, overOp: boolean): string {
  switch (handle) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "start":
    case "end":
      return "move";
    default:
      return overOp ? "move" : "default";
  }
}
