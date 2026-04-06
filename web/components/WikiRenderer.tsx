"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import type { Components } from "react-markdown";

interface WikiRendererProps {
  content: string;
  className?: string;
}

/**
 * Pre-process markdown to convert [[wikilinks]] into standard markdown links
 * that react-markdown can handle, then use custom renderers for Next.js Link.
 */
function processWikilinks(text: string): string {
  // [[display|slug]] or [[slug]]
  return text.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_match, slugOrDisplay, slug) => {
    const displayText = slug ? slugOrDisplay : slugOrDisplay;
    const linkSlug = slug || slugOrDisplay;
    const normalized = linkSlug
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-");
    return `[${displayText}](/wiki/${normalized})`;
  });
}

export default function WikiRenderer({ content, className = "" }: WikiRendererProps) {
  const processed = processWikilinks(content);

  const components: Components = {
    a: ({ href, children, ...props }) => {
      if (href && href.startsWith("/")) {
        return (
          <Link href={href} className="text-accent hover:text-accent-hover underline">
            {children}
          </Link>
        );
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:text-accent-hover underline"
          {...props}
        >
          {children}
        </a>
      );
    },
    table: ({ children, ...props }) => (
      <div className="overflow-x-auto mb-4">
        <table className="w-full border-collapse" {...props}>
          {children}
        </table>
      </div>
    ),
    pre: ({ children, ...props }) => (
      <pre className="bg-surface-2 border border-surface-3 rounded-lg p-4 mb-4 overflow-x-auto" {...props}>
        {children}
      </pre>
    ),
    code: ({ children, className: codeClassName, ...props }) => {
      const isInline = !codeClassName;
      if (isInline) {
        return (
          <code className="bg-surface-3 px-1.5 py-0.5 rounded text-sm text-indigo-300" {...props}>
            {children}
          </code>
        );
      }
      return (
        <code className={codeClassName} {...props}>
          {children}
        </code>
      );
    },
    blockquote: ({ children, ...props }) => (
      <blockquote className="border-l-4 border-accent pl-4 my-4 text-gray-400 italic" {...props}>
        {children}
      </blockquote>
    ),
  };

  return (
    <div className={`wiki-content ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}
