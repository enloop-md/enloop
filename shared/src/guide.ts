/**
 * A finished run as a user guide.
 *
 * A case run step by step, with a picture at each step, is a guide: the
 * prose comes from the frozen `case.md`, the pictures from the run's
 * screenshots, and the order from the run. What a tester needs and a reader
 * does not — notes, selectors, scripts, photo specs, verdicts, comments,
 * ratings — never crosses over. Two outputs from one walk: Markdown with
 * image references (a folder with an `images/` beside it) and a single
 * HTML page (images inlined as data URLs by the caller's `imageRef`).
 *
 * Used by the validator's `export-guide` and by the panel's Download guide,
 * so the two cannot disagree about what a guide contains.
 */

import { renderInline, renderMarkdown } from "./html.js";
import {
  PHOTO_PLACEHOLDER_RE,
  VIA_LINK_ONLY_RE,
  renderBulletList,
  screenshotAlt,
  stepNumberLabels,
} from "./markdown.js";
import type {
  FreeRunFile,
  RunFile,
  RunScreenshot,
  RunStepState,
  Step,
  TestCaseVersion,
} from "./types.js";

export interface GuideRenderOptions {
  /** How an image is referenced: a relative path for Markdown, a data URL
   * for HTML. */
  imageRef: (shot: RunScreenshot) => string;
}

export interface GuideOutput {
  text: string;
  /** Things the guide could not do — an unfilled `%PHOTO_n%` — for the
   * exporter to print and the panel to show. */
  warnings: string[];
}

export interface GuideStep {
  step: Step;
  state: RunStepState;
  /** Display number over the included steps only — a guide never reads
   * "1, 2, 4". */
  label: string;
}

/** The steps a guide shows: document order, every step the run did not
 * skip, numbered over that list. */
export function guideSteps(doc: TestCaseVersion, run: RunFile): GuideStep[] {
  const byId = new Map(run.steps.map((s) => [s.stepId, s]));
  const included = doc.steps
    .map((step) => ({ step, state: byId.get(step.id) }))
    .filter((s): s is { step: Step; state: RunStepState } => !!s.state && s.state.status !== "skipped");
  const labels = stepNumberLabels(included.map((s) => s.step));
  return included.map((s, i) => ({ ...s, label: labels[i] }));
}

/** A figure's legend: the spec's callout texts, in order, only for a
 * screenshot that fills a slot. */
function legendOf(step: Step | null, shot: RunScreenshot): string[] {
  if (!step || shot.slot === null) return [];
  const spec = step.photos[shot.slot - 1];
  if (!spec) return [];
  // In lockstep with the discs the runner drew: a callout whose selector
  // matched nothing has no disc, so it takes no number; one without text
  // still has a disc, so it keeps its line — named by its selector rather
  // than shifting every number after it.
  return spec.callouts
    .filter((c) => !shot.missing.includes(c.selector))
    .map((c) => c.text.trim() || c.selector);
}

/** What the figure shows: the crop's size when there is one, else the
 * capture's — the rendered PNG is the cropped image. */
function shownSize(shot: RunScreenshot): { width: number; height: number } {
  const crop = shot.ops.find((op) => op.tool === "crop");
  if (!crop) return { width: shot.width, height: shot.height };
  return { width: Math.round(crop.w), height: Math.round(crop.h) };
}

/** The caption a figure shows: the screenshot's own, else the spec's. */
function captionOf(step: Step | null, shot: RunScreenshot): string {
  if (shot.caption.trim()) return shot.caption.trim();
  if (step && shot.slot !== null) return step.photos[shot.slot - 1]?.caption.trim() ?? "";
  return "";
}

function bySeq(shots: RunScreenshot[]): RunScreenshot[] {
  return [...shots].sort((a, b) => a.seq - b.seq);
}

// ---- Markdown ---------------------------------------------------------------

function figureMarkdown(step: Step | null, shot: RunScreenshot, opts: GuideRenderOptions): string {
  const caption = captionOf(step, shot);
  const lines = [`![${caption || screenshotAlt(shot)}](${opts.imageRef(shot)})`];
  if (caption) lines.push(`*${caption}*`);
  const legend = legendOf(step, shot);
  if (legend.length > 0) {
    lines.push("");
    legend.forEach((text, i) => lines.push(`${i + 1}. ${text}`));
  }
  return lines.join("\n");
}

/** `text` with every `%PHOTO_n%` replaced by the figure that fills it, on
 * its own paragraph; unfilled ones are dropped and reported. */
function placeFiguresMarkdown(
  text: string,
  at: string,
  step: Step,
  bySlot: Map<number, RunScreenshot>,
  opts: GuideRenderOptions,
  warnings: string[],
): string {
  return text.replace(PHOTO_PLACEHOLDER_RE, (_m, n: string) => {
    const shot = bySlot.get(Number(n));
    if (!shot) {
      warnings.push(`${at}: %PHOTO_${n}% has no screenshot in this run; dropped.`);
      return "";
    }
    return `\n\n${figureMarkdown(step, shot, opts)}\n\n`;
  });
}

/** Collapses the blank runs that dropped or inserted figures leave. */
function tidy(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function renderGuideMarkdown(
  doc: TestCaseVersion,
  run: RunFile,
  opts: GuideRenderOptions,
): GuideOutput {
  const warnings: string[] = [];
  const out: string[] = [];
  const push = (s: string) => {
    out.push(s);
    out.push("");
  };

  push(`# ${doc.title.trim()}`);
  if (doc.goal.trim()) push(doc.goal.trim());
  if (doc.description.trim()) push(doc.description.trim());
  for (const shot of bySeq(run.screenshots.filter((s) => s.stepId === null))) {
    push(figureMarkdown(null, shot, opts));
  }

  const before = [...doc.youWillNeed, ...doc.prerequisites];
  if (before.length > 0) {
    push("## Before you start");
    push(renderBulletList(before));
  }

  const grouped = doc.groups.length > 0;
  let openGroup: string | undefined;
  for (const { step, label } of guideSteps(doc, run)) {
    if (grouped && step.group && step.group !== openGroup) {
      openGroup = step.group;
      push(`## ${step.group}`);
      const goal = doc.groups.find((g) => g.title === step.group)?.goal.trim();
      if (goal) push(goal);
    }
    push(`${grouped ? "###" : "##"} ${label}. ${step.title.trim()}`);
    if (step.where?.trim()) push(`Go to: \`${step.where.trim()}\``);
    if (step.via?.trim() && !VIA_LINK_ONLY_RE.test(step.via.trim())) {
      push(`Find it under: ${step.via.trim()}`);
    }

    const shots = bySeq(run.screenshots.filter((s) => s.stepId === step.id));
    const bySlot = new Map(shots.filter((s) => s.slot !== null).map((s) => [s.slot!, s]));
    const at = `Step ${label} "${step.title.trim()}"`;
    const placed = new Set<number>([
      ...placeholdersOf(step.instructions ?? ""),
      ...placeholdersOf(step.expected ?? ""),
    ]);

    if (step.instructions?.trim()) {
      push(tidy(placeFiguresMarkdown(step.instructions.trim(), at, step, bySlot, opts, warnings)));
    }
    // Slot photos the prose never placed go after the instructions; hand
    // shots sit among them in the order they were taken.
    for (const shot of shots) {
      if (shot.slot !== null && placed.has(shot.slot)) continue;
      push(figureMarkdown(step, shot, opts));
    }
    if (step.expected?.trim()) {
      push("**You should see:**");
      push(tidy(placeFiguresMarkdown(step.expected.trim(), at, step, bySlot, opts, warnings)));
    }
  }

  push("---");
  push(`*Made with Enloop from run ${run.id} of v${run.testCaseVersion}.*`);
  return { text: tidy(out.join("\n")) + "\n", warnings };
}

function placeholdersOf(text: string): number[] {
  return [...text.matchAll(PHOTO_PLACEHOLDER_RE)].map((m) => Number(m[1]));
}

// ---- HTML -------------------------------------------------------------------

export const GUIDE_PAGE_CSS = `
:root { --bg: #ffffff; --ink: #0f172a; --muted: #64748b; --line: #e2e8f0; --link: #0369a1; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0b1120; --ink: #e2e8f0; --muted: #94a3b8; --line: #1f2937; --link: #7dd3fc; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); padding: 24px 16px 64px;
  font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.guide { max-width: 46rem; margin: 0 auto; }
h1 { font-size: 1.8rem; line-height: 1.25; margin: 0 0 12px; letter-spacing: -0.01em; }
h2 { font-size: 1.25rem; margin: 32px 0 8px; }
h3 { font-size: 1.05rem; margin: 24px 0 6px; }
p { margin: 8px 0; }
ul, ol { margin: 6px 0; padding-left: 22px; }
code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(127,127,127,.12);
  border-radius: 4px; padding: 1px 5px; }
a { color: var(--link); }
.nav { color: var(--muted); font-size: 0.95em; margin: 4px 0; }
figure { margin: 14px 0; }
figure img { max-width: 100%; height: auto; display: block; border: 1px solid var(--line); border-radius: 8px; }
figcaption { color: var(--muted); font-size: 0.9em; margin-top: 6px; }
figure ol { font-size: 0.9em; margin-top: 4px; }
.see { font-weight: 600; margin-top: 12px; }
footer { color: var(--muted); font-size: 0.85em; margin-top: 40px; border-top: 1px solid var(--line); padding-top: 12px; }
.chip { font: inherit; border: 1px solid var(--line); border-radius: 6px; padding: 0 5px; background: transparent; color: inherit; }
`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function figureHtml(step: Step | null, shot: RunScreenshot, opts: GuideRenderOptions): string {
  const caption = captionOf(step, shot);
  const legend = legendOf(step, shot);
  const size = shownSize(shot);
  return (
    `<figure><img src="${escapeHtml(opts.imageRef(shot))}" alt="${escapeHtml(caption || screenshotAlt(shot))}" ` +
    `width="${size.width}" height="${size.height}">` +
    (caption ? `<figcaption>${renderInline(caption)}</figcaption>` : "") +
    (legend.length > 0 ? `<ol>${legend.map((t) => `<li>${renderInline(t)}</li>`).join("")}</ol>` : "") +
    `</figure>`
  );
}

/** Markdown prose with `%PHOTO_n%` cut out and the figure HTML put between
 * the rendered chunks — a figure is block content and cannot sit inside a
 * paragraph the Markdown renderer would build around the token. */
function placeFiguresHtml(
  text: string,
  at: string,
  step: Step,
  bySlot: Map<number, RunScreenshot>,
  opts: GuideRenderOptions,
  warnings: string[],
): string {
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(PHOTO_PLACEHOLDER_RE)) {
    const chunk = text.slice(last, m.index).trim();
    if (chunk) parts.push(renderMarkdown(chunk));
    const shot = bySlot.get(Number(m[1]));
    if (shot) parts.push(figureHtml(step, shot, opts));
    else warnings.push(`${at}: %PHOTO_${m[1]}% has no screenshot in this run; dropped.`);
    last = (m.index ?? 0) + m[0].length;
  }
  const tail = text.slice(last).trim();
  if (tail) parts.push(renderMarkdown(tail));
  return parts.join("\n");
}

export function renderGuideHtml(
  doc: TestCaseVersion,
  run: RunFile,
  opts: GuideRenderOptions,
): GuideOutput {
  const warnings: string[] = [];
  const body: string[] = [];

  body.push(`<h1>${escapeHtml(doc.title.trim())}</h1>`);
  if (doc.goal.trim()) body.push(`<p>${renderInline(doc.goal.trim())}</p>`);
  if (doc.description.trim()) body.push(renderMarkdown(doc.description.trim()));
  for (const shot of bySeq(run.screenshots.filter((s) => s.stepId === null))) {
    body.push(figureHtml(null, shot, opts));
  }
  const before = [...doc.youWillNeed, ...doc.prerequisites];
  if (before.length > 0) {
    body.push("<h2>Before you start</h2>");
    body.push(renderMarkdown(renderBulletList(before)));
  }

  const grouped = doc.groups.length > 0;
  let openGroup: string | undefined;
  for (const { step, label } of guideSteps(doc, run)) {
    if (grouped && step.group && step.group !== openGroup) {
      openGroup = step.group;
      body.push(`<h2>${escapeHtml(step.group)}</h2>`);
      const goal = doc.groups.find((g) => g.title === step.group)?.goal.trim();
      if (goal) body.push(`<p>${renderInline(goal)}</p>`);
    }
    const tag = grouped ? "h3" : "h2";
    body.push(`<${tag}>${escapeHtml(label)}. ${escapeHtml(step.title.trim())}</${tag}>`);
    if (step.where?.trim()) body.push(`<p class="nav">Go to: <code>${escapeHtml(step.where.trim())}</code></p>`);
    if (step.via?.trim() && !VIA_LINK_ONLY_RE.test(step.via.trim())) {
      body.push(`<p class="nav">Find it under: ${renderInline(step.via.trim())}</p>`);
    }

    const shots = bySeq(run.screenshots.filter((s) => s.stepId === step.id));
    const bySlot = new Map(shots.filter((s) => s.slot !== null).map((s) => [s.slot!, s]));
    const at = `Step ${label} "${step.title.trim()}"`;
    const placed = new Set<number>([
      ...placeholdersOf(step.instructions ?? ""),
      ...placeholdersOf(step.expected ?? ""),
    ]);

    if (step.instructions?.trim()) {
      body.push(placeFiguresHtml(step.instructions.trim(), at, step, bySlot, opts, warnings));
    }
    for (const shot of shots) {
      if (shot.slot !== null && placed.has(shot.slot)) continue;
      body.push(figureHtml(step, shot, opts));
    }
    if (step.expected?.trim()) {
      body.push(`<p class="see">You should see:</p>`);
      body.push(placeFiguresHtml(step.expected.trim(), at, step, bySlot, opts, warnings));
    }
  }

  body.push(`<footer>Made with Enloop from run ${escapeHtml(run.id)} of v${escapeHtml(String(run.testCaseVersion))}.</footer>`);
  return { text: page(doc.title.trim(), body.join("\n")), warnings };
}

function page(title: string, body: string): string {
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n<style>${GUIDE_PAGE_CSS}</style>\n</head>\n` +
    `<body>\n<main class="guide">\n${body}\n</main>\n</body>\n</html>\n`
  );
}

// ---- free runs --------------------------------------------------------------

/** A free run's notes with `%PHOTO_<seq>%` replaced by its figures, and
 * every screenshot the notes never placed appended at the end. */
export function renderFreeRunGuideMarkdown(
  free: FreeRunFile,
  notes: string,
  opts: GuideRenderOptions,
): GuideOutput {
  const warnings: string[] = [];
  const bySeqMap = new Map(free.screenshots.map((s) => [s.seq, s]));
  const placed = new Set(placeholdersOf(notes));
  const body = notes.replace(PHOTO_PLACEHOLDER_RE, (_m, n: string) => {
    const shot = bySeqMap.get(Number(n));
    if (!shot) {
      warnings.push(`%PHOTO_${n}% names no screenshot of this session; dropped.`);
      return "";
    }
    return `\n\n${figureMarkdown(null, shot, opts)}\n\n`;
  });
  const out = [`# ${free.title.trim() || "Free run"}`, "", tidy(body)];
  for (const shot of bySeq(free.screenshots)) {
    if (placed.has(shot.seq)) continue;
    out.push("", figureMarkdown(null, shot, opts));
  }
  out.push("", "---", "", `*Made with Enloop from free run ${free.id}.*`);
  return { text: tidy(out.join("\n")) + "\n", warnings };
}

export function renderFreeRunGuideHtml(
  free: FreeRunFile,
  notes: string,
  opts: GuideRenderOptions,
): GuideOutput {
  const warnings: string[] = [];
  const bySeqMap = new Map(free.screenshots.map((s) => [s.seq, s]));
  const placed = new Set(placeholdersOf(notes));
  const parts: string[] = [`<h1>${escapeHtml(free.title.trim() || "Free run")}</h1>`];
  let last = 0;
  for (const m of notes.matchAll(PHOTO_PLACEHOLDER_RE)) {
    const chunk = notes.slice(last, m.index).trim();
    if (chunk) parts.push(renderMarkdown(chunk));
    const shot = bySeqMap.get(Number(m[1]));
    if (shot) parts.push(figureHtml(null, shot, opts));
    else warnings.push(`%PHOTO_${m[1]}% names no screenshot of this session; dropped.`);
    last = (m.index ?? 0) + m[0].length;
  }
  const tail = notes.slice(last).trim();
  if (tail) parts.push(renderMarkdown(tail));
  for (const shot of bySeq(free.screenshots)) {
    if (!placed.has(shot.seq)) parts.push(figureHtml(null, shot, opts));
  }
  parts.push(`<footer>Made with Enloop from free run ${escapeHtml(free.id)}.</footer>`);
  return { text: page(free.title.trim() || "Free run", parts.join("\n")), warnings };
}
