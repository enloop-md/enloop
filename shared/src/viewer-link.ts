/**
 * Turning a case file into a link someone can open.
 *
 * The viewer (`viewer/`, published to GitHub Pages) is a static page with no
 * server and no storage behind it, so a link to "this case" has to carry the
 * case itself. It travels base64url-encoded in the `c` parameter:
 *
 *   https://ryabenko-pro.github.io/enloop/?c=IyBTaWduIGluCkAdmVyc2lvbi4uLg
 *
 * base64url rather than plain base64 for one specific reason: a `+` in a
 * query string decodes as a space in most parsers (including
 * `URLSearchParams`), so a plain-base64 payload arrives silently corrupted
 * about half the time. `-`/`_` cannot be mangled that way. The decoder here
 * still accepts either alphabet — plus spaces, so a link that went through a
 * `+`-eating parser anyway is repaired rather than rejected.
 *
 * Nothing is uploaded: the page reads the parameter and parses it in the
 * reader's own browser. That is also why the viewer accepts `#c=` as well —
 * a fragment is never sent to the host at all, which matters when a case
 * names internal URLs. See `viewer/src/lib/url-case.ts`.
 */

/** Where the published viewer lives. A different deployment (a fork, a
 * company mirror) overrides it per call via `opts.baseUrl`. */
export const VIEWER_BASE_URL = "https://ryabenko-pro.github.io/enloop/";

/** The query parameter the viewer reads the case out of. */
export const VIEWER_CASE_PARAM = "c";

/**
 * Longest link worth embedding in a file. Chrome itself handles megabytes,
 * but links get pasted into tickets, chat clients and email, and several of
 * those truncate somewhere in the tens of thousands of characters — a
 * silently cut link is worse than an honest one, since it fails at the
 * reader's end with no clue what happened. Past this size the file gets a
 * plain viewer link and an instruction to paste instead.
 */
const MAX_EMBEDDED_LINK_LENGTH = 16_000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** UTF-8 text as a base64url payload. `btoa` alone throws on anything
 * non-Latin-1, and case files are full of arrows, dashes and quotes that
 * qualify — so the text becomes bytes first. */
export function encodeCaseParam(markdown: string): string {
  return toBase64Url(new TextEncoder().encode(markdown));
}

/**
 * The Markdown a `c` parameter carries. Throws if the payload is not valid
 * base64 — callers show that to the reader, since a truncated link is the
 * single most likely thing to go wrong and "nothing happened" is a bad way
 * to say so.
 */
export function decodeCaseParam(param: string): string {
  // A `+` that survived to here is a real one; a space is a `+` that did
  // not. Both mean the same byte, so normalize before touching the alphabet.
  const normalized = param.trim().replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error(
      "This link's case data is not valid base64 — it was probably truncated somewhere on the way here.",
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** A viewer link carrying `markdown`. */
export function viewerLink(markdown: string, opts: { baseUrl?: string } = {}): string {
  const base = opts.baseUrl ?? VIEWER_BASE_URL;
  return `${base}${base.includes("?") ? "&" : "?"}${VIEWER_CASE_PARAM}=${encodeCaseParam(markdown)}`;
}

/**
 * The generated block, recognised by its `enloop:viewer` marker rather than
 * by position — so a file that has been reordered, or one where an author
 * moved the comment, still gets its old link replaced instead of a second
 * one appended.
 */
const VIEWER_COMMENT_RE = /[ \t]*<!--\s*enloop:viewer\b[\s\S]*?-->[ \t]*\n?/g;

/**
 * The document without its generated viewer comment.
 *
 * Every read that parses or rewrites case text goes through this, because
 * the comment is machine-written and must never reach the model: left in
 * place it lands inside the last step's body, where it would show up in a
 * readable export and be carried into a run's frozen `case.md`.
 */
export function stripViewerComment(markdown: string): string {
  // Untouched when there is nothing to strip — this runs on the editor's
  // load path, and normalizing trailing whitespace on a file nobody
  // generated into would show up as a phantom diff.
  if (!markdown.includes("enloop:viewer")) return markdown;
  return markdown.replace(VIEWER_COMMENT_RE, "").replace(/\s+$/, "") + "\n";
}

/**
 * `markdown` with a fresh viewer link comment at the end, replacing any
 * previous one.
 *
 * The link encodes the document *without* the comment, which is the only
 * self-consistent choice available — a link that encoded the comment
 * containing it could not be computed at all. It also means the reader who
 * follows the link sees exactly what the file says, since the parser strips
 * the comment either way.
 *
 * An HTML comment because that is the one thing Markdown hides everywhere:
 * invisible on GitHub, in an editor preview, and in the viewer itself, while
 * staying plainly readable in the raw file where a person handed the file
 * over is most likely to be looking.
 */
export function withViewerComment(markdown: string, opts: { baseUrl?: string } = {}): string {
  const body = stripViewerComment(markdown).replace(/\s+$/, "");
  const link = viewerLink(body, opts);
  const block =
    link.length <= MAX_EMBEDDED_LINK_LENGTH
      ? `<!-- enloop:viewer
Read this case in a browser — tick off steps, copy the values, fill in the
variables. The link below carries the case itself; nothing is uploaded.

${link}
-->`
      : `<!-- enloop:viewer
Read this case in a browser — tick off steps, copy the values, fill in the
variables. This case is too long to travel in a link, so open the viewer and
paste the file into it:

${opts.baseUrl ?? VIEWER_BASE_URL}
-->`;
  return `${body}\n\n${block}\n`;
}
