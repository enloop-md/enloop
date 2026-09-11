import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HighlightLink } from "./HighlightLink.js";
import { ValueChip } from "./ValueChip.js";
import { looksLikeSelector, matchesLocations, selectorFromHref } from "@tcm/shared";
import { rehypeQuotedValues } from "../lib/quoted-values.js";
import { rehypePhotoChips } from "../lib/photo-chips.js";

/**
 * Renders test-case content (description, instructions, expected, notes) as
 * Markdown — the case files themselves are Markdown, so a bare URL or a
 * `**bold**` in an instructions line should render as a real link/bold text
 * here rather than literal characters. remark-gfm turns bare `https://...`
 * text into a clickable link even without `[text](url)` syntax.
 *
 * Selectors named in that prose become Highlight controls automatically:
 * inline code that can only be a selector (`#sync-btn`,
 * `[data-testid="row"]`, `.modal .btn`), and links written as
 * `[the Sync button](#sync-btn)`. Authors get this for free — a case
 * written before the feature existed gains it on the next render, with no
 * new grammar to learn. `looksLikeSelector` is deliberately strict about
 * what qualifies; see the reasoning there.
 *
 * Example values an author marked up — `Put "**Buy milk**" in the field` —
 * become controls too, where `insertValues` is set: clicking one arms the
 * page so the next input, textarea or select the tester clicks receives the
 * value, with a copy fallback. The marker is quotes *and* bold together;
 * see `rehypeQuotedValues` for why neither alone will do.
 *
 * `insertValues` is off by default and belongs to the run screen. Inserting
 * a value into the page only means something while a run is in front of the
 * page it is against — in the library, the active tab is whatever the
 * reader happened to be looking at, and offering to type into it is an
 * offer to corrupt something unrelated.
 *
 * Pass `highlightSelectors={false}` where a page to highlight against is not
 * the point — free-run notes, say — to render everything as plain text.
 *
 * `locations` — the case's `@locations` globs — colours every absolute link
 * green when its host fits one and red when it fits none. The link still
 * opens either way: the colour is a warning, not a gate.
 *
 * Where `onRunCommand` is set (the run screen's dependencies, prerequisites
 * and manual-step prose), inline code that reads as a shell command gets a
 * Run button — the command is handed to the agent session watching the data
 * folder, since a side panel cannot spawn processes. Inline code only, by
 * design: a fenced block inside a step is what makes the step automated,
 * and its fence is a *browser* script, never shell.
 *
 * `%PHOTO_n%` — where the step's n-th `### Photo` lands on export — always
 * renders as a small chip rather than as text. With `photoSlots` (the run
 * screen) the chip also says whether the picture exists yet: green once
 * the slot is filled, amber while it is not; anywhere else it is plain
 * grey, a marker and nothing more.
 */
export function Markdown({
  text,
  className,
  highlightSelectors = true,
  insertValues = false,
  onRunCommand,
  locations,
  photoSlots,
}: {
  text: string;
  className?: string;
  highlightSelectors?: boolean;
  insertValues?: boolean;
  onRunCommand?: (command: string) => void;
  locations?: string[];
  /** Which `### Photo` slots of this step have a screenshot, and each
   * spec's caption (index = slot − 1) for the chip's tooltip. Only the run
   * screen knows this. */
  photoSlots?: { filled: number[]; captions: string[] };
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={insertValues ? [rehypeQuotedValues, rehypePhotoChips] : [rehypePhotoChips]}
        components={{
          mark: ({ children }) => <ValueChip value={flattenText(children)} />,
          data: ({ value }) => <PhotoChip n={Number(value)} slots={photoSlots} />,
          a: ({ href, children, ...props }) => {
            const selector = highlightSelectors ? selectorFromHref(href) : null;
            if (selector) {
              const label = typeof children === "string" ? children : selector;
              return <HighlightLink selector={selector} label={label} />;
            }
            const status = locations ? matchesLocations(locations, href ?? "") : "unchecked";
            return (
              <a
                {...props}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS[status]}
                title={
                  status === "mismatch"
                    ? `Does not match this case's @locations: ${locations?.join(", ")}`
                    : status === "match"
                      ? "Matches this case's @locations"
                      : undefined
                }
              >
                {children}
              </a>
            );
          },
          p: ({ ...props }) => <p className="mb-1.5 last:mb-0" {...props} />,
          ul: ({ ...props }) => <ul className="mb-1.5 list-disc pl-4 last:mb-0" {...props} />,
          ol: ({ ...props }) => <ol className="mb-1.5 list-decimal pl-4 last:mb-0" {...props} />,
          code: ({ children, ...props }) => {
            const value = typeof children === "string" ? children : null;
            if (highlightSelectors && value && looksLikeSelector(value)) {
              return <HighlightLink selector={value.trim()} label={value.trim()} />;
            }
            // Inline code cannot contain a newline, which is what keeps
            // fenced blocks (and automated-step scripts) out of this.
            if (onRunCommand && value && !value.includes("\n")) {
              const command = value.trim();
              if (RUNNABLE_COMMAND_RE.test(command)) {
                return (
                  <>
                    <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{command}</code>{" "}
                    <button
                      onClick={() => onRunCommand(command)}
                      className="rounded border border-sky-200 bg-sky-50 px-1 py-px align-baseline text-[10px] font-medium text-sky-700 hover:bg-sky-100"
                      title="Run in the agent session watching this folder"
                    >
                      ▶ Run
                    </button>
                  </>
                );
              }
            }
            return (
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]" {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/**
 * The `%PHOTO_n%` marker. Amber is "the runner has not taken this one
 * yet", green "it is there" — the same question the spec row under the
 * step answers, shown at the place in the prose the picture belongs.
 */
function PhotoChip({ n, slots }: { n: number; slots?: { filled: number[]; captions: string[] } }) {
  const state = !slots ? "plain" : slots.filled.includes(n) ? "filled" : "empty";
  const caption = slots?.captions[n - 1]?.trim();
  const title =
    state === "plain"
      ? `Photo ${n} of this step goes here on export`
      : `${caption || `Photo ${n}`} — ${state === "filled" ? "taken" : "not taken yet"}`;
  return (
    <span className={`inline-block rounded border px-1 align-baseline text-[10px] ${PHOTO_CHIP_CLASS[state]}`} title={title}>
      📷 {n}
    </span>
  );
}

const PHOTO_CHIP_CLASS = {
  plain: "border-slate-200 bg-slate-50 text-slate-500",
  empty: "border-amber-200 bg-amber-50 text-amber-700",
  filled: "border-emerald-200 bg-emerald-50 text-emerald-700",
} as const;

/** A link's colour by where its host stands against `@locations`. */
const LINK_CLASS = {
  unchecked: "text-blue-600 underline hover:text-blue-700",
  match: "text-emerald-700 underline hover:text-emerald-800",
  mismatch: "text-red-600 underline decoration-wavy hover:text-red-700",
} as const;

/** What marks inline code as runnable: it starts like a command someone
 * would author into Dependencies ("node scripts/seed.js --org …"), not like
 * a selector, a value, or a file path. An allowlist of first tokens rather
 * than a heuristic — a false Run button on `#save-btn` costs trust, a
 * missing one costs a copy-paste. */
const RUNNABLE_COMMAND_RE =
  /^(node|npm|npx|pnpm|yarn|python3?|pip|php|composer|symfony|bash|sh|make|docker(-compose)?|go|cargo|\.\/)\s/;

/** The chip needs the literal string an author quoted. Markdown inside a
 * quoted span would arrive as nested nodes rather than a string, so flatten
 * defensively instead of rendering "[object Object]" into a field. */
function flattenText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(flattenText).join("");
  if (typeof children === "number") return String(children);
  return "";
}
