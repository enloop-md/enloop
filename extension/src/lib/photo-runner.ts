/**
 * The runner's half of a `### Photo`: turn a spec into a capture and a
 * list of ops, with nothing asked of the tester.
 *
 * The spec names elements; the page says where they are right now; the
 * capture is the viewport at that instant. Every mark becomes an ordinary
 * op — the editor can undo or add to them, nothing is special — and a
 * selector that matches nothing is skipped and reported, never fatal: a
 * guide with one missing arrow is still a guide, and the amber marker on
 * the step tells the author which selector to fix.
 */

import type { PhotoSpec, ScreenshotOp } from "@tcm/shared";
import { elementRects, type DeviceRect } from "./element-rects.js";
import { activePageUrl, captureScreenshotDetailed } from "./page-capture.js";
import { clampCrop, dataUrlToBytes, decodePng, metrics, renderScreenshot } from "./screenshot-render.js";

export interface TakenPhoto {
  sourcePng: Uint8Array;
  renderedPng: Uint8Array;
  width: number;
  height: number;
  ops: ScreenshotOp[];
  missing: string[];
  pageUrl: string;
}

export type TakePhotoResult =
  | { ok: true; photo: TakenPhoto }
  | { ok: false; error: string; needsGesture: boolean };

/** A crop that shows nearly the whole capture is no crop. */
const CROP_COVER_LIMIT = 0.95;
/** How far an arrow's tail sits from its tip, in CSS px. */
const ARROW_LENGTH = 100;

/**
 * Ops for a spec against the rects the page reported. Exported for the
 * hand-taken `& edit` path, which wants only the element crop.
 */
export function opsFromRects(
  spec: PhotoSpec,
  rects: Map<string, DeviceRect | null>,
  dpr: number,
  width: number,
  height: number,
): { ops: ScreenshotOp[]; missing: string[] } {
  const m = metrics(width);
  const ops: ScreenshotOp[] = [];
  const missing: string[] = [];
  const rectOf = (selector: string): DeviceRect | null => {
    const r = rects.get(selector) ?? null;
    if (!r) missing.push(selector);
    return r;
  };

  // The crop first, since every other mark is clamped into it.
  let bounds: DeviceRect = { x: 0, y: 0, w: width, h: height };
  if (spec.crop) {
    const r = rectOf(spec.crop);
    if (r) {
      const pad = spec.pad * dpr;
      const crop = clampCrop(
        { tool: "crop", x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 },
        width,
        height,
      );
      if ((crop.w * crop.h) / (width * height) < CROP_COVER_LIMIT) {
        ops.push(crop);
        bounds = { x: crop.x, y: crop.y, w: crop.w, h: crop.h };
      }
    }
  }
  const clampX = (x: number) => Math.max(bounds.x, Math.min(x, bounds.x + bounds.w));
  const clampY = (y: number) => Math.max(bounds.y, Math.min(y, bounds.y + bounds.h));

  for (const selector of spec.blurs) {
    const r = rectOf(selector);
    if (r) ops.push({ tool: "blur", x: r.x, y: r.y, w: r.w, h: r.h });
  }
  for (const selector of spec.marks) {
    const r = rectOf(selector);
    if (!r) continue;
    // Just outside the element, so the stroke does not cover its edge.
    const gap = m.lineWidth;
    ops.push({ tool: "rect", x: r.x - gap, y: r.y - gap, w: r.w + gap * 2, h: r.h + gap * 2, color: spec.color });
  }
  for (const selector of spec.points) {
    const r = rectOf(selector);
    if (!r) continue;
    const length = ARROW_LENGTH * dpr;
    // From the lower left by default; mirrored when the element sits in the
    // left third of the picture, where a tail would leave the frame.
    const fromLeft = r.x - bounds.x > bounds.w * 0.3;
    const tipX = fromLeft ? r.x - m.lineWidth : r.x + r.w + m.lineWidth;
    const tipY = r.y + r.h / 2;
    const angle = fromLeft ? (5 * Math.PI) / 6 : Math.PI / 6;
    ops.push({
      tool: "arrow",
      x1: clampX(tipX + length * Math.cos(angle)),
      y1: clampY(tipY + length * Math.sin(angle)),
      x2: tipX,
      y2: tipY,
      color: spec.color,
    });
  }
  let n = 0;
  for (const callout of spec.callouts) {
    const r = rectOf(callout.selector);
    if (!r) continue;
    n += 1;
    // The disc sits on the element's top-left corner, half outside it,
    // and never leaves the crop.
    const cx = Math.max(bounds.x + m.radius, Math.min(r.x - m.radius * 0.3, bounds.x + bounds.w - m.radius));
    const cy = Math.max(bounds.y + m.radius, Math.min(r.y - m.radius * 0.3, bounds.y + bounds.h - m.radius));
    ops.push({ tool: "callout", x: cx, y: cy, n, color: spec.color });
  }
  return { ops, missing };
}

/** The selectors a spec needs measured, in a fixed order. */
function specSelectors(spec: PhotoSpec): string[] {
  const all = [
    spec.crop,
    ...spec.marks,
    ...spec.points,
    ...spec.callouts.map((c) => c.selector),
    ...spec.blurs,
  ].filter(Boolean);
  return [...new Set(all)];
}

/**
 * Takes the photo a spec describes from the page in front of the panel.
 * `stepSelectors` is what the capture scrolls to when the spec names
 * nothing to scroll to — the step's own subject.
 */
export async function takePhoto(spec: PhotoSpec, stepSelectors: string[]): Promise<TakePhotoResult> {
  const selectors = specSelectors(spec);
  const scrollTo = spec.crop || selectors[0] || stepSelectors[0] || "";
  const measured = await elementRects(scrollTo, selectors);
  if (!measured) return { ok: false, error: "no access to this page", needsGesture: false };

  const captured = await captureScreenshotDetailed();
  if (!captured.ok) return captured;
  const sourcePng = captured.png;

  const bitmap = await decodePng(sourcePng);
  try {
    const rects = new Map(selectors.map((s, i) => [s, measured.rects[i] ?? null]));
    const { ops, missing } = opsFromRects(spec, rects, measured.dpr, bitmap.width, bitmap.height);
    const renderedPng = ops.length > 0 ? await renderScreenshot(bitmap, ops) : sourcePng;
    return {
      ok: true,
      photo: {
        sourcePng,
        renderedPng,
        width: bitmap.width,
        height: bitmap.height,
        ops,
        missing,
        pageUrl: await activePageUrl(),
      },
    };
  } finally {
    bitmap.close();
  }
}

/** A hand-taken capture: no ops, just the bytes and their size. */
export async function takePlainScreenshot(): Promise<TakePhotoResult> {
  const captured = await captureScreenshotDetailed();
  if (!captured.ok) return captured;
  const sourcePng = captured.png;
  const bitmap = await decodePng(sourcePng);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return {
    ok: true,
    photo: { sourcePng, renderedPng: sourcePng, ...size, ops: [], missing: [], pageUrl: await activePageUrl() },
  };
}

/** A capture the background worker took on a gesture, as a hand-taken
 * photo the panel can attach like any other. */
export async function photoFromDataUrl(dataUrl: string, pageUrl: string): Promise<TakenPhoto> {
  const sourcePng = dataUrlToBytes(dataUrl);
  const bitmap = await decodePng(sourcePng);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return { sourcePng, renderedPng: sourcePng, ...size, ops: [], missing: [], pageUrl };
}

/**
 * The crop `& edit` opens with when the step's Highlight matched an
 * element: the element padded by 48 CSS px, unless that is nearly the
 * whole picture. Null when there is nothing to crop to.
 */
export async function elementCrop(selector: string, width: number, height: number): Promise<ScreenshotOp | null> {
  const measured = await elementRects("", [selector]);
  const r = measured?.rects[0];
  if (!measured || !r) return null;
  const pad = 48 * measured.dpr;
  const crop = clampCrop({ tool: "crop", x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }, width, height);
  return (crop.w * crop.h) / (width * height) >= 0.9 ? null : crop;
}
