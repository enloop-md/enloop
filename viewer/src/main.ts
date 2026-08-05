/**
 * The online viewer: a case, out of a link, in a browser.
 *
 * There is no server here and no storage — the page is static, and the case
 * arrives inside the URL (`?c=<base64url>`, or `#c=` for a link that never
 * reaches a server at all). Decoding, parsing and rendering all happen on the
 * reader's own device.
 *
 * The rendering itself is not this module's job: `renderCaseBody` and
 * `attachCasePage` come from `@tcm/shared`, and the extension inlines the
 * same two into a downloadable HTML file. This module is only the way in —
 * read the link, hand the text to the parser, put the result on the page,
 * and offer the handful of things you can do with a case once it is open.
 */

import {
  attachCasePage,
  CASE_PAGE_CSS,
  decodeCaseParam,
  encodeCaseParam,
  exampleCaseSource,
  parseCaseDocument,
  renderCaseBody,
  renderCasePage,
  VIEWER_CASE_PARAM,
  type TestCaseVersion,
} from "@tcm/shared";
import "./viewer.css";

const styles = document.createElement("style");
styles.textContent = CASE_PAGE_CSS;
document.head.appendChild(styles);

const caseRoot = document.querySelector<HTMLElement>("#case-root")!;
const toolbar = document.querySelector<HTMLElement>("#toolbar")!;
const landing = document.querySelector<HTMLElement>("#landing")!;
const landingError = document.querySelector<HTMLElement>("#landing-error")!;
const pasteBox = document.querySelector<HTMLTextAreaElement>("#paste")!;

/** The case currently on screen, kept as text because that is what a link,
 * a download and the paste box all deal in. */
let source: string | null = null;
let simplified = false;

/** Where this deployment lives — read off the page rather than hard-coded,
 * so a fork or a local `vite preview` generates links to itself. */
function baseUrl(): string {
  return location.origin + location.pathname;
}

function linkFor(markdown: string): string {
  return `${baseUrl()}?${VIEWER_CASE_PARAM}=${encodeCaseParam(markdown)}`;
}

/** The payload out of the query string, or out of the fragment — a fragment
 * is never sent to the host, which is the right default for a case naming
 * internal URLs, so both are accepted and `?c=` wins if somehow both are
 * there. */
function readParam(): string | null {
  const fromQuery = new URLSearchParams(location.search).get(VIEWER_CASE_PARAM);
  if (fromQuery) return fromQuery;
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  return new URLSearchParams(hash).get(VIEWER_CASE_PARAM);
}

function say(message: string): void {
  document.querySelector(".copied")?.remove();
  const toast = document.createElement("div");
  toast.className = "copied";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 1400);
}

function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function fileSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "case";
}

/**
 * A case document parses as a case; a suite's `suite.md` is the same grammar
 * with the steps optional. Anyone can be handed either, and being told "no
 * steps found" about a file that legitimately has none would be the viewer
 * refusing to show something it can render perfectly well.
 */
function parse(markdown: string): TestCaseVersion {
  return parseCaseDocument(
    markdown,
    { version: 1, createdAt: new Date().toISOString() },
    { requireSteps: false },
  );
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.title = title;
  element.addEventListener("click", onClick);
  return element;
}

function renderToolbar(doc: TestCaseVersion, markdown: string): void {
  toolbar.replaceChildren();
  toolbar.hidden = false;

  const brand = document.createElement("a");
  brand.className = "brand";
  brand.href = "https://github.com/ryabenko-pro/enloop";
  brand.target = "_blank";
  brand.rel = "noopener noreferrer";
  brand.textContent = "Enloop";
  toolbar.appendChild(brand);

  const spacer = document.createElement("span");
  spacer.className = "spacer";
  toolbar.appendChild(spacer);

  // Only offered where it changes something: with no scripts and no
  // selectors, the simplified view is the view.
  const hasMachinery = doc.steps.some((s) => s.type === "automated" || s.selectors.length > 0);
  if (hasMachinery) {
    const label = document.createElement("label");
    label.className = "switch";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = simplified;
    toggle.addEventListener("change", () => {
      simplified = toggle.checked;
      show(markdown, { updateUrl: false });
    });
    label.append(toggle, document.createTextNode(" simplified"));
    toolbar.appendChild(label);
  }

  toolbar.appendChild(
    button("🔗 Copy link", "A link with this case inside it — nothing is uploaded", () => {
      const link = linkFor(markdown);
      navigator.clipboard.writeText(link).then(
        () => say("Link copied"),
        () => say("Could not copy — the link is in the address bar"),
      );
    }),
  );

  toolbar.appendChild(
    button("⤓ HTML", "Save this page as one self-contained file that works offline", () => {
      download(
        `${fileSlug(doc.title)}${simplified ? "-simplified" : ""}.html`,
        renderCasePage(doc, {
          simplified,
          exportedAt: new Date().toISOString(),
          viewerUrl: linkFor(markdown),
        }),
        "text/html",
      );
    }),
  );

  toolbar.appendChild(
    button("Open another", "Paste a different case", () => {
      showLanding(markdown);
      history.replaceState(null, "", baseUrl());
    }),
  );
}

function show(markdown: string, opts: { updateUrl?: boolean } = {}): void {
  const doc = parse(markdown);
  source = markdown;
  landing.hidden = true;
  landingError.hidden = true;
  // A fresh holder per render rather than replacing `caseRoot`'s innerHTML:
  // `attachCasePage` binds a click listener to whatever it is given, and
  // re-rendering into the same element — which toggling "simplified" does —
  // would stack a second listener on it and copy everything twice.
  const holder = document.createElement("div");
  holder.innerHTML = renderCaseBody(doc, { simplified, viewerUrl: null });
  caseRoot.replaceChildren(holder);
  attachCasePage(holder);
  renderToolbar(doc, markdown);
  document.title = `${doc.title} — Enloop`;
  if (opts.updateUrl !== false) history.replaceState(null, "", linkFor(markdown));
  window.scrollTo(0, 0);
}

function showLanding(prefill = "", error?: string): void {
  caseRoot.replaceChildren();
  toolbar.hidden = true;
  landing.hidden = false;
  pasteBox.value = prefill;
  landingError.hidden = !error;
  landingError.textContent = error ?? "";
  document.title = "Enloop — test case viewer";
  if (!error) pasteBox.focus();
}

function open(markdown: string): void {
  try {
    show(markdown);
  } catch (e) {
    // A parse failure is nearly always a real case with one thing wrong in
    // it, so the text goes back into the box with the parser's own complaint
    // above it rather than being thrown away.
    showLanding(markdown, e instanceof Error ? e.message : String(e));
  }
}

document.querySelector("#show-case")?.addEventListener("click", () => {
  const text = pasteBox.value.trim();
  if (text) open(text);
});

document.querySelector("#load-example")?.addEventListener("click", () => open(exampleCaseSource()));

// Ctrl/⌘+Enter from the box, which is what anyone who has used a comment
// field expects.
pasteBox.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    const text = pasteBox.value.trim();
    if (text) open(text);
  }
});

// Back/forward between links, and someone editing the address bar by hand.
window.addEventListener("popstate", () => {
  const param = readParam();
  if (param) open(decodeCaseParam(param));
  else showLanding(source ?? "");
});

const initial = readParam();
if (initial) {
  try {
    open(decodeCaseParam(initial));
  } catch (e) {
    showLanding("", e instanceof Error ? e.message : String(e));
  }
} else {
  showLanding();
}
