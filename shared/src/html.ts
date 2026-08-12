/**
 * A case as a page a person reads and works through, rather than as a file.
 *
 * One renderer serves two deliveries of the same thing:
 *
 * - **The online viewer** (`viewer/`, published to GitHub Pages) decodes a
 *   case out of a link, parses it, and drops this markup into its document.
 * - **The HTML download** in the side panel writes the same markup out as a
 *   single self-contained file — no network, no assets, nothing to install —
 *   which is what you attach to a ticket or send to someone who will never
 *   have the extension.
 *
 * They must not drift, because the whole promise of the link is that the
 * recipient sees the case you are looking at. So the markup, the CSS and the
 * behaviour all live here, and the two callers differ only in how they get
 * the page in front of someone.
 *
 * Markdown is rendered by the small inline renderer below rather than by a
 * library, for the same reason: the downloaded file has to work with nothing
 * loaded alongside it, and case prose is a narrow dialect — paragraphs,
 * bullets, bold, code, links, and the `"**value**"` marker. Anything richer
 * degrades to escaped text, which is safe and legible rather than broken.
 */

import { looksLikeSelector } from "./selector-text.js";
import type { Step, TestCaseVariable, TestCaseVersion } from "./types.js";

export interface CasePageOptions {
  /**
   * The case rewritten for someone who is going to carry it out by hand —
   * the same edit `renderReadableCase` makes to the Markdown export: no
   * selectors, no scripts, automated steps listed at the end instead of
   * standing in the sequence as things to do.
   */
  simplified?: boolean;
  /** ISO timestamp stamped into the header, so a printed copy says how old it is. */
  exportedAt?: string;
  /**
   * Link back to the online viewer, shown in the footer of a downloaded
   * file. Null in the viewer itself, where it would point at the page you
   * are already on.
   */
  viewerUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Inline Markdown
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escaped for use inside a double-quoted attribute. */
function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

const VARIABLE_TOKEN = /%([A-Za-z_][A-Za-z0-9_]*)%/g;

/** `text` with every `%NAME%` that has a value replaced by it, leaving the
 * rest literal — `substituteVariables`' rule, applied where a span cannot go
 * (attributes). */
function resolveText(text: string, values: Record<string, string>): string {
  return text.replace(VARIABLE_TOKEN, (match, name: string) => values[name]?.trim() || match);
}

/**
 * Copyable things — a value chip, a selector — carry the text to copy in
 * `data-copy`. When that text contains a variable, it also carries the
 * unresolved form, so filling the value in updates what the clipboard gets:
 * a chip that quietly copies `%LOGIN_EMAIL%` into a login field is a trap,
 * and it is exactly the chip a reader is most likely to click.
 */
function copyAttrs(text: string, values: Record<string, string>): string {
  const resolved = resolveText(text, values);
  const template = HAS_VARIABLE.test(text) ? ` data-copy-template="${escapeAttr(text)}"` : "";
  return ` data-copy="${escapeAttr(resolved)}"${template}`;
}

/** Non-global twin of `VARIABLE_TOKEN`: a `g` regex carries `lastIndex`
 * between `test` calls, which turns a pure question into a stateful one. */
const HAS_VARIABLE = /%[A-Za-z_][A-Za-z0-9_]*%/;

/**
 * Wraps every `%NAME%` in a span the page can rewrite live as the reader
 * fills in values. Applied to escaped text only — never to an attribute —
 * so a placeholder inside a URL keeps its literal form and is handled by the
 * link's own template attribute instead.
 */
function withVariableSpans(escapedText: string, values: Record<string, string>): string {
  return escapedText.replace(VARIABLE_TOKEN, (match, name: string) => {
    const value = values[name]?.trim();
    return (
      `<span class="var" data-var="${escapeAttr(name)}"${value ? "" : " data-unset"}>` +
      `${value ? escapeHtml(value) : match}</span>`
    );
  });
}

/** A value an author marked as something to type: `"**Buy milk**"`. Both
 * marks are required — see `rehypeQuotedValues` in the extension for why
 * neither quotes nor bold alone can carry it. */
const QUOTED_VALUE = /["“]\*\*([^*\n]{1,120})\*\*["”]/;
const INLINE_CODE = /`([^`\n]+)`/;
const MD_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/;
const BOLD = /\*\*([^*\n]+)\*\*/;
/**
 * Emphasis, with the character in front of it captured rather than checked
 * by a lookbehind — which older Safari cannot parse, and an unparseable
 * regex here does not degrade, it throws before the page renders at all.
 *
 * The guard on both sides is what keeps snake_case out: without it,
 * `%LOGIN_EMAIL% and %RUN_ID%` matches from the `_` in one variable to the
 * `_` in the next and italicises the span between them.
 */
const EMPHASIS = /(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/;
const AUTOLINK = /https?:\/\/[^\s<>()]+/;
/** A variable-built address in plain prose — `%BASE_URL%/admin/reports`.
 * When it resolves absolute it renders as a link, exactly as if the author
 * had written the Markdown-link form; a case written before this existed
 * gains the links on its next render, with no new markup to learn. A bare
 * `%NAME%` also matches (empty suffix) and falls through to the ordinary
 * value-span rendering. */
const VAR_ADDRESS = /%[A-Za-z_][A-Za-z0-9_]*%[^\s<>()]*/;

/** Alternation order is the precedence: a quoted bold run is a value rather
 * than bold-inside-quotes, and code wins over everything so a selector
 * containing `*` is never read as emphasis. */
const INLINE_SOURCE = [
  `(?<value>${QUOTED_VALUE.source})`,
  `(?<code>${INLINE_CODE.source})`,
  `(?<link>${MD_LINK.source})`,
  `(?<varaddr>${VAR_ADDRESS.source})`,
  `(?<bold>${BOLD.source})`,
  `(?<em>${EMPHASIS.source})`,
  `(?<url>${AUTOLINK.source})`,
].join("|");

/**
 * A selector an author named in prose — `` `#sync-btn` `` — rendered as
 * something the reader can copy. In the side panel these flash the element
 * in the page; here there is no page to flash, and a selector you can put on
 * your clipboard is the most of that idea a document can keep.
 */
function renderCode(value: string, values: Record<string, string>): string {
  const trimmed = value.trim();
  if (looksLikeSelector(trimmed)) {
    return (
      `<code class="sel"${copyAttrs(trimmed, values)} title="Copy this selector">` +
      `${withVariableSpans(escapeHtml(trimmed), values)}</code>`
    );
  }
  return `<code>${withVariableSpans(escapeHtml(value), values)}</code>`;
}

function renderLink(label: string, href: string, values: Record<string, string>): string {
  // A fragment or `selector:` href is a Highlight control in the panel, not
  // a place to go — outside it, only the label means anything.
  if (href.startsWith("#") || href.startsWith("selector:")) {
    return renderInline(label, values);
  }
  const resolved = resolveText(href, values);
  return (
    `<a href="${escapeAttr(resolved)}" data-href="${escapeAttr(href)}" target="_blank" ` +
    `rel="noopener noreferrer">${renderInline(label, values)}</a>`
  );
}

/** Markdown's inline layer: the marks case prose actually uses. */
export function renderInline(text: string, values: Record<string, string> = {}): string {
  // A fresh scanner per call, not a shared one: this function recurses into
  // the contents of bold, emphasis and link labels, and a `g`-flagged regex
  // shared across those calls has one `lastIndex` between them — the inner
  // call rewinds it and the outer loop then re-matches text it has already
  // emitted, forever.
  const scanner = new RegExp(INLINE_SOURCE, "g");
  let out = "";
  let last = 0;
  for (let match = scanner.exec(text); match; match = scanner.exec(text)) {
    out += withVariableSpans(escapeHtml(text.slice(last, match.index)), values);
    const groups = match.groups ?? {};
    if (groups.value !== undefined) {
      const value = QUOTED_VALUE.exec(match[0])![1];
      out +=
        `<button type="button" class="chip"${copyAttrs(value, values)} ` +
        `title="Copy this value">${withVariableSpans(escapeHtml(value), values)}</button>`;
    } else if (groups.code !== undefined) {
      out += renderCode(INLINE_CODE.exec(match[0])![1], values);
    } else if (groups.link !== undefined) {
      const link = MD_LINK.exec(match[0])!;
      out += renderLink(link[1], link[2], values);
    } else if (groups.varaddr !== undefined) {
      // The sentence's closing punctuation is not part of the address.
      const token = match[0].replace(/[.,;:!?]+$/, "");
      const trailing = match[0].slice(token.length);
      const resolved = resolveText(token, values);
      if (ABSOLUTE_URL.test(resolved) && !HAS_VARIABLE.test(resolved)) {
        out +=
          `<a href="${escapeAttr(resolved)}" data-href="${escapeAttr(token)}" target="_blank" ` +
          `rel="noopener noreferrer">${withVariableSpans(escapeHtml(token), values)}</a>` +
          withVariableSpans(escapeHtml(trailing), values);
      } else {
        out += withVariableSpans(escapeHtml(match[0]), values);
      }
    } else if (groups.bold !== undefined) {
      out += `<strong>${renderInline(BOLD.exec(match[0])![1], values)}</strong>`;
    } else if (groups.em !== undefined) {
      const emphasis = EMPHASIS.exec(match[0])!;
      // Group 1 is the character the guard had to consume — it is ordinary
      // text and has to be put back.
      out +=
        withVariableSpans(escapeHtml(emphasis[1]), values) +
        `<em>${renderInline(emphasis[2], values)}</em>`;
    } else {
      out += `<a href="${escapeAttr(match[0])}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[0])}</a>`;
    }
    last = match.index + match[0].length;
  }
  return out + withVariableSpans(escapeHtml(text.slice(last)), values);
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** Markdown's block layer: paragraphs and the two kinds of list. */
export function renderMarkdown(text: string, values: Record<string, string> = {}): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${renderInline(paragraph.join(" "), values)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    blocks.push(
      `<${tag}>${list.items.map((i) => `<li>${renderInline(i, values)}</li>`).join("")}</${tag}>`,
    );
    list = null;
  };

  for (const line of text.split("\n")) {
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks.join("");
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** Stable per case, so ticking steps off in a downloaded file and in the
 * same case opened from a link share one saved position. Content-derived
 * rather than id-derived because neither delivery carries the case's id. */
function caseKey(doc: TestCaseVersion): string {
  const source = `${doc.title}|${doc.steps.map((s) => s.title).join("|")}`;
  let hash = 5381;
  for (let i = 0; i < source.length; i++) hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/** Values the page starts with: a declared literal default, and nothing
 * else. A generator's value is decided when a run starts, and inventing one
 * here would put a number on the page that no run will ever have used. */
function initialValues(variables: TestCaseVariable[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const variable of variables) {
    if (variable.defaultValue?.trim()) values[variable.name] = variable.defaultValue.trim();
  }
  return values;
}

const ABSOLUTE_URL = /^https?:\/\//i;

function renderWhere(where: string, values: Record<string, string>): string {
  // A bare route is only half an address; the case's own BASE_URL is the
  // other half. Joining them as a *template* — `%BASE_URL%/admin/x` in
  // data-href — is what turns a legacy case's Where into a link, and keeps
  // it live when the reader edits the value: `applyValues` re-resolves
  // data-href, and a template it cannot see BASE_URL in is one it cannot
  // keep current.
  const template =
    where.trim().startsWith("/") && (values.BASE_URL ?? "").trim()
      ? `%BASE_URL%${where.trim()}`
      : where;
  const resolved = resolveText(template, values);
  const openable = ABSOLUTE_URL.test(resolved) && !/\s/.test(resolved);
  const target = openable
    ? `<a href="${escapeAttr(resolved)}" data-href="${escapeAttr(template)}" target="_blank" rel="noopener noreferrer">${withVariableSpans(escapeHtml(where), values)}</a>`
    : withVariableSpans(escapeHtml(where), values);
  return `<p class="where"><span class="where-label">Where</span>${target}</p>`;
}

function renderStep(
  step: Step,
  index: number,
  values: Record<string, string>,
  opts: CasePageOptions,
): string {
  const parts: string[] = [];
  parts.push(
    `<li class="step${step.quick && !opts.simplified ? " is-quick" : ""}" data-step="${escapeAttr(step.id)}"` +
      `${step.quick ? " data-quick" : ""}>`,
  );
  parts.push('<div class="step-head">');
  parts.push(
    `<label class="tick"><input type="checkbox" class="step-check" ` +
      `aria-label="Mark step ${index + 1} done"><span class="num">${index + 1}</span></label>`,
  );
  parts.push(`<h3>${renderInline(step.title, values)}</h3>`);
  if (step.quick && !opts.simplified) {
    parts.push('<span class="badge quick" title="Part of the core path a quick run covers">quick</span>');
  }
  if (step.type === "automated" && !opts.simplified) {
    parts.push('<span class="badge auto" title="Runs as a script in the Enloop extension">automated</span>');
  }
  parts.push("</div>");

  parts.push('<div class="step-body">');
  if (step.where) parts.push(renderWhere(step.where, values));
  if (step.instructions?.trim()) {
    parts.push(`<div class="prose">${renderMarkdown(step.instructions.trim(), values)}</div>`);
  }
  if (!opts.simplified && step.selectors.length > 0) {
    parts.push(
      `<p class="selectors">${step.selectors
        .map(
          (sel) =>
            `<code class="sel"${copyAttrs(sel, values)} title="Copy this selector">` +
            `${withVariableSpans(escapeHtml(sel), values)}</code>`,
        )
        .join("")}</p>`,
    );
  }
  if (!opts.simplified && step.script) {
    parts.push(
      `<details class="script"><summary>Script this step runs</summary>` +
        `<pre><code>${escapeHtml(step.script)}</code></pre>` +
        `<button type="button" class="copy-btn" data-copy="${escapeAttr(step.script)}">Copy script</button>` +
        `</details>`,
    );
  }
  if (step.expected?.trim()) {
    parts.push(
      `<div class="expected"><span class="expected-label">Expected</span>` +
        `<div class="prose">${renderMarkdown(step.expected.trim(), values)}</div></div>`,
    );
  }
  if (step.note?.trim()) {
    parts.push(
      `<details class="note"><summary>Note</summary>` +
        `<div class="prose">${renderMarkdown(step.note.trim(), values)}</div></details>`,
    );
  }
  parts.push("</div></li>");
  return parts.join("");
}

/**
 * The case as markup, without the surrounding document — what the viewer
 * injects and what `renderCasePage` wraps.
 */
export function renderCaseBody(doc: TestCaseVersion, opts: CasePageOptions = {}): string {
  const values = initialValues(doc.variables);
  const shown = opts.simplified ? doc.steps.filter((s) => s.type !== "automated") : doc.steps;
  const omitted = opts.simplified ? doc.steps.filter((s) => s.type === "automated") : [];
  const quickCount = doc.steps.filter((s) => s.quick).length;
  const parts: string[] = [];

  parts.push(
    // The key carries the view as well as the case: the two views show
    // different numbers of steps, so sharing one saved position between them
    // would mean tick 4 of the full case landing on whatever step 4 is once
    // the automated ones are gone.
    `<article class="case" data-case-key="${escapeAttr(caseKey(doc))}${opts.simplified ? "s" : ""}"` +
      `${opts.simplified ? " data-simplified" : ""}>`,
  );

  parts.push("<header class=\"case-head\">");
  parts.push(`<h1>${renderInline(doc.title, values)}</h1>`);
  const meta: string[] = [];
  if (doc.project) meta.push(`<span class="project">${escapeHtml(doc.project)}</span>`);
  if (doc.author) meta.push(`<span>by ${escapeHtml(doc.author)}</span>`);
  meta.push(`<span>v${doc.version}</span>`);
  if (opts.exportedAt) meta.push(`<span>exported ${escapeHtml(opts.exportedAt.slice(0, 10))}</span>`);
  if (opts.simplified) meta.push('<span class="tag">simplified</span>');
  for (const tag of doc.tags) meta.push(`<span class="tag">${escapeHtml(tag)}</span>`);
  parts.push(`<div class="meta">${meta.join("")}</div>`);

  if (shown.length > 0) {
    parts.push('<div class="toolbar">');
    parts.push(
      '<div class="progress"><div class="bar"><span class="fill"></span></div>' +
        `<span class="count">0 of ${shown.length} done</span></div>`,
    );
    parts.push('<div class="tools">');
    // Only a choice where the case draws the distinction — with no quick
    // steps, or with every step quick, the filter hides nothing.
    if (!opts.simplified && quickCount > 0 && quickCount < doc.steps.length) {
      parts.push(
        `<label class="switch"><input type="checkbox" id="quick-only"> quick only (${quickCount})</label>`,
      );
    }
    parts.push('<button type="button" class="ghost" id="reset-progress">Reset ticks</button>');
    parts.push('<button type="button" class="ghost no-print" id="print-page">Print</button>');
    parts.push("</div></div>");
  }
  parts.push("</header>");

  if (doc.description.trim()) {
    parts.push(`<section class="description prose">${renderMarkdown(doc.description.trim(), values)}</section>`);
  }

  if (doc.variables.length > 0) {
    parts.push('<section class="panel variables">');
    parts.push(
      `<h2>Values used in this case</h2>` +
        `<p class="hint">Fill these in and every <code>%NAME%</code> below follows along. ` +
        `Write down what you used, so a rerun means the same thing.</p>`,
    );
    parts.push('<div class="var-grid">');
    for (const variable of doc.variables) {
      const value = values[variable.name] ?? "";
      parts.push('<div class="var-row">');
      parts.push(`<label for="var-${escapeAttr(variable.name)}">%${escapeHtml(variable.name)}%</label>`);
      parts.push(
        `<input id="var-${escapeAttr(variable.name)}" class="var-input" ` +
          `data-var-input="${escapeAttr(variable.name)}" value="${escapeAttr(value)}" ` +
          `placeholder="${escapeAttr(variable.generator ? "generated when a run starts — type what you used" : "no default")}">`,
      );
      if (variable.description.trim()) {
        parts.push(`<p class="hint">${renderInline(variable.description.trim())}</p>`);
      }
      if (variable.match?.trim()) {
        parts.push(
          `<p class="hint">Must match <code>${escapeHtml(variable.match.trim())}</code>.</p>`,
        );
      }
      parts.push("</div>");
    }
    parts.push("</div></section>");
  }

  if (doc.prerequisites.length > 0 || doc.dependencies.length > 0) {
    parts.push('<section class="panel before">');
    parts.push("<h2>Before you start</h2>");
    if (doc.prerequisites.length > 0) {
      parts.push(`<ul class="checklist">`);
      for (const item of doc.prerequisites) {
        parts.push(
          `<li><label><input type="checkbox" class="pre-check"> <span>${renderInline(item, values)}</span></label></li>`,
        );
      }
      parts.push("</ul>");
    }
    if (doc.dependencies.length > 0) {
      parts.push('<p class="hint">These must already be true, and are not yours to arrange:</p>');
      parts.push(
        `<ul class="deps">${doc.dependencies
          .map((d) => `<li>${renderInline(d, values)}</li>`)
          .join("")}</ul>`,
      );
    }
    parts.push("</section>");
  }

  parts.push('<section class="steps-section"><h2>Steps</h2>');
  if (shown.length === 0) {
    parts.push(
      '<p class="hint empty">This document has no steps to work through' +
        (omitted.length > 0 ? " by hand — every step in it is automated." : ".") +
        "</p>",
    );
  } else {
    parts.push('<ol class="steps">');
    shown.forEach((step, index) => parts.push(renderStep(step, index, values, opts)));
    parts.push("</ol>");
  }
  parts.push("</section>");

  if (omitted.length > 0) {
    parts.push('<section class="panel omitted">');
    parts.push(
      `<h2>${omitted.length} automated step${omitted.length === 1 ? "" : "s"} not shown</h2>` +
        `<p class="hint">${omitted.length === 1 ? "It runs" : "They run"} as a script in the Enloop ` +
        `extension rather than by hand:</p>`,
    );
    parts.push(`<ul>${omitted.map((s) => `<li>${renderInline(s.title, values)}</li>`).join("")}</ul>`);
    parts.push("</section>");
  }

  parts.push('<footer class="case-foot">');
  parts.push(
    opts.viewerUrl
      ? `<p>Made with <a href="https://github.com/enloop-md/enloop" target="_blank" rel="noopener noreferrer">Enloop</a>. ` +
          `<a href="${escapeAttr(opts.viewerUrl)}" target="_blank" rel="noopener noreferrer">Open this case online</a> — ` +
          `or run it step by step in the Chrome side panel.</p>`
      : `<p>Made with <a href="https://github.com/enloop-md/enloop" target="_blank" rel="noopener noreferrer">Enloop</a>. ` +
          `This page runs entirely in your browser — the case travels in the link, and nothing is uploaded.</p>`,
  );
  parts.push("</footer></article>");
  return parts.join("");
}

/**
 * Everything the page needs to look like itself. Inlined into the download
 * and into the viewer alike — a stylesheet the downloaded file had to fetch
 * would make it a file that only works online, which is the one thing it is
 * for.
 */
export const CASE_PAGE_CSS = `
:root {
  --bg: #f8fafc; --card: #ffffff; --ink: #0f172a; --muted: #64748b; --faint: #94a3b8;
  --line: #e2e8f0; --accent: #059669; --accent-soft: #ecfdf5; --amber: #b45309;
  --amber-soft: #fffbeb; --violet: #7c3aed; --violet-soft: #f5f3ff; --link: #0369a1;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b1120; --card: #111827; --ink: #e2e8f0; --muted: #94a3b8; --faint: #64748b;
    --line: #1f2937; --accent: #34d399; --accent-soft: #052e26; --amber: #fbbf24;
    --amber-soft: #2a1e05; --violet: #c4b5fd; --violet-soft: #221a3d; --link: #7dd3fc;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  padding: 24px 16px 64px;
}
.case { max-width: 46rem; margin: 0 auto; }
.case h1 { font-size: 1.6rem; line-height: 1.25; margin: 0 0 8px; letter-spacing: -0.01em; }
.case h2 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--muted); margin: 28px 0 10px; }
.panel h2, .variables h2 { margin-top: 0; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center;
  font-size: 0.8rem; color: var(--muted); margin-bottom: 16px; }
.meta .project { font-weight: 600; color: var(--ink); }
.meta .tag { background: var(--card); border: 1px solid var(--line); border-radius: 999px;
  padding: 1px 8px; font-size: 0.72rem; }
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
  justify-content: space-between; background: var(--card); border: 1px solid var(--line);
  border-radius: 10px; padding: 10px 12px; }
.progress { display: flex; align-items: center; gap: 10px; flex: 1 1 200px; }
.bar { flex: 1; height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
.fill { display: block; height: 100%; width: 0; background: var(--accent);
  transition: width 160ms ease-out; }
.count { font-size: 0.78rem; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.tools { display: flex; align-items: center; gap: 8px; }
.switch { font-size: 0.78rem; color: var(--muted); display: flex; align-items: center; gap: 5px; }
button.ghost { background: none; border: 1px solid var(--line); color: var(--muted);
  border-radius: 7px; padding: 4px 9px; font-size: 0.75rem; cursor: pointer; font-family: inherit; }
button.ghost:hover { background: var(--bg); color: var(--ink); }
.description { margin-bottom: 8px; color: var(--ink); }
.panel { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 14px 16px; margin: 16px 0; }
.hint { color: var(--muted); font-size: 0.82rem; margin: 4px 0; }
.var-grid { display: grid; gap: 12px; margin-top: 10px; }
.var-row label { display: block; font-size: 0.78rem; font-weight: 600; color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.var-input { width: 100%; margin-top: 3px; padding: 6px 9px; border: 1px solid var(--line);
  border-radius: 7px; background: var(--bg); color: var(--ink); font: inherit; font-size: 0.88rem; }
.var-input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.checklist, .deps { margin: 6px 0; padding-left: 0; list-style: none; }
.deps { padding-left: 18px; list-style: disc; color: var(--muted); }
.checklist li { margin: 4px 0; }
.checklist label { display: flex; gap: 8px; align-items: baseline; cursor: pointer; }
.checklist input:checked + span { color: var(--faint); text-decoration: line-through; }
.steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.step { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 12px 14px; }
.step.is-quick { border-left: 3px solid var(--amber); }
.step-head { display: flex; align-items: baseline; gap: 9px; }
.step-head h3 { flex: 1; margin: 0; font-size: 1rem; font-weight: 600; line-height: 1.4; }
.tick { display: flex; align-items: center; gap: 7px; cursor: pointer; }
.tick input { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; }
.num { font-size: 0.75rem; color: var(--faint); font-variant-numeric: tabular-nums; min-width: 1ch; }
.badge { font-size: 0.66rem; padding: 1px 6px; border-radius: 999px; white-space: nowrap; }
.badge.quick { background: var(--amber-soft); color: var(--amber); }
.badge.auto { background: var(--violet-soft); color: var(--violet); }
.step.done { opacity: 0.55; }
.step.done .step-head h3 { text-decoration: line-through; }
.step-body { padding-left: 39px; }
.step-body > *:first-child { margin-top: 6px; }
.where { margin: 6px 0; font-size: 0.85rem; color: var(--muted); }
.where-label { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--faint); margin-right: 7px; }
.prose p { margin: 6px 0; }
.prose ul, .prose ol { margin: 6px 0; padding-left: 20px; }
.expected { margin-top: 8px; padding: 8px 11px; background: var(--accent-soft);
  border-radius: 8px; }
.expected-label { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--accent); font-weight: 600; }
.expected .prose p:first-child { margin-top: 2px; }
details { margin-top: 8px; font-size: 0.88rem; }
summary { cursor: pointer; color: var(--muted); font-size: 0.78rem; }
pre { overflow-x: auto; background: #0f172a; color: #e2e8f0; padding: 10px 12px;
  border-radius: 8px; font-size: 0.78rem; line-height: 1.5; }
pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
code { background: var(--bg); border: 1px solid var(--line); border-radius: 5px;
  padding: 0 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
code.sel { color: var(--amber); border-color: var(--amber-soft); cursor: pointer; }
.selectors { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
.chip { font: inherit; font-size: 0.85em; background: var(--accent-soft); color: var(--accent);
  border: 1px solid transparent; border-radius: 6px; padding: 1px 7px; cursor: pointer; }
.chip::before, .chip::after { content: '"'; opacity: 0.5; }
.chip:hover { border-color: var(--accent); }
.copy-btn { margin-top: 8px; font: inherit; font-size: 0.75rem; background: none;
  border: 1px solid var(--line); color: var(--muted); border-radius: 7px; padding: 3px 8px;
  cursor: pointer; }
.var { background: var(--violet-soft); color: var(--violet); border-radius: 4px; padding: 0 3px; }
.var[data-unset] { background: var(--amber-soft); color: var(--amber); }
a { color: var(--link); }
.case-foot { margin-top: 32px; padding-top: 14px; border-top: 1px solid var(--line);
  font-size: 0.78rem; color: var(--faint); }
.case-foot a { color: var(--muted); }
.copied { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  background: var(--ink); color: var(--bg); padding: 7px 14px; border-radius: 999px;
  font-size: 0.8rem; box-shadow: 0 6px 20px rgba(0,0,0,0.18); z-index: 20; }
.step[hidden] { display: none; }
@media print {
  body { background: #fff; padding: 0; font-size: 11pt; }
  .toolbar, .no-print, .copy-btn { display: none; }
  .step, .panel { break-inside: avoid; border-color: #ddd; }
  details { display: block; }
  details > summary { display: none; }
  details[class] > *:not(summary) { display: block; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 0.75em; color: #666; }
}
`;

/**
 * Everything the page *does*: ticking steps off, filling values in, copying
 * things to the clipboard.
 *
 * IMPORTANT — this function is serialized with `Function.prototype.toString`
 * and inlined into the standalone HTML download, so it must be completely
 * self-contained: no imports, no module-scope constants, no helpers defined
 * outside its own body. A reference to anything out here compiles fine, runs
 * fine in the viewer, and throws `ReferenceError` in the downloaded file,
 * where the surrounding module does not exist.
 */
export function attachCasePage(root: Document | HTMLElement): void {
  const scope: Document | HTMLElement = root;
  const article = scope.querySelector<HTMLElement>(".case");
  if (!article) return;

  const storageKey = "enloop:progress:" + (article.dataset.caseKey ?? "case");
  const steps = Array.from(scope.querySelectorAll<HTMLElement>(".step"));
  const checks = Array.from(scope.querySelectorAll<HTMLInputElement>(".step-check"));
  const fill = scope.querySelector<HTMLElement>(".fill");
  const count = scope.querySelector<HTMLElement>(".count");

  function save(): void {
    try {
      const done = checks.map((c) => (c.checked ? "1" : "0")).join("");
      localStorage.setItem(storageKey, done);
    } catch {
      // Private mode, a file:// origin with storage blocked — ticking still
      // works for this sitting, it just will not be there tomorrow.
    }
  }

  function paint(): void {
    let done = 0;
    checks.forEach((check, i) => {
      if (check.checked) done++;
      steps[i]?.classList.toggle("done", check.checked);
    });
    const total = checks.length || 1;
    if (fill) fill.style.width = Math.round((done / total) * 100) + "%";
    if (count) count.textContent = done + " of " + checks.length + " done";
  }

  try {
    const saved = localStorage.getItem(storageKey);
    if (saved && saved.length === checks.length) {
      checks.forEach((check, i) => (check.checked = saved[i] === "1"));
    }
  } catch {
    // Same as above — an unreadable store just means starting fresh.
  }
  paint();

  for (const check of checks) {
    check.addEventListener("change", () => {
      paint();
      save();
    });
  }

  const reset = scope.querySelector<HTMLElement>("#reset-progress");
  if (reset) {
    reset.addEventListener("click", () => {
      for (const check of checks) check.checked = false;
      for (const pre of Array.from(scope.querySelectorAll<HTMLInputElement>(".pre-check"))) {
        pre.checked = false;
      }
      paint();
      save();
    });
  }

  const print = scope.querySelector<HTMLElement>("#print-page");
  if (print) print.addEventListener("click", () => window.print());

  const quickOnly = scope.querySelector<HTMLInputElement>("#quick-only");
  if (quickOnly) {
    quickOnly.addEventListener("change", () => {
      for (const step of steps) {
        step.hidden = quickOnly.checked && step.dataset.quick === undefined;
      }
    });
  }

  // Values: every %NAME% on the page follows the field. An empty value goes
  // back to the literal %NAME% rather than a blank, for the reason
  // `substituteVariables` gives — a blank looks like an instruction that is
  // complete and is not.
  const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>(".var-input"));
  function applyValues(): void {
    const values: Record<string, string> = {};
    for (const input of inputs) {
      const name = input.dataset.varInput;
      if (name) values[name] = input.value.trim();
    }
    for (const span of Array.from(scope.querySelectorAll<HTMLElement>(".var"))) {
      const name = span.dataset.var;
      if (!name) continue;
      // Except in the values panel: a variable's own description names the
      // placeholder ("every %BASE_URL% in the case is replaced with this"),
      // and substituting it there makes the sentence describe itself.
      if (span.closest(".var-row")) continue;
      const value = values[name];
      span.textContent = value ? value : "%" + name + "%";
      if (value) span.removeAttribute("data-unset");
      else span.setAttribute("data-unset", "");
    }
    const resolve = (text: string) =>
      text.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (match, name: string) =>
        values[name] ? values[name] : match,
      );
    for (const anchor of Array.from(scope.querySelectorAll<HTMLAnchorElement>("a[data-href]"))) {
      const template = anchor.dataset.href;
      if (template) anchor.href = resolve(template);
    }
    // What a chip puts on the clipboard follows the field too — copying a
    // literal %LOGIN_EMAIL% into a login form is the one failure here nobody
    // notices until the step does not work.
    for (const target of Array.from(scope.querySelectorAll<HTMLElement>("[data-copy-template]"))) {
      const template = target.dataset.copyTemplate;
      if (template) target.dataset.copy = resolve(template);
    }
  }
  for (const input of inputs) input.addEventListener("input", applyValues);
  if (inputs.length > 0) applyValues();

  // Copying: values, selectors, scripts. `navigator.clipboard` is missing on
  // an insecure origin and on some file:// setups, so the textarea fallback
  // is not optional — a downloaded page is opened from disk more often than
  // not.
  let toast: number | undefined;
  function say(message: string): void {
    const existing = document.querySelector(".copied");
    if (existing) existing.remove();
    const element = document.createElement("div");
    element.className = "copied";
    element.textContent = message;
    document.body.appendChild(element);
    window.clearTimeout(toast);
    toast = window.setTimeout(() => element.remove(), 1400);
  }

  scope.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-copy]");
    if (!target) return;
    const text = target.dataset.copy ?? "";
    const done = () => say("Copied");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => say("Could not copy"));
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      done();
    } catch {
      say("Could not copy");
    }
    area.remove();
  });
}

/**
 * The case as one self-contained HTML file: markup, styles and behaviour
 * inlined, nothing fetched. This is what the side panel's HTML download
 * writes — a file you can attach to a ticket, mail to a tester, or open from
 * a USB stick five years from now.
 */
export function renderCasePage(doc: TestCaseVersion, opts: CasePageOptions = {}): string {
  const title = doc.title.replace(/[<>]/g, "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CASE_PAGE_CSS}</style>
</head>
<body>
${renderCaseBody(doc, opts)}
<script>(${attachCasePage.toString()})(document);</script>
</body>
</html>
`;
}
