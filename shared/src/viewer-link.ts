/**
 * Turning a case file into a link someone can open.
 *
 * The viewer (`viewer/`, published to GitHub Pages) is a static page with no
 * server and no storage behind it, so a link to "this case" has to carry the
 * case itself. It travels deflate-compressed and base64url-encoded in the `c`
 * *fragment* parameter:
 *
 *   https://enloop-md.github.io/enloop/#c=~q1bKSM3JyVfSUUjOSSwuVrIC
 *
 * A fragment rather than a query string because a fragment is never sent to
 * the server: it stays in the reader's browser, never reaches GitHub Pages,
 * and never lands in an access log. Cases name internal URLs, staging
 * credentials and customer records, so the payload has no business leaving the
 * two machines at either end of the link. Nothing was ever uploaded — the page
 * decodes and parses in the reader's own browser either way — but with `?c=`
 * the host still saw the bytes go past.
 *
 * Compressed because a link has to survive being pasted into a ticket, a chat
 * client or an email, several of which give up somewhere in the tens of
 * thousands of characters. Case Markdown deflates to between a third and a
 * half of the characters it took before — it is repetitive text full of
 * repeated selectors, step numbering and URLs — which is the difference
 * between a long case fitting in a link and having to be pasted.
 *
 * The decoder still reads the old uncompressed `?c=` links — see
 * `COMPRESSED_MARKER` — because those are already out in tickets and files.
 */

/** Where the published viewer lives. A different deployment (a fork, a
 * company mirror) overrides it per call via `opts.baseUrl`. */
export const VIEWER_BASE_URL = "https://enloop-md.github.io/enloop/";

/** The fragment parameter the viewer reads the case out of. */
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

/**
 * Marks a payload as compressed.
 *
 * `~` is unreserved in a URL, so it survives every parser untouched, and it is
 * not in the base64url alphabet, so a payload either starts with it or is one
 * of the uncompressed links written before this existed. That is the whole
 * reason for a marker: those links are already sitting in tickets and in case
 * files nobody has rewritten yet, and they have to keep working.
 */
const COMPRESSED_MARKER = "~";

/**
 * Bytes backed by their own `ArrayBuffer`, which is what the `Response` and
 * stream APIs below insist on — a bare `Uint8Array` may sit on a
 * `SharedArrayBuffer`, and they will not take one.
 */
type Bytes = Uint8Array<ArrayBuffer>;

function toBase64Url(bytes: Bytes): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * base64url — or plain base64, or base64 that has been through a `+`-eating
 * parser — back to bytes.
 *
 * The tolerance is for the old `?c=` links: a `+` in a query string decodes as
 * a space in most parsers (including `URLSearchParams`), so a plain-base64
 * payload arrived silently corrupted about half the time. A `+` that survived
 * to here is a real one and a space is a `+` that did not; both mean the same
 * byte, so both are normalized before the alphabet is touched.
 */
function fromBase64Url(param: string): Bytes {
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
  return bytes;
}

/**
 * Bytes through one of the platform's compression streams.
 *
 * `Response` on both ends is the shortest way to get a one-shot buffer in and a
 * one-shot buffer back out of an API built for streaming: it turns the input
 * into a `ReadableStream` and collects the output without anyone having to
 * hand-manage a writer, a reader and the backpressure between them.
 */
async function through(
  bytes: Bytes,
  transform: CompressionStream | DecompressionStream,
): Promise<Bytes> {
  const piped = new Response(bytes).body!.pipeThrough(transform);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

/**
 * Raw deflate — the same compression a zip archive stores its entries with,
 * without the archive around it. There is no file list to carry here, only one
 * blob of text, and every header byte saved is a byte of link length back.
 */
function deflate(bytes: Bytes): Promise<Bytes> {
  return through(bytes, new CompressionStream("deflate-raw"));
}

function inflate(bytes: Bytes): Promise<Bytes> {
  return through(bytes, new DecompressionStream("deflate-raw"));
}

/** UTF-8 text, deflated, as a base64url payload. The text becomes bytes
 * first because `btoa` throws on anything non-Latin-1, and case files are full
 * of arrows, dashes and quotes that qualify. */
export async function encodeCaseParam(markdown: string): Promise<string> {
  const compressed = await deflate(new TextEncoder().encode(markdown));
  return COMPRESSED_MARKER + toBase64Url(compressed);
}

/**
 * The Markdown a `c` parameter carries, compressed or not. Throws if the
 * payload will not decode — callers show that to the reader, since a truncated
 * link is the single most likely thing to go wrong and "nothing happened" is a
 * bad way to say so.
 */
export async function decodeCaseParam(param: string): Promise<string> {
  const trimmed = param.trim();
  const compressed = trimmed.startsWith(COMPRESSED_MARKER);
  let bytes = fromBase64Url(compressed ? trimmed.slice(COMPRESSED_MARKER.length) : trimmed);
  if (compressed) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error(
        "This browser cannot unpack a case from a link — update it, or paste the case's Markdown in below instead.",
      );
    }
    try {
      bytes = await inflate(bytes);
    } catch {
      throw new Error(
        "This link's case data could not be unpacked — it was probably truncated somewhere on the way here.",
      );
    }
  }
  return new TextDecoder().decode(bytes);
}

/** A viewer link carrying `markdown`. */
export async function viewerLink(
  markdown: string,
  opts: { baseUrl?: string } = {},
): Promise<string> {
  // Any fragment already on the base goes: the case is the fragment now, and
  // a URL only gets one.
  const base = (opts.baseUrl ?? VIEWER_BASE_URL).replace(/#.*$/, "");
  return `${base}#${VIEWER_CASE_PARAM}=${await encodeCaseParam(markdown)}`;
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
export async function withViewerComment(
  markdown: string,
  opts: { baseUrl?: string } = {},
): Promise<string> {
  const body = stripViewerComment(markdown).replace(/\s+$/, "");
  const link = await viewerLink(body, opts);
  const block =
    link.length <= MAX_EMBEDDED_LINK_LENGTH
      ? `<!-- enloop:viewer
Read this case in a browser — tick off steps, copy the values, fill in the
variables. The link below carries the case itself; nothing is uploaded, and
the part after the # never reaches a server at all.

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
