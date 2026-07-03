import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders test-case content (description, instructions, expected, notes) as
 * Markdown — the case files themselves are Markdown, so a bare URL or a
 * `**bold**` in an instructions line should render as a real link/bold text
 * here rather than literal characters. remark-gfm turns bare `https://...`
 * text into a clickable link even without `[text](url)` syntax.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-700"
            />
          ),
          p: ({ ...props }) => <p className="mb-1.5 last:mb-0" {...props} />,
          ul: ({ ...props }) => <ul className="mb-1.5 list-disc pl-4 last:mb-0" {...props} />,
          ol: ({ ...props }) => <ol className="mb-1.5 list-decimal pl-4 last:mb-0" {...props} />,
          code: ({ ...props }) => (
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]" {...props} />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
