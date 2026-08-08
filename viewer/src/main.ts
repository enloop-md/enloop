/**
 * The online viewer: a case, out of a link, in a browser.
 *
 * There is no server here and no storage — the page is static, and the case
 * arrives inside the URL (`#c=<deflated base64url>`, or the older `?c=` form).
 * Decoding, parsing and rendering all happen on the reader's own device, and
 * with the case in the fragment the payload never leaves it at all.
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
  exampleCaseSource,
  parseCaseDocument,
  renderCaseBody,
  renderCasePage,
  VIEWER_CASE_PARAM,
  viewerLink,
  type TestCaseVersion,
} from "@tcm/shared";
import { renderBuilder } from "./builder.js";
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

/**
 * The link to whatever is currently on screen.
 *
 * Encoding is asynchronous now that the case is compressed, and the toolbar's
 * Copy has to write to the clipboard inside the click that asked for it —
 * browsers withdraw clipboard permission across an `await`. So the link is
 * computed once when the case is shown and kept here for the buttons to use.
 */
let currentLink: string | null = null;

/** Where this deployment lives — read off the page rather than hard-coded,
 * so a fork or a local `vite preview` generates links to itself. */
function baseUrl(): string {
  return location.origin + location.pathname;
}

function linkFor(markdown: string): Promise<string> {
  return viewerLink(markdown, { baseUrl: baseUrl() });
}

/** The payload out of the fragment, or out of the query string. The fragment
 * is where links have carried the case since it started being compressed, and
 * it is the one that never reaches the host at all — so it wins. `?c=` is
 * still read for the links written before that. */
function readParam(): string | null {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const fromHash = new URLSearchParams(hash).get(VIEWER_CASE_PARAM);
  if (fromHash) return fromHash;
  return new URLSearchParams(location.search).get(VIEWER_CASE_PARAM);
}

function say(message: string, ms = 1400): void {
  document.querySelector(".copied")?.remove();
  const toast = document.createElement("div");
  toast.className = "copied";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), ms);
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
  brand.href = "https://github.com/enloop-md/enloop";
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
      // `currentLink` is all but always ready by the time anyone reaches for
      // the button; the address bar holds the same link, so on the one frame
      // where it is not, say so rather than making the reader wait.
      if (!currentLink) {
        say("Still packing the link — it is in the address bar");
        return;
      }
      navigator.clipboard.writeText(currentLink).then(
        () => say("Link copied"),
        () => say("Could not copy — the link is in the address bar"),
      );
    }),
  );

  toolbar.appendChild(
    button("⤓ HTML", "Save this page as one self-contained file that works offline", () => {
      void (async () => {
        download(
          `${fileSlug(doc.title)}${simplified ? "-simplified" : ""}.html`,
          renderCasePage(doc, {
            simplified,
            exportedAt: new Date().toISOString(),
            viewerUrl: currentLink ?? (await linkFor(markdown)),
          }),
          "text/html",
        );
      })();
    }),
  );

  toolbar.appendChild(
    button("✎ Edit", "Open this case in the builder", () => showBuilder(markdown)),
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
  currentLink = null;
  void refreshLink(markdown, opts.updateUrl !== false);
  window.scrollTo(0, 0);
}

/**
 * Encode the case into a link, hold on to it, and put it in the address bar.
 *
 * `replaceState` rather than assigning `location.hash`, so that opening a case
 * does not stack a history entry the reader has to press back through — and so
 * that it fires no `hashchange`, which would otherwise re-open the case that
 * was just opened.
 */
async function refreshLink(markdown: string, updateUrl: boolean): Promise<void> {
  const link = await linkFor(markdown);
  // Another case may have been opened while this one was compressing.
  if (source !== markdown) return;
  currentLink = link;
  if (updateUrl) history.replaceState(null, "", link);
}

/** The builder, in place of everything else. `initial` pre-fills it from an
 * existing case, which is what the toolbar's Edit passes. */
function showBuilder(initial?: string): void {
  toolbar.hidden = true;
  landing.hidden = true;
  document.title = initial ? "Editing a case — Enloop" : "Build a case — Enloop";
  renderBuilder(
    caseRoot,
    {
      onPreview: (markdown) => open(markdown),
      onClose: () => (source ? show(source) : showLanding()),
    },
    initial,
  );
  window.scrollTo(0, 0);
}

function showLanding(prefill = "", error?: string): void {
  caseRoot.replaceChildren();
  toolbar.hidden = true;
  currentLink = null;
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

document.querySelector("#build-case")?.addEventListener("click", () => showBuilder());

// Ctrl/⌘+Enter from the box, which is what anyone who has used a comment
// field expects.
pasteBox.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    const text = pasteBox.value.trim();
    if (text) open(text);
  }
});

/**
 * Dropping a case file on the page opens it.
 *
 * The shortest route in for the people this viewer is for: a case arrives as
 * a file — attached to a ticket, pulled out of a repo, saved from the
 * extension — and "drag it onto the page" beats opening it in an editor,
 * selecting all, and pasting. It works while a case is already on screen too,
 * which makes it the way to move from one case to the next.
 *
 * Guarded on `Files` rather than on any drag at all: dragging *text* into the
 * paste box is a native behaviour worth keeping, and preventing the default
 * for everything would break it.
 */
const MAX_DROP_BYTES = 1_000_000;
const CASE_FILE_NAME = /\.(md|markdown|txt)$/i;

let dragDepth = 0;

function draggingFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function showDropTarget(on: boolean): void {
  document.body.classList.toggle("dropping", on);
}

/** An error that must not cost someone the case they already have open: the
 * landing screen would replace it, so a case on screen gets a toast instead. */
function refuseDrop(message: string): void {
  if (source) say(message, 3000);
  else showLanding(pasteBox.value, message);
}

async function openDroppedFile(file: File): Promise<void> {
  if (file.size > MAX_DROP_BYTES) {
    refuseDrop(
      `${file.name} is ${Math.round(file.size / 1024)} KB — far larger than any case file. ` +
        "Drop the case's Markdown itself.",
    );
    return;
  }
  if (!CASE_FILE_NAME.test(file.name) && !file.type.startsWith("text/")) {
    refuseDrop(`${file.name} does not look like a case file. Drop the case's Markdown (.md).`);
    return;
  }
  try {
    open(await file.text());
  } catch {
    refuseDrop(`Could not read ${file.name}.`);
  }
}

window.addEventListener("dragenter", (event) => {
  if (!draggingFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  showDropTarget(true);
});

window.addEventListener("dragover", (event) => {
  if (!draggingFiles(event)) return;
  // Without this the browser navigates to the file on drop, which throws the
  // page away — and with it whatever the reader had already ticked off.
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});

// Every child element the pointer crosses fires its own dragleave, so the
// overlay can only come down on the one that balances the first dragenter.
window.addEventListener("dragleave", (event) => {
  if (!draggingFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) showDropTarget(false);
});

window.addEventListener("drop", (event) => {
  if (!draggingFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  showDropTarget(false);
  const file = event.dataTransfer?.files?.[0];
  if (file) void openDroppedFile(file);
});

/** Whatever the URL currently points at, on screen. */
async function openFromUrl(): Promise<void> {
  const param = readParam();
  if (!param) {
    // A fragment that is not a case is not a request to close the one that is
    // open — and closing it would take the reader's ticks with it. Only a URL
    // stripped back to the bare page means "start over".
    if (location.hash && source) return;
    showLanding(source ?? "");
    return;
  }
  let markdown: string;
  try {
    markdown = await decodeCaseParam(param);
  } catch (e) {
    showLanding("", e instanceof Error ? e.message : String(e));
    return;
  }
  // Nothing to do when the URL already describes what is showing — which is
  // what a `hashchange` fired by anything other than a reader pasting a new
  // link would mean.
  if (markdown !== source) open(markdown);
}

// Back/forward between links, and someone editing the address bar by hand —
// which now changes only the fragment, so it arrives as `hashchange` rather
// than as a load.
window.addEventListener("popstate", () => void openFromUrl());
window.addEventListener("hashchange", () => void openFromUrl());

if (readParam()) void openFromUrl();
else showLanding();
