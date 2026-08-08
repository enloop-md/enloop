/**
 * What the page said about itself while a run was happening: what it logged,
 * what it threw, and which of its requests failed.
 *
 * A run otherwise records only what the tester can see. The console is where
 * the cheapest evidence of a bug lives and where it is invisible by default —
 * an uncaught `TypeError` behind a button that appears to do nothing, a 401
 * logged by a fetch wrapper, a framework warning explaining why a list renders
 * twice. Today that reaches a run only when a tester opens DevTools and pastes
 * text into a step comment, which happens on the runs where someone already
 * suspected a problem and never on the green ones.
 *
 * Two artifacts come out of this, and they have different jobs:
 *
 * - **`console.jsonl`** — the record. Appended a batch at a time while the run
 *   is in progress, one JSON object per line, never read by a human.
 * - **`console.md`** — rendered from the record when the run finishes, grouped
 *   by step, for a person (or `/enloop:check`) to read.
 *
 * The split is what keeps the digest honest. Building a digest needs the
 * entries back, and parsing them out of prose we just wrote would be a parser
 * to maintain for no reason. Nothing here decides *whether* to capture: that
 * is a per-install toggle, off by default, in the extension.
 */

/** Every kind of line the capture can produce.
 *
 * `uncaught` is separate from `error` because in some frameworks a thrown
 * error never reaches `console.error` at all, and it is the level that most
 * often explains a step that "did nothing". `notice` is Enloop's own voice —
 * the cap marker — and is never something the page said. */
export type CaptureLevel =
  | "log"
  | "info"
  | "warn"
  | "error"
  | "debug"
  | "uncaught"
  | "network"
  | "notice";

/** One captured line. Deliberately flat: it is written as JSON a line at a
 * time and read back whole, and a nested shape buys nothing for either. */
export interface CapturedEntry {
  level: CaptureLevel;
  /** ISO timestamp, taken in the page at the moment it happened. */
  at: string;
  /** URL of the page (or frame) it came from, **query string redacted** — see
   * `redactUrl` in the page-side script. */
  url: string;
  /** The whole line, already formatted and bounded by the page-side script. */
  text: string;
  /** Only for `error`/`uncaught`, and only when the page provided one. */
  stack?: string;
  /** The step that was running when it arrived — stamped by the extension,
   * never by the page. Null for a free run, and for anything logged before
   * the first step started. */
  stepId?: string | null;
  /** The structure behind a `network` line, kept so the digest can group by
   * status rather than by a string containing a duration. Never headers and
   * never bodies: those are the parts that carry credentials by design. */
  request?: { method: string; status: number | null; durationMs: number };
}

/**
 * Ceilings per run. A chatty app must not be able to make a run unsavable,
 * and it must not be able to do it quietly either — the cap writes itself into
 * the log as a `notice` entry, because silent truncation would be read as "the
 * page went quiet", which is the opposite of what happened.
 *
 * Note that the cap **stops capture** rather than dropping the oldest entries,
 * which is what `PLAN-TOOLING.md` originally suggested. Entries are already on
 * disk by the time a cap is reached, and the earliest ones — everything logged
 * during page load — are the most valuable, so evicting them would spend the
 * budget on exactly the wrong half.
 */
export const CAPTURE_MAX_ENTRIES = 2000;
export const CAPTURE_MAX_BYTES = 512 * 1024;

/** Per-step, and per-run, tallies. Stored in `run.json` so the report and
 * `/enloop:check` can point at a step without opening the artifact. */
export interface CaptureCounts {
  consoleErrors: number;
  consoleWarnings: number;
  networkFailures: number;
}

export const ZERO_CAPTURE_COUNTS: CaptureCounts = {
  consoleErrors: 0,
  consoleWarnings: 0,
  networkFailures: 0,
};

/** `error` and `uncaught` both count as errors: to a reader of the report the
 * distinction is a detail of how the page reported it, not of how bad it is. */
function bump(counts: CaptureCounts, level: CaptureLevel): void {
  if (level === "error" || level === "uncaught") counts.consoleErrors += 1;
  else if (level === "warn") counts.consoleWarnings += 1;
  else if (level === "network") counts.networkFailures += 1;
}

export function totalCounts(entries: CapturedEntry[]): CaptureCounts {
  const counts = { ...ZERO_CAPTURE_COUNTS };
  for (const entry of entries) bump(counts, entry.level);
  return counts;
}

/** Keyed by `stepId`; entries with no step land under `""`. */
export function countsByStep(entries: CapturedEntry[]): Map<string, CaptureCounts> {
  const byStep = new Map<string, CaptureCounts>();
  for (const entry of entries) {
    const key = entry.stepId ?? "";
    let counts = byStep.get(key);
    if (!counts) {
      counts = { ...ZERO_CAPTURE_COUNTS };
      byStep.set(key, counts);
    }
    bump(counts, entry.level);
  }
  return byStep;
}

/** True when a set of counts is worth mentioning at all. */
export function hasCaptureSignal(counts: CaptureCounts): boolean {
  return counts.consoleErrors > 0 || counts.consoleWarnings > 0 || counts.networkFailures > 0;
}

/** "2 errors, 1 warning" — the phrase used in the report, the panel and the
 * digest, so all three agree on wording as well as on numbers. */
export function describeCounts(counts: CaptureCounts): string {
  const parts: string[] = [];
  if (counts.consoleErrors) parts.push(plural(counts.consoleErrors, "error"));
  if (counts.consoleWarnings) parts.push(plural(counts.consoleWarnings, "warning"));
  if (counts.networkFailures) parts.push(plural(counts.networkFailures, "failed request"));
  return parts.join(", ");
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// ---- the record: console.jsonl ----

export function toJsonl(entries: CapturedEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
}

/**
 * Reads the record back. Skips a line it cannot parse instead of throwing:
 * this file is appended to while a browser tab is being driven around, so a
 * torn final line is a normal thing to find, and one of them must not cost
 * the run its whole log.
 */
export function parseJsonl(text: string): CapturedEntry[] {
  const entries: CapturedEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as CapturedEntry;
      if (parsed && typeof parsed.level === "string" && typeof parsed.text === "string") {
        entries.push(parsed);
      }
    } catch {
      // A half-written line — see above.
    }
  }
  return entries;
}

// ---- the readable artifact: console.md ----

const LEVEL_LABEL: Record<CaptureLevel, string> = {
  log: "log",
  info: "info",
  warn: "warn",
  error: "error",
  debug: "debug",
  uncaught: "uncaught",
  network: "network",
  notice: "enloop",
};

/** Just the time — the date is on the run and repeating it on 2000 lines
 * makes the level, which is what anyone scans for, harder to find. */
function clock(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toISOString().slice(11, 23);
}

/**
 * `console.md`: every entry, in order, under the step that was running when it
 * arrived.
 *
 * Everything is here, including `log` and `info` — this is the artifact you
 * open when the digest was not enough, and a filtered "full log" would send
 * the reader to DevTools on a page that has since navigated away.
 *
 * `stepLabel` turns a stamped id into something a human recognises ("Step 3 —
 * Sync the contact"); entries with no step (a free run, or anything logged
 * before step 1) are grouped under `unstepped`.
 */
export function renderCaptureLog(
  entries: CapturedEntry[],
  opts: {
    title: string;
    /** Run/session identity, printed under the title. */
    subtitle?: string;
    stepLabel?: (stepId: string) => string;
    unstepped?: string;
  },
): string {
  const lines: string[] = [];
  lines.push(`# ${opts.title} — console and network`);
  lines.push("");
  if (opts.subtitle) {
    lines.push(opts.subtitle);
    lines.push("");
  }
  const counts = totalCounts(entries);
  lines.push(
    entries.length === 0
      ? "Capture was on and the page printed nothing."
      : `${entries.length} entries — ${describeCounts(counts) || "no errors, warnings or failed requests"}.`,
  );
  lines.push("");
  lines.push(
    "Query strings are redacted as `?…`; request headers and bodies are never captured.",
  );

  // Grouped in order of first appearance rather than by sorting on stepId:
  // steps advance monotonically during a run, so first-appearance order *is*
  // execution order, and it stays right for a free run that has no steps.
  const groups: Array<{ key: string; entries: CapturedEntry[] }> = [];
  for (const entry of entries) {
    const key = entry.stepId ?? "";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, entries: [entry] });
  }

  for (const group of groups) {
    lines.push("");
    lines.push(
      `## ${
        group.key
          ? (opts.stepLabel?.(group.key) ?? group.key)
          : (opts.unstepped ?? "Before the first step")
      }`,
    );
    lines.push("");
    // The page an entry came from is printed when it changes rather than on
    // every line: a step that navigates twice is the case where it matters,
    // and repeating one URL down 200 lines is the case where it is noise.
    let shownUrl = "";
    for (const entry of group.entries) {
      if (entry.url && entry.url !== shownUrl) {
        shownUrl = entry.url;
        lines.push(`_on ${entry.url}_`);
      }
      lines.push(`- \`${clock(entry.at)}\` **${LEVEL_LABEL[entry.level]}** ${entry.text}`);
      if (entry.stack) {
        // Indented so Markdown keeps it as part of the bullet rather than
        // starting a new block, and fenced so a stack full of `at foo (…)`
        // is not reflowed into a paragraph.
        lines.push("");
        lines.push(indent(entry.stack, "  "));
        lines.push("");
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

// ---- the digest: what the report is allowed to carry ----

export interface CaptureDigestItem {
  level: CaptureLevel;
  text: string;
  stack?: string;
  /** How many times this message appeared. */
  count: number;
  /** The step it first appeared in — null when it arrived outside one. */
  firstStepId: string | null;
}

export interface CaptureDigest {
  counts: CaptureCounts;
  items: CaptureDigestItem[];
  /** Distinct messages left out by the item cap. */
  omittedMessages: number;
  /** `log`/`info`/`debug` lines the digest deliberately does not carry. */
  chatterLines: number;
  /** Whatever the capture itself said — currently only the cap marker. */
  notices: string[];
}

/** Distinct messages a digest will carry before it stops and counts. */
const DIGEST_MAX_ITEMS = 25;
/** Stack frames kept per item, after vendor frames are collapsed. */
const DIGEST_MAX_FRAMES = 5;

/**
 * What crosses into the report: errors, warnings, uncaught exceptions and
 * failed requests, deduplicated.
 *
 * A raw log is mostly repetition, and repetition in a prompt is both expensive
 * and actively misleading — fifty identical React warnings read as fifty
 * problems. So identical messages collapse to one item with an occurrence
 * count and the step they first showed up in, and `log`/`info`/`debug` are
 * dropped entirely (they stay in `console.md`, which is not going anywhere).
 */
export function buildCaptureDigest(entries: CapturedEntry[]): CaptureDigest {
  const byKey = new Map<string, CaptureDigestItem>();
  const notices: string[] = [];
  let chatterLines = 0;

  for (const entry of entries) {
    if (entry.level === "notice") {
      notices.push(entry.text);
      continue;
    }
    if (entry.level === "log" || entry.level === "info" || entry.level === "debug") {
      chatterLines += 1;
      continue;
    }
    const key = dedupeKey(entry);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      // The duration belonged to one occurrence. Keeping it on a line that now
      // says "×2" would claim both requests took the same time.
      if (existing.level === "network") {
        existing.text = existing.text.replace(/ in \d+ms$/, "");
      }
      // Keep the first stack we saw: later occurrences of the same message
      // are usually the same code path, and the first one is the one that
      // happened closest to whatever the tester was doing at the time.
      if (!existing.stack && entry.stack) existing.stack = collapseStack(entry.stack, entry.url);
      continue;
    }
    byKey.set(key, {
      level: entry.level,
      text: entry.text,
      stack: entry.stack ? collapseStack(entry.stack, entry.url) : undefined,
      count: 1,
      firstStepId: entry.stepId ?? null,
    });
  }

  // Loudest first, then by level severity — a report read top-down should hit
  // the thing that happened 40 times before the one that happened once.
  const ranked = [...byKey.values()].sort(
    (a, b) => b.count - a.count || severity(b.level) - severity(a.level),
  );

  return {
    counts: totalCounts(entries),
    items: ranked.slice(0, DIGEST_MAX_ITEMS),
    omittedMessages: Math.max(0, ranked.length - DIGEST_MAX_ITEMS),
    chatterLines,
    notices,
  };
}

function severity(level: CaptureLevel): number {
  if (level === "uncaught") return 4;
  if (level === "error") return 3;
  if (level === "network") return 2;
  if (level === "warn") return 1;
  return 0;
}

/**
 * What counts as "the same message".
 *
 * Network lines key on method, path and status with the duration thrown away —
 * two 500s on the same endpoint are one finding, and `312ms` vs `340ms` would
 * otherwise make them two. Everything else keys on the text with the parts
 * that vary per occurrence — ids, timestamps, hashes — flattened, so a message
 * carrying a record id does not produce one item per record.
 */
function dedupeKey(entry: CapturedEntry): string {
  if (entry.level === "network" && entry.request) {
    return `network|${entry.request.method}|${entry.url}|${entry.request.status ?? "failed"}`;
  }
  return `${entry.level}|${normalizeMessage(entry.text)}`;
}

function normalizeMessage(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "…")
    .replace(/\b[0-9a-f]{8,}\b/gi, "…")
    .replace(/\d{3,}/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/**
 * Keeps the frames from the app's own code and collapses the rest.
 *
 * A stack is mostly framework: twenty frames of scheduler internals around the
 * two that name a file someone can open. Same-origin frames are kept (the app
 * under test), `node_modules`/vendor bundles and other origins are counted and
 * summarised, so the shape of the stack survives without the noise.
 */
function collapseStack(stack: string, pageUrl: string): string {
  let origin = "";
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    // A page URL we cannot parse (an `about:` frame) — then nothing is
    // "the app's own", and the head of the stack is the best we can do.
  }

  const kept: string[] = [];
  let collapsed = 0;
  for (const line of stack.split("\n")) {
    const isVendor =
      /node_modules|\/vendor|chunk-vendors|webpack-internal/.test(line) ||
      (origin && /https?:\/\//.test(line) && !line.includes(origin));
    if (kept.length < DIGEST_MAX_FRAMES && !isVendor) kept.push(line.trimEnd());
    else collapsed += 1;
  }
  if (collapsed > 0) kept.push(`    … ${collapsed} vendor/framework ${collapsed === 1 ? "frame" : "frames"}`);
  return kept.join("\n");
}

/**
 * The digest as it appears inside `report.md` — the only form in which
 * captured output ever leaves the run folder, and then only when the tester
 * ticked the box at finish.
 *
 * `stepLabel` is given the stamped step id and returns whatever the report
 * calls that step, so the digest cross-references the step list above it.
 */
export function renderCaptureDigest(
  digest: CaptureDigest,
  stepLabel: (stepId: string | null) => string,
): string {
  const lines: string[] = [];
  lines.push("## Console and network");
  lines.push("");
  lines.push(
    `${describeCounts(digest.counts) || "Nothing was logged"} while this run was in progress. ` +
      "Identical messages are collapsed; `×N` is how many times one appeared.",
  );
  for (const notice of digest.notices) {
    lines.push("");
    lines.push(`**${notice}**`);
  }
  lines.push("");
  for (const item of digest.items) {
    const where = stepLabel(item.firstStepId);
    lines.push(
      `- **${LEVEL_LABEL[item.level]}${item.count > 1 ? ` ×${item.count}` : ""}**` +
        `${where ? ` (${where})` : ""} ${item.text}`,
    );
    if (item.stack) {
      lines.push("");
      lines.push(indent(item.stack, "  "));
      lines.push("");
    }
  }
  if (digest.omittedMessages > 0) {
    lines.push("");
    lines.push(
      `${digest.omittedMessages} further distinct ${
        digest.omittedMessages === 1 ? "message" : "messages"
      } not listed.`,
    );
  }
  if (digest.chatterLines > 0) {
    lines.push("");
    lines.push(
      `${plural(digest.chatterLines, "log/info line")} ${
        digest.chatterLines === 1 ? "is" : "are"
      } in \`console.md\` in this run's folder and not repeated here.`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** Short, one-line form of a digest item — for listing a step's own findings
 * under it, where the full text and stack would bury the step. */
export function summarizeDigestItem(item: CaptureDigestItem, maxLength = 140): string {
  const text = item.text.length > maxLength ? `${item.text.slice(0, maxLength - 1)}…` : item.text;
  return `${LEVEL_LABEL[item.level]}${item.count > 1 ? ` ×${item.count}` : ""}: ${text}`;
}
