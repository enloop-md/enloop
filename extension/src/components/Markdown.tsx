import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HighlightLink } from "./HighlightLink.js";
import { looksLikeSelector, selectorFromHref } from "../lib/selector-text.js";

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
 * Pass `highlightSelectors={false}` where a page to highlight against is not
 * the point — free-run notes, say — to render everything as plain text.
 */
export function Markdown({
  text,
  className,
  highlightSelectors = true,
}: {
  text: string;
  className?: string;
  highlightSelectors?: boolean;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            const selector = highlightSelectors ? selectorFromHref(href) : null;
            if (selector) {
              const label = typeof children === "string" ? children : selector;
              return <HighlightLink selector={selector} label={label} />;
            }
            return (
              <a
                {...props}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline hover:text-blue-700"
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
