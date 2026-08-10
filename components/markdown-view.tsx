"use client";

import { useMemo } from "react";
import { parseMarkdown, type Block, type InlineNode } from "@/lib/markdown";

// Renders the block tree from lib/markdown as React elements. Nothing here goes
// through dangerouslySetInnerHTML, so the untrusted prompt body can't inject
// markup — the parser already reduced it to a fixed set of node types.

function renderInline(nodes: InlineNode[]): React.ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return <span key={i}>{node.value}</span>;
      case "strong":
        return <strong key={i}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={i}>{renderInline(node.children)}</em>;
      case "code":
        return (
          <code
            key={i}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
          >
            {node.value}
          </code>
        );
      case "link":
        return (
          <a
            key={i}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-4 mb-2 text-xl font-semibold",
  2: "mt-4 mb-2 text-lg font-semibold",
  3: "mt-3 mb-1.5 text-base font-semibold",
  4: "mt-3 mb-1.5 text-sm font-semibold",
  5: "mt-2 mb-1 text-sm font-semibold",
  6: "mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
};

function renderBlock(block: Block, key: number): React.ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as keyof React.JSX.IntrinsicElements;
      return (
        <Tag key={key} className={`${HEADING_CLASS[block.level]} text-foreground`}>
          {renderInline(block.children)}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p key={key} className="my-2 leading-relaxed text-foreground">
          {renderInline(block.children)}
        </p>
      );
    case "code":
      return (
        <pre
          key={key}
          className="my-2 overflow-auto rounded-lg border border-border bg-muted/50 p-3 text-[13px] leading-relaxed"
        >
          <code className="font-mono text-foreground">{block.value}</code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="my-2 border-l-2 border-border pl-3 text-muted-foreground"
        >
          {block.children.map((b, i) => renderBlock(b, i))}
        </blockquote>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          className={`my-2 ml-5 space-y-1 text-foreground ${
            block.ordered ? "list-decimal" : "list-disc"
          }`}
        >
          {block.items.map((item, i) => (
            <li key={i} className="leading-relaxed">
              {renderInline(item)}
            </li>
          ))}
        </Tag>
      );
    }
    case "hr":
      return <hr key={key} className="my-4 border-border" />;
  }
}

export function MarkdownView({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="overflow-auto rounded-lg border border-border bg-background px-4 py-2 text-sm">
      {blocks.length === 0 ? (
        <p className="my-2 text-sm text-muted-foreground">Nothing to preview.</p>
      ) : (
        blocks.map((b, i) => renderBlock(b, i))
      )}
    </div>
  );
}
